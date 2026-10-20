import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { SceneSpec, Vector3Tuple } from '@virtualworld/scene-schema';
import { character } from './avatar';
import { radialUp, tangentForward } from './sphere';
let initialization: Promise<void> | undefined;
export class CharacterController {
  world: RAPIER.World;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  controller: RAPIER.KinematicCharacterController;
  object: THREE.Object3D = character('#d6b7e7');
  keys = new Set<string>();
  movement = { x: 0, y: 0, jump: false };
  readonly up = new THREE.Vector3(0, 1, 0);
  cameraForward = new THREE.Vector3(0, 0, -1);
  moving = false;
  private procedural = true;
  private center?: THREE.Vector3;
  private radius = 0;
  private offset = 0.8;
  private velocityY = 0;
  private time = 0;
  private jumpHeld = false;
  private planeBounds?: { minX: number; maxX: number; minZ: number; maxZ: number };
  private recoveryPosition?: THREE.Vector3;
  private recoveryFloor = -Infinity;
  private constructor(
    scene: SceneSpec,
    objects: Map<string, THREE.Object3D>,
    actor?: THREE.Object3D,
    height = 1.6,
  ) {
    if (actor) {
      this.object = actor;
      this.procedural = false;
    }
    this.offset = height / 2;
    if (scene.navigation?.kind === 'sphere') {
      this.center = new THREE.Vector3(...scene.navigation.center);
      this.radius = scene.navigation.radius;
      this.up.copy(radialUp(new THREE.Vector3(...scene.spawn), this.center));
    }
    this.world = new RAPIER.World({ x: 0, y: this.center ? 0 : -9.81, z: 0 });
    const navigationBounds =
      scene.navigation?.kind === 'plane' ? scene.navigation.bounds : undefined;
    let lowestColliderY = Infinity;
    for (const node of scene.nodes) {
      if (!node.collider || !node.visible) continue;
      const object = objects.get(node.id);
      if (!object) continue;
      object.updateWorldMatrix(true, false);
      const p = new THREE.Vector3(),
        q = new THREE.Quaternion(),
        s = new THREE.Vector3();
      object.matrixWorld.decompose(p, q, s);
      if (node.collider.shape === 'mesh') {
        object.updateWorldMatrix(true, true);
        object.traverse((child) => {
          if (!(child instanceof THREE.Mesh)) return;
          const positions = child.geometry.getAttribute('position');
          if (!positions) return;
          const vertices: number[] = [];
          const point = new THREE.Vector3();
          for (let i = 0; i < positions.count; i++) {
            point.fromBufferAttribute(positions, i).applyMatrix4(child.matrixWorld);
            vertices.push(point.x, point.y, point.z);
          }
          const index = child.geometry.index;
          const indices = index
            ? (Array.from(index.array) as number[])
            : Array.from({ length: positions.count }, (_, i) => i);
          if (indices.length >= 3) {
            const worldVertices = new Float32Array(vertices);
            this.world.createCollider(
              RAPIER.ColliderDesc.trimesh(worldVertices, new Uint32Array(indices)),
            );
            if (navigationBounds)
              for (const vertexIndex of indices)
                lowestColliderY = Math.min(lowestColliderY, worldVertices[vertexIndex * 3 + 1]);
          }
        });
        continue;
      }
      const [x, y, z] = node.collider.size;
      const desc =
        node.collider.shape === 'ball'
          ? RAPIER.ColliderDesc.ball(x * Math.max(s.x, s.y, s.z))
          : RAPIER.ColliderDesc.cuboid((x * s.x) / 2, (y * s.y) / 2, (z * s.z) / 2);
      desc.setTranslation(p.x, p.y, p.z).setRotation(q);
      const collider = this.world.createCollider(desc);
      if (navigationBounds) {
        let halfHeight: number;
        if (node.collider.shape === 'ball') halfHeight = collider.radius();
        else {
          const half = collider.halfExtents();
          const rotation = collider.rotation();
          q.set(rotation.x, rotation.y, rotation.z, rotation.w);
          const axes = new THREE.Matrix4().makeRotationFromQuaternion(q).elements;
          halfHeight =
            Math.abs(axes[1]) * half.x + Math.abs(axes[5]) * half.y + Math.abs(axes[9]) * half.z;
        }
        lowestColliderY = Math.min(lowestColliderY, collider.translation().y - halfHeight);
      }
    }
    const [x, y, z] = scene.spawn;
    this.body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        x + this.up.x * this.offset,
        y + this.up.y * this.offset,
        z + this.up.z * this.offset,
      ),
    );
    this.collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(
        actor ? Math.max(height * 0.01, this.offset - height * 0.17) : 0.5,
        actor ? height * 0.17 : 0.27,
      ),
      this.body,
    );
    if (navigationBounds) {
      const { min, max } = navigationBounds;
      const margin = this.collider.radius() + 0.02;
      this.planeBounds = {
        minX: min[0] + margin,
        maxX: max[0] - margin,
        minZ: min[1] + margin,
        maxZ: max[1] - margin,
      };
      // Spawn is the fallback until the first grounded position is available.
      this.recoveryPosition = new THREE.Vector3().copy(this.body.translation());
      // Valid drops can land far below the last contact. Recover only once the
      // entire capsule is beneath the physical world, with the controller gap.
      this.recoveryFloor =
        (Number.isFinite(lowestColliderY) ? lowestColliderY : y) -
        this.collider.halfHeight() -
        margin;
    }
    this.controller = this.world.createCharacterController(0.02);
    this.controller.enableAutostep(0.45, 0.2, true);
    this.controller.enableSnapToGround(0.4);
    this.controller.setSlideEnabled(true);
    this.body.setRotation(
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.up),
      true,
    );
    this.object.position.set(x, y, z);
  }
  static async create(
    scene: SceneSpec,
    objects: Map<string, THREE.Object3D>,
    actor?: THREE.Object3D,
    height?: number,
  ) {
    initialization ??= RAPIER.init();
    await initialization;
    return new CharacterController(scene, objects, actor, height);
  }
  private constrainPlanePosition(position: THREE.Vector3) {
    if (!this.planeBounds) return;
    const bounds = this.planeBounds;
    position.x = THREE.MathUtils.clamp(position.x, bounds.minX, bounds.maxX);
    position.z = THREE.MathUtils.clamp(position.z, bounds.minZ, bounds.maxZ);
  }
  step(dt: number, spawn: Vector3Tuple) {
    dt = Math.min(dt, 0.04);
    this.time += dt;
    const forward =
      (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0) -
      (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) +
      this.movement.y;
    const right =
      (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) -
      (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0) +
      this.movement.x;
    if (this.center)
      this.up.copy(radialUp(new THREE.Vector3().copy(this.body.translation()), this.center));
    const heading = tangentForward(this.cameraForward, this.up);
    const direction = heading
      .clone()
      .multiplyScalar(-forward)
      .add(heading.clone().cross(this.up).multiplyScalar(right));
    this.moving = direction.lengthSq() > 0;
    this.controller.setUp(this.up);
    if (this.center)
      this.body.setRotation(
        new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.up),
        true,
      );
    if (direction.lengthSq() > 1) direction.normalize();
    const grounded = this.controller.computedGrounded();
    if (grounded && this.velocityY < 0) this.velocityY = -0.1;
    const jumping = this.keys.has('Space') || this.movement.jump;
    if (jumping && !this.jumpHeld && grounded) this.velocityY = 5.2;
    this.jumpHeld = jumping;
    this.velocityY -= 14 * dt;
    const p = this.body.translation();
    const target = new THREE.Vector3(
      (direction.x * 3.6 + this.up.x * this.velocityY) * dt,
      (direction.y * 3.6 + this.up.y * this.velocityY) * dt,
      (direction.z * 3.6 + this.up.z * this.velocityY) * dt,
    );
    if (this.planeBounds) {
      // Constrain only the outward component, preserving jumps and edge travel.
      target.add(p);
      this.constrainPlanePosition(target);
      target.sub(p);
    }
    this.controller.computeColliderMovement(this.collider, target);
    const movement = this.controller.computedMovement();
    target.set(p.x + movement.x, p.y + movement.y, p.z + movement.z);
    // Sloped collision surfaces can also deflect an otherwise valid movement.
    this.constrainPlanePosition(target);
    this.body.setNextKinematicTranslation(target);
    this.world.timestep = dt;
    this.world.step();
    const next = this.body.translation();
    if (this.recoveryPosition) {
      if (next.y < this.recoveryFloor) {
        this.body.setTranslation(this.recoveryPosition, true);
        this.body.setNextKinematicTranslation(this.recoveryPosition);
        this.velocityY = 0;
      } else if (this.controller.computedGrounded()) this.recoveryPosition.copy(next);
    } else if (
      this.center
        ? new THREE.Vector3().copy(next).distanceTo(this.center) < this.radius * 0.5 ||
          new THREE.Vector3().copy(next).distanceTo(this.center) > this.radius + 30
        : next.y < -12
    ) {
      const up = this.center
        ? radialUp(new THREE.Vector3(...spawn), this.center)
        : new THREE.Vector3(0, 1, 0);
      this.body.setTranslation(
        {
          x: spawn[0] + up.x * this.offset,
          y: spawn[1] + up.y * this.offset,
          z: spawn[2] + up.z * this.offset,
        },
        true,
      );
      this.velocityY = 0;
    }
    const final = this.body.translation();
    if (this.center) this.up.copy(radialUp(new THREE.Vector3().copy(final), this.center));
    this.object.position.set(final.x, final.y, final.z).addScaledVector(this.up, -this.offset);
    if (this.center) {
      const heading = direction.lengthSq()
        ? tangentForward(direction, this.up)
        : tangentForward(
            new THREE.Vector3(0, 0, 1).applyQuaternion(this.object.quaternion),
            this.up,
          );
      const rightAxis = new THREE.Vector3().crossVectors(this.up, heading).normalize();
      this.object.quaternion.setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(rightAxis, this.up, heading),
      );
    } else if (direction.lengthSq()) this.object.rotation.y = Math.atan2(direction.x, direction.z);
    if (this.procedural)
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
