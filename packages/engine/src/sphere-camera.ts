import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/** Refresh the up basis cached by the pinned Three r180 OrbitControls. */
export function updateOrbitControls(controls: OrbitControls) {
  // OrbitControls captures object.up at construction. Spherical travel changes it
  // every frame; both cached transforms must follow it before polar constraints.
  const basis = controls as unknown as { _quat: THREE.Quaternion; _quatInverse: THREE.Quaternion };
  if (
    !(basis._quat instanceof THREE.Quaternion) ||
    !(basis._quatInverse instanceof THREE.Quaternion)
  )
    throw new Error('OrbitControls up-basis contract changed; update the spherical camera adapter');
  basis._quat.setFromUnitVectors(controls.object.up, new THREE.Vector3(0, 1, 0));
  basis._quatInverse.copy(basis._quat).invert();
  controls.update();
}
