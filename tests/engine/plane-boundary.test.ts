import * as THREE from 'three';
import { expect, it } from 'vitest';
import { node } from '@virtualworld/scene-schema';
import { CharacterController } from '@virtualworld/interaction/character';
import { worldDemo } from '../fixtures/scenes';

async function arena(altitude = 0, height = 1.6, bounded = true) {
  const scene = worldDemo();
  scene.spawn = [0, altitude + 0.1, 0];
  scene.navigation = bounded
    ? { kind: 'plane', bounds: { min: [-5, -5], max: [5, 5] } }
    : { kind: 'plane' };
  scene.nodes = [
    node('ground', 'Ground', 'box', [0, altitude - 0.5, 0], [12, 1, 12], '#ffffff', {
      collider: { shape: 'box', size: [12, 1, 12] },
    }),
  ];
  const ground = new THREE.Mesh(new THREE.BoxGeometry(12, 1, 12));
  ground.position.fromArray(scene.nodes[0].position);
  const controller = await CharacterController.create(
    scene,
    new Map([['ground', ground]]),
    new THREE.Group(),
    height,
  );
  const step = (frames = 1) => {
    for (let i = 0; i < frames; i++) controller.step(1 / 60, scene.spawn);
  };
  step(60);
  return {
    scene,
    controller,
    step,
    dispose() {
      controller.dispose();
      ground.geometry.dispose();
      for (const material of Array.isArray(ground.material) ? ground.material : [ground.material])
        material.dispose();
    },
  };
}

it.each([
  ['east', 1, 0],
  ['west', -1, 0],
  ['south', 0, 1],
  ['north', 0, -1],
  ['north-east', 1, -1],
  ['north-west', -1, -1],
  ['south-east', 1, 1],
  ['south-west', -1, 1],
] as const)('holds the whole capsule inside the %s boundary without falling', async (_, x, y) => {
  const arenaState = await arena();
  const { controller, step } = arenaState;
  try {
    controller.movement.x = x;
    controller.movement.y = y;
    const radius = controller.collider.radius();
    for (let frame = 0; frame < 240; frame++) {
      step();
      const position = controller.object.position;
      expect(Math.abs(position.x) + radius).toBeLessThanOrEqual(5.0001);
      expect(Math.abs(position.z) + radius).toBeLessThanOrEqual(5.0001);
      expect(position.y).toBeGreaterThan(-0.05);
    }
    if (x) expect(controller.object.position.x * x).toBeGreaterThan(4.6);
    if (y) expect(controller.object.position.z * y).toBeGreaterThan(4.6);
  } finally {
    arenaState.dispose();
  }
});

it('uses the authored actor capsule width for boundary clearance', async () => {
  const arenaState = await arena(0, 5);
  const { controller, step } = arenaState;
  try {
    controller.keys.add('KeyD');
    step(240);
    expect(controller.object.position.x).toBeGreaterThan(4);
    expect(controller.object.position.x + controller.collider.radius()).toBeLessThanOrEqual(5.0001);
    expect(controller.object.position.y).toBeGreaterThan(-0.05);
  } finally {
    arenaState.dispose();
  }
});

it('keeps the tangential part of diagonal movement while pressing against a boundary', async () => {
  const arenaState = await arena();
  const { controller, step } = arenaState;
  try {
    controller.movement.x = 1;
    step(120);
    const start = controller.object.position.clone();
    controller.movement.y = -1;
    step(60);
    expect(controller.object.position.x).toBeCloseTo(start.x, 3);
    expect(controller.object.position.z - start.z).toBeCloseTo(-3.6 / Math.sqrt(2), 2);
    expect(controller.object.position.y).toBeGreaterThan(-0.05);
  } finally {
    arenaState.dispose();
  }
});

it('jumps and lands while outward movement remains held at a boundary', async () => {
  const arenaState = await arena();
  const { controller, step } = arenaState;
  try {
    controller.keys.add('KeyD');
    step(120);
    controller.keys.add('Space');
    let highest = -Infinity;
    for (let frame = 0; frame < 120; frame++) {
      step();
      highest = Math.max(highest, controller.object.position.y);
      expect(controller.object.position.x + controller.collider.radius()).toBeLessThanOrEqual(
        5.0001,
      );
    }
    expect(highest).toBeGreaterThan(0.7);
    expect(controller.object.position.y).toBeGreaterThan(-0.05);
    expect(controller.object.position.y).toBeLessThan(0.05);
    expect(controller.controller.computedGrounded()).toBe(true);
  } finally {
    arenaState.dispose();
  }
});

it.each([80, -30])('recovers an abnormal fall to recent safe ground at elevation %s', async (y) => {
  const arenaState = await arena(y);
  const { controller, step } = arenaState;
  try {
    controller.movement.x = 1;
    step(45);
    controller.movement.x = 0;
    step(10);
    const safe = controller.object.position.clone();
    expect(safe.x).toBeGreaterThan(2);
    const belowGround = { x: safe.x, y: y - 5, z: safe.z };
    controller.body.setTranslation(belowGround, true);
    controller.body.setNextKinematicTranslation(belowGround);
    step();
    expect(controller.object.position.x).toBeCloseTo(safe.x, 3);
    expect(controller.object.position.y).toBeCloseTo(safe.y, 2);
    expect(controller.object.position.z).toBeCloseTo(safe.z, 3);
    step(60);
    expect(controller.object.position.y).toBeCloseTo(safe.y, 2);
    expect(controller.controller.computedGrounded()).toBe(true);
  } finally {
    arenaState.dispose();
  }
});

