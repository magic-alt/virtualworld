using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEditor.Build.Reporting;

namespace VirtualWorld.Editor
{
    public static class VirtualWorldImporter
    {
        const string CatalogName = "Catalog.asset";
        static bool SafeId(string id) { return !String.IsNullOrEmpty(id) && Regex.IsMatch(id, @"^[a-zA-Z0-9_-]{1,100}$"); }
        static string Argument(string name, string fallback = null)
        {
            string[] args = System.Environment.GetCommandLineArgs();
            for (int i = 0; i < args.Length - 1; i++) if (args[i] == name) return args[i + 1];
            if (fallback != null) return fallback;
            throw new ArgumentException("Missing " + name);
        }
        static string AssetPath(string absolute)
        {
            string root = Path.GetFullPath(Application.dataPath) + Path.DirectorySeparatorChar;
            absolute = Path.GetFullPath(absolute);
            if (!absolute.StartsWith(root, StringComparison.Ordinal)) throw new InvalidDataException("Copy the export into a unique folder below this project's Assets directory first");
            return "Assets/" + absolute.Substring(root.Length).Replace('\\', '/');
        }
        static string ModelPath(string folder, string relative)
        {
            if (String.IsNullOrEmpty(relative) || !Regex.IsMatch(relative, @"^models/[a-f0-9]{64}\.glb$")) throw new InvalidDataException("Unsafe canonical model path: " + relative);
            string path = Path.GetFullPath(Path.Combine(folder, relative));
            if (!path.StartsWith(Path.GetFullPath(folder) + Path.DirectorySeparatorChar, StringComparison.Ordinal)) throw new InvalidDataException("Model escapes export directory");
            return path;
        }
        [MenuItem("Tools/VirtualWorld/Import manifest")]
        public static void SelectManifest()
        {
            string path = EditorUtility.OpenFilePanel("Select engine-manifest.json", Application.dataPath, "json");
            if (String.IsNullOrEmpty(path)) return;
            try { Debug.Log("VirtualWorld native scenes: " + Import(path)); }
            catch (Exception error) { Debug.LogException(error); EditorUtility.DisplayDialog("VirtualWorld import failed", error.Message, "OK"); }
        }
        public static void ImportBatch() { Debug.Log("VirtualWorld native scenes: " + Import(Argument("-virtualWorldManifest"), Argument("-virtualWorldFont", VirtualWorldFonts.DefaultPath))); }
        public static void ValidateBatch()
        {
            string output = Import(Argument("-virtualWorldManifest"), Argument("-virtualWorldFont", VirtualWorldFonts.DefaultPath));
            VirtualWorldValidation.Run(AssetDatabase.LoadAssetAtPath<VirtualWorldCatalog>(output + "/" + CatalogName), output);
        }
        public static void BuildBatch()
        {
            if (!Enum.TryParse(Argument("-virtualWorldBuildTarget", "StandaloneLinux64"), out BuildTarget target) ||
                !new[] { BuildTarget.StandaloneLinux64, BuildTarget.StandaloneWindows64, BuildTarget.StandaloneOSX, BuildTarget.WebGL }.Contains(target))
                throw new ArgumentException("Supported build targets: StandaloneLinux64, StandaloneWindows64, StandaloneOSX, WebGL");
            string directory = Path.GetFullPath(Argument("-virtualWorldBuildPath"));
            if (File.Exists(directory) || Directory.Exists(directory)) throw new IOException("Build directory already exists; choose a fresh directory: " + directory);
            if (!BuildPipeline.IsBuildTargetSupported(BuildPipeline.GetBuildTargetGroup(target), target)) throw new InvalidOperationException("Unity build module is not installed for " + target);
            string output = Import(Argument("-virtualWorldManifest"), Argument("-virtualWorldFont", VirtualWorldFonts.DefaultPath));
            var catalog = AssetDatabase.LoadAssetAtPath<VirtualWorldCatalog>(output + "/" + CatalogName);
            VirtualWorldValidation.Run(catalog, output);
            var manifest = catalog.ReadManifest();
            var scenes = OrderedScenes(manifest).Select(scene => output + "/Scenes/" + scene.id + ".unity").ToArray();
            // A desktop build writes siblings beside its executable. Own a fresh root so
            // UnityPlayer, data folders and other build products cannot overwrite prior work.
            if (File.Exists(directory) || Directory.Exists(directory)) throw new IOException("Build directory appeared during import: " + directory);
            Directory.CreateDirectory(directory);
            string destination = target == BuildTarget.WebGL ? directory : Path.Combine(directory,
                target == BuildTarget.StandaloneWindows64 ? "VirtualWorld.exe" :
                target == BuildTarget.StandaloneOSX ? "VirtualWorld.app" : "VirtualWorld.x86_64");
            var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions { scenes = scenes, target = target, locationPathName = destination, options = BuildOptions.None });
            if (report.summary.result != BuildResult.Succeeded) throw new InvalidOperationException("Unity player build failed: " + report.summary.result + ", errors=" + report.summary.totalErrors);
            if (catalog.uiFontLicense != null) File.WriteAllText(Path.Combine(directory, "Font-LICENSE.txt"), catalog.uiFontLicense.text, new System.Text.UTF8Encoding(false));
            string exportDirectory = Path.GetDirectoryName(Path.GetFullPath(Argument("-virtualWorldManifest")));
            foreach (string notice in new[] { "LICENSES.txt", "ATTRIBUTION.txt", "THIRD_PARTY_NOTICES.md" })
                if (File.Exists(Path.Combine(exportDirectory, notice))) File.Copy(Path.Combine(exportDirectory, notice), Path.Combine(directory, notice), false);
            Debug.Log("VirtualWorld Unity player: " + destination);
        }
        static IEnumerable<NativeScene> OrderedScenes(NativeManifest manifest)
        {
            return manifest.scenes.OrderBy(scene => scene.id == manifest.entrySceneId ? 0 : 1);
        }
        public static string Import(string manifestPath, string fontPath = null)
        {
            string manifestAssetPath = AssetPath(manifestPath);
            var manifest = JsonUtility.FromJson<NativeManifest>(File.ReadAllText(manifestPath));
            if (manifest == null || manifest.version != 1 || manifest.target != "unity" || manifest.scenes == null || manifest.assets == null)
                throw new InvalidDataException("Unsupported VirtualWorld Unity manifest");
            if (manifest.scenes.Length == 0 || !manifest.scenes.Any(scene => scene.id == manifest.entrySceneId) || manifest.scenes.Select(scene => scene.id).Distinct().Count() != manifest.scenes.Length)
                throw new InvalidDataException("Invalid scene identities or entrySceneId");
            foreach (var scene in manifest.scenes)
            {
                if (!SafeId(scene.id)) throw new InvalidDataException("Unsafe scene ID");
                if (scene.nodes == null || scene.nodes.Select(node => node.id).Distinct().Count() != scene.nodes.Length) throw new InvalidDataException("Duplicate/missing node list");
                var spec = scene.ReadSpec();
                if (spec.actor != null && String.IsNullOrEmpty(scene.actorModel)) throw new InvalidDataException("Actor model binding is missing: " + scene.id);
            }
            Font uiFont = VirtualWorldFonts.Resolve(fontPath ?? VirtualWorldFonts.DefaultPath, manifest);
            TextAsset uiFontLicense = VirtualWorldFonts.License(uiFont);
            string folder = Path.GetDirectoryName(Path.GetFullPath(manifestPath));
            AssetDatabase.ImportAsset(manifestAssetPath, ImportAssetOptions.ForceSynchronousImport | ImportAssetOptions.ForceUpdate);
            var manifestAsset = AssetDatabase.LoadAssetAtPath<TextAsset>(manifestAssetPath);
            var imported = new Dictionary<string, GameObject>();
            var clips = new Dictionary<string, AnimationClip[]>();
            foreach (var asset in manifest.assets)
            {
                string absolute = ModelPath(folder, asset.path);
                byte[] bytes = File.ReadAllBytes(absolute);
                if (bytes.LongLength != asset.bytes) throw new InvalidDataException("Canonical model length mismatch: " + asset.path);
                using (var hash = SHA256.Create())
                {
                    string digest = BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
                    if (digest != asset.sha256 || digest != asset.id) throw new InvalidDataException("Canonical model hash mismatch: " + asset.path);
                }
                string path = AssetPath(absolute);
                AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceSynchronousImport | ImportAssetOptions.ForceUpdate);
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
                if (prefab == null || prefab.GetComponentsInChildren<MeshFilter>(true).Length + prefab.GetComponentsInChildren<SkinnedMeshRenderer>(true).Length == 0)
                    throw new InvalidDataException("GLB importer missing/conflicting or no mesh prefab for " + path + ". Install com.unity.cloud.gltfast 6.14.1 and remove conflicting GLB importers.");
                imported.Add(asset.id, prefab);
                clips.Add(asset.id, AssetDatabase.LoadAllAssetsAtPath(path).OfType<AnimationClip>().Where(clip => !clip.name.StartsWith("__preview__", StringComparison.Ordinal)).ToArray());
            }
            string parent = Path.GetDirectoryName(manifestAssetPath).Replace('\\', '/');
            string output = AssetDatabase.GenerateUniqueAssetPath(parent + "/VirtualWorld-Native");
            if (String.IsNullOrEmpty(AssetDatabase.CreateFolder(parent, Path.GetFileName(output)))) throw new IOException("Cannot create fresh native output directory");
            var preview = EditorSceneManager.NewPreviewScene();
            var originalActive = SceneManager.GetActiveScene();
            var previousBuildScenes = EditorBuildSettings.scenes;
            try
            {
                foreach (string name in new[] { "Models", "Prefabs", "Scenes", "Colliders" }) AssetDatabase.CreateFolder(output, name);
                var models = new Dictionary<string, GameObject>();
                foreach (var asset in manifest.assets) models.Add(asset.id, PrepareModel(asset.id, imported[asset.id], clips[asset.id], preview, output));
                var entries = new List<NativeSceneEntry>();
                foreach (var scene in OrderedScenes(manifest))
                {
                    var prefab = BuildScene(scene, models, manifestAsset, preview, output);
                    if (!String.IsNullOrEmpty(scene.actorModel) && !models.ContainsKey(scene.actorModel)) throw new InvalidDataException("Missing actor canonical model: " + scene.actorModel);
                    entries.Add(new NativeSceneEntry { id = scene.id, prefab = prefab, actorPrefab = String.IsNullOrEmpty(scene.actorModel) ? null : models[scene.actorModel] });
                }
                var catalog = ScriptableObject.CreateInstance<VirtualWorldCatalog>(); catalog.manifest = manifestAsset; catalog.uiFont = uiFont; catalog.uiFontLicense = uiFontLicense; catalog.scenes = entries.ToArray();
                AssetDatabase.CreateAsset(catalog, output + "/" + CatalogName);
                var buildScenes = new List<EditorBuildSettingsScene>(previousBuildScenes);
                foreach (var scene in OrderedScenes(manifest))
                {
                    string path = output + "/Scenes/" + scene.id + ".unity";
                    BuildPlayableScene(catalog, scene.id, path);
                    buildScenes.Add(new EditorBuildSettingsScene(path, true));
                }
                EditorBuildSettings.scenes = buildScenes.ToArray();
                AssetDatabase.SaveAssets();
                VirtualWorldValidation.ValidateBindings(catalog);
                return output;
            }
            catch
            {
                EditorBuildSettings.scenes = previousBuildScenes;
                AssetDatabase.DeleteAsset(output);
                throw;
            }
            finally
            {
                EditorSceneManager.ClosePreviewScene(preview);
                if (originalActive.IsValid() && originalActive.isLoaded) SceneManager.SetActiveScene(originalActive);
            }
        }
        static GameObject PrepareModel(string id, GameObject source, AnimationClip[] clips, Scene preview, string output)
        {
            var instance = (GameObject)PrefabUtility.InstantiatePrefab(source, preview);
            try
            {
                if (clips.Length > 0)
                {
                    var binding = instance.AddComponent<VirtualWorldAnimator>(); binding.clips = clips;
                    binding.animationRoot = ResolveAnimationRoot(instance, clips);
                    foreach (var animation in instance.GetComponentsInChildren<Animation>(true)) animation.playAutomatically = false;
                }
                bool success;
                var result = PrefabUtility.SaveAsPrefabAsset(instance, output + "/Models/" + id + ".prefab", out success);
                if (!success || result == null) throw new IOException("Saving model prefab failed: " + id);
                return result;
            }
            finally { UnityEngine.Object.DestroyImmediate(instance); }
        }
        internal static bool MatchesAnimationRoot(Transform root, AnimationClip clip)
        {
            var curves = AnimationUtility.GetCurveBindings(clip).Concat(AnimationUtility.GetObjectReferenceCurveBindings(clip));
            foreach (var curve in curves)
            {
                var target = String.IsNullOrEmpty(curve.path) ? root : root.Find(curve.path);
                if (target == null || (typeof(Component).IsAssignableFrom(curve.type) && target.GetComponent(curve.type) == null)) return false;
            }
            return true;
        }
        static Transform ResolveAnimationRoot(GameObject model, AnimationClip[] clips)
        {
            // glTF import modes can add a scene wrapper. Resolve imported clip paths in
            // the Editor and serialize the exact native root instead of guessing at runtime.
            var components = model.GetComponentsInChildren<Animator>(true).Select(item => item.transform)
                .Concat(model.GetComponentsInChildren<Animation>(true).Select(item => item.transform));
            var candidates = components.Concat(model.GetComponentsInChildren<Transform>(true)).Distinct();
            foreach (var candidate in candidates) if (clips.All(clip => MatchesAnimationRoot(candidate, clip))) return candidate;
            throw new InvalidDataException("No native animation root matches all imported clip paths: " + model.name);
        }
        static GameObject BuildScene(NativeScene scene, Dictionary<string, GameObject> models, TextAsset manifest, Scene preview, string output)
        {
            var spec = scene.ReadSpec();
            var root = new GameObject(scene.id); SceneManager.MoveGameObjectToScene(root, preview);
            try
            {
                var rootMetadata = root.AddComponent<VirtualWorldMetadata>(); rootMetadata.manifest = manifest; rootMetadata.sceneId = scene.id; rootMetadata.metadataJson = scene.metadataJson;
                var objects = new Dictionary<string, GameObject>();
                foreach (var item in scene.nodes)
                {
                    if (!SafeId(item.id)) throw new InvalidDataException("Unsafe node ID");
                    var wrapper = new GameObject(item.id); wrapper.transform.SetParent(root.transform, false); objects.Add(item.id, wrapper);
                    var metadata = wrapper.AddComponent<VirtualWorldMetadata>(); metadata.manifest = manifest; metadata.sceneId = scene.id; metadata.nodeId = item.id; metadata.metadataJson = item.metadataJson;
                }
                foreach (var item in scene.nodes)
                {
                    var wrapper = objects[item.id];
                    if (!String.IsNullOrEmpty(item.parentId))
                    {
                        if (!objects.ContainsKey(item.parentId)) throw new InvalidDataException("Missing parent: " + item.parentId);
                        wrapper.transform.SetParent(objects[item.parentId].transform, false);
                    }
                    wrapper.transform.localPosition = NativeCoordinates.Position(item.translation);
                    wrapper.transform.localRotation = NativeCoordinates.Rotation(item.rotation);
                    wrapper.transform.localScale = NativeCoordinates.Vector(item.scale);
                    GameObject model = null;
                    if (!String.IsNullOrEmpty(item.model))
                    {
                        if (!models.ContainsKey(item.model)) throw new InvalidDataException("Missing canonical model: " + item.model);
                        // glTFast already converted geometry. Never apply a second negative scale.
                        model = (GameObject)PrefabUtility.InstantiatePrefab(models[item.model], preview); model.transform.SetParent(wrapper.transform, false);
                        if (spec.actor != null && spec.actor.nodeId == item.id && VirtualWorldSceneRuntime.TryBounds(model.transform, out var bounds, false) && bounds.size.y > .0001f)
                            model.transform.localScale *= spec.actor.height / bounds.size.y;
                    }
                    if (item.collider != null)
                    {
                        if (item.collider.shape == "box") wrapper.AddComponent<BoxCollider>().size = NativeCoordinates.Vector(item.collider.size);
                        else if (item.collider.shape == "ball") wrapper.AddComponent<SphereCollider>().radius = item.collider.size[0];
                        else if (item.collider.shape == "mesh" && model != null) AddMeshColliders(model, output, scene.id, item.id);
                    }
                    // Static colliders also support native ray picking for mechanical inspection.
                    if (spec.mechanism != null && item.collider == null && model != null) AddMeshColliders(model, output, scene.id, item.id);
                    wrapper.SetActive(item.visible);
                }
                bool success;
                var prefab = PrefabUtility.SaveAsPrefabAsset(root, output + "/Prefabs/" + scene.id + ".prefab", out success);
                if (!success || prefab == null) throw new IOException("Saving scene prefab failed: " + scene.id);
                return prefab;
            }
            finally { UnityEngine.Object.DestroyImmediate(root); }
        }
        static void AddMeshColliders(GameObject model, string output, string sceneId, string nodeId)
        {
            foreach (var mesh in model.GetComponentsInChildren<MeshFilter>(true))
                if (mesh.sharedMesh != null) { var collider = mesh.gameObject.AddComponent<MeshCollider>(); collider.sharedMesh = mesh.sharedMesh; }
            foreach (var skin in model.GetComponentsInChildren<SkinnedMeshRenderer>(true))
            {
                var baked = new Mesh(); skin.BakeMesh(baked);
                var collider = skin.gameObject.AddComponent<MeshCollider>(); collider.sharedMesh = baked;
                AssetDatabase.CreateAsset(baked, AssetDatabase.GenerateUniqueAssetPath(output + "/Colliders/" + sceneId + "-" + nodeId + ".asset"));
            }
        }
        static void BuildPlayableScene(VirtualWorldCatalog catalog, string id, string path)
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Additive);
            try
            {
                var root = new GameObject("VirtualWorld Player"); SceneManager.MoveGameObjectToScene(root, scene);
                var player = root.AddComponent<VirtualWorldSceneRuntime>(); player.catalog = catalog; player.uiFont = catalog.uiFont; player.initialSceneId = id;
                if (!EditorSceneManager.SaveScene(scene, path)) throw new IOException("Saving runnable Unity scene failed: " + path);
            }
            finally { EditorSceneManager.CloseScene(scene, true); }
        }
    }
}
