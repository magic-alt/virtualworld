import { StudioRuntime } from '@virtualworld/engine';
import { assertScene, CampaignSchema, type SceneSpec } from '@virtualworld/scene-schema';
import { CampaignProgress } from '@virtualworld/interaction/campaign';
import { mountExperienceControls } from '../shared/experience-controls';
import '../shared/experience.css';
document.body.classList.add('standalone-experience');
const css = document.createElement('style');
css.textContent = `*{box-sizing:border-box}body{margin:0;color:#e3dfd4;font-family:Inter,Segoe UI,Microsoft YaHei,sans-serif}#viewport{position:fixed;inset:0}canvas{display:block;outline:0}.title{position:fixed;top:30px;left:34px;pointer-events:none}.title small{font-size:9px;letter-spacing:3px;color:#b1a07f}.title h1{font-size:27px;font-weight:400;letter-spacing:4px;margin:14px 0 9px}.title p{font-size:11px;color:#9faebe;letter-spacing:1px}.toolbar{position:fixed;bottom:25px;left:50%;transform:translateX(-50%);display:flex;gap:16px;align-items:center;background:#182332e8;border:1px solid #7e8e9c44;border-radius:8px;padding:12px 18px;font-size:10px;white-space:nowrap}button{font:inherit;cursor:pointer;border:1px solid #6a76864d;border-radius:5px;padding:7px 12px;background:#ffffff08;color:#d7c19e}input{accent-color:#cfb88e}label{display:flex;align-items:center;gap:10px}.quest{position:fixed;top:147px;left:34px;width:230px;background:#152030d9;border:1px solid #8195ad33;border-radius:8px;padding:20px;font-size:11px;backdrop-filter:blur(12px)}.quest h3{font-size:13px;font-weight:400;margin:0 0 20px;letter-spacing:1px}.quest p{color:#9baab9;line-height:1.8;margin:13px 0}.quest p.done{color:#c3d6ae}.dialog{position:fixed;bottom:90px;left:50%;transform:translateX(-50%);width:min(440px,92vw);max-height:70vh;overflow:auto;background:#1b2635f5;border:1px solid #a7acb04d;border-radius:10px;padding:24px 28px;backdrop-filter:blur(14px);box-shadow:0 20px 70px #0005}.dialog h2{font-size:18px;font-weight:400;letter-spacing:1px}.dialog p{white-space:pre-line;line-height:2;font-size:11px;color:#afbdca}.dialog button{display:block;width:100%;text-align:left;margin-top:12px}.error{position:fixed;bottom:85px;left:30px;right:30px;background:#392725;padding:16px;font-size:12px;border-radius:7px;color:#e4baa7}.status{position:fixed;right:24px;top:30px;font-size:9px;color:#92a1b4}kbd{border:1px solid #8795a44d;border-radius:3px;padding:3px 5px;font-size:9px;margin:0 5px}@media(max-width:600px){.title{left:20px;top:20px}.title h1{font-size:23px}.quest{top:125px;left:20px;width:180px;font-size:9px}.toolbar{max-width:96vw;white-space:normal;font-size:9px;gap:8px}.title p{max-width:80vw;line-height:1.8}}`;
document.head.append(css);
const mobileCss = document.createElement('style');
mobileCss.textContent = `select{font:inherit;color:#e3dfd4;background:#182332;border:1px solid #6a76864d;border-radius:5px;padding:7px}select option{background:#182332}@media(max-width:600px){.toolbar{width:calc(100vw - 32px);max-width:none;flex-wrap:wrap;justify-content:center;gap:8px;padding:10px;bottom:16px}.toolbar>span{flex:1 0 100%;text-align:center;line-height:1.7}.toolbar>select{flex:1 0 100%;min-width:0}.toolbar>button{flex:1 1 auto;white-space:nowrap}.toolbar label{flex:1 1 auto;white-space:nowrap}.toolbar input[type=range]{width:85px}.title p{font-size:10px;line-height:1.6}.quest{top:165px;padding:14px;width:170px}.quest h3{margin-bottom:12px}.quest p{margin:8px 0}}`;
document.head.append(mobileCss);
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
let runtime: StudioRuntime | undefined;
let experienceControls: ReturnType<typeof mountExperienceControls> | undefined;
let generation = 0;
let disposed = false;
window.addEventListener(
  'pagehide',
  () => {
    disposed = true;
    generation++;
    experienceControls?.dispose();
    runtime?.dispose();
  },
  { once: true },
);
try {
  const readJson = async (path: string) => {
    const response = await fetch(new URL(path, location.href));
    if (!response.ok) throw new Error(`文件无法加载：${path}`);
    return response.json();
  };
  const rootScene = assertScene(await readJson('scene.json'));
  let progress: CampaignProgress | undefined;
  if (rootScene.campaign) {
    const manifest = CampaignSchema.parse(await readJson('campaign.json'));
    const scenes = await Promise.all(
      manifest.chapters.map(async (chapter) =>
        assertScene(await readJson(`${chapter.directory}/scene.json`)),
      ),
    );
    progress = CampaignProgress.browser(manifest, scenes);
  }
  const title = el('div', 'title');
  const heading = el('h1'),
    description = el('p');
  title.append(el('small', '', 'VIRTUALWORLD EXPERIENCE'), heading, description);
  const quest = el('div', 'quest'),
    status = el('div', 'status', '加载场景…'),
    toolbar = el('div', 'toolbar');
  document.body.append(title, quest, status, toolbar);
  let dialog: HTMLElement | undefined;
  let chapterSelect: HTMLSelectElement | undefined;
  const refreshChapters = () => {
    if (!progress || !chapterSelect) return;
    const current = chapterSelect.value;
    chapterSelect.replaceChildren();
    for (const chapter of progress.status()) {
      const option = el(
        'option',
        '',
        `${chapter.completed ? '✓ ' : chapter.unlocked ? '' : '🔒 '}${chapter.title}`,
      );
      option.value = chapter.id;
      option.disabled = !chapter.unlocked;
      chapterSelect.append(option);
    }
    chapterSelect.value = current;
  };
  async function showScene(scene: SceneSpec) {
    if (disposed) return;
    const version = ++generation;
    experienceControls?.dispose();
    runtime?.dispose();
    runtime = undefined;
    dialog?.remove();
    errorBox.hidden = true;
    document.title = scene.name;
    heading.textContent = scene.name;
    description.textContent = scene.description;
    quest.replaceChildren(el('h3', '', '旅程手记'));
    quest.hidden = !scene.tasks.length;
    const rows = scene.tasks.map((task, i) => {
      const row = el('p', '', `${String(i + 1).padStart(2, '0')}  ${task.label}`);
      quest.append(row);
      return row;
    });
    toolbar.replaceChildren();
    chapterSelect = undefined;
    if (progress) {
      chapterSelect = el('select');
      chapterSelect.setAttribute('aria-label', '选择章节');
      refreshChapters();
      chapterSelect.value = scene.id;
      chapterSelect.onchange = () => {
        const next = progress!.select(chapterSelect!.value);
        void showScene(next).catch(showError);
      };
      toolbar.append(chapterSelect);
    }
    const active = new StudioRuntime(viewport, scene, {
      onError: (message) => {
        if (version === generation) showError(message);
      },
      onStory: (state, node) => {
        if (version !== generation || disposed) return;
        rows.forEach((row, i) => {
          const done = state.flags.includes(scene.tasks[i].flag);
          row.className = done ? 'done' : '';
          row.textContent = `${done ? '✓' : '○'}  ${scene.tasks[i].label}`;
        });
        refreshChapters();
        experienceControls?.update(active.getDiagnostics());
        if (!node?.interaction) return;
        dialog?.remove();
        dialog = el('div', 'dialog');
        experienceControls?.setDialogOpen(true);
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
        const close = el('button', '', state.completed ? '本章已完成 · 继续探索' : '继续');
        close.onclick = () => {
          dialog?.remove();
          experienceControls?.setDialogOpen(false);
        };
        dialog.append(close);
        document.body.append(dialog);
      },
      onMetrics: (m) => {
        if (version !== generation) return;
        experienceControls?.update(m);
        status.textContent = m.loading ? '正在加载世界…' : '';
      },
    });
    runtime = active;
    experienceControls = mountExperienceControls(active, {
      onCloseDialog: () => {
        dialog?.remove();
        experienceControls?.setDialogOpen(false);
      },
      onError: showError,
      onReset: progress
        ? () => {
            progress!.reset();
            void showScene(progress!.select(progress!.current())).catch(showError);
          }
        : undefined,
    });
    document.body.append(experienceControls.element);
    (window as any).virtualworld = active;
    if (scene.mode === 'world') {
      toolbar.append(el('span', '', 'WASD 移动 · 空格跳跃 · 拖动调整镜头'));
      const interact = el('button', '', 'E · 附近互动');
      interact.onclick = () => active.interact();
      toolbar.append(interact);
      const reset = el('button', '', progress ? '重置全部旅程' : '重置旅程');
      reset.onclick = () => {
        dialog?.remove();
        experienceControls?.setDialogOpen(false);
        if (progress) {
          progress.reset();
          void showScene(progress.select(progress.current())).catch(showError);
        } else active.resetProgress();
      };
      toolbar.append(reset);
    } else {
      let moving = false;
      const motion = el('button', '', '运动演示');
      motion.onclick = () => {
        moving = !moving;
        active.animateJoints(moving);
        motion.textContent = moving ? '停止运动' : '运动演示';
      };
      const label = el('label', '', '爆炸视图'),
        slider = el('input');
      slider.type = 'range';
      slider.min = '0';
      slider.max = '1';
      slider.step = '.01';
      slider.value = '0';
      slider.setAttribute('aria-label', '爆炸展开');
      slider.oninput = () => active.explode(Number(slider.value));
      label.append(slider);
      toolbar.append(motion, label);
      if (scene.mechanism) {
        const section = el('label', '', '剖视'),
          checkbox = el('input');
        checkbox.type = 'checkbox';
        checkbox.setAttribute('aria-label', '剖视');
        checkbox.onchange = () => active.setSection(checkbox.checked);
        section.append(checkbox);
        const speed = el('label', '', '输入 RPM'),
          rpm = el('input');
        rpm.type = 'range';
        rpm.min = '-30';
        rpm.max = '30';
        rpm.step = '1';
        rpm.value = '6';
        rpm.setAttribute('aria-label', '输入 RPM');
        const value = el('span', '', '6');
        rpm.oninput = () => {
          active.setTransmissionSpeed(Number(rpm.value));
          value.textContent = rpm.value;
        };
        speed.append(rpm, value);
        toolbar.append(section, speed);
      }
      const reset = el('button', '', '重置视角');
      reset.onclick = () => active.resetCamera();
      toolbar.append(reset);
    }
    await active.ready;
    if (disposed || version !== generation) {
      active.dispose();
      return;
    }
    await active.setMode(scene.mode === 'world' ? 'explore' : 'view');
  }
  function showError(error: unknown) {
    errorBox.hidden = false;
    errorBox.textContent = error instanceof Error ? error.message : String(error);
  }
  await showScene(progress ? progress.select(progress.current()) : rootScene);
} catch (error) {
  errorBox.hidden = false;
  errorBox.textContent = error instanceof Error ? error.message : String(error);
}