it('allows a six metre descent onto lower solid ground', async () => {
  const scene = worldDemo();
  scene.spawn = [0, 6.1, 0];
  scene.navigation = { kind: 'plane', bounds: { min: [-10, -10], max: [10, 10] } };
  scene.nodes = [
    node('platform', 'Platform', 'box', [0, 5.5, 0], [3, 1, 6], '#ffffff', {
      collider: { shape: 'box', size: [3, 1, 6] },
    }),
    node('ground', 'Lower ground', 'box', [0, -0.5, 0], [20, 1, 20], '#ffffff', {
      collider: { shape: 'box', size: [20, 1, 20] },
    }),
  ];
  const objects = new Map(
    scene.nodes.map((spec) => {
      const object = new THREE.Object3D();
      object.position.fromArray(spec.position);
      return [spec.id, object];
    }),
  );
  const controller = await CharacterController.create(scene, objects, new THREE.Group(), 1.6);
  try {
    for (let frame = 0; frame < 60; frame++) controller.step(1 / 60, scene.spawn);
    expect(controller.object.position.y).toBeGreaterThan(6);
    controller.movement.x = 1;
    for (let frame = 0; frame < 240; frame++) controller.step(1 / 60, scene.spawn);
    expect(controller.object.position.x).toBeGreaterThan(9);
    expect(controller.object.position.y).toBeGreaterThan(0);
    expect(controller.object.position.y).toBeLessThan(0.05);
    expect(controller.controller.computedGrounded()).toBe(true);
  } finally {
    controller.dispose();
  }
});

it.each(['mesh', 'box', 'ball'] as const)(
  'waits until below transformed %s collision geometry before recovering a void fall',
  async (shape) => {
    const scene = worldDemo();
    scene.spawn = [0, 6.1, 0];
    scene.navigation = { kind: 'plane', bounds: { min: [-50, -50], max: [50, 50] } };
    scene.nodes = [
      node('platform', 'Platform', 'box', [0, 5.5, 0], [3, 1, 6], '#ffffff', {
        collider: { shape: 'box', size: [3, 1, 6] },
      }),
      node(
        'lower',
        'Lower geometry',
        'box',
        [40, shape === 'mesh' ? 6 : 8, 0],
        [1, 1, 1],
        '#ffffff',
        {
          rotation: [0, 0, Math.PI / 2],
          scale: shape === 'ball' ? [5, 1, 2] : [2, 1, 1],
          collider: { shape, size: shape === 'ball' ? [2, 2, 2] : [10, 2, 2] },
        },
      ),
    ];
    const platform = new THREE.Object3D();
    platform.position.fromArray(scene.nodes[0].position);
    const lower = new THREE.Group();
    lower.position.fromArray(scene.nodes[1].position);
    lower.rotation.set(...scene.nodes[1].rotation);
    lower.scale.fromArray(scene.nodes[1].scale);
    if (shape === 'mesh') {
      const child = new THREE.Mesh(new THREE.BoxGeometry(10, 2, 2));
      child.position.x = 1;
      lower.add(child);
    }
    // All three physical shapes reach Y=-2 after their world transforms.
    const controller = await CharacterController.create(
      scene,
      new Map([
        ['platform', platform],
        ['lower', lower],
      ]),
      new THREE.Group(),
      1.6,
    );
    try {
      for (let frame = 0; frame < 60; frame++) controller.step(1 / 60, scene.spawn);
      const safe = controller.object.position.clone();
      const nearBottom = { x: 4, y: -1, z: 0 };
      controller.body.setTranslation(nearBottom, true);
      controller.body.setNextKinematicTranslation(nearBottom);
      controller.world.propagateModifiedBodyPositionsToColliders();
      controller.step(1 / 60, scene.spawn);
      expect(controller.body.translation().x).toBeCloseTo(4);
      expect(controller.body.translation().y).toBeLessThan(-0.99);
      const belowWorld = { x: 4, y: -4, z: 0 };
      controller.body.setTranslation(belowWorld, true);
      controller.body.setNextKinematicTranslation(belowWorld);
      controller.world.propagateModifiedBodyPositionsToColliders();
      controller.step(1 / 60, scene.spawn);
      expect(controller.object.position.x).toBeCloseTo(safe.x, 3);
      expect(controller.object.position.y).toBeCloseTo(safe.y, 2);
    } finally {
      controller.dispose();
      lower.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        for (const material of Array.isArray(object.material) ? object.material : [object.material])
          material.dispose();
      });
    }
  },
);

it('preserves unrestricted movement and the legacy respawn threshold without plane bounds', async () => {
  const arenaState = await arena(0, 1.6, false);
  const { controller, scene, step } = arenaState;
  try {
    controller.movement.x = 1;
    step(100);
    expect(controller.object.position.x).toBeGreaterThan(5.5);
    controller.movement.x = 0;
    const belowGround = { x: 4, y: -6, z: 2 };
    controller.body.setTranslation(belowGround, true);
    controller.body.setNextKinematicTranslation(belowGround);
    step();
    expect(controller.object.position.x).toBeCloseTo(4);
    expect(controller.object.position.y).toBeLessThan(-6);
    const belowRespawn = { x: 4, y: -13, z: 2 };
    controller.body.setTranslation(belowRespawn, true);
    controller.body.setNextKinematicTranslation(belowRespawn);
    step();
    scene.spawn.forEach((value, axis) =>
      expect(controller.object.position.getComponent(axis)).toBeCloseTo(value, 5),
    );
  } finally {
    arenaState.dispose();
  }
});
