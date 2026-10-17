import { StudioRuntime } from '../../../packages/runtime/src/runtime';
import { assertScene } from '../../../packages/scene/src/schema';
const css = document.createElement('style');
css.textContent = `*{box-sizing:border-box}body{margin:0;color:#e3dfd4;font-family:Inter,Segoe UI,Microsoft YaHei,sans-serif}#viewport{position:fixed;inset:0}canvas{display:block;outline:0}.title{position:fixed;top:30px;left:34px;pointer-events:none}.title small{font-size:9px;letter-spacing:3px;color:#b1a07f}.title h1{font-size:27px;font-weight:400;letter-spacing:4px;margin:14px 0 9px}.title p{font-size:11px;color:#9faebe;letter-spacing:1px}.toolbar{position:fixed;bottom:25px;left:50%;transform:translateX(-50%);display:flex;gap:16px;align-items:center;background:#182332e8;border:1px solid #7e8e9c44;border-radius:8px;padding:12px 18px;font-size:10px;white-space:nowrap}button{font:inherit;cursor:pointer;border:1px solid #6a76864d;border-radius:5px;padding:7px 12px;background:#ffffff08;color:#d7c19e}input{accent-color:#cfb88e}label{display:flex;align-items:center;gap:10px}.quest{position:fixed;top:147px;left:34px;width:230px;background:#152030d9;border:1px solid #8195ad33;border-radius:8px;padding:20px;font-size:11px;backdrop-filter:blur(12px)}.quest h3{font-size:13px;font-weight:400;margin:0 0 20px;letter-spacing:1px}.quest p{color:#9baab9;line-height:1.8;margin:13px 0}.quest p.done{color:#c3d6ae}.dialog{position:fixed;bottom:90px;left:50%;transform:translateX(-50%);width:min(440px,92vw);max-height:70vh;overflow:auto;background:#1b2635f5;border:1px solid #a7acb04d;border-radius:10px;padding:24px 28px;backdrop-filter:blur(14px);box-shadow:0 20px 70px #0005}.dialog h2{font-size:18px;font-weight:400;letter-spacing:1px}.dialog p{white-space:pre-line;line-height:2;font-size:11px;color:#afbdca}.dialog button{display:block;width:100%;text-align:left;margin-top:12px}.error{position:fixed;bottom:85px;left:30px;right:30px;background:#392725;padding:16px;font-size:12px;border-radius:7px;color:#e4baa7}.status{position:fixed;right:24px;top:30px;font-size:9px;color:#92a1b4}kbd{border:1px solid #8795a44d;border-radius:3px;padding:3px 5px;font-size:9px;margin:0 5px}@media(max-width:600px){.title{left:20px;top:20px}.title h1{font-size:23px}.quest{top:125px;left:20px;width:180px;font-size:9px}.toolbar{max-width:96vw;white-space:normal;font-size:9px;gap:8px}.title p{max-width:80vw;line-height:1.8}}`;
document.head.append(css);
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}
const viewport = el('div');
viewport.id = 'viewport';
document.body.append(viewport);
const errorBox = el('div', 'error');
errorBox.hidden = true;
document.body.append(errorBox);
try {
  const response = await fetch(new URL('scene.json', location.href));
  if (!response.ok) throw new Error('场景文件无法加载');
  const scene = assertScene(await response.json());
  document.title = scene.name;
  const title = el('div', 'title');
  title.append(
    el('small', '', 'VIRTUALWORLD EXPERIENCE'),
    el('h1', '', scene.name),
    el('p', '', scene.description),
  );
  document.body.append(title);
  const quest = el('div', 'quest');
  quest.append(el('h3', '', '旅程手记'));
  const rows = scene.tasks.map((task, i) => {
    const row = el('p', '', `${String(i + 1).padStart(2, '0')}  ${task.label}`);
    quest.append(row);
    return row;
  });
  if (scene.tasks.length) document.body.append(quest);
  const status = el('div', 'status', '加载场景…');
  document.body.append(status);
  let dialog: HTMLElement | undefined;
  const runtime = new StudioRuntime(viewport, scene, {
    onError: (message) => {
      errorBox.textContent = message;
      errorBox.hidden = false;
    },
    onStory: (state, node) => {
      rows.forEach((row, i) => {
        row.className = state.flags.includes(scene.tasks[i].flag) ? 'done' : '';
        row.textContent = `${state.flags.includes(scene.tasks[i].flag) ? '✓' : '○'}  ${scene.tasks[i].label}`;
      });
      if (!node?.interaction) return;
      dialog?.remove();
      dialog = el('div', 'dialog');
      dialog.setAttribute('role', 'dialog');
      dialog.append(el('h2', '', node.interaction.title));
      const text = el('p', '', state.message);
      dialog.append(text);
      for (const choice of node.interaction.choices || []) {
        const button = el('button', '', choice.label);
        button.onclick = () => {
          text.textContent = choice.text;
        };
        dialog.append(button);
      }
      const close = el('button', '', state.completed ? '信已寄出 · 继续探索' : '继续');
      close.onclick = () => dialog?.remove();
      dialog.append(close);
      document.body.append(dialog);
    },
    onMetrics: (m) => {
      status.textContent = `${m.fps} FPS · WebGL 2${m.splats ? ` · ${m.splats.toLocaleString()} splats` : ''}`;
    },
  });
  (window as any).virtualworld = runtime;
  const toolbar = el('div', 'toolbar');
  if (scene.mode === 'world') {
    toolbar.append(el('span', '', 'WASD 移动 · 空格跳跃 · 拖动调整镜头'));
    const interact = el('button', '', 'E · 附近互动');
    interact.onclick = () => runtime.interact();
    toolbar.append(interact);
  } else {
    const motion = el('button', '', '运动演示');
    let moving = false;
    motion.onclick = () => {
      moving = !moving;
      runtime.animateJoints(moving);
      motion.textContent = moving ? '停止运动' : '运动演示';
    };
    const label = el('label', '', '爆炸视图'),
      slider = el('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '1';
    slider.step = '0.01';
    slider.value = '0';
    slider.setAttribute('aria-label', '爆炸展开');
    slider.oninput = () => runtime.explode(Number(slider.value));
    label.append(slider);
    const reset = el('button', '', '重置视角');
    reset.onclick = () => runtime.resetCamera();
    toolbar.append(motion, label, reset);
  }
  document.body.append(toolbar);
  await runtime.play();
  window.addEventListener('pagehide', () => runtime.dispose(), { once: true });
} catch (error) {
  errorBox.hidden = false;
  errorBox.textContent = error instanceof Error ? error.message : String(error);
}
