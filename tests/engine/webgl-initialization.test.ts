import { expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  rendererThrows: false,
  disposed: 0,
  removed: 0,
  roomDisposed: 0,
  pmremDisposed: 0,
}));
vi.mock('three', async (original) => {
  const three = await original<typeof import('three')>();
  return {
    ...three,
    WebGLRenderer: class {
      shadowMap = {};
      domElement = {
        remove: () => {
          state.removed++;
        },
      };
      constructor() {
        if (state.rendererThrows) throw new Error('Error creating WebGL context.');
      }
      setPixelRatio() {}
      setAnimationLoop() {}
      dispose() {
        state.disposed++;
      }
    },
    PMREMGenerator: class {
      fromScene() {
        throw new Error('GPU environment allocation failed');
      }
      dispose() {
        state.pmremDisposed++;
      }
    },
  };
});
vi.mock('three/addons/environments/RoomEnvironment.js', () => ({
  RoomEnvironment: class {
    dispose() {
      state.roomDisposed++;
    }
  },
}));
import { StudioRuntime, WebGLInitializationError } from '@virtualworld/engine';
import { emptyScene } from '@virtualworld/scene-schema';

it('classifies the actual renderer creation failure without allocating another capability probe', () => {
  vi.stubGlobal('devicePixelRatio', 1);
  state.rendererThrows = true;
  let failure: unknown;
  try {
    new StudioRuntime({} as HTMLElement, emptyScene());
  } catch (error) {
    failure = error;
  }
  expect(failure).toMatchObject({
    name: 'WebGLInitializationError',
    detail: 'Error creating WebGL context.',
  });
  expect(WebGLInitializationError).toBeTypeOf('function');
  expect(state.disposed).toBe(0);
  vi.unstubAllGlobals();
});

it('releases an already created renderer and temporary environment resources when construction fails', () => {
  vi.stubGlobal('devicePixelRatio', 1);
  state.rendererThrows = false;
  expect(() => new StudioRuntime({} as HTMLElement, emptyScene())).toThrow(
    WebGLInitializationError,
  );
  expect(state.disposed).toBe(1);
  expect(state.removed).toBe(1);
  expect(state.roomDisposed).toBe(1);
  expect(state.pmremDisposed).toBe(1);
  vi.unstubAllGlobals();
});
