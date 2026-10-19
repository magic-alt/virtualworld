import { useEffect, useState } from 'react';
import { assertScene, type SceneSpec } from '@virtualworld/scene-schema';
import type { GraphicsState } from '@virtualworld/engine';
import { Viewport } from './Viewport';
import { api } from './api';

export default function LivePreview({
  onReady,
  onError,
  onGraphics,
}: {
  onReady: () => void;
  onError: () => void;
  onGraphics: (state: GraphicsState) => void;
}) {
  const [scene, setScene] = useState<SceneSpec>();
  useEffect(() => {
    const controller = new AbortController();
    void api('/api/projects/little-prince-desert', { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setScene(assertScene(data));
      })
      .catch(() => {
        if (!controller.signal.aborted) onError();
      });
    return () => controller.abort();
  }, [onError]);
  return scene ? (
    <Viewport
      preview
      scene={scene}
      callbacks={{ onReady, onError }}
      onGraphics={onGraphics}
      onRuntime={(runtime) => {
        if (!runtime) return;
        void runtime.setMode('view').catch(() => {
          if (runtime.getGraphicsState().status === 'ready') onError();
        });
        runtime.controls.autoRotate = !matchMedia('(prefers-reduced-motion: reduce)').matches;
        runtime.controls.autoRotateSpeed = 0.35;
      }}
    />
  ) : null;
}
