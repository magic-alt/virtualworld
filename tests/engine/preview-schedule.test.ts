import { afterEach, expect, it, vi } from 'vitest';
import { schedulePreview } from '../../apps/web/src/preview-schedule';

afterEach(() => vi.unstubAllGlobals());
function browser() {
  let observed: (entries: { isIntersecting: boolean }[]) => void = () => {};
  let visibility: () => void = () => {};
  const idle = new Map<number, () => void>();
  let nextId = 0;
  const doc = {
    hidden: false,
    addEventListener: (_name: string, callback: () => void) => {
      visibility = callback;
    },
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    requestIdleCallback: (callback: () => void) => {
      idle.set(++nextId, callback);
      return nextId;
    },
    cancelIdleCallback: (id: number) => idle.delete(id),
  });
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: typeof observed) {
        observed = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  return {
    doc,
    idle,
    visible: (value: boolean) => observed([{ isIntersecting: value }]),
    visibility: () => visibility(),
    flush: () => {
      const callbacks = [...idle.values()];
      idle.clear();
      callbacks.forEach((callback) => callback());
    },
  };
}

it('starts a visible preview only after idle and at most once', () => {
  const env = browser();
  let starts = 0;
  const dispose = schedulePreview({} as HTMLElement, () => starts++);
  env.flush();
  expect(starts).toBe(0);
  env.visible(true);
  expect(starts).toBe(0);
  env.flush();
  expect(starts).toBe(1);
  env.visible(false);
  env.visible(true);
  env.flush();
  expect(starts).toBe(1);
  dispose();
});

it('cancels pending work while offscreen, document-hidden or unmounted', () => {
  const env = browser();
  let starts = 0;
  const dispose = schedulePreview({} as HTMLElement, () => starts++);
  env.visible(true);
  env.visible(false);
  env.flush();
  expect(starts).toBe(0);
  env.visible(true);
  env.doc.hidden = true;
  env.visibility();
  env.flush();
  expect(starts).toBe(0);
  env.doc.hidden = false;
  env.visibility();
  expect(env.idle.size).toBe(1);
  const staleIdle = [...env.idle.values()][0];
  dispose();
  staleIdle();
  expect(starts).toBe(0);
});
