import { useEffect, useRef } from 'react';
import { StudioRuntime, type RuntimeCallbacks } from '@virtualworld/engine';
import type { SceneSpec } from '@virtualworld/scene-schema';
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
}: {
  scene: SceneSpec;
  selected?: string;
  callbacks: RuntimeCallbacks;
  onRuntime: (runtime: StudioRuntime) => void;
}) {
  const container = useRef<HTMLDivElement>(null),
    runtime = useRef<StudioRuntime | null>(null),
    last = useRef(scene),
    cb = useRef(callbacks);
  cb.current = callbacks;
  useEffect(() => {
    let view: StudioRuntime;
    try {
      view = new StudioRuntime(container.current!, scene, {
        onSelect: (id) => cb.current.onSelect?.(id),
        onTransform: (id, patch) => cb.current.onTransform?.(id, patch),
        onStory: (s, n) => cb.current.onStory?.(s, n),
        onMetrics: (m) => cb.current.onMetrics?.(m),
        onError: (e) => cb.current.onError?.(e),
        onReady: () => cb.current.onReady?.(),
      });
      runtime.current = view;
      window.virtualworld = view;
      last.current = scene;
      onRuntime(view);
    } catch (error) {
      cb.current.onError?.(`WebGL 2 初始化失败：${String(error)}`);
      return;
    }
    return () => {
      view.dispose();
      runtime.current = null;
      delete window.virtualworld;
    };
  }, []);
  useEffect(() => {
    if (runtime.current && last.current !== scene) {
      last.current = scene;
      void runtime.current.load(scene);
    }
  }, [scene]);
  useEffect(() => runtime.current?.select(selected), [selected, scene]);
  return <div className="canvas-host" ref={container} data-testid="viewport" />;
}
