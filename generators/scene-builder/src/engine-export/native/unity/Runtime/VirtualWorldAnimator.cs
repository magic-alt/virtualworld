using System;
using System.Linq;
using UnityEngine;
using UnityEngine.Animations;
using UnityEngine.Playables;

namespace VirtualWorld
{
    /// <summary>Plays glTFast's imported native clips, supporting legacy and Mecanim import modes.</summary>
    public sealed class VirtualWorldAnimator : MonoBehaviour
    {
        public AnimationClip[] clips = Array.Empty<AnimationClip>();
        public Transform animationRoot;
        Animation legacy;
        Animator animator;
        PlayableGraph graph;
        AnimationMixerPlayable mixer;
        AnimationClipPlayable[] playables;
        float[] weights;
        int active = -1;
        bool ready, paused, loop;
        float speed = 1;
        public string ActiveClip { get { return active >= 0 ? clips[active].name : ""; } }

        void Initialize()
        {
            if (ready) return;
            ready = true;
            if (animationRoot == null) throw new InvalidOperationException("Imported animation root is missing: " + name);
            legacy = animationRoot.GetComponent<Animation>();
            animator = animationRoot.GetComponent<Animator>();
            if (legacy != null) { legacy.playAutomatically = false; legacy.Stop(); }
            if (clips == null) clips = Array.Empty<AnimationClip>();
            if (clips.Length == 0) return;
            if (clips.All(clip => clip != null && clip.legacy))
            {
                if (animator != null) animator.enabled = false;
                if (legacy == null) legacy = animationRoot.gameObject.AddComponent<Animation>();
                legacy.cullingType = AnimationCullingType.AlwaysAnimate;
                foreach (var clip in clips) if (legacy.GetClip(clip.name) == null) legacy.AddClip(clip, clip.name);
                return;
            }
            if (clips.Any(clip => clip == null || clip.legacy)) throw new InvalidOperationException("Mixed/missing legacy and Mecanim animation clips: " + name);
            if (legacy != null) legacy.enabled = false;
            if (animator == null) animator = animationRoot.gameObject.AddComponent<Animator>();
            animator.applyRootMotion = false;
            animator.cullingMode = AnimatorCullingMode.AlwaysAnimate;
            graph = PlayableGraph.Create("VirtualWorld clips " + name);
            graph.SetTimeUpdateMode(DirectorUpdateMode.Manual);
            mixer = AnimationMixerPlayable.Create(graph, clips.Length);
            playables = new AnimationClipPlayable[clips.Length];
            weights = new float[clips.Length];
            for (int i = 0; i < clips.Length; i++)
            {
                playables[i] = AnimationClipPlayable.Create(graph, clips[i]);
                playables[i].SetApplyFootIK(false);
                graph.Connect(playables[i], 0, mixer, i);
            }
            AnimationPlayableOutput.Create(graph, "Animation", animator).SetSourcePlayable(mixer);
            graph.Play();
        }
        public bool HasClip(string clipName) { return clips != null && clips.Any(clip => clip != null && clip.name == clipName); }
        public void Play(string clipName, bool repeat = true, float rate = 1)
        {
            Initialize();
            int next = Array.FindIndex(clips, clip => clip.name == clipName);
            if (next < 0) throw new InvalidOperationException("Missing imported animation clip: " + clipName);
            speed = Mathf.Clamp(rate, 0, 10); loop = repeat;
            if (active == next) { SetPaused(paused); return; }
            active = next;
            if (graph.IsValid())
            {
                playables[active].SetTime(0);
                playables[active].SetDone(false);
                playables[active].SetSpeed(speed);
            }
            else
            {
                var state = legacy[clipName];
                state.wrapMode = repeat ? WrapMode.Loop : WrapMode.ClampForever;
                state.speed = paused ? 0 : speed;
                state.time = 0;
                legacy.CrossFade(clipName, .18f);
            }
        }
        public void SetPaused(bool value)
        {
            paused = value;
            if (legacy != null && active >= 0 && !graph.IsValid())
                foreach (AnimationState state in legacy) state.speed = paused ? 0 : speed;
        }
        void Update()
        {
            if (paused || active < 0 || !graph.IsValid()) return;
            float dt = Mathf.Min(Time.deltaTime, .05f);
            for (int i = 0; i < playables.Length; i++)
            {
                weights[i] = Mathf.MoveTowards(weights[i], i == active ? 1 : 0, dt / .18f);
                mixer.SetInputWeight(i, weights[i]);
                playables[i].SetSpeed(speed);
                double time = playables[i].GetTime();
                if (clips[i].length > 0 && time >= clips[i].length)
                {
                    playables[i].SetTime(loop ? time % clips[i].length : clips[i].length);
                    if (!loop) playables[i].SetSpeed(0);
                }
            }
            graph.Evaluate(dt);
        }
        void OnDisable() { if (legacy != null) legacy.Stop(); }
        void OnDestroy() { if (graph.IsValid()) graph.Destroy(); }
    }
}
