import { afterEach, expect, it, vi } from 'vitest';
import { GraphicsRecovery } from '../../packages/engine/src/graphics';

afterEach(() => vi.useRealTimers());
function fixture(rebuild: (current: () => boolean) => Promise<void> = async () => {}) {
  const canvas = new EventTarget();
  let lost = false;
  const changed = vi.fn();
  const restore = vi.fn(rebuild);
  const recovery = new GraphicsRecovery(canvas, () => lost, restore, changed);
  return {
    canvas,
    recovery,
    restore,
    changed,
    lose() {
      lost = true;
      canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    },
    restoreContext() {
      lost = false;
      canvas.dispatchEvent(new Event('webglcontextrestored'));
    },
  };
}

it('immediately reports immutable snapshots and blocks until restored GPU resources finish', async () => {
  let finish!: () => void;
  const f = fixture(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const states: string[] = [];
  const unsubscribe = f.recovery.subscribe((state) => states.push(state.status));
  const snapshot = f.recovery.snapshot();
  snapshot.status = 'failed';
  expect(f.recovery.snapshot().status).toBe('ready');
  f.lose();
  expect(f.recovery.blocked).toBe(true);
  f.restoreContext();
  await Promise.resolve();
  expect(f.recovery.snapshot().status).toBe('restoring');
  finish();
  await f.recovery.retry();
  expect(states).toEqual(['ready', 'lost', 'restoring', 'ready']);
  unsubscribe();
  f.lose();
  expect(states).toHaveLength(4);
  f.recovery.dispose();
});

it('ignores stale resource completion after a repeated loss and after disposal', async () => {
  const checks: (() => boolean)[] = [];
  const finishes: (() => void)[] = [];
  const f = fixture((current) => {
    checks.push(current);
    return new Promise<void>((resolve) => finishes.push(resolve));
  });
  f.lose();
  f.restoreContext();
  await Promise.resolve();
  f.lose();
  expect(checks[0]()).toBe(false);
  finishes[0]();
  await Promise.resolve();
  await Promise.resolve();
  expect(f.recovery.snapshot().status).toBe('lost');
  f.restoreContext();
  await Promise.resolve();
  f.recovery.dispose();
  expect(checks[1]()).toBe(false);
  finishes[1]();
  await Promise.resolve();
  await Promise.resolve();
  const calls = f.changed.mock.calls.length;
  f.canvas.dispatchEvent(new Event('webglcontextrestored'));
  expect(f.changed).toHaveBeenCalledTimes(calls);
});

it('exposes a retryable GPU failure without publishing ready and succeeds on an explicit retry', async () => {
  let attempts = 0;
  const f = fixture(async () => {
    if (++attempts === 1) throw new Error('PMREM upload failed');
  });
  f.lose();
  f.restoreContext();
  await f.recovery.retry();
  expect(f.recovery.snapshot()).toMatchObject({ status: 'failed', detail: 'PMREM upload failed' });
  await f.recovery.retry();
  expect(f.recovery.snapshot().status).toBe('ready');
  expect(attempts).toBe(2);
  f.recovery.dispose();
});

it('times out a missing browser restoration and refuses to rebuild while the real context remains lost', async () => {
  vi.useFakeTimers();
  const f = fixture();
  f.lose();
  await vi.advanceTimersByTimeAsync(15000);
  expect(f.recovery.snapshot().status).toBe('failed');
  await f.recovery.retry();
  expect(f.recovery.snapshot().status).toBe('lost');
  expect(f.restore).not.toHaveBeenCalled();
  f.recovery.dispose();
});

it('times out a hung GPU rebuild and invalidates its late result', async () => {
  vi.useFakeTimers();
  let current!: () => boolean;
  let finish!: () => void;
  const f = fixture((valid) => {
    current = valid;
    return new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  f.lose();
  f.restoreContext();
  const pending = f.recovery.retry();
  await vi.advanceTimersByTimeAsync(15000);
  await pending;
  expect(f.recovery.snapshot().status).toBe('failed');
  expect(current()).toBe(false);
  finish();
  await Promise.resolve();
  expect(f.recovery.snapshot().status).toBe('failed');
  f.recovery.dispose();
});

it('cancels the restoration deadline when a managed renderer failure enters the shared failure path', async () => {
  vi.useFakeTimers();
  const f = fixture(() => new Promise<void>(() => {}));
  f.lose();
  f.restoreContext();
  const pending = f.recovery.retry();
  f.recovery.fail(new Error('normal update readback failed'));
  await pending;
  await vi.advanceTimersByTimeAsync(15000);
  expect(f.recovery.snapshot()).toMatchObject({
    status: 'failed',
    detail: 'normal update readback failed',
  });
  f.recovery.dispose();
});
