import { useEffect, useRef } from 'react';
import {
  StudioRuntime,
  WebGLInitializationError,
  type GraphicsState,
  type RuntimeCallbacks,
} from '@virtualworld/engine';
import type { SceneSpec } from '@virtualworld/scene-schema';
import { mountGraphicsStatus } from '../shared/graphics-status';
declare global {
  interface Window {
    virtualworld?: StudioRuntime;
  }
}
export function Viewport({
  scene,
  selected,
  callbacks,
  onRuntime,
  onGraphics,
  preview = false,
}: {
  scene: SceneSpec;
  selected?: string;
  callbacks: RuntimeCallbacks;
  onRuntime: (runtime: StudioRuntime | undefined) => void;
  onGraphics?: (state: GraphicsState) => void;
  preview?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null),
    runtime = useRef<StudioRuntime | undefined>(undefined),
    last = useRef(scene),
    current = useRef({ scene, selected, callbacks, onRuntime, onGraphics });
  current.current = { scene, selected, callbacks, onRuntime, onGraphics };
  useEffect(() => {
    let disposed = false;
    let version = 0;
    let visible = true;
    const graphics = mountGraphicsStatus({
      onRetry: async () => {
        if (disposed) return;
        if (runtime.current) await runtime.current.retryGraphics();
        else initialize();
      },
      onState: (state) => current.current.onGraphics?.(state),
    });
    container.current!.append(graphics.element);
    const updateVisibility = () => runtime.current?.setSuspended(!visible || document.hidden);
    function initialize() {
      if (disposed || runtime.current) return;
      const attempt = ++version;
      const live = () => !disposed && attempt === version;
      const snapshot = current.current.scene;
      try {
        const view = new StudioRuntime(container.current!, snapshot, {
          onSelect: (id) => {
            if (live()) current.current.callbacks.onSelect?.(id);
          },
          onTransform: (id, patch) => {
            if (live()) current.current.callbacks.onTransform?.(id, patch);
          },
          onStory: (s, n) => {
            if (live()) current.current.callbacks.onStory?.(s, n);
          },
          onMetrics: (m) => {
            if (live()) current.current.callbacks.onMetrics?.(m);
          },
          onError: (e) => {
            if (live()) current.current.callbacks.onError?.(e);
          },
          onReady: () => {
            if (live()) current.current.callbacks.onReady?.();
          },
        });
        runtime.current = view;
        window.virtualworld = view;
        last.current = snapshot;
        graphics.bind(view);
        current.current.onRuntime(view);
        view.select(current.current.selected);
        updateVisibility();
        void view.ready.catch((error: unknown) => {
          if (live())
            current.current.callbacks.onError?.(
              error instanceof Error ? error.message : String(error),
            );
        });
      } catch (error) {
        if (error instanceof WebGLInitializationError) graphics.initializationFailed(error);
        else
          current.current.callbacks.onError?.(
            error instanceof Error ? error.message : String(error),
          );
      }
    }
    initialize();
    const observer = preview
      ? new IntersectionObserver((entries) => {
          visible = entries[0].isIntersecting;
          updateVisibility();
        })
      : undefined;
    observer?.observe(container.current!);
    if (preview) document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      disposed = true;
      version++;
      observer?.disconnect();
      document.removeEventListener('visibilitychange', updateVisibility);
      const view = runtime.current;
      graphics.dispose();
      view?.dispose();
      runtime.current = undefined;
      current.current.onRuntime(undefined);
      if (window.virtualworld === view) delete window.virtualworld;
    };
  }, []);
  useEffect(() => {
    const view = runtime.current;
    if (view && last.current !== scene) {
      last.current = scene;
      void view.load(scene).catch((error: unknown) => {
        if (runtime.current === view && last.current === scene)
          current.current.callbacks.onError?.(
            error instanceof Error ? error.message : String(error),
          );
      });
    }
  }, [scene]);
  useEffect(() => runtime.current?.select(selected), [selected, scene]);
  return <div className="canvas-host" ref={container} data-testid="viewport" />;
}
