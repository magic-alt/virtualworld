import type { StudioRuntime, RuntimeMetrics, RenderQuality } from '@virtualworld/engine';
import { interactionStatus } from '@virtualworld/interaction';
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}
/** DOM controls shared by the React application and the standalone player. */
export function mountExperienceControls(
  runtime: StudioRuntime,
  options: {
    onReset?: () => void;
    onError?: (error: unknown) => void;
    onCloseDialog?: () => void;
  } = {},
) {
  const element = el('div', 'experience-controls');
  let graphicsBlocked = runtime.getGraphicsState().status !== 'ready';
  const hotspots = el('div', 'experience-hotspots'),
    guidance = el('p', 'experience-guidance');
  hotspots.setAttribute('aria-label', '场景互动');
  guidance.setAttribute('role', 'status');
  const hotspotButtons = new Map<string, HTMLButtonElement>();
  const dock = el('div', 'experience-dock'),
    journal = el('section', 'experience-journal'),
    settings = el('section', 'experience-settings');
  journal.hidden = true;
  settings.hidden = true;
  journal.setAttribute('aria-label', '旅程手记');
  settings.setAttribute('aria-label', '播放设置');
  const button = (text: string, label: string, action: () => void) => {
    const b = el('button', '', text);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.onclick = () => {
      if (!graphicsBlocked) action();
    };
    return b;
  };
  const report = (error: unknown) => options.onError?.(error);
  const pause = button('Ⅱ', '暂停体验', () => {
    runtime.setPaused(!runtime.getDiagnostics().paused);
    update(runtime.getDiagnostics());
  });
  const mode = button('自由观赏', '切换自由观赏', () => {
    mode.disabled = true;
    void runtime
      .setMode(runtime.getDiagnostics().mode === 'explore' ? 'view' : 'explore')
      .catch(report)
      .finally(() => {
        mode.disabled = false;
        update(runtime.getDiagnostics());
      });
  });
  mode.hidden = runtime.spec.mode !== 'world';
  const notes = button('旅程手记', '旅程手记', () => {
    journal.hidden = !journal.hidden;
    notes.setAttribute('aria-expanded', String(!journal.hidden));
  });
  notes.hidden = !runtime.spec.tasks.length;
  const full = button('⛶', '全屏显示', () => {
    const promise = document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen?.();
    void promise?.then(syncFullscreen, (error) => {
      syncFullscreen();
      report(error);
    });
  });
  function syncFullscreen() {
    full.setAttribute('aria-label', document.fullscreenElement ? '退出全屏' : '全屏显示');
    full.setAttribute('aria-pressed', String(!!document.fullscreenElement));
    full.disabled = !document.fullscreenEnabled || !document.documentElement.requestFullscreen;
  }
  syncFullscreen();
  document.addEventListener('fullscreenchange', syncFullscreen);
  let pauseBeforeMenu = false;
  const menu = button('设置', '播放设置', () => {
    settings.hidden = !settings.hidden;
    menu.setAttribute('aria-expanded', String(!settings.hidden));
    if (!settings.hidden) {
      pauseBeforeMenu = !!runtime.getDiagnostics().paused;
      runtime.setPaused(true);
    } else runtime.setPaused(pauseBeforeMenu);
    update(runtime.getDiagnostics());
  });
  const quality = el('select');
  quality.setAttribute('aria-label', '画面质量');
  for (const [value, text] of [
    ['low', '流畅'],
    ['balanced', '均衡'],
    ['high', '精细'],
  ]) {
    const option = el('option', '', text);
    option.value = value;
    quality.append(option);
  }
  let savedQuality: string | null = null;
  try {
    savedQuality = localStorage.getItem('vw-render-quality');
  } catch {}
  quality.value =
    savedQuality && ['low', 'balanced', 'high'].includes(savedQuality) ? savedQuality : 'balanced';
  runtime.setQuality(quality.value as RenderQuality);
  quality.onchange = () => {
    runtime.setQuality(quality.value as RenderQuality);
    try {
      localStorage.setItem('vw-render-quality', quality.value);
    } catch {}
  };
  const qualityLabel = el('label', '', '画面质量');
  qualityLabel.append(quality);
  settings.append(
    el('h3', '', '让探索更舒适'),
    qualityLabel,
    el(
      'p',
      '',
      runtime.spec.mode === 'world'
        ? 'WASD / 方向键移动，空格跳跃，E 与附近对象互动。拖动调整镜头；触屏使用左侧摇杆。'
        : '拖动旋转，滚轮或双指缩放。通过下方控件观察运动、剖面与装配。',
    ),
  );
  if (runtime.spec.tasks.length)
    settings.append(
      button(
        options.onReset ? '重置全部旅程' : '重置旅程',
        options.onReset ? '重置全部旅程' : '重置旅程',
        () => {
          if (!confirm('重置已保存的旅程进度？')) return;
          if (options.onReset) options.onReset();
          else runtime.resetProgress();
          update(runtime.getDiagnostics());
        },
      ),
    );
  settings.append(button('关闭设置', '关闭播放设置', () => menu.click()));
  const touch = el('div', 'experience-touch'),
    stick = el('div', 'experience-stick'),
    thumb = el('span');
  stick.setAttribute('role', 'group');
  stick.setAttribute('aria-label', '移动摇杆');
  stick.append(thumb);
  const move = { x: 0, y: 0, jump: false };
  let pointer: number | undefined;
  function reset() {
    pointer = undefined;
    move.x = move.y = 0;
    move.jump = false;
    thumb.style.transform = '';
    runtime.setMovement(move);
  }
  const drag = (event: PointerEvent) => {
    if (event.pointerId !== pointer) return;
    const rect = stick.getBoundingClientRect();
    move.x = Math.max(-1, Math.min(1, (event.clientX - rect.left - rect.width / 2) / 34));
    move.y = Math.max(-1, Math.min(1, (event.clientY - rect.top - rect.height / 2) / 34));
    thumb.style.transform = `translate(${move.x * 25}px,${move.y * 25}px)`;
    runtime.setMovement(move);
  };
  stick.onpointerdown = (event) => {
    if (pointer !== undefined) return;
    pointer = event.pointerId;
    stick.setPointerCapture(pointer);
    drag(event);
  };
  stick.onpointermove = drag;
  stick.onpointerup = reset;
  stick.onpointercancel = reset;
  stick.onlostpointercapture = reset;
  const jump = button('↑', '跳跃', () => {});
  jump.onpointerdown = (event) => {
    jump.setPointerCapture(event.pointerId);
    move.jump = true;
    runtime.setMovement(move);
  };
  const releaseJump = () => {
    move.jump = false;
    runtime.setMovement(move);
  };
  jump.onpointerup = releaseJump;
  jump.onpointercancel = releaseJump;
  jump.onlostpointercapture = releaseJump;
  const interact = button('互动', '附近互动', () => runtime.interact());
  touch.append(stick, jump, interact);
  dock.append(pause, mode, notes, full, menu);
  element.append(hotspots, guidance, dock, journal, settings, touch);
  let hiddenPaused = false;
  const visibility = () => {
    if (document.hidden) {
      hiddenPaused = !!runtime.getDiagnostics().paused;
      runtime.setPaused(true);
      reset();
    } else runtime.setPaused(hiddenPaused);
    runtime.setSuspended(document.hidden);
    update(runtime.getDiagnostics());
  };
  const blur = () => reset();
  const escape = (event: KeyboardEvent) => {
    if (graphicsBlocked) return;
    if (event.key === 'Escape') {
      if (dialogPaused !== undefined) {
        options.onCloseDialog?.();
        return;
      }
      if (!settings.hidden) menu.click();
      else {
        runtime.setPaused(!runtime.getDiagnostics().paused);
        update(runtime.getDiagnostics());
      }
    }
  };
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('blur', blur);
  window.addEventListener('keydown', escape);
  let dialogPaused: boolean | undefined;
  function setDialogOpen(open: boolean) {
    if (open && !settings.hidden) menu.click();
    dock.inert = open;
    hotspots.inert = open;
    if (open && dialogPaused === undefined) {
      dialogPaused = !!runtime.getDiagnostics().paused;
      runtime.setPaused(true);
      reset();
    }
    if (open) runtime.setPaused(true);
    if (!open && dialogPaused !== undefined) {
      runtime.setPaused(dialogPaused);
      dialogPaused = undefined;
    }
    update(runtime.getDiagnostics());
  }
  function update(metrics: RuntimeMetrics) {
    pause.textContent = metrics.paused ? '▷' : 'Ⅱ';
    pause.setAttribute('aria-label', metrics.paused ? '继续体验' : '暂停体验');
    mode.textContent = metrics.mode === 'view' ? '进入探索' : '自由观赏';
    mode.setAttribute('aria-label', metrics.mode === 'view' ? '切换第三人称探索' : '切换自由观赏');
    touch.hidden =
      graphicsBlocked ||
      metrics.mode !== 'explore' ||
      !!metrics.paused ||
      runtime.spec.mode !== 'world';
    hotspots.hidden = graphicsBlocked || metrics.mode !== 'explore' || !!metrics.paused;
    guidance.hidden = hotspots.hidden || !runtime.spec.tasks.length;
    const visible = new Set<string>();
    const occupied: { x: number; y: number }[] = [];
    const bounds = element.getBoundingClientRect();
    for (const hotspot of metrics.hotspots || []) {
      const node = runtime.spec.nodes.find((n) => n.id === hotspot.id);
      if (!node) continue;
      const status = interactionStatus(node, metrics.story);
      if (status === 'none') continue;
      visible.add(hotspot.id);
      let b = hotspotButtons.get(hotspot.id);
      if (!b) {
        b = button('', '', () => runtime.interact(hotspot.id));
        b.className = 'experience-hotspot';
        b.dataset.nodeId = hotspot.id;
        hotspotButtons.set(hotspot.id, b);
        hotspots.append(b);
      }
      const state =
        status === 'locked'
          ? '先完成前置任务'
          : status === 'completed'
            ? '已完成 · 回顾'
            : '可互动';
      const hint = hotspot.inRange ? state : `${state} · 靠近后互动`;
      const label = `${hotspot.label} · ${hint}`;
      if (b.textContent !== label) b.textContent = label;
      b.setAttribute('aria-label', `${hotspot.label}，${hint}`);
      b.title = hint;
      b.dataset.status = status;
      b.disabled = !hotspot.inRange || !!metrics.paused;
      // Separate nearby anchors, including the two visits to the same rose garden.
      const x = Math.max(105, Math.min(bounds.width - 105, hotspot.x));
      const minY = 155;
      const maxY = Math.max(
        minY,
        bounds.height - (matchMedia('(pointer: coarse)').matches ? 270 : 180),
      );
      const anchorY = Math.max(minY, Math.min(maxY, hotspot.y));
      let y = anchorY;
      for (let row = 0; row < 12; row++) {
        const candidate = anchorY + (row % 2 ? 1 : -1) * Math.ceil(row / 2) * 64;
        if (candidate < minY || candidate > maxY) continue;
        if (!occupied.some((p) => Math.abs(p.x - x) < 220 && Math.abs(p.y - candidate) < 64)) {
          y = candidate;
          break;
        }
      }
      occupied.push({ x, y });
      b.style.left = `${x}px`;
      b.style.top = `${y}px`;
    }
    for (const [id, b] of hotspotButtons) {
      if (!visible.has(id)) {
        b.remove();
        hotspotButtons.delete(id);
      }
    }
    const nearby = runtime.nearest();
    const next = runtime.spec.tasks.find((task) => !metrics.story.flags.includes(task.flag));
    const instruction = nearby?.interaction
      ? `E / 互动：${nearby.interaction.title}${interactionStatus(nearby, metrics.story) === 'locked' ? ' · 请先完成手记中的前置任务' : ''}`
      : next
        ? `下一步：${next.label} · 靠近场景标记后互动`
        : '本章已完成 · 可以继续探索和回顾相遇';
    if (guidance.textContent !== instruction) guidance.textContent = instruction;
    journal.replaceChildren(
      el('h3', '', '旅程手记'),
      ...runtime.spec.tasks.map((task) =>
        el(
          'p',
          metrics.story.flags.includes(task.flag) ? 'done' : '',
          `${metrics.story.flags.includes(task.flag) ? '✓' : '○'} ${task.label}`,
        ),
      ),
    );
  }
  const unsubscribeGraphics = runtime.subscribeGraphics((state) => {
    graphicsBlocked = state.status !== 'ready';
    element.inert = graphicsBlocked;
    if (graphicsBlocked) reset();
    update(runtime.getDiagnostics());
  });
  update(runtime.getDiagnostics());
  return {
    element,
    update,
    setDialogOpen,
    dispose() {
      unsubscribeGraphics();
      reset();
      document.removeEventListener('visibilitychange', visibility);
      document.removeEventListener('fullscreenchange', syncFullscreen);
      window.removeEventListener('blur', blur);
      window.removeEventListener('keydown', escape);
      element.remove();
    },
  };
}
