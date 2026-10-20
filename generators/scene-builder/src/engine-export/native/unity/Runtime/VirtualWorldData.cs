using System;
using System.Linq;
using System.Text.RegularExpressions;
using UnityEngine;

namespace VirtualWorld
{
    [Serializable] public sealed class NativeManifest
    {
        public int version;
        public string target, entrySceneId;
        public NativeAsset[] assets;
        public NativeScene[] scenes;
        public CampaignSpec campaign;
    }
    [Serializable] public sealed class NativeAsset { public string id, path, sha256; public long bytes; }
    [Serializable] public sealed class NativeScene
    {
        public string id, name, actorModel, metadataJson;
        public NativeNode[] nodes;
        public CameraSpec camera;
        public EnvironmentSpec environment;
        public float[] spawn;
        public SceneSpec ReadSpec()
        {
            var spec = JsonUtility.FromJson<SceneSpec>(metadataJson);
            if (spec == null || spec.id != id) throw new InvalidOperationException("Invalid scene metadata: " + id);
            spec.nodes = spec.nodes ?? Array.Empty<NodeSpec>();
            spec.tasks = spec.tasks ?? Array.Empty<TaskSpec>();
            foreach (var node in nodes ?? Array.Empty<NativeNode>())
            {
                var authored = spec.nodes.FirstOrDefault(n => n.id == node.id);
                // JsonUtility's default(bool/float) cannot express optional loop=true/speed=1.
                if (authored != null && authored.animation != null)
                {
                    if (!Regex.IsMatch(node.metadataJson, "\"loop\"\\s*:")) authored.animation.loop = true;
                    if (!Regex.IsMatch(node.metadataJson, "\"speed\"\\s*:")) authored.animation.speed = 1;
                }
            }
            return spec;
        }
    }
    [Serializable] public sealed class NativeNode
    {
        public string id, name, parentId, model, metadataJson;
        public float[] translation, rotation, scale;
        public bool visible, effectiveVisible;
        public ColliderSpec collider;
    }
    [Serializable] public sealed class SceneSpec
    {
        public int version, revision;
        public string id, name, description, mode;
        public NodeSpec[] nodes;
        public TaskSpec[] tasks;
        public float[] spawn;
        public CameraSpec camera;
        public EnvironmentSpec environment;
        public NavigationSpec navigation;
        public ActorSpec actor;
        public ChapterIdentity campaign;
        public MechanismSpec mechanism;
    }
    [Serializable] public sealed class NodeSpec
    {
        public string id, name, kind, parentId, assetId, shape, color;
        public float[] position, rotation, scale, size, explode;
        public bool visible;
        public AnimationSpec animation;
        public InteractionSpec interaction;
        public ColliderSpec collider;
        public JointSpec joint;
    }
    [Serializable] public sealed class AnimationSpec { public string clip; public bool loop; public float speed; }
    [Serializable] public sealed class ColliderSpec { public string shape; public float[] size; }
    [Serializable] public sealed class JointSpec { public string axis; public float min, max, value; public bool confirmed; }
    [Serializable] public sealed class CameraSpec { public float[] position, target; }
    [Serializable] public sealed class EnvironmentSpec { public string background; public float lightIntensity, ambientIntensity, fog; }
    [Serializable] public sealed class NavigationSpec { public string kind; public float[] center; public float radius; public PlaneBounds bounds; }
    [Serializable] public sealed class PlaneBounds { public float[] min, max; }
    [Serializable] public sealed class ActorSpec { public string assetId, nodeId; public float height; public ActorClips clips; }
    [Serializable] public sealed class ActorClips { public string idle, walk, interact; }
    [Serializable] public sealed class InteractionSpec
    {
        public string title, text, gives;
        public string[] requires;
        public bool completes;
        public DialogueChoice[] choices;
    }
    [Serializable] public sealed class DialogueChoice { public string label, text; }
    [Serializable] public sealed class TaskSpec { public string flag, label; }
    [Serializable] public sealed class ChapterIdentity { public string id, chapterId; public int index; }
    [Serializable] public sealed class CampaignSpec { public int version; public string id, title; public CampaignChapter[] chapters; }
    [Serializable] public sealed class CampaignChapter { public string id, title, directory; public string[] requires; }
    [Serializable] public sealed class MechanismSpec
    {
        public string kind, waveNodeId, flexNodeId, outputNodeId, cosMorph, sinMorph, referenceNotes;
        public string[] fixedNodeIds, fullHousingIds, sectionHousingIds;
        public int flexTeeth, ringTeeth;
        public MechanismDimensions dimensions;
        public MechanismSubsystem[] subsystems;
    }
    [Serializable] public sealed class MechanismDimensions { public float baseDiameter, housingDiameter, totalHeight, boreDiameter; }
    [Serializable] public sealed class MechanismSubsystem { public string id, name, description, optional; public string[] nodeIds; }

    public static class NativeCoordinates
    {
        public static Vector3 Vector(float[] a) { return new Vector3(a[0], a[1], a[2]); }
        // glTFast reflects model geometry in X. Reflect wrapper positions and rotations exactly once.
        public static Vector3 Position(float[] a) { return new Vector3(-a[0], a[1], a[2]); }
        public static Quaternion Rotation(float[] q) { return new Quaternion(q[0], -q[1], -q[2], q[3]); }
        public static Quaternion YRotation(double radians) { return Quaternion.AngleAxis((float)(-radians * 180 / Math.PI), Vector3.up); }
        public static Vector3 Up(Vector3 position, Vector3 center)
        {
            var direction = position - center;
            return direction.sqrMagnitude < 1e-12f ? Vector3.up : direction.normalized;
        }
        public static Vector3 Tangent(Vector3 direction, Vector3 up)
        {
            var result = Vector3.ProjectOnPlane(direction, up);
            if (result.sqrMagnitude < 1e-8f) result = Vector3.ProjectOnPlane(Mathf.Abs(up.y) < .9f ? Vector3.up : Vector3.right, up);
            return result.normalized;
        }
    }
}
