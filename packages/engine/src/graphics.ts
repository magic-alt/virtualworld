export type GraphicsState = {
  status: 'ready' | 'lost' | 'restoring' | 'failed';
  message?: string;
  detail?: string;
};

export class WebGLInitializationError extends Error {
  readonly detail: string;
  constructor(cause: unknown) {
    super('无法初始化 WebGL 2 三维画面，请检查浏览器图形支持后重试。', { cause });
    this.name = 'WebGLInitializationError';
    this.detail = cause instanceof Error ? cause.message : String(cause);
  }
}

/** Owns only GPU availability; scene, user pause and page visibility stay with the runtime. */
export class GraphicsRecovery {
  private state: GraphicsState = { status: 'ready' };
  private listeners = new Set<(state: GraphicsState) => void>();
  private version = 0;
  private disposed = false;
  private timer?: ReturnType<typeof setTimeout>;
  private attempt?: Promise<void>;
  private cancelAttempt?: () => void;
  constructor(
    private canvas: EventTarget,
    private isLost: () => boolean,
    private rebuild: (current: () => boolean) => Promise<void>,
    private changed: () => void,
  ) {
    // Registered after Three's listeners: its internal GL state is rebuilt first.
    canvas.addEventListener('webglcontextlost', this.lost);
    canvas.addEventListener('webglcontextrestored', this.restored);
  }
  snapshot(): GraphicsState {
    return { ...this.state };
  }
  get blocked() {
    return this.state.status !== 'ready';
  }
  subscribe(listener: (state: GraphicsState) => void) {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }
  private publish(state: GraphicsState) {
    if (this.disposed) return;
    this.state = state;
    this.changed();
    for (const listener of this.listeners) listener(this.snapshot());
  }
  private clearAttempt() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.cancelAttempt?.();
    this.cancelAttempt = undefined;
    this.attempt = undefined;
  }
  private lost = (event: Event) => {
    event.preventDefault();
    if (this.disposed) return;
    this.version++;
    this.clearAttempt();
    this.publish({
      status: 'lost',
      message: '图形连接已中断，画面与操作已暂停。',
      detail: '正在等待浏览器恢复 WebGL 连接，当前场景和进度保留。',
    });
    this.timer = setTimeout(() => {
      this.publish({
        status: 'failed',
        message: '浏览器尚未恢复图形连接。',
        detail: '可重试检查连接；当前场景与进度保留。如持续失败，请检查浏览器图形设置后重新打开。',
      });
    }, 15000);
  };
  private restored = () => {
    void this.retry();
  };
  retry(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.isLost()) {
      this.lost(new Event('webglcontextlost'));
      return Promise.resolve();
    }
    if (this.attempt) return this.attempt;
    if (this.state.status === 'ready') return Promise.resolve();
    this.clearAttempt();
    const version = ++this.version;
    const current = () => !this.disposed && version === this.version && !this.isLost();
    this.publish({ status: 'restoring', message: '图形连接已恢复，正在重建画面资源…' });
    const cancelled = new Promise<void>((resolve) => {
      this.cancelAttempt = resolve;
    });
    const deadline = new Promise<never>((_, reject) => {
      this.timer = setTimeout(() => reject(new Error('重建图形资源超时，请重试。')), 15000);
    });
    // A microtask also lets every browser/Three restore listener finish before GPU work.
    const attempt = Promise.race([
      Promise.resolve().then(() => {
        if (current()) return this.rebuild(current);
      }),
      deadline,
      cancelled,
    ])
      .then(() => {
        if (current()) this.publish({ status: 'ready' });
        else if (!this.disposed && version === this.version && this.isLost())
          this.lost(new Event('webglcontextlost'));
      })
      .catch((error: unknown) => {
        if (!this.disposed && version === this.version) {
          this.version++;
          this.publish({
            status: 'failed',
            message: '图形资源恢复失败，请重试。',
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      })
      .finally(() => {
        if (this.attempt === attempt) {
          clearTimeout(this.timer);
          this.timer = undefined;
          this.attempt = undefined;
          this.cancelAttempt = undefined;
        }
      });
    this.attempt = attempt;
    return attempt;
  }
  fail(error: unknown) {
    if (this.disposed) return;
    this.version++;
    this.clearAttempt();
    this.publish({
      status: 'failed',
      message: '图形资源更新失败，请重试恢复。',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.version++;
    this.clearAttempt();
    this.canvas.removeEventListener('webglcontextlost', this.lost);
    this.canvas.removeEventListener('webglcontextrestored', this.restored);
    this.listeners.clear();
  }
}
