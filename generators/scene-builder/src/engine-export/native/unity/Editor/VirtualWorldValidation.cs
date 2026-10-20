using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using UnityEngine;
using UnityEditor;
using UnityEditor.SceneManagement;

namespace VirtualWorld.Editor
{
    /// <summary>Executed by an actual Unity Editor. Export-source tests do not execute these checks.</summary>
    public static class VirtualWorldValidation
    {
        [Serializable] sealed class Report
        {
            public string unityVersion, scope;
            public string[] scenes;
            public bool passed;
        }
        static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException("VirtualWorld native validation: " + message);
        }
        static void Near(double actual, double expected, double tolerance, string message)
        {
            Require(Math.Abs(actual - expected) <= tolerance, message + ": " + actual + " != " + expected);
        }
        public static void Run(VirtualWorldCatalog catalog, string output)
        {
            ValidateBindings(catalog); ValidateMotion(); ValidateStories(); ValidateMorphDeformation(catalog);
            var manifest = catalog.ReadManifest();
            foreach (var scene in manifest.scenes) Require(File.Exists(output + "/Scenes/" + scene.id + ".unity"), "runnable scene missing: " + scene.id);
            var report = new Report
            {
                unityVersion = Application.unityVersion,
                scope = "Native import bindings, animation clips, signed morph baking, deterministic motion/story rules. Play-mode navigation and visual parity require separate acceptance checks.",
                scenes = manifest.scenes.Select(scene => scene.id).ToArray(), passed = true
            };
            File.WriteAllText(output + "/native-validation.json", JsonUtility.ToJson(report, true));
            AssetDatabase.ImportAsset(output + "/native-validation.json");
            Debug.Log("VirtualWorld native validation passed: " + output);
        }
        public static void ValidateBindings(VirtualWorldCatalog catalog)
        {
            Require(catalog != null && catalog.manifest != null, "catalog or manifest missing");
            var manifest = catalog.ReadManifest();
            VirtualWorldFonts.Validate(catalog.uiFont, manifest);
            foreach (var scene in manifest.scenes)
            {
                var entry = catalog.Find(scene.id); var spec = scene.ReadSpec();
                Require(entry.prefab != null, "scene prefab missing: " + scene.id);
                foreach (var binding in entry.prefab.GetComponentsInChildren<VirtualWorldAnimator>(true)
                    .Concat(entry.actorPrefab == null ? Array.Empty<VirtualWorldAnimator>() : entry.actorPrefab.GetComponentsInChildren<VirtualWorldAnimator>(true)))
                {
                    Require(binding.animationRoot != null, "animation root missing: " + binding.name);
                    foreach (var clip in binding.clips)
                        Require(clip != null && VirtualWorldImporter.MatchesAnimationRoot(binding.animationRoot, clip), "native clip path does not resolve: " + binding.name);
                }
                var nodes = entry.prefab.GetComponentsInChildren<VirtualWorldMetadata>(true).Where(item => !String.IsNullOrEmpty(item.nodeId)).ToDictionary(item => item.nodeId);
                Require(nodes.Count == scene.nodes.Length, "node count differs: " + scene.id);
                foreach (var item in scene.nodes)
                {
                    Require(nodes.ContainsKey(item.id), "node ID missing: " + item.id);
                    var wrapper = nodes[item.id].transform;
                    Require(Vector3.Distance(wrapper.localPosition, NativeCoordinates.Position(item.translation)) < 1e-5f, "wrapper position differs: " + item.id);
                    Require(Quaternion.Angle(wrapper.localRotation, NativeCoordinates.Rotation(item.rotation)) < .01f, "wrapper rotation differs: " + item.id);
                    Require(Vector3.Distance(wrapper.localScale, NativeCoordinates.Vector(item.scale)) < 1e-5f, "wrapper scale differs: " + item.id);
                    Require(wrapper.gameObject.activeSelf == item.visible, "authored visibility differs: " + item.id);
                    if (!String.IsNullOrEmpty(item.parentId)) Require(wrapper.parent == nodes[item.parentId].transform, "parent binding differs: " + item.id);
                    if (!String.IsNullOrEmpty(item.model)) Require(wrapper.GetComponentsInChildren<Renderer>(true).Length > 0, "visible geometry missing: " + item.id);
                    if (item.collider != null && item.collider.shape == "ball") Near(wrapper.GetComponent<SphereCollider>().radius, item.collider.size[0], 1e-6, "ball radius units");
                }
                foreach (var node in spec.nodes.Where(node => node.animation != null))
                {
                    var animation = nodes[node.id].GetComponentInChildren<VirtualWorldAnimator>(true);
                    Require(animation != null && animation.HasClip(node.animation.clip), "node clip missing: " + node.id + "/" + node.animation.clip);
                }
                if (spec.actor != null)
                {
                    Require(entry.actorPrefab != null && !String.IsNullOrEmpty(scene.actorModel), "actor-only asset was not bound: " + scene.id);
                    var animation = entry.actorPrefab.GetComponent<VirtualWorldAnimator>();
                    foreach (string clip in new[] { spec.actor.clips.idle, spec.actor.clips.walk, spec.actor.clips.interact })
                        Require(animation != null && animation.HasClip(clip), "actor clip missing: " + scene.id + "/" + clip);
                    Require(VirtualWorldSceneRuntime.TryBounds(entry.actorPrefab.transform, out var bounds, false) && bounds.size.y > .0001f, "actor geometry missing");
                    if (!String.IsNullOrEmpty(spec.actor.nodeId)) Require(nodes.ContainsKey(spec.actor.nodeId), "actor preview binding missing");
                }
            }
        }
        static void ValidateMotion()
        {
            var motion = new HarmonicMotion(200, 202, true);
            motion.SetMoving(true); motion.Tick(10, false);
            Near(motion.Angle, Math.PI * 2, 1e-10, "input phase after one revolution");
            Near(motion.OutputAngle, -Math.PI / 50, 1e-10, "negative 100:1 output");
            double phase = motion.Angle;
            motion.Tick(5, true); Near(motion.Angle, phase, 1e-10, "pause preserves phase");
            motion.Tick(0, false); motion.PowerBrake(false); motion.SetMoving(true); motion.Step(1); motion.Tick(10, false);
            Near(motion.Angle, phase, 1e-10, "unpowered brake locks motion");
            motion.PowerBrake(true); motion.Tick(10, false); Near(motion.Angle, phase, 1e-10, "brake release requires explicit start");
            motion.SetSpeed(-100); Near(motion.Speed, -30, 1e-10, "bounded reverse speed");
            motion.Reset(); motion.Step(Math.PI / (2 * (1 - motion.Ratio)));
            Near(motion.Cos, -1, 1e-10, "negative morph phase survives");
            var position = NativeCoordinates.Position(new[] { 1f, 2f, 3f });
            Require(position == new Vector3(-1, 2, 3), "canonical position reflection");
            Require(Vector3.Distance(NativeCoordinates.YRotation(Math.PI / 2) * Vector3.forward, Vector3.left) < 1e-5, "canonical angular reflection");
        }
        static void ValidateStories()
        {
            var first = new InteractionSpec { title = "first", text = "one", gives = "first" };
            var last = new InteractionSpec { title = "last", text = "two", gives = "last", requires = new[] { "first" }, completes = true };
            var scene = new SceneSpec { id = "unity-smoke-" + Guid.NewGuid().ToString("N"), nodes = new[] { new NodeSpec { id = "first", interaction = first }, new NodeSpec { id = "last", interaction = last } }, tasks = new[] { new TaskSpec { flag = "first", label = "one" }, new TaskSpec { flag = "last", label = "two" } } };
            string fingerprint = VirtualWorldProgress.Fingerprint(scene);
            var state = VirtualWorldProgress.Advance(last, new StoryState());
            Require(state.flags.Length == 0 && !state.completed, "locked story skips prerequisites");
            state = VirtualWorldProgress.Advance(first, state); state = VirtualWorldProgress.Advance(last, state);
            Require(state.completed && state.flags.Length == 2, "reachable story does not complete");
            Require(!VirtualWorldProgress.Validate(scene, new StoryState { flags = new[] { "last" }, completed = true }).completed, "forged save skips prerequisite");
            Require(VirtualWorldProgress.Fingerprint(scene) == fingerprint, "play modified authored story");
            try
            {
                VirtualWorldProgress.Save(scene, state);
                Require(VirtualWorldProgress.Load(scene).completed, "saved progress does not resume");
                scene.nodes[1].interaction.text = "new story";
                Require(!VirtualWorldProgress.Load(scene).completed, "changed story reuses obsolete save");
                VirtualWorldProgress.Reset(scene);
                Require(VirtualWorldProgress.Load(scene).flags.Length == 0, "progress reset failed");
            }
            finally { VirtualWorldProgress.Reset(scene); }
        }
        static void ValidateMorphDeformation(VirtualWorldCatalog catalog)
        {
            var preview = EditorSceneManager.NewPreviewScene();
            try
            {
                foreach (var scene in catalog.ReadManifest().scenes)
                {
                    var spec = scene.ReadSpec(); if (spec.mechanism == null) continue;
                    var instance = (GameObject)PrefabUtility.InstantiatePrefab(catalog.Find(scene.id).prefab, preview);
                    try
                    {
                        var nodes = instance.GetComponentsInChildren<VirtualWorldMetadata>(true).Where(item => !String.IsNullOrEmpty(item.nodeId)).ToDictionary(item => item.nodeId, item => item.transform);
                        var mechanism = instance.AddComponent<VirtualWorldMechanism>(); mechanism.Initialize(spec, nodes);
                        var renderers = nodes[spec.mechanism.flexNodeId].GetComponentsInChildren<SkinnedMeshRenderer>(true);
                        bool deformed = false;
                        foreach (var renderer in renderers)
                        {
                            int cos = renderer.sharedMesh.GetBlendShapeIndex(spec.mechanism.cosMorph);
                            int sin = renderer.sharedMesh.GetBlendShapeIndex(spec.mechanism.sinMorph);
                            if (cos < 0 || sin < 0) continue;
                            float unit = renderer.sharedMesh.GetBlendShapeFrameWeight(cos, renderer.sharedMesh.GetBlendShapeFrameCount(cos) - 1);
                            Require(unit > 0, "morph unit scale is invalid");
                            var baseline = new Mesh(); var positive = new Mesh(); var negative = new Mesh();
                            try
                            {
                                renderer.SetBlendShapeWeight(cos, 0); renderer.SetBlendShapeWeight(sin, 0); renderer.BakeMesh(baseline);
                                renderer.SetBlendShapeWeight(cos, unit); renderer.BakeMesh(positive);
                                renderer.SetBlendShapeWeight(cos, -unit); renderer.BakeMesh(negative);
                                Near(renderer.GetBlendShapeWeight(cos), -unit, 1e-5, "negative morph weight was clamped");
                                var a = baseline.vertices; var b = positive.vertices; var c = negative.vertices;
                                Require(a.Length == b.Length && b.Length == c.Length && a.Length > 0, "baked morph topology differs");
                                for (int i = 0; i < a.Length; i++)
                                {
                                    if ((b[i] - a[i]).sqrMagnitude > 1e-12f) deformed = true;
                                    Require(((b[i] + c[i]) * .5f - a[i]).magnitude < 1e-5f, "signed morph deformation is not symmetric");
                                }
                            }
                            finally { UnityEngine.Object.DestroyImmediate(baseline); UnityEngine.Object.DestroyImmediate(positive); UnityEngine.Object.DestroyImmediate(negative); }
                        }
                        Require(deformed, "named morph weights did not deform geometry");
                        string original = JsonUtility.ToJson(spec);
                        mechanism.SetSection(true); mechanism.SetExplosion(.5f);
                        foreach (var subsystem in mechanism.Subsystems) { mechanism.Isolate(subsystem.id); mechanism.SetVisible(subsystem.id, false); }
                        mechanism.InstallBrake(false); mechanism.ResetPresentation();
                        Require(JsonUtility.ToJson(spec) == original, "mechanism presentation modified authored scene");
                    }
                    finally { UnityEngine.Object.DestroyImmediate(instance); }
                }
            }
            finally { EditorSceneManager.ClosePreviewScene(preview); }
        }
    }
}
