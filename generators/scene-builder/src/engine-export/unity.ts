export function unityFiles(): Record<string, string> {
  return {
    'Runtime/VirtualWorldMetadata.cs': `using UnityEngine;
namespace VirtualWorld {
 public sealed class VirtualWorldMetadata : MonoBehaviour {
  public TextAsset manifest;
  public string sceneId;
  public string nodeId;
  [TextArea(4,20)] public string metadataJson;
 }
}
`,
    'Editor/VirtualWorldImporter.cs': `using System;
using System.IO;
using System.Collections.Generic;
using UnityEngine;
using UnityEditor;
namespace VirtualWorld.Editor {
 public static class VirtualWorldImporter {
  [Serializable] public class Manifest { public int version; public string target; public string entrySceneId; public Asset[] assets; public Scene[] scenes; }
  [Serializable] public class Asset { public string id; public string path; public string sha256; public long bytes; }
  [Serializable] public class Scene { public string id; public string name; public Node[] nodes; public CameraData camera; public EnvironmentData environment; public float[] spawn; public string metadataJson; }
  [Serializable] public class CameraData { public float[] position; public float[] target; }
  [Serializable] public class EnvironmentData { public string background; public float lightIntensity; public float ambientIntensity; }
  [Serializable] public class Node { public string id; public string name; public string parentId; public float[] translation; public float[] rotation; public float[] scale; public bool visible; public bool effectiveVisible; public string model; public ColliderData collider; public string metadataJson; }
  [Serializable] public class ColliderData { public string shape; public float[] size; }
  static Vector3 V(float[] a) { return new Vector3(a[0],a[1],a[2]); }
  static Vector3 Position(float[] a) { return new Vector3(-a[0],a[1],a[2]); }
  static Quaternion Rotation(float[] a) { return new Quaternion(a[0],-a[1],-a[2],a[3]); }
  static bool SafeId(string id) { return !String.IsNullOrEmpty(id) && System.Text.RegularExpressions.Regex.IsMatch(id,@"^[a-zA-Z0-9_-]{1,100}$"); }
  static string ModelPath(string folder,string relative) {
   if(String.IsNullOrEmpty(relative) || !System.Text.RegularExpressions.Regex.IsMatch(relative,@"^models/[a-f0-9]{64}\\.glb$")) throw new InvalidDataException("Unsafe canonical model path: "+relative);
   string path=Path.GetFullPath(Path.Combine(folder,relative));
   if(!path.StartsWith(Path.GetFullPath(folder)+Path.DirectorySeparatorChar,StringComparison.Ordinal)) throw new InvalidDataException("Model escapes export directory");
   return path;
  }
  static string AssetPath(string absolute) {
   string root=Path.GetFullPath(Application.dataPath)+Path.DirectorySeparatorChar;
   absolute=Path.GetFullPath(absolute);
   if(!absolute.StartsWith(root,StringComparison.Ordinal)) throw new InvalidDataException("Copy the export into a unique folder below this project's Assets directory first");
   return "Assets/"+absolute.Substring(root.Length).Replace('\\\\','/');
  }
  [MenuItem("Tools/VirtualWorld/Import manifest")]
  public static void SelectManifest() {
   string path=EditorUtility.OpenFilePanel("Select engine-manifest.json",Application.dataPath,"json");
   if(String.IsNullOrEmpty(path)) return;
   try { Debug.Log("VirtualWorld prefabs: "+Import(path)); }
   catch(Exception error) { Debug.LogException(error); EditorUtility.DisplayDialog("VirtualWorld import failed",error.Message,"OK"); }
  }
  // Batch mode: -executeMethod VirtualWorld.Editor.VirtualWorldImporter.ImportBatch -virtualWorldManifest /absolute/Assets/.../engine-manifest.json
  public static void ImportBatch() {
   string[] args=System.Environment.GetCommandLineArgs();
   for(int i=0;i<args.Length-1;i++) if(args[i]=="-virtualWorldManifest") { Debug.Log(Import(args[i+1])); return; }
   throw new ArgumentException("Missing -virtualWorldManifest");
  }
  public static string Import(string manifestPath) {
   string manifestAssetPath=AssetPath(manifestPath);
   var manifest=JsonUtility.FromJson<Manifest>(File.ReadAllText(manifestPath));
   if(manifest==null || manifest.version!=1 || manifest.scenes==null || manifest.assets==null) throw new InvalidDataException("Unsupported VirtualWorld manifest version");
   string folder=Path.GetDirectoryName(Path.GetFullPath(manifestPath));
   AssetDatabase.ImportAsset(manifestAssetPath,ImportAssetOptions.ForceSynchronousImport|ImportAssetOptions.ForceUpdate);
   var manifestAsset=AssetDatabase.LoadAssetAtPath<TextAsset>(manifestAssetPath);
   var models=new Dictionary<string,GameObject>();
   foreach(var asset in manifest.assets) {
    string absolute=ModelPath(folder,asset.path);
    byte[] bytes=File.ReadAllBytes(absolute);
    if(bytes.LongLength!=asset.bytes) throw new InvalidDataException("Canonical model length mismatch: "+asset.path);
    using(var hash=System.Security.Cryptography.SHA256.Create()) {
     string digest=BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-","").ToLowerInvariant();
     if(digest!=asset.sha256) throw new InvalidDataException("Canonical model hash mismatch: "+asset.path);
    }
    string path=AssetPath(absolute);
    AssetDatabase.ImportAsset(path,ImportAssetOptions.ForceSynchronousImport|ImportAssetOptions.ForceUpdate);
    var prefab=AssetDatabase.LoadAssetAtPath<GameObject>(path);
    if(prefab==null || prefab.GetComponentsInChildren<MeshFilter>(true).Length+prefab.GetComponentsInChildren<SkinnedMeshRenderer>(true).Length==0) throw new InvalidDataException("GLB importer missing/conflicting or no mesh prefab for "+path+". Install com.unity.cloud.gltfast 6.14.1, and remove conflicting GLB importers.");
    models.Add(asset.id,prefab);
   }
   bool entryFound=false;
   foreach(var scene in manifest.scenes) { if(!SafeId(scene.id)) throw new InvalidDataException("Unsafe scene ID"); if(scene.id==manifest.entrySceneId) entryFound=true; }
   if(!entryFound) throw new InvalidDataException("Unknown entrySceneId");
   string parent=Path.GetDirectoryName(manifestAssetPath).Replace('\\\\','/');
   string output=AssetDatabase.GenerateUniqueAssetPath(parent+"/VirtualWorld-Prefabs");
   string guid=AssetDatabase.CreateFolder(parent,Path.GetFileName(output));
   if(String.IsNullOrEmpty(guid)) throw new IOException("Cannot create fresh prefab output directory");
   try {
    foreach(var scene in manifest.scenes) BuildScene(scene,models,manifestAsset,output);
    AssetDatabase.SaveAssets();
    return output;
   } catch { AssetDatabase.DeleteAsset(output); throw; }
  }
  static void BuildScene(Scene scene,Dictionary<string,GameObject> models,TextAsset manifest,string output) {
   var root=new GameObject(scene.id);
   try {
    var rootMetadata=root.AddComponent<VirtualWorldMetadata>();rootMetadata.manifest=manifest;rootMetadata.sceneId=scene.id;rootMetadata.metadataJson=scene.metadataJson;
    var objects=new Dictionary<string,GameObject>();
    foreach(var item in scene.nodes) {
     if(!SafeId(item.id)) throw new InvalidDataException("Unsafe node ID");
     var wrapper=new GameObject(item.id);wrapper.transform.SetParent(root.transform,false);objects.Add(item.id,wrapper);
     var metadata=wrapper.AddComponent<VirtualWorldMetadata>();metadata.manifest=manifest;metadata.sceneId=scene.id;metadata.nodeId=item.id;metadata.metadataJson=item.metadataJson;
    }
    foreach(var item in scene.nodes) {
     var wrapper=objects[item.id];
     if(!String.IsNullOrEmpty(item.parentId)) { if(!objects.ContainsKey(item.parentId)) throw new InvalidDataException("Missing parent: "+item.parentId);wrapper.transform.SetParent(objects[item.parentId].transform,false); }
     wrapper.transform.localPosition=Position(item.translation);wrapper.transform.localRotation=Rotation(item.rotation);wrapper.transform.localScale=V(item.scale);
     // glTFast already converts canonical right-handed model geometry. No negative scale here.
     GameObject model=null;
     if(!String.IsNullOrEmpty(item.model)) {
      if(!models.ContainsKey(item.model)) throw new InvalidDataException("Missing canonical model: "+item.model);
      model=(GameObject)PrefabUtility.InstantiatePrefab(models[item.model]);model.transform.SetParent(wrapper.transform,false);
     }
     if(item.collider!=null && item.effectiveVisible) {
      if(item.collider.shape=="box") wrapper.AddComponent<BoxCollider>().size=V(item.collider.size);
      else if(item.collider.shape=="ball") wrapper.AddComponent<SphereCollider>().radius=item.collider.size[0];
      else if(item.collider.shape=="mesh" && model!=null) {
       foreach(var mesh in model.GetComponentsInChildren<MeshFilter>(true)) { var collision=mesh.gameObject.AddComponent<MeshCollider>();collision.sharedMesh=mesh.sharedMesh; }
       foreach(var skin in model.GetComponentsInChildren<SkinnedMeshRenderer>(true)) { var baked=new Mesh();skin.BakeMesh(baked);var collision=skin.gameObject.AddComponent<MeshCollider>();collision.sharedMesh=baked; AssetDatabase.CreateAsset(baked,AssetDatabase.GenerateUniqueAssetPath(output+"/"+scene.id+"-"+item.id+"-collision.asset")); }
      }
     }
     wrapper.SetActive(item.effectiveVisible);
    }
    var cameraObject=new GameObject("Camera");cameraObject.transform.SetParent(root.transform,false);cameraObject.transform.localPosition=Position(scene.camera.position);Vector3 direction=Position(scene.camera.target)-cameraObject.transform.localPosition;if(direction.sqrMagnitude>0.000001f)cameraObject.transform.localRotation=Quaternion.LookRotation(direction,Vector3.up);
    var camera=cameraObject.AddComponent<Camera>();camera.clearFlags=CameraClearFlags.SolidColor;Color background;if(ColorUtility.TryParseHtmlString(scene.environment.background,out background))camera.backgroundColor=background;
    var sun=new GameObject("Sun");sun.transform.SetParent(root.transform,false);sun.transform.localRotation=Quaternion.Euler(45,-30,0);var light=sun.AddComponent<Light>();light.type=LightType.Directional;light.intensity=scene.environment.lightIntensity;
    bool success;PrefabUtility.SaveAsPrefabAsset(root,AssetDatabase.GenerateUniqueAssetPath(output+"/"+scene.id+".prefab"),out success);if(!success)throw new IOException("Saving scene prefab failed: "+scene.id);
   } finally { UnityEngine.Object.DestroyImmediate(root); }
  }
 }
}
`,
    'README-Unity.md': `# Unity 6 importer\n1. Install com.unity.cloud.gltfast 6.14.1 in your Unity 6 project (Package Manager). Official Editor import documentation: https://docs.unity3d.com/Packages/com.unity.cloud.gltfast@6.14/manual/ImportEditor.html\n2. Copy this archive into a unique directory under Assets/. Wait for script compilation and glTFast GLB imports. The importer uses UnityEditor AssetDatabase APIs and does not compile against glTFast C# types.\n3. Choose Tools > VirtualWorld > Import manifest and select engine-manifest.json. All campaign scenes are saved as separate editable prefabs under a fresh VirtualWorld-Prefabs directory. The manifest entrySceneId identifies the default scene prefab. Drag that prefab into a new Unity scene.\nOriginal scenes/prefabs are never overwritten. Missing/conflicting GLB importers fail clearly before scene creation. Failed partial output and temporary GameObjects are removed. Each wrapper retains the source scene/node IDs, manifest reference and JSON metadata.\nCanonical coordinates are reflected once in wrappers: position (-x,y,z), quaternion (x,-y,-z,w). glTFast model conversion supplies geometry handedness; no second negative scale is applied. Box collider dimensions and ball radius are preserved. Mesh colliders use each imported mesh's transform; skinned collision is baked once.\nPrefab assets cannot serialize global RenderSettings; ambient intensity, fog and navigation/gameplay remain manifest metadata (see compatibility.json). glTF PBR rendering and Unity material pipeline can differ. No Unity Editor execution is claimed without an actual Unity 6 installation.\nBatch: Unity -batchmode -quit -projectPath PATH -executeMethod VirtualWorld.Editor.VirtualWorldImporter.ImportBatch -virtualWorldManifest ABSOLUTE_MANIFEST\n`,
  };
}
