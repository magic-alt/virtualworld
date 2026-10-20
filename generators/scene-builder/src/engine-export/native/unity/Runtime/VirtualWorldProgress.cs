using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace VirtualWorld
{
    [Serializable] public sealed class StoryState
    {
        public string[] flags = Array.Empty<string>();
        public bool completed;
        public string message = "";
    }
    [Serializable] sealed class SavedStory { public int version; public string fingerprint; public StoryState state; }
    [Serializable] sealed class StorySignature { public TaskSpec[] tasks; public StoryNode[] nodes; }
    [Serializable] sealed class StoryNode { public string id; public InteractionSpec interaction; }

    public static class VirtualWorldProgress
    {
        static readonly Dictionary<string, string> session = new Dictionary<string, string>();
        static readonly HashSet<string> sessionOnly = new HashSet<string>();
        static string Key(SceneSpec scene) { return "virtualworld:unity:progress:v1:" + scene.id; }
        public static string Fingerprint(SceneSpec scene)
        {
            var signature = new StorySignature { tasks = scene.tasks, nodes = scene.nodes.Where(n => n.interaction != null).Select(n => new StoryNode { id = n.id, interaction = n.interaction }).ToArray() };
            uint hash = 2166136261;
            foreach (char value in JsonUtility.ToJson(signature)) hash = unchecked((hash ^ value) * 16777619);
            return hash.ToString("x8");
        }
        public static bool Available(InteractionSpec interaction, StoryState state)
        {
            return interaction != null && (interaction.requires ?? Array.Empty<string>()).All(flag => state.flags.Contains(flag));
        }
        public static string Status(InteractionSpec interaction, StoryState state)
        {
            if (!Available(interaction, state)) return "locked";
            return !String.IsNullOrEmpty(interaction.gives) && state.flags.Contains(interaction.gives) ? "completed" : "available";
        }
        public static StoryState Advance(InteractionSpec interaction, StoryState state)
        {
            if (!Available(interaction, state)) return new StoryState { flags = state.flags.ToArray(), completed = state.completed, message = "请先完成前置任务，再回到这里。" };
            var flags = new HashSet<string>(state.flags);
            if (!String.IsNullOrEmpty(interaction.gives)) flags.Add(interaction.gives);
            return new StoryState { flags = flags.ToArray(), completed = state.completed || interaction.completes, message = interaction.text };
        }
        public static StoryState Validate(SceneSpec scene, StoryState state)
        {
            if (state == null || state.flags == null || state.flags.Length > 5000) return new StoryState();
            var remaining = new HashSet<string>(state.flags);
            var reachable = new HashSet<string>();
            bool changed;
            do
            {
                changed = false;
                foreach (var node in scene.nodes)
                {
                    var interaction = node.interaction;
                    if (interaction == null || String.IsNullOrEmpty(interaction.gives) || !remaining.Contains(interaction.gives)) continue;
                    if ((interaction.requires ?? Array.Empty<string>()).All(reachable.Contains))
                    {
                        remaining.Remove(interaction.gives); reachable.Add(interaction.gives); changed = true;
                    }
                }
            } while (changed);
            if (remaining.Count != 0) return new StoryState();
            bool canComplete = scene.nodes.Any(n => n.interaction != null && n.interaction.completes && Available(n.interaction, state) && (String.IsNullOrEmpty(n.interaction.gives) || reachable.Contains(n.interaction.gives)));
            return new StoryState { flags = state.flags.Distinct().ToArray(), completed = state.completed && canComplete, message = state.message ?? "" };
        }
        public static StoryState Load(SceneSpec scene)
        {
            try
            {
                var saved = JsonUtility.FromJson<SavedStory>(Read(Key(scene)));
                if (saved == null || saved.version != 1 || saved.fingerprint != Fingerprint(scene)) return new StoryState();
                return Validate(scene, saved.state);
            }
            catch { return new StoryState(); }
        }
        public static void Save(SceneSpec scene, StoryState state)
        {
            Write(Key(scene), JsonUtility.ToJson(new SavedStory { version = 1, fingerprint = Fingerprint(scene), state = Validate(scene, state) }));
        }
        public static void Reset(SceneSpec scene) { Remove(Key(scene)); }
        public static bool Unlocked(NativeManifest manifest, string id)
        {
            if (manifest.campaign == null || manifest.campaign.chapters == null) return true;
            if (!manifest.campaign.chapters.Any(chapter => chapter.id == id)) return true;
            var completed = new HashSet<string>();
            foreach (var chapter in manifest.campaign.chapters)
            {
                bool unlocked = (chapter.requires ?? Array.Empty<string>()).All(completed.Contains);
                if (chapter.id == id) return unlocked;
                var scene = manifest.scenes.FirstOrDefault(candidate => candidate.id == chapter.id);
                if (unlocked && scene != null && Load(scene.ReadSpec()).completed) completed.Add(chapter.id);
            }
            return false;
        }
        public static void Remember(NativeManifest manifest, string id)
        {
            if (manifest.campaign != null && manifest.campaign.chapters.Any(chapter => chapter.id == id)) Write("virtualworld:unity:campaign:v1:" + manifest.campaign.id, id);
        }
        public static string Resume(NativeManifest manifest, string fallback)
        {
            if (manifest.campaign != null && manifest.campaign.chapters.Any(chapter => chapter.id == fallback))
            {
                string saved = Read("virtualworld:unity:campaign:v1:" + manifest.campaign.id);
                if (manifest.scenes.Any(scene => scene.id == saved) && Unlocked(manifest, saved)) return saved;
            }
            return Unlocked(manifest, fallback) ? fallback : manifest.scenes.First(scene => Unlocked(manifest, scene.id)).id;
        }
        public static void ResetCampaign(NativeManifest manifest)
        {
            if (manifest.campaign == null) return;
            foreach (var chapter in manifest.campaign.chapters)
            {
                var scene = manifest.scenes.FirstOrDefault(candidate => candidate.id == chapter.id);
                if (scene != null) Reset(scene.ReadSpec());
            }
            Remove("virtualworld:unity:campaign:v1:" + manifest.campaign.id);
        }
        static string Read(string key)
        {
            try { if (!sessionOnly.Contains(key) && PlayerPrefs.HasKey(key)) return PlayerPrefs.GetString(key); }
            catch { sessionOnly.Add(key); }
            return session.TryGetValue(key, out var value) ? value : "";
        }
        static void Write(string key, string value)
        {
            session[key] = value;
            try { PlayerPrefs.SetString(key, value); PlayerPrefs.Save(); sessionOnly.Remove(key); }
            catch { sessionOnly.Add(key); }
        }
        static void Remove(string key)
        {
            session.Remove(key);
            try { PlayerPrefs.DeleteKey(key); PlayerPrefs.Save(); sessionOnly.Remove(key); }
            catch { sessionOnly.Add(key); }
        }
    }
}
