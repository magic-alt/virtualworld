import * as THREE from 'three';
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
