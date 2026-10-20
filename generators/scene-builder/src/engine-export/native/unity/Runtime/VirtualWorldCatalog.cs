using System;
using System.Linq;
using UnityEngine;

namespace VirtualWorld
{
    [Serializable] public sealed class NativeSceneEntry
    {
        public string id;
        public GameObject prefab;
        public GameObject actorPrefab;
    }

    /// <summary>Native asset references for an offline packaged player.</summary>
    public sealed class VirtualWorldCatalog : ScriptableObject
    {
        public TextAsset manifest;
        public Font uiFont;
        public TextAsset uiFontLicense;
        public NativeSceneEntry[] scenes;
        public NativeManifest ReadManifest()
        {
            var result = JsonUtility.FromJson<NativeManifest>(manifest.text);
            if (result == null || result.version != 1 || result.target != "unity" || result.scenes == null)
                throw new InvalidOperationException("Unsupported VirtualWorld Unity manifest");
            return result;
        }
        public NativeSceneEntry Find(string id)
        {
            var entry = scenes.FirstOrDefault(scene => scene.id == id);
            if (entry == null) throw new InvalidOperationException("Scene is not in the native catalog: " + id);
            return entry;
        }
    }
}
