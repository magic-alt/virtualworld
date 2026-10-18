import type { StudioRuntime, MechanismViewState } from '@virtualworld/engine';
import './mechanism.css';

/** One accessible, transient observation panel for the app and offline player. */
export function mountMechanismControls(runtime: StudioRuntime) {
  const element = document.createElement('details');
  element.className = 'joint-panel';
  element.open = window.innerWidth > 700;
  element.setAttribute('aria-label', '机构控制');
  const summary = document.createElement('summary');
  summary.textContent = '机构控制';
  element.append(summary);
  const body = document.createElement('div');
  body.className = 'joint-panel-body';
  element.append(body);
  const listeners = new AbortController();
  const text = (tag: string, value: string, parent: HTMLElement = body) => {
    const el = document.createElement(tag);
    el.textContent = value;
    parent.append(el);
    return el;
  };
  const button = (label: string, action: () => void, parent: HTMLElement = body) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('aria-label', label);
    b.addEventListener('click', action, { signal: listeners.signal });
    parent.append(b);
    return b;
  };
  const input = (label: string, type: string, parent: HTMLElement = body) => {
    const row = document.createElement('label');
    row.append(document.createTextNode(label));
    const el = document.createElement('input');
    el.type = type;
    el.setAttribute('aria-label', label);
    row.append(el);
    parent.append(row);
    return el;
  };
  const value = (label: string) => {
    const row = document.createElement('div');
    row.className = 'joint-reading';
    text('span', label, row);
    const out = document.createElement('output');
    out.setAttribute('aria-label', label);
    row.append(out);
    readings.append(row);
    return out;
  };
  const setText = (el: HTMLElement, value: string) => {
    if (el.textContent !== value) el.textContent = value;
  };
  const m = runtime.spec.mechanism!;
  text(
    'small',
    `HARMONIC / ${(m.flexTeeth / (m.ringTeeth - m.flexTeeth)).toFixed(0)}:1 · 反向输出`,
  );
  const status = text('p', '停止 · 通电释放');
  status.className = 'joint-status';
  status.setAttribute('role', 'status');
  const transport = text('div', '');
  transport.className = 'joint-row';
  const play = button(
    '播放机构',
    () => runtime.animateJoints(!runtime.getMechanismState()?.moving),
    transport,
  );
  button('运动归零', () => runtime.resetMechanismMotion(), transport);
  const back = button('输入 −15°', () => runtime.stepMechanism(-Math.PI / 12), transport);
  const forward = button('输入 +15°', () => runtime.stepMechanism(Math.PI / 12), transport);
  const rpm = input('输入 RPM', 'range');
  Object.assign(rpm, { min: '-30', max: '30', step: '1', value: '6' });
  const number = input('输入转速数值', 'number');
  Object.assign(number, { min: '-30', max: '30', step: '1', value: '6' });
  rpm.addEventListener('input', () => runtime.setTransmissionSpeed(Number(rpm.value)), {
    signal: listeners.signal,
  });
  number.addEventListener(
    'change',
    () => {
      if (number.value.trim()) runtime.setTransmissionSpeed(number.valueAsNumber);
      number.value = String(runtime.getMechanismState()?.inputRpm ?? 6);
    },
    { signal: listeners.signal },
  );
  const readings = text('div', '');
  readings.className = 'joint-readings';
  const inputAngle = value('输入角度'),
    outputAngle = value('输出角度'),
    actual = value('实际输入 RPM'),
    outputRpm = value('实际输出 RPM');
  const explosion = input('爆炸展开', 'range');
  Object.assign(explosion, { min: '0', max: '1', step: '.01', value: '0' });
  const explosionValue = text('output', '装配 · 0%');
  explosion.addEventListener(
    'input',
    () => {
      runtime.explode(Number(explosion.value));
      fit();
    },
    { signal: listeners.signal },
  );
  const section = input('剖视', 'checkbox');
  section.addEventListener(
    'change',
    () => {
      runtime.setSection(section.checked);
      fit();
    },
    { signal: listeners.signal },
  );
  const views = text('div', '');
  views.className = 'joint-row';
  for (const [view, label] of [
    ['default', '默认视角'],
    ['front', '正视'],
    ['side', '侧视'],
    ['top', '顶视'],
    ['bottom', '底视'],
  ] as const)
    button(label, () => runtime.fitMechanismView(view), views);
  button('适配当前模型', () => fit(), views);
  const brake = runtime.spec.mechanism?.subsystems?.find((s) => s.optional === 'brake');
  const installed = brake ? input('安装可选抱闸', 'checkbox') : undefined;
  const power = brake ? input('抱闸线圈掉电', 'checkbox') : undefined;
  installed?.addEventListener(
    'change',
    () => {
      runtime.setBrakeInstalled(installed.checked);
      fit();
    },
    { signal: listeners.signal },
  );
  power?.addEventListener('change', () => runtime.setBrakePowered(!power.checked), {
    signal: listeners.signal,
  });
  if (brake)
    text('p', '永磁抱闸：通电释放，掉电理想保持；不计算制动距离或额定性能。').className =
      'joint-note';
  const description = text('p', '选择一个子系统，了解其结构与传动关系。');
  description.className = 'joint-description';
  const subsystemInputs = new Map<string, HTMLInputElement>();
  const isolateButtons = new Map<string, HTMLButtonElement>();
  for (const subsystem of runtime.spec.mechanism?.subsystems ?? []) {
    const row = text('div', '');
    row.className = 'joint-subsystem';
    const check = input(`显示${subsystem.name}`, 'checkbox', row);
    subsystemInputs.set(subsystem.id, check);
    check.addEventListener(
      'change',
      () => {
        runtime.setSubsystemVisible(subsystem.id, check.checked);
        fit();
      },
      { signal: listeners.signal },
    );
    const info = button(
      `了解${subsystem.name}`,
      () => {
        description.textContent = subsystem.description;
      },
      row,
    );
    info.textContent = '说明';
    const isolate = button(
      `单独观察${subsystem.name}`,
      () => {
        runtime.isolateSubsystem(
          runtime.getMechanismState()?.isolatedSubsystem === subsystem.id
            ? undefined
            : subsystem.id,
        );
        description.textContent = subsystem.description;
        fit();
      },
      row,
    );
    isolate.textContent = '单看';
    isolateButtons.set(subsystem.id, isolate);
  }
  const actions = text('div', '');
  actions.className = 'joint-row';
  button(
    '恢复全部部件',
    () => {
      runtime.isolateSubsystem();
      for (const subsystem of runtime.spec.mechanism?.subsystems ?? [])
        runtime.setSubsystemVisible(subsystem.id, true);
      fit();
    },
    actions,
  );
  button(
    '恢复展示',
    () => {
      runtime.resetMechanismPresentation();
      element.scrollTop = 0;
      summary.focus({ preventScroll: true });
      description.textContent = '选择一个子系统，了解其结构与传动关系。';
      fit();
    },
    actions,
  );
  const references = document.createElement('details');
  text('summary', '模型依据与边界', references);
  text(
    'p',
    runtime.spec.mechanism?.referenceNotes ?? '参数化机构示意；非制造图或性能验证。',
    references,
  );
  body.append(references);

  function update(state: MechanismViewState) {
    const locked = state.brakeInstalled && !state.brakePowered;
    const label = state.moving ? '暂停机构' : '播放机构';
    setText(play, label);
    play.setAttribute('aria-label', label);
    play.disabled = locked || state.paused;
    back.disabled = forward.disabled = state.moving || state.paused || locked;
    setText(
      status,
      `${state.paused ? '体验已暂停' : locked ? '抱闸保持' : state.moving ? '运动中' : '停止'} · ${!state.brakeInstalled ? '无抱闸' : state.brakePowered ? '通电释放' : '掉电抱紧'}`,
    );
    if (document.activeElement !== rpm) rpm.value = String(state.inputRpm);
    if (document.activeElement !== number) number.value = String(state.inputRpm);
    setText(inputAngle, `${((state.inputAngle * 180) / Math.PI).toFixed(1)}°`);
    setText(outputAngle, `${((state.outputAngle * 180) / Math.PI).toFixed(2)}°`);
    setText(actual, state.actualInputRpm.toFixed(1));
    setText(outputRpm, state.actualOutputRpm.toFixed(3));
    if (document.activeElement !== explosion) explosion.value = String(state.explosion);
    setText(
      explosionValue,
      `${state.explosion ? '展开' : '装配'} · ${Math.round(state.explosion * 100)}%`,
    );
    section.checked = state.section;
    if (installed) installed.checked = state.brakeInstalled;
    if (power) {
      power.checked = state.brakeInstalled && !state.brakePowered;
      power.disabled = !state.brakeInstalled;
    }
    for (const subsystem of runtime.spec.mechanism?.subsystems ?? []) {
      const check = subsystemInputs.get(subsystem.id)!;
      check.checked = !state.hiddenSubsystems.includes(subsystem.id);
      check.disabled = subsystem.optional === 'brake' && !state.brakeInstalled;
      const b = isolateButtons.get(subsystem.id)!;
      b.setAttribute('aria-pressed', String(state.isolatedSubsystem === subsystem.id));
    }
  }
  let frame = 0,
    disposed = false;
  function fit() {
    if (disposed) return;
    const rect = element.getBoundingClientRect();
    const mobile = window.innerWidth <= 700;
    runtime.setMechanismViewportInsets({
      top: mobile ? 120 : 110,
      bottom: mobile ? rect.height + 96 : 90,
      left: mobile ? 16 : 24,
      right: mobile ? 16 : rect.width + 48,
    });
    runtime.fitMechanismView();
  }
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(fit);
  };
  const observer = new ResizeObserver(schedule);
  observer.observe(element);
  element.addEventListener('toggle', schedule, { signal: listeners.signal });
  window.addEventListener('resize', schedule, { signal: listeners.signal });
  const unsubscribe = runtime.subscribeMechanism(update);
  schedule();
  return {
    element,
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      listeners.abort();
      unsubscribe();
      element.remove();
    },
  };
}
