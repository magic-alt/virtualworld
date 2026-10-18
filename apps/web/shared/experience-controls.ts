import type { StudioRuntime, RuntimeMetrics, RenderQuality } from '@virtualworld/engine';
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
    b.onclick = action;
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
  element.append(dock, journal, settings, touch);
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
    touch.hidden = metrics.mode !== 'explore' || !!metrics.paused || runtime.spec.mode !== 'world';
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
  update(runtime.getDiagnostics());
  return {
    element,
    update,
    setDialogOpen,
    dispose() {
      reset();
      document.removeEventListener('visibilitychange', visibility);
      document.removeEventListener('fullscreenchange', syncFullscreen);
      window.removeEventListener('blur', blur);
      window.removeEventListener('keydown', escape);
      element.remove();
    },
  };
}
