import * as T from 'three';
import { CadMechanismSchema, type CadMechanism } from '@virtualworld/scene-schema';
import {
  cadBindingPose,
  cadTransmission,
  principlePoint,
  principleCamPoint,
  principleRingRadius,
} from './joint-geometry';

type Entry = {
  object: T.Object3D;
  initial: T.Matrix4;
  visible: boolean;
  binding: CadMechanism['bindings'][number];
};
/** A transient inspection instance. Authored CAD geometry, materials and SceneSpec remain untouched. */
export class CadJointView {
  private entries: Entry[] = [];
  private markers: T.Mesh[] = [];
  private principle?: T.Group;
  private flex?: T.Mesh<T.BufferGeometry>;
  private cam?: T.Mesh<T.BufferGeometry>;
  private ring?: T.Mesh<T.BufferGeometry>;
  private armature?: T.Mesh;
  private principleEnabled = false;
  private markersEnabled = false;
  constructor(
    private model: T.Object3D,
    private config: CadMechanism,
    private content: T.Object3D,
  ) {
    if (config.driveChain) CadMechanismSchema.parse(config);
    if (model.userData.glbSha256 !== config.modelSha256)
      throw new Error('CAD model hash does not match motion bindings');
    model.updateWorldMatrix(true, true);
    const inverse = model.matrixWorld.clone().invert();
    const objects = new Map<number, T.Object3D>();
    model.traverse((o) => {
      const index = o.userData.gltfNodeIndex;
      if (typeof index === 'number') objects.set(index, o);
    });
    for (const binding of config.bindings) {
      const object = objects.get(binding.gltfNodeIndex);
      if (!object) throw new Error(`Missing CAD node ${binding.gltfNodeIndex}`);
      if (
        binding.role === 'ball' &&
        (!binding.center || !config.bearings.some((b) => b.id === binding.bearingId))
      )
        throw new Error('Missing fitted ball geometry');
      this.entries.push({
        object,
        binding,
        visible: object.visible,
        initial: inverse.clone().multiply(object.matrixWorld),
      });
    }
    const configured = new Set(config.bindings.map((binding) => binding.gltfNodeIndex));
    // A tagged glTF node is a mechanical identity. Untagged primitive children
    // remain attached to their node so multi-material bodies still move together.
    for (const [gltfNodeIndex, object] of objects) {
      if (configured.has(gltfNodeIndex)) continue;
      this.entries.push({
        object,
        visible: object.visible,
        initial: inverse.clone().multiply(object.matrixWorld),
        binding: {
          gltfNodeIndex,
          originalPath: `/node/${gltfNodeIndex}`,
          role: 'unknown',
          pivot: [0, 0, 0],
          axis: [0, 0, 1],
        },
      });
    }
    // Flatten only the runtime instance after every binding is validated and
    // all original model-frame transforms (including omitted nodes) are captured.
    for (const e of this.entries) {
      model.attach(e.object);
      e.object.matrixAutoUpdate = false;
      e.object.matrix.copy(e.initial);
    }
    const sphere = new T.SphereGeometry(1, 8, 6),
      material = new T.MeshBasicMaterial({ color: '#ff6840' });
    for (const e of this.entries)
      if (config.motionMarkers !== false && e.binding.role === 'ball' && !e.binding.displayHidden) {
        const b = config.bearings.find((b) => b.id === e.binding.bearingId)!;
        const marker = new T.Mesh(sphere, material);
        marker.name = 'rolling-marker';
        marker.position
          .fromArray(e.binding.center!)
          .add(new T.Vector3(b.ballRadius * 0.93, 0, 0))
          .applyMatrix4(e.initial.clone().invert());
        marker.scale.setScalar(b.ballRadius * 0.18);
        marker.visible = false;
        e.object.add(marker);
        this.markers.push(marker);
      }
    if (!this.markers.length) {
      sphere.dispose();
      material.dispose();
    }
    if (config.principle) {
      this.principle = new T.Group();
      this.principle.name = 'illustrative-principle-layer';
      this.principle.position.fromArray(config.principle.position);
      this.principle.visible = false;
      content.add(this.principle);
      this.flex = new T.Mesh(
        new T.BufferGeometry(),
        new T.MeshBasicMaterial({ color: '#4db7ff', side: T.DoubleSide }),
      );
      this.ring = new T.Mesh(
        new T.BufferGeometry(),
        new T.MeshBasicMaterial({ color: '#e8b25d', side: T.DoubleSide }),
      );
      this.principle.add(this.flex, this.ring);
      // Legacy tiny profiles may have no room for a hollow cam; never generate inverted geometry.
      if (
        principleCamPoint(config.principle, Math.PI / 2, 0).radius >
        config.principle.radius * 0.25
      ) {
        this.cam = new T.Mesh(
          new T.BufferGeometry(),
          new T.MeshBasicMaterial({ color: '#75d7c4', side: T.DoubleSide }),
        );
        this.cam.name = 'illustrative-wave-cam';
        this.principle.add(this.cam);
      }
      this.armature = new T.Mesh(
        new T.CylinderGeometry(0.006, 0.006, 0.0004, 32),
        new T.MeshBasicMaterial({ color: '#d5dded' }),
      );
      this.armature.name = 'illustrative-brake-armature';
      this.armature.rotation.x = Math.PI / 2;
      this.armature.position.y = -config.principle.radius * 1.7;
      // Independent assumed surfaces, each 0.4 mm thick. Their facing
      // planes touch at full closure; the released gap is armatureTravel.
      const pole = new T.Mesh(
        new T.CylinderGeometry(0.006, 0.006, 0.0004, 32),
        new T.MeshBasicMaterial({ color: '#335980' }),
      );
      pole.name = 'illustrative-brake-pole';
      pole.rotation.copy(this.armature.rotation);
      pole.position.set(0, this.armature.position.y, config.dynamics.armatureTravel + 0.0004);
      this.principle.add(this.armature, pole);
    }
  }
  get principleVisible() {
    return this.principleEnabled;
  }
  get principleObject() {
    return this.principle;
  }
  setPrinciple(enabled: boolean) {
    this.principleEnabled = enabled;
    if (this.principle) this.principle.visible = enabled;
  }
  setMarkers(enabled: boolean) {
    this.markersEnabled = enabled;
    for (const m of this.markers) m.visible = enabled;
  }
  update(angle: number, closure: number, section: boolean) {
    const transmission = cadTransmission(this.config.gear);
    for (const e of this.entries) {
      const bearing = this.config.bearings.find((b) => b.id === e.binding.bearingId),
        pose = cadBindingPose(
          e.binding,
          bearing,
          angle,
          closure,
          this.config.dynamics.armatureTravel,
          transmission,
        );
      const delta = new T.Matrix4().compose(
        new T.Vector3(...pose.translation),
        new T.Quaternion(...pose.rotation),
        new T.Vector3(1, 1, 1),
      );
      e.object.matrix.copy(delta.multiply(e.initial));
      e.object.matrixWorldNeedsUpdate = true;
      // Browser inspection hides selected occluders; native derives capped sections.
      e.object.visible =
        e.visible &&
        !e.binding.displayHidden &&
        !(section && (e.binding.inspectionHidden || e.binding.inspectionCut));
    }
    if (this.principleEnabled && this.config.principle && this.flex && this.ring) {
      this.strip(this.flex, 0, angle);
      this.strip(this.ring, 1, angle);
      if (this.cam) this.strip(this.cam, 2, angle);
      if (this.armature) this.armature.position.z = closure * this.config.dynamics.armatureTravel;
    }
  }
  private strip(mesh: T.Mesh<T.BufferGeometry>, kind: 0 | 1 | 2, theta: number) {
    const p = this.config.principle!,
      count = 1536,
      vertices = new Float32Array(count * 4 * 3),
      indices: number[] = [];
    for (let i = 0; i < count; i++) {
      const u = (i * 2 * Math.PI) / count,
        v = kind === 2 ? principleCamPoint(p, u, theta) : principlePoint(p, u, theta),
        circularPhase =
          p.fixedMember === 'flexspline' ? ((p.ringTeeth - p.flexTeeth) / p.ringTeeth) * theta : 0,
        phi = kind === 1 ? u + circularPhase : v.phi,
        edge = kind === 1 ? principleRingRadius(p, phi, theta) : v.radius,
        width = Math.max(0.0004, p.toothHeight * 3);
      for (let c = 0; c < 4; c++) {
        const outer = c === 1 || c === 2,
          radius =
            kind === 2
              ? outer
                ? edge
                : p.radius * 0.25
              : kind === 1
                ? edge + (outer ? width : 0)
                : edge - (outer ? 0 : width),
          offset = (4 * i + c) * 3;
        vertices[offset] = radius * Math.cos(phi);
        vertices[offset + 1] = radius * Math.sin(phi);
        vertices[offset + 2] = c < 2 ? -0.0006 : 0.0006;
      }
      for (let edge = 0; edge < 4; edge++) {
        const a = i * 4 + edge,
          b = ((i + 1) % count) * 4 + edge,
          c = ((i + 1) % count) * 4 + ((edge + 1) % 4),
          d = i * 4 + ((edge + 1) % 4);
        indices.push(a, b, c, a, c, d);
      }
    }
    if (!mesh.geometry.index) {
      mesh.geometry.setIndex(indices);
      mesh.geometry.setAttribute('position', new T.BufferAttribute(vertices, 3));
    } else {
      (mesh.geometry.attributes.position.array as Float32Array).set(vertices);
      mesh.geometry.attributes.position.needsUpdate = true;
    }
    mesh.geometry.computeBoundingSphere();
  }
  dispose() {
    const geometries = new Set<T.BufferGeometry>(),
      materials = new Set<T.Material>();
    for (const m of this.markers) {
      m.removeFromParent();
      geometries.add(m.geometry);
      materials.add(m.material as T.Material);
    }
    this.markers = [];
    this.principle?.traverse((o) => {
      if (o instanceof T.Mesh) {
        geometries.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
      }
    });
    this.principle?.removeFromParent();
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    this.entries = [];
  }
}
