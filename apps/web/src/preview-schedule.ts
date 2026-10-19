/** Delay optional 3D work until the poster is visible and the main thread has spare time. */
export function schedulePreview(host: HTMLElement, start: () => void) {
  let visible = false;
  let disposed = false;
  let started = false;
  let pending: number | undefined;
  const usesIdle = typeof window.requestIdleCallback === 'function';
  const cancel = () => {
    if (pending === undefined) return;
    if (usesIdle) window.cancelIdleCallback(pending);
    else window.clearTimeout(pending);
    pending = undefined;
  };
  const update = () => {
    if (disposed || started || !visible || document.hidden) {
      cancel();
      return;
    }
    if (pending !== undefined) return;
    const run = () => {
      pending = undefined;
      if (disposed || started || !visible || document.hidden) return;
      started = true;
      start();
    };
    pending = usesIdle
      ? window.requestIdleCallback(run, { timeout: 1500 })
      : window.setTimeout(run, 160);
  };
  const observer =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => {
          visible = entries.some((entry) => entry.isIntersecting);
          update();
        })
      : undefined;
  const measure = () => {
    const rect = host.getBoundingClientRect();
    visible =
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth;
    update();
  };
  if (observer) observer.observe(host);
  else {
    measure();
    window.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
  }
  document.addEventListener('visibilitychange', update);
  return () => {
    disposed = true;
    cancel();
    observer?.disconnect();
    window.removeEventListener('scroll', measure);
    window.removeEventListener('resize', measure);
    document.removeEventListener('visibilitychange', update);
  };
}
