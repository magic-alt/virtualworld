using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace VirtualWorld
{
    /// <summary>Pure deterministic motion state; angles remain canonical radians.</summary>
    public sealed class HarmonicMotion
    {
        public double Angle { get; private set; }
        public double Speed { get; private set; } = 6;
        public bool Moving { get; private set; }
        public bool Paused { get; private set; }
        public bool BrakeInstalled { get; private set; }
        public bool BrakePowered { get; private set; } = true;
        readonly bool hasBrake;
        public readonly double Ratio;
        public double OutputAngle { get { return Angle * Ratio; } }
        public double Cos { get { return Math.Cos(2 * (Angle - OutputAngle)); } }
        public double Sin { get { return Math.Sin(2 * (Angle - OutputAngle)); } }
        public bool Locked { get { return BrakeInstalled && !BrakePowered; } }
        public double ActualSpeed { get { return Moving && !Paused && !Locked ? Speed : 0; } }
        public HarmonicMotion(int flexTeeth, int ringTeeth, bool brake)
        {
            if (flexTeeth < 10 || ringTeeth - flexTeeth != 2) throw new ArgumentException("Invalid harmonic tooth counts");
            Ratio = -(double)(ringTeeth - flexTeeth) / flexTeeth;
            BrakeInstalled = hasBrake = brake;
        }
        public void SetMoving(bool moving) { Moving = moving && !Locked; }
        public void SetSpeed(double rpm) { if (!Double.IsNaN(rpm) && !Double.IsInfinity(rpm)) Speed = Math.Max(-30, Math.Min(30, rpm)); }
        public void Step(double radians) { if (!Moving && !Paused && !Locked && !Double.IsNaN(radians) && !Double.IsInfinity(radians)) Angle += radians; }
        public void Reset() { Angle = 0; Moving = false; }
        public void InstallBrake(bool installed) { BrakeInstalled = hasBrake && installed; BrakePowered = true; Moving = false; }
        public void PowerBrake(bool powered) { if (BrakeInstalled) { BrakePowered = powered; Moving = false; } }
        public void Tick(double dt, bool paused)
        {
            Paused = paused;
            if (dt > 0 && !Double.IsNaN(dt) && !Double.IsInfinity(dt)) Angle += ActualSpeed * Math.PI * 2 / 60 * dt;
        }
    }

    public sealed class VirtualWorldMechanism : MonoBehaviour
    {
        public HarmonicMotion Motion { get; private set; }
        public bool Section { get; private set; }
        public float Explosion { get; private set; }
        public string IsolatedSubsystem { get; private set; }
        public string SelectedSubsystem { get; private set; }
        public readonly HashSet<string> HiddenSubsystems = new HashSet<string>();
        SceneSpec spec;
        Dictionary<string, Transform> nodes;
        readonly Dictionary<string, Quaternion> baseRotations = new Dictionary<string, Quaternion>();
        readonly List<MorphBinding> morphs = new List<MorphBinding>();
        sealed class MorphBinding { public SkinnedMeshRenderer renderer; public int cos, sin; public float cosScale, sinScale; }
        public void Initialize(SceneSpec scene, Dictionary<string, Transform> objects)
        {
            spec = scene; nodes = objects;
            var mechanism = spec.mechanism;
            Motion = new HarmonicMotion(mechanism.flexTeeth, mechanism.ringTeeth, (mechanism.subsystems ?? Array.Empty<MechanismSubsystem>()).Any(s => s.optional == "brake"));
            foreach (string id in new[] { mechanism.waveNodeId, mechanism.flexNodeId, mechanism.outputNodeId }) baseRotations[id] = nodes[id].localRotation;
            foreach (var renderer in nodes[mechanism.flexNodeId].GetComponentsInChildren<SkinnedMeshRenderer>(true))
            {
                var mesh = renderer.sharedMesh;
                int cos = mesh.GetBlendShapeIndex(mechanism.cosMorph), sin = mesh.GetBlendShapeIndex(mechanism.sinMorph);
                if (cos < 0 || sin < 0) continue;
                morphs.Add(new MorphBinding { renderer = renderer, cos = cos, sin = sin,
                    cosScale = mesh.GetBlendShapeFrameWeight(cos, mesh.GetBlendShapeFrameCount(cos) - 1),
                    sinScale = mesh.GetBlendShapeFrameWeight(sin, mesh.GetBlendShapeFrameCount(sin) - 1) });
                renderer.updateWhenOffscreen = true;
            }
            if (morphs.Count == 0) throw new InvalidOperationException("Harmonic flex mesh lost its named morph targets during import");
            ApplyPose(); ApplyVisibility();
        }
        public void Tick(float dt, bool paused) { Motion.Tick(dt, paused); ApplyPose(); }
        public void ApplyPose()
        {
            var mechanism = spec.mechanism;
            nodes[mechanism.waveNodeId].localRotation = baseRotations[mechanism.waveNodeId] * NativeCoordinates.YRotation(Motion.Angle);
            nodes[mechanism.flexNodeId].localRotation = baseRotations[mechanism.flexNodeId] * NativeCoordinates.YRotation(Motion.OutputAngle);
            nodes[mechanism.outputNodeId].localRotation = baseRotations[mechanism.outputNodeId] * NativeCoordinates.YRotation(Motion.OutputAngle);
            foreach (var morph in morphs)
            {
                // Native blend-shape frame weights define the unit scale. Do not clamp signed waves.
                morph.renderer.SetBlendShapeWeight(morph.cos, (float)Motion.Cos * morph.cosScale);
                morph.renderer.SetBlendShapeWeight(morph.sin, (float)Motion.Sin * morph.sinScale);
            }
        }
        public void SetExplosion(float value)
        {
            Explosion = Mathf.Clamp01(value);
            foreach (var node in spec.nodes)
                nodes[node.id].localPosition = NativeCoordinates.Position(node.position) + (node.explode == null ? Vector3.zero : NativeCoordinates.Position(node.explode) * Explosion);
        }
        public void SetSection(bool section) { Section = section; ApplyVisibility(); }
        public void InstallBrake(bool installed)
        {
            Motion.InstallBrake(installed);
            var brake = Subsystems.FirstOrDefault(s => s.optional == "brake");
            if (!installed && brake != null)
            {
                if (IsolatedSubsystem == brake.id) IsolatedSubsystem = null;
                if (SelectedSubsystem == brake.id) SelectedSubsystem = null;
            }
            ApplyVisibility();
        }
        public MechanismSubsystem[] Subsystems { get { return spec.mechanism.subsystems ?? Array.Empty<MechanismSubsystem>(); } }
        public bool Available(MechanismSubsystem subsystem) { return subsystem.optional != "brake" || Motion.BrakeInstalled; }
        public void Select(string id)
        {
            var subsystem = Subsystems.FirstOrDefault(s => s.id == id);
            if (subsystem != null && Available(subsystem)) SelectedSubsystem = id;
        }
        public void SetVisible(string id, bool visible)
        {
            if (visible) HiddenSubsystems.Remove(id); else HiddenSubsystems.Add(id);
            if (!visible && IsolatedSubsystem == id) IsolatedSubsystem = null;
            if (!visible && SelectedSubsystem == id) SelectedSubsystem = null;
            ApplyVisibility();
        }
        public void Isolate(string id)
        {
            if (id != null && !Subsystems.Any(s => s.id == id && Available(s))) return;
            IsolatedSubsystem = id;
            if (id != null) { HiddenSubsystems.Remove(id); SelectedSubsystem = id; }
            ApplyVisibility();
        }
        public void ResetPresentation()
        {
            HiddenSubsystems.Clear(); IsolatedSubsystem = SelectedSubsystem = null;
            Motion.InstallBrake(true); Motion.SetSpeed(6); Motion.Reset();
            SetExplosion(0); SetSection(false); ApplyPose();
        }
        void ApplyVisibility()
        {
            var mechanism = spec.mechanism;
            foreach (var node in spec.nodes)
            {
                bool visible = node.visible;
                if ((mechanism.fullHousingIds ?? Array.Empty<string>()).Contains(node.id)) visible &= !Section;
                if ((mechanism.sectionHousingIds ?? Array.Empty<string>()).Contains(node.id)) visible = Section;
                var subsystem = Subsystems.FirstOrDefault(s => s.nodeIds.Contains(node.id));
                if (subsystem != null) visible &= Available(subsystem) && !HiddenSubsystems.Contains(subsystem.id) && (IsolatedSubsystem == null || IsolatedSubsystem == subsystem.id);
                else if (IsolatedSubsystem != null && node.kind != "group") visible = false;
                nodes[node.id].gameObject.SetActive(visible);
            }
        }
    }
}
