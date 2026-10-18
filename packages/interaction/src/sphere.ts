import * as THREE from 'three';
export function radialUp(position: THREE.Vector3, center: THREE.Vector3) {
  const up = position.clone().sub(center);
  return up.lengthSq() > 1e-12 ? up.normalize() : new THREE.Vector3(0, 1, 0);
}
export function tangentForward(forward: THREE.Vector3, up: THREE.Vector3) {
  const tangent = forward.clone().addScaledVector(up, -forward.dot(up));
  if (tangent.lengthSq() < 1e-8) {
    tangent.set(Math.abs(up.y) < 0.9 ? 0 : 1, Math.abs(up.y) < 0.9 ? 1 : 0, 0);
    tangent.addScaledVector(up, -tangent.dot(up));
  }
  return tangent.normalize();
}
export function sphereOccludes(
  camera: THREE.Vector3,
  target: THREE.Vector3,
  center: THREE.Vector3,
  radius: number,
) {
  const direction = target.clone().sub(camera),
    length = direction.length();
  if (length < 1e-8) return false;
  const ray = new THREE.Ray(camera, direction.divideScalar(length));
  const hit = ray.intersectSphere(new THREE.Sphere(center, radius * 0.998), new THREE.Vector3());
  return !!hit && hit.distanceTo(camera) < length - 0.02;
}
