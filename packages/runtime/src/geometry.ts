import * as THREE from 'three';
import type { SceneNode } from '../../scene/src/schema';
export function material(node: SceneNode, color = node.color) {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: node.metalness ?? 0.05,
    roughness: node.roughness ?? 0.72,
    emissive: color,
    emissiveIntensity: node.emissive ?? 0,
    transparent: (node.opacity ?? 1) < 1,
    opacity: node.opacity ?? 1,
  });
}
export function primitive(node: SceneNode): THREE.Object3D {
  const [x, y, z] = node.size;
  const mat = material(node);
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material = mat) => {
    const o = new THREE.Mesh(g, m);
    o.castShadow = true;
    o.receiveShadow = true;
    return o;
  };
  switch (node.shape) {
    case 'box':
      return mesh(new THREE.BoxGeometry(x, y, z));
    case 'cylinder': {
      const o = mesh(new THREE.CylinderGeometry(x / 2, z / 2, y, 64));
      return o;
    }
    case 'sphere':
      return mesh(new THREE.SphereGeometry(0.5, 32, 20).scale(x, y, z));
    case 'torus':
      return mesh(new THREE.TorusGeometry(Math.max(0.01, x / 2 - y / 2), y / 2, 12, 64));
    case 'cone':
      return mesh(new THREE.ConeGeometry(x / 2, y, 8));
    case 'rock':
      return mesh(new THREE.IcosahedronGeometry(0.5, 1).scale(x, y, z));
    case 'crystal':
      return mesh(new THREE.OctahedronGeometry(0.5).scale(x, y, z));
    case 'tree': {
      const group = new THREE.Group();
      const trunk = mesh(
        new THREE.CylinderGeometry(x * 0.09, x * 0.13, y * 0.5, 8),
        new THREE.MeshStandardMaterial({ color: '#63616b', roughness: 1 }),
      );
      trunk.position.y = y * 0.25;
      group.add(trunk);
      for (let i = 0; i < 3; i++) {
        const crown = mesh(new THREE.ConeGeometry(x * (0.58 - i * 0.1), y * 0.56, 7));
        crown.position.y = y * (0.48 + i * 0.18);
        crown.rotation.y = i * 0.6;
        group.add(crown);
      }
      return group;
    }
    case 'arch': {
      const group = new THREE.Group();
      const radius = x / 2,
        tube = 0.19;
      const top = mesh(new THREE.TorusGeometry(radius - tube, tube, 8, 32, Math.PI));
      top.position.y = y - radius;
      group.add(top);
      for (const side of [-1, 1]) {
        const leg = mesh(new THREE.BoxGeometry(tube * 2, y - radius, z));
        leg.position.set(side * (radius - tube), (y - radius) / 2, 0);
        group.add(leg);
        const foot = mesh(new THREE.BoxGeometry(tube * 3, 0.22, z * 1.5));
        foot.position.set(side * (radius - tube), 0, z * 0);
        group.add(foot);
      }
      const glow = new THREE.Mesh(
        new THREE.CircleGeometry(radius * 0.72, 48),
        new THREE.MeshBasicMaterial({
          color: '#b8dbeb',
          transparent: true,
          opacity: 0.16,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      glow.position.set(0, y - radius, 0);
      group.add(glow);
      return group;
    }
    case 'character':
      return character(node.color);
    default:
      return new THREE.Group();
  }
}
export function character(color = '#e7c29a') {
  const group = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: '#f2debc' });
  const dark = new THREE.MeshStandardMaterial({ color: '#3e4565' });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.48, 6, 12), cloth);
  body.position.y = 0.92;
  group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.23, 16, 12), skin);
  head.position.y = 1.53;
  group.add(head);
  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.31, 0.32, 8), cloth);
  hat.position.y = 1.79;
  group.add(hat);
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.36, 4, 8), dark);
    leg.position.set(side * 0.13, 0.32, 0);
    leg.name = `leg${side}`;
    group.add(leg);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.36, 4, 8), cloth);
    arm.position.set(side * 0.32, 0.95, 0);
    arm.name = `arm${side}`;
    group.add(arm);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.027, 8, 6), dark);
    eye.position.set(side * 0.08, 1.56, 0.21);
    group.add(eye);
  }
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return group;
}
