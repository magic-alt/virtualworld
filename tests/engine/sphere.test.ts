import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { radialUp, tangentForward, sphereOccludes } from '../../packages/interaction/src/sphere';
describe('spherical navigation basis', () => {
  it('has a finite tangent basis at both poles', () => {
    for (const y of [-6, 6]) {
      const up = radialUp(new THREE.Vector3(0, y, 0), new THREE.Vector3());
      const f = tangentForward(new THREE.Vector3(0, 1, 0), up);
      expect(f.length()).toBeCloseTo(1);
      expect(f.dot(up)).toBeCloseTo(0);
    }
  });
  it('hides far-side points without flattening altitude', () => {
    expect(
      sphereOccludes(
        new THREE.Vector3(0, 0, 10),
        new THREE.Vector3(0, 0, -7),
        new THREE.Vector3(),
        6,
      ),
    ).toBe(true);
    expect(
      sphereOccludes(
        new THREE.Vector3(0, 0, 10),
        new THREE.Vector3(0, 0, 7),
        new THREE.Vector3(),
        6,
      ),
    ).toBe(false);
  });
});
