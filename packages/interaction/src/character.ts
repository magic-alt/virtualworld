import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { SceneSpec, Vector3Tuple } from '@virtualworld/scene-schema';
import { character } from './avatar';
let initialization: Promise<void> | undefined;
export class CharacterController {
  world: RAPIER.World;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  controller: RAPIER.KinematicCharacterController;
  object = character('#d6b7e7');
  keys = new Set<string>();
  private velocityY = 0;
  private time = 0;
  private jumpHeld = false;
  private constructor(scene: SceneSpec, objects: Map<string, THREE.Object3D>) {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    for (const node of scene.nodes) {
      if (!node.collider || !node.visible) continue;
      const object = objects.get(node.id);
      if (!object) continue;
      object.updateWorldMatrix(true, false);
      const p = new THREE.Vector3(),
        q = new THREE.Quaternion(),
        s = new THREE.Vector3();
      object.matrixWorld.decompose(p, q, s);
      const [x, y, z] = node.collider.size;
      const desc =
        node.collider.shape === 'ball'
          ? RAPIER.ColliderDesc.ball(x * Math.max(s.x, s.y, s.z))
          : RAPIER.ColliderDesc.cuboid((x * s.x) / 2, (y * s.y) / 2, (z * s.z) / 2);
      desc.setTranslation(p.x, p.y, p.z).setRotation(q);
      this.world.createCollider(desc);
    }
    const [x, y, z] = scene.spawn;
    this.body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y + 0.8, z),
    );
    this.collider = this.world.createCollider(RAPIER.ColliderDesc.capsule(0.5, 0.27), this.body);
    this.controller = this.world.createCharacterController(0.02);
    this.controller.enableAutostep(0.45, 0.2, true);
    this.controller.enableSnapToGround(0.4);
    this.controller.setSlideEnabled(true);
    this.object.position.set(x, y, z);
  }
  static async create(scene: SceneSpec, objects: Map<string, THREE.Object3D>) {
    initialization ??= RAPIER.init();
    await initialization;
    return new CharacterController(scene, objects);
  }
  step(dt: number, spawn: Vector3Tuple) {
    dt = Math.min(dt, 0.04);
    this.time += dt;
    const forward =
      (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0) -
      (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0);
    const right =
      (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) -
      (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
    const direction = new THREE.Vector3(right, 0, forward);
    if (direction.lengthSq()) direction.normalize();
    const grounded = this.controller.computedGrounded();
    if (grounded && this.velocityY < 0) this.velocityY = -0.1;
    const jumping = this.keys.has('Space');
    if (jumping && !this.jumpHeld && grounded) this.velocityY = 5.2;
    this.jumpHeld = jumping;
    this.velocityY -= 14 * dt;
    this.controller.computeColliderMovement(this.collider, {
      x: direction.x * 3.6 * dt,
      y: this.velocityY * dt,
      z: direction.z * 3.6 * dt,
    });
    const movement = this.controller.computedMovement();
    const p = this.body.translation();
    this.body.setNextKinematicTranslation({
      x: p.x + movement.x,
      y: p.y + movement.y,
      z: p.z + movement.z,
    });
    this.world.timestep = dt;
    this.world.step();
    const next = this.body.translation();
    if (next.y < -12) {
      this.body.setTranslation({ x: spawn[0], y: spawn[1] + 0.8, z: spawn[2] }, true);
      this.velocityY = 0;
    }
    const final = this.body.translation();
    this.object.position.set(final.x, final.y - 0.8, final.z);
    if (direction.lengthSq()) this.object.rotation.y = Math.atan2(direction.x, direction.z);
    this.object.children.forEach((child) => {
      if (child.name.startsWith('leg') || child.name.startsWith('arm'))
        child.rotation.x = direction.lengthSq()
          ? Math.sin(this.time * 10) * (child.name.endsWith('-1') ? 1 : -1) * 0.45
          : 0;
    });
  }
  dispose() {
    this.world.free();
  }
}
