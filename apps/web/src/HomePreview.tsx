import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { LazyBoundary } from './LazyBoundary';
import { schedulePreview } from './preview-schedule';

const LivePreview = lazy(() => import('./LivePreview'));
export function HomePreview() {
  const host = useRef<HTMLDivElement>(null);
  const [started, setStarted] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const onReady = useCallback(() => setReady(true), []);
  const onError = useCallback(() => setFailed(true), []);
  useEffect(() => schedulePreview(host.current!, () => setStarted(true)), []);
  return (
    <div className={`home-preview${ready && !failed ? ' is-live' : ''}`} ref={host}>
      <img
        className="home-preview-poster"
        src="/world-previews/desert.jpg"
        alt="小王子的沙海世界"
        fetchPriority="high"
      />
      {started && !failed && (
        <LazyBoundary fallback={null} onError={onError}>
          <Suspense fallback={null}>
            <LivePreview onReady={onReady} onError={onError} />
          </Suspense>
        </LazyBoundary>
      )}
      {failed && (
        <p className="home-preview-status" role="status">
          实时预览暂不可用，仍可从下方探索世界。
        </p>
      )}
    </div>
  );
}
