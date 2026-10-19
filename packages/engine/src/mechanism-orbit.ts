import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { updateOrbitControls } from './sphere-camera';

/**
 * Orbit the mechanism around its inspection target without spherical pole limits.
 * Rotating the camera's up vector together with its offset preserves a usable
 * local orbit basis even after a complete vertical revolution.
 */
export function rotateMechanismCamera(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  deltaX: number,
  deltaY: number,
  viewportHeight: number,
) {
  if (
    ![deltaX, deltaY, viewportHeight, controls.rotateSpeed].every(Number.isFinite) ||
    viewportHeight <= 0 ||
    (!deltaX && !deltaY)
  )
    return;
  const offset = camera.position.clone().sub(controls.target);
  const up = camera.up.clone();
  if (offset.lengthSq() < 1e-12 || up.lengthSq() < 1e-12) return;
  up.normalize();
  const right = new THREE.Vector3().crossVectors(up, offset);
  if (right.lengthSq() < 1e-12) return;
  right.normalize();

  // OrbitControls also scales both axes by viewport height.
  const radians = (2 * Math.PI * controls.rotateSpeed) / viewportHeight;
  const yaw = new THREE.Quaternion().setFromAxisAngle(up, -deltaX * radians);
  const pitch = new THREE.Quaternion().setFromAxisAngle(
    right.applyQuaternion(yaw),
    -deltaY * radians,
  );
  const rotation = pitch.multiply(yaw);

  camera.position.copy(controls.target).add(offset.applyQuaternion(rotation));
  camera.up.copy(up.applyQuaternion(rotation)).normalize();
  camera.lookAt(controls.target);
  updateOrbitControls(controls);
}

/**
 * Uses quaternion drags only for mechanism inspection. OrbitControls remains
 * responsible for wheel zoom, right-button pan and two-finger dolly/pan.
 */
export class MechanismOrbitController {
  private mechanismEnabled = false;
  private activePointer?: number;
  private pointers = new Set<number>();
  private lastX = 0;
  private lastY = 0;

  constructor(
    private element: HTMLElement,
    private camera: THREE.PerspectiveCamera,
    private controls: OrbitControls,
    private interactive: () => boolean,
  ) {
    element.addEventListener('pointerdown', this.pointerDown);
    element.addEventListener('pointermove', this.pointerMove);
    element.addEventListener('pointerup', this.pointerEnd);
    element.addEventListener('pointercancel', this.pointerEnd);
    element.addEventListener('lostpointercapture', this.pointerEnd);
  }

  setMechanismEnabled(enabled: boolean) {
    if (enabled === this.mechanismEnabled) return;
    this.mechanismEnabled = enabled;
    // Built-in spherical rotation clamps polar angles to [0, PI].
    // Disable only that rotation path while retaining zoom and pan.
    this.controls.enableRotate = !enabled;
    this.controls.maxPolarAngle = enabled ? Math.PI : Math.PI * 0.49;
    this.cancel();
  }

  cancel() {
    this.activePointer = undefined;
    this.pointers.clear();
  }

  private pointerDown = (event: PointerEvent) => {
    if (!this.mechanismEnabled) return;
    this.pointers.add(event.pointerId);
    if (this.pointers.size !== 1) {
      // Two-finger gestures are handled by OrbitControls; do not orbit at the
      // same time as a pinch, even if one finger is subsequently released.
      this.activePointer = undefined;
      return;
    }
    if (
      !this.interactive() ||
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    )
      return;
    this.activePointer = event.pointerId;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
  };

  private pointerMove = (event: PointerEvent) => {
    if (
      !this.mechanismEnabled ||
      !this.interactive() ||
      this.activePointer !== event.pointerId ||
      this.pointers.size !== 1
    )
      return;
    if (event.pointerType !== 'touch' && !(event.buttons & 1)) {
      this.cancel();
      return;
    }
    const deltaX = event.clientX - this.lastX;
    const deltaY = event.clientY - this.lastY;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    rotateMechanismCamera(
      this.camera,
      this.controls,
      deltaX,
      deltaY,
      this.element.getBoundingClientRect().height,
    );
  };

  private pointerEnd = (event: PointerEvent) => {
    this.pointers.delete(event.pointerId);
    if (this.activePointer === event.pointerId) this.activePointer = undefined;
  };

  dispose() {
    this.cancel();
    this.element.removeEventListener('pointerdown', this.pointerDown);
    this.element.removeEventListener('pointermove', this.pointerMove);
    this.element.removeEventListener('pointerup', this.pointerEnd);
    this.element.removeEventListener('pointercancel', this.pointerEnd);
    this.element.removeEventListener('lostpointercapture', this.pointerEnd);
  }
}
