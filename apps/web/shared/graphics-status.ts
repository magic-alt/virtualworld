import type { GraphicsState, StudioRuntime } from '@virtualworld/engine';
import './graphics-status.css';

/** Persistent graphics feedback shared by React hosts and the offline player. */
export function mountGraphicsStatus(options: {
  onRetry: () => void | Promise<void>;
  onState?: (state: GraphicsState) => void;
}) {
  const element = document.createElement('section');
  element.className = 'graphics-status-panel';
  element.dataset.testid = 'graphics-status-panel';
  element.hidden = true;
  element.setAttribute('aria-label', '图形状态');
  const card = document.createElement('div');
  card.className = 'graphics-status-card';
  const heading = document.createElement('h2');
  const message = document.createElement('p');
  const note = document.createElement('p');
  note.textContent = '场景内容会保留；恢复画面不会重新加载网页。';
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = '故障详情';
  const detail = document.createElement('pre');
  details.append(summary, detail);
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = '重试加载画面';
  retry.setAttribute('aria-label', '重试加载画面');
  card.append(heading, message, note, details, retry);
  element.append(card);
  let state: GraphicsState = { status: 'ready' };
  let disposed = false;
  let busy = false;
  let unsubscribe: (() => void) | undefined;
  function render() {
    element.dataset.status = state.status;
    element.hidden = state.status === 'ready';
    element.setAttribute('role', state.status === 'failed' ? 'alert' : 'status');
    element.setAttribute('aria-busy', String(busy || state.status === 'restoring'));
    heading.textContent =
      state.status === 'lost'
        ? '图形连接暂时中断'
        : state.status === 'restoring'
          ? '正在恢复画面'
          : '画面暂时无法显示';
    message.textContent =
      state.message ||
      (state.status === 'lost'
        ? '画面与场景互动已暂停，等待浏览器恢复图形连接。'
        : state.status === 'restoring'
          ? '正在恢复图形资源，请稍候。场景互动暂时暂停。'
          : '请重试加载画面。未保存的场景内容仍然保留。');
    detail.textContent = state.detail || '';
    details.hidden = !state.detail;
    retry.disabled = busy || state.status !== 'failed';
    retry.textContent = busy ? '正在重试…' : '重试加载画面';
  }
  function update(next: GraphicsState) {
    if (disposed) return;
    state = next;
    render();
    options.onState?.(next);
  }
  retry.onclick = () => {
    if (disposed || busy || state.status !== 'failed') return;
    busy = true;
    render();
    void Promise.resolve()
      .then(() => {
        if (!disposed) return options.onRetry();
      })
      .catch((error: unknown) => {
        if (disposed || state.status === 'lost') return;
        const errorDetail = error instanceof Error ? error.message : String(error);
        update({
          status: 'failed',
          message:
            state.status === 'failed' && state.message
              ? state.message
              : '画面重试未能完成，请查看故障详情后重试。',
          detail: [...new Set([state.detail, errorDetail].filter(Boolean))].join('\n'),
        });
      })
      .finally(() => {
        if (!disposed) {
          busy = false;
          render();
        }
      });
  };
  return {
    element,
    update,
    bind(runtime: StudioRuntime) {
      unsubscribe?.();
      unsubscribe = runtime.subscribeGraphics(update);
    },
    initializationFailed(error: Error & { detail?: string }) {
      update({
        status: 'failed',
        message: '无法启动 3D 画面。你可以重试，未保存的场景内容会保留。',
        detail: error.detail ? `${error.message}\n${error.detail}` : error.message,
      });
    },
    dispose() {
      disposed = true;
      unsubscribe?.();
      retry.onclick = null;
      element.remove();
    },
  };
}
