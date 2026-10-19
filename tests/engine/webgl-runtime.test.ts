import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { StudioRuntime } from '@virtualworld/engine';
import { GraphicsRecovery } from '../../packages/engine/src/graphics';
import { MechanismController } from '../../packages/engine/src/mechanism';

function fixture() {
  const r = Object.create(StudioRuntime.prototype) as StudioRuntime;
  const canvas = new EventTarget();
  let lost = false;
  const render = vi.fn();
  const loop = vi.fn();
  Object.assign(r, {
    disposed: false,
    suspended: false,
    paused: false,
    renderer: { render, setAnimationLoop: loop, getContext: () => ({ isContextLost: () => lost }) },
    controls: { enabled: true },
    transform: { enabled: true, dragging: false },
    callbacks: {},
    assets: { releaseGraphics() {} },
    keys: new Set(['KeyW']),
    movement: { x: 1, y: 1, jump: true },
    last: 1000,
    mechanismListeners: new Set(),
    hiddenSubsystems: new Set(),
    mechanismController: new MechanismController({
      flexTeeth: 200,
      ringTeeth: 202,
      hasBrake: false,
    }),
    spec: { mechanism: {} },
  });
  const graphics = new GraphicsRecovery(
    canvas,
    () => lost,
    async () => {},
    () => (r as any).syncGraphics?.(),
  );
  Object.assign(r, { graphics });
  return {
    r,
    graphics,
    render,
    loop,
    lose() {
      lost = true;
      canvas.dispatchEvent(new Event('webglcontextlost'));
    },
    async restore() {
      lost = false;
      canvas.dispatchEvent(new Event('webglcontextrestored'));
      await r.retryGraphics();
    },
  };
}

it('stops stale frame callbacks and input/step advancement on context loss, independent of visibility', () => {
  const f = fixture();
  const r = f.r;
  r.animateJoints(true);
  f.lose();
  expect(r.getGraphicsState().status).toBe('lost');
  expect(f.loop).toHaveBeenLastCalledWith(null);
  expect((r as any).keys.size).toBe(0);
  expect((r as any).movement).toEqual({ x: 0, y: 0, jump: false });
  expect(r.controls.enabled).toBe(false);
  expect(r.transform.enabled).toBe(false);
  expect(r.getMechanismState()?.actualInputRpm).toBe(0);
  r.setSuspended(false);
  r.setPaused(false);
  r.setMovement({ x: 1, y: 1, jump: true });
  r.stepMechanism(0.25);
  (r as any).renderFrame(9000);
  expect(f.loop).toHaveBeenLastCalledWith(null);
  expect(f.render).not.toHaveBeenCalled();
  expect(r.getMechanismState()?.inputAngle).toBe(0);
  expect((r as any).movement).toEqual({ x: 0, y: 0, jump: false });
  expect(() => r.screenshot()).toThrow(/图形/);
  f.graphics.dispose();
});

it('preserves user pause and hidden suspension after recovery, then resets timing before resuming', async () => {
  const f = fixture();
  const r = f.r;
  r.animateJoints(true);
  r.setPaused(true);
  r.setSuspended(true);
  f.lose();
  await f.restore();
  expect(r.getGraphicsState().status).toBe('ready');
  expect((r as any).paused).toBe(true);
  expect((r as any).last).toBe(0);
  expect(f.loop).toHaveBeenLastCalledWith(null);
  r.setSuspended(false);
  expect(r.controls.enabled).toBe(false);
  expect(r.getMechanismState()?.actualInputRpm).toBe(0);
  r.setPaused(false);
  expect(r.getMechanismState()?.actualInputRpm).toBe(6);
  expect(r.getMechanismState()?.inputAngle).toBe(0);
  f.graphics.dispose();
});

