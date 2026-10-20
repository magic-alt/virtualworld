using UnityEngine;

namespace VirtualWorld
{
    /// <summary>Authoring identity. Runtime movement never modifies this source metadata.</summary>
    public sealed class VirtualWorldMetadata : MonoBehaviour
    {
        public TextAsset manifest;
        public string sceneId;
        public string nodeId;
        [TextArea(4, 20)] public string metadataJson;
    }
}