it('only declares ready after GPU rebuild and a real render, preserving camera, scene, story and mechanism state', async () => {
  const f = fixture();
  f.graphics.dispose();
  const r = f.r;
  const world = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(1, 2, 3);
  camera.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.4);
  const initialEnvironment = new THREE.WebGLRenderTarget(1, 1);
  const disposeEnvironment = vi.spyOn(initialEnvironment, 'dispose');
  const replacement = new THREE.WebGLRenderTarget(1, 1);
  let finish!: () => void;
  const resources = new Promise<void>((resolve) => {
    finish = resolve;
  });
  Object.assign(r, {
    world,
    camera,
    environment: initialEnvironment,
    story: { flags: ['friend'], inventory: [], completed: false },
    buildEnvironment: () => replacement,
    assets: { releaseGraphics() {}, restoreGraphics: () => resources },
  });
  Object.assign(r.renderer, { resetState() {} });
  r.stepMechanism(0.4);
  r.animateJoints(true);
  r.setPaused(true);
  const snapshot = () =>
    JSON.stringify({
      camera: camera.toJSON(),
      spec: r.spec,
      story: (r as any).story,
      angle: r.getMechanismState()?.inputAngle,
      moving: r.getMechanismState()?.moving,
      paused: (r as any).paused,
    });
  const before = snapshot();
  const canvas = new EventTarget();
  let lost = false;
  const graphics = new GraphicsRecovery(
    canvas,
    () => lost,
    (current) => (r as any).restoreGraphics(current),
    () => (r as any).syncGraphics(),
  );
  Object.assign(r, { graphics });
  lost = true;
  canvas.dispatchEvent(new Event('webglcontextlost'));
  lost = false;
  canvas.dispatchEvent(new Event('webglcontextrestored'));
  const recovered = r.retryGraphics();
  await Promise.resolve();
  expect(r.getGraphicsState().status).toBe('restoring');
  expect(f.render).not.toHaveBeenCalled();
  finish();
  await recovered;
  expect(disposeEnvironment).toHaveBeenCalledOnce();
  expect(world.environment).toBe(replacement.texture);
  expect(f.render).toHaveBeenCalledExactlyOnceWith(world, camera);
  expect(r.getGraphicsState().status).toBe('ready');
  expect(snapshot()).toBe(before);
  graphics.dispose();
});

it('rebuilds for the latest scene generation before publishing ready after an in-flight edit', async () => {
  const f = fixture();
  f.graphics.dispose();
  const r = f.r;
  let finish!: () => void;
  const first = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const generations: number[] = [];
  let entered!: () => void;
  const rebuilding = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const restore = vi.fn(async () => {
    generations.push((r as any).generation);
    entered();
    if (generations.length === 1) await first;
  });
  Object.assign(r, {
    generation: 1,
    loadComplete: Promise.resolve(),
    world: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    buildEnvironment: () => new THREE.WebGLRenderTarget(1, 1),
    assets: { releaseGraphics() {}, restoreGraphics: restore },
  });
  Object.assign(r.renderer, { resetState() {} });
  const canvas = new EventTarget();
  let lost = false;
  const graphics = new GraphicsRecovery(
    canvas,
    () => lost,
    (current) => (r as any).restoreGraphics(current),
    () => (r as any).syncGraphics(),
  );
  Object.assign(r, { graphics });
  lost = true;
  canvas.dispatchEvent(new Event('webglcontextlost'));
  lost = false;
  canvas.dispatchEvent(new Event('webglcontextrestored'));
  const recovered = r.retryGraphics();
  await rebuilding;
  expect(generations).toEqual([1]);
  (r as any).generation = 2;
  (r as any).loadComplete = Promise.resolve();
  finish();
  await recovered;
  expect(generations).toEqual([1, 2]);
  expect(f.render).toHaveBeenCalledOnce();
  expect(r.getGraphicsState().status).toBe('ready');
  graphics.dispose();
});

it('does not invalidate an in-flight GPU rebuild when page visibility changes', async () => {
  const f = fixture();
  const release = vi.fn();
  Object.assign(f.r, { assets: { releaseGraphics: release } });
  f.lose();
  const restoring = f.restore();
  const before = release.mock.calls.length;
  f.r.setSuspended(true);
  f.r.setSuspended(false);
  expect(release).toHaveBeenCalledTimes(before);
  await restoring;
  expect(f.r.getGraphicsState().status).toBe('ready');
  f.graphics.dispose();
});
