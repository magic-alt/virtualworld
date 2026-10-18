/** Real browser product flow; all model responses below are local HTTP fixtures. */
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { builtinPlan } from '@virtualworld/planner/world';
const root = await mkdtemp(join(tmpdir(), 'vw-experience-'));
const output = resolve('output/playwright/ai-world');
await mkdir(output, { recursive: true });
await cp('worlds', join(root, 'worlds'), { recursive: true });
await cp('assets/optimized/showcase', join(root, 'assets/optimized/showcase'), { recursive: true });
const report = {
  checks: [],
  errors: [],
  measurements: {},
  limitations: ['LLM uses a local HTTP fixture. No live paid provider or mobile GPU validation.'],
};
const check = (text) => {
  console.log('PASS', text);
  report.checks.push(text);
};
const origin = 'http://127.0.0.1:3137';
let plannerRequests = 0,
  referenceSeen = false,
  modelRequests = 0;
const model = createServer(async (req, res) => {
  try {
    let bytes = '';
    for await (const chunk of req) bytes += chunk;
    const payload = JSON.parse(bytes);
    modelRequests++;
    let result;
    if (payload.messages[0].content.startsWith('Plan a complete')) {
      plannerRequests++;
      const content = payload.messages[1].content;
      referenceSeen ||=
        Array.isArray(content) &&
        content.some(
          (x) => x.type === 'image_url' && x.image_url.url.startsWith('data:image/png;base64,'),
        );
      const id = payload.messages[0].content.match(/Return scene id exactly ([a-zA-Z0-9_-]+)/)[1];
      await new Promise((r) => setTimeout(r, 350));
      result = builtinPlan({ id, description: Array.isArray(content) ? content[0].text : content });
    } else {
      const instruction = JSON.parse(payload.messages[1].content).instruction;
      if (instruction.includes('延迟')) await new Promise((r) => setTimeout(r, 1200));
      result = {
        summary: '把世界背景调整为深蓝色',
        commands: [{ type: 'setEnvironment', patch: { background: '#255577' } }],
      };
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }));
  } catch (e) {
    res.statusCode = 500;
    res.end(String(e));
  }
});
model.listen(0, '127.0.0.1');
await once(model, 'listening');
const code = `import {createApp} from './apps/web/server/app.ts'; const app=await createApp({dataRoot:process.env.TEST_DATA,projectRoot:process.env.TEST_PROJECT,publicRoot:'public',studioRoot:'dist/web',playerRoot:'dist/player'}); await app.listen({host:'127.0.0.1',port:3137}); process.on('SIGTERM',()=>void app.close().then(()=>process.exit()));`;
const app = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], {
  env: {
    ...process.env,
    PORT: '3137',
    TEST_DATA: join(root, 'data'),
    TEST_PROJECT: root,
    LLM_BASE_URL: `http://127.0.0.1:${model.address().port}/v1`,
    LLM_MODEL: 'local-http-fixture',
    LLM_API_KEY: 'fixture-only',
    TRIPO_API_KEY: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let appLog = '';
app.stdout.on('data', (b) => (appLog += b));
app.stderr.on('data', (b) => (appLog += b));
let browser, page;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${origin}/api/health`)).ok) break;
    } catch {}
    if (i === 99) throw new Error(appLog);
    await new Promise((r) => setTimeout(r, 100));
  }
  const executablePath =
    process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
    [
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
    ].find(existsSync);
  browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ['--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  page = await context.newPage();
  page.on('pageerror', (e) => report.errors.push(e.message));
  const ready = async (target = page) => {
    await target.waitForFunction(
      () =>
        window.virtualworld &&
        !window.virtualworld.getDiagnostics().loading &&
        window.virtualworld.getDiagnostics().mode !== 'edit',
    );
    await target.locator('.experience-loading').waitFor({ state: 'hidden' });
  };
  await page.goto(origin);
  await page.getByRole('heading', { level: 1 }).filter({ hasText: '让想象' }).waitFor();
  await page.waitForFunction(
    () => window.virtualworld && !window.virtualworld.getDiagnostics().loading,
  );
  assert.equal(await page.locator('.inspector,.sidebar,.transform-toolbar').count(), 0);
  assert.equal(await page.locator('canvas').count(), 1);
  await page.screenshot({ path: join(output, 'home-desktop.png'), fullPage: true });
  check('Home is a world creation experience without editor panels; one live preview');
  await page.locator('#mine').scrollIntoViewIfNeeded();
  await page.waitForFunction(
    () => document.querySelector('.hero-world').getBoundingClientRect().bottom < 0,
  );
  await page.waitForTimeout(150);
  const frame = await page.evaluate(() => window.virtualworld.renderer.info.render.frame);
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.virtualworld.renderer.info.render.frame), frame);
  check('Offscreen home preview suspends its render loop');
  await page.getByLabel('世界生成模式').selectOption('builtin');
  await page.getByLabel('描述你的世界').fill('蓝色晶石与古树环绕的森林');
  await page.getByRole('button', { name: '生成世界', exact: true }).click();
  await page
    .getByTestId('generation-progress')
    .getByRole('heading', { name: '世界已就绪' })
    .waitFor();
  const offlineId = await page.evaluate(() => localStorage.getItem('vw-generation-job'));
  await page.reload();
  await page
    .getByTestId('generation-progress')
    .getByRole('heading', { name: '世界已就绪' })
    .waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('vw-generation-job')), offlineId);
  await page.getByRole('button', { name: '进入我的世界', exact: true }).click();
  await ready();
  await page.waitForFunction(() => !!window.virtualworld.getDiagnostics().player);
  const spec = await page.evaluate(() => JSON.stringify(window.virtualworld.spec));
  await page.getByRole('button', { name: '暂停体验', exact: true }).click();
  const pausedPosition = await page.evaluate(() => window.virtualworld.getDiagnostics().player);
  await page.keyboard.down('w');
  await page.waitForTimeout(250);
  await page.keyboard.up('w');
  assert.deepEqual(
    await page.evaluate(() => window.virtualworld.getDiagnostics().player),
    pausedPosition,
  );
  await page.getByRole('button', { name: '继续体验', exact: true }).click();
  await page.getByRole('button', { name: '切换自由观赏', exact: true }).click();
  await page.waitForFunction(
    () =>
      window.virtualworld.getDiagnostics().mode === 'view' &&
      !window.virtualworld.getDiagnostics().player,
  );
  assert.equal(await page.evaluate(() => !!window.virtualworld.transform.object), false);
  await page.getByRole('button', { name: '播放设置', exact: true }).click();
  await page.getByLabel('画面质量').selectOption('low');
  assert.equal(await page.evaluate(() => window.virtualworld.renderer.getPixelRatio()), 1);
  await page.getByRole('button', { name: '关闭播放设置', exact: true }).click();
  await page.getByRole('button', { name: '切换第三人称探索', exact: true }).click();
  await page.waitForFunction(() => !!window.virtualworld.getDiagnostics().player);
  assert.equal(await page.evaluate(() => JSON.stringify(window.virtualworld.spec)), spec);
  check(
    'Offline creation, reload recovery, exploration, pause, quality and viewing preserve SceneSpec',
  );
  await page.getByRole('button', { name: '用 AI 改变世界', exact: true }).click();
  await page.getByLabel('描述世界修改').fill('把天空变成深蓝色');
  await page.getByRole('button', { name: '生成修改提案', exact: true }).click();
  await page.getByTestId('ai-proposal').waitFor();
  assert.notEqual(
    await page.evaluate(() => window.virtualworld.spec.environment.background),
    '#255577',
  );
  await page.getByRole('button', { name: '应用提案', exact: true }).click();
  await page.waitForFunction(() => window.virtualworld?.spec.environment.background === '#255577');
  await page.locator('.experience-loading').waitFor({ state: 'hidden' });
  assert.equal(
    await page.evaluate(() => window.virtualworld.getDiagnostics().paused),
    true,
    'AI panel must remain modal after a runtime rebuild',
  );
  let discardPrompt = false;
  page.once('dialog', async (dialog) => {
    discardPrompt = true;
    await dialog.dismiss();
  });
  await page.evaluate(() => history.back());
  await page.waitForTimeout(300);
  assert.equal(discardPrompt, true, 'Browser Back must ask before discarding unsaved AI edits');
  await page.getByTestId('world-experience').waitFor();
  let releaseSave;
  const saveGate = new Promise((resolve) => {
    releaseSave = resolve;
  });
  let held = false;
  await page.route('**/api/projects/*', async (route) => {
    if (route.request().method() === 'PUT' && !held) {
      held = true;
      await saveGate;
    }
    await route.continue();
  });
  await page.getByRole('button', { name: '保存世界', exact: true }).click();
  for (let i = 0; i < 40 && !held; i++) await page.waitForTimeout(25);
  assert.equal(held, true);
  await page.getByRole('button', { name: '撤销修改', exact: true }).click();
  await page.waitForFunction(() => window.virtualworld?.spec.environment.background !== '#255577');
  releaseSave();
  await page.getByRole('button', { name: '保存世界', exact: true }).waitFor({ state: 'visible' });
  await page.waitForFunction(
    () => !document.querySelector('.experience-message')?.textContent.includes('正在保存'),
  );
  assert.equal(await page.getByRole('button', { name: '保存世界', exact: true }).isEnabled(), true);
  await page.getByRole('button', { name: '保存世界', exact: true }).click();
  await page.getByText('世界已保存', { exact: false }).waitFor();
  await page.getByRole('button', { name: '关闭 AI 创作', exact: true }).click();
  await page.getByRole('button', { name: '用 AI 改变世界', exact: true }).click();
  await page.getByLabel('描述世界修改').fill('延迟修改');
  const beforeRequests = modelRequests;
  await page.getByRole('button', { name: '生成修改提案', exact: true }).click();
  for (let i = 0; i < 40 && modelRequests === beforeRequests; i++) await page.waitForTimeout(25);
  await page.getByRole('button', { name: '返回世界首页', exact: true }).click();
  await page.getByRole('button', { name: '进入小王子世界', exact: true }).click();
  await ready();
  const princeBackground = await page.evaluate(
    () => window.virtualworld.spec.environment.background,
  );
  await page.waitForTimeout(1400);
  assert.equal(
    await page.evaluate(() => window.virtualworld.spec.environment.background),
    princeBackground,
  );
  check('AI uses validated preview/apply/undo/save; delayed proposal cannot cross world identity');
  await page.screenshot({ path: join(output, 'explore-desktop.png') });
  await page.getByRole('button', { name: '返回世界首页', exact: true }).click();
  await page.getByLabel('描述你的世界').fill('有向导的星光花园');
  await page.getByLabel('世界生成模式').selectOption('llm');
  await page.locator('input[type=file]').setInputFiles({
    name: 'reference.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jw1sAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await page.getByRole('button', { name: '生成世界', exact: true }).click();
  await page
    .getByTestId('generation-progress')
    .getByRole('heading', { name: '世界已就绪' })
    .waitFor();
  assert.equal(plannerRequests, 1);
  assert.equal(referenceSeen, true);
  check('Text and uploaded reference reach the existing planner through a local HTTP fixture');
  await page.getByRole('button', { name: '进入我的世界', exact: true }).click();
  await ready();
  const generatedId = await page.evaluate(() => window.virtualworld.spec.id);
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const mobile = await mobileContext.newPage();
  mobile.on('pageerror', (e) => report.errors.push(e.message));
  await mobile.goto(`${origin}/?project=${generatedId}`);
  await ready(mobile);
  await mobile.waitForFunction(() => !!window.virtualworld.getDiagnostics().player);
  const position = await mobile.evaluate(() => window.virtualworld.getDiagnostics().player);
  const stick = mobile.getByRole('group', { name: '移动摇杆' });
  await stick.waitFor({ state: 'visible' });
  const box = await stick.boundingBox();
  await mobile.mouse.move(box.x + 50, box.y + 50);
  await mobile.mouse.down();
  await mobile.mouse.move(box.x + 50, box.y + 20);
  await mobile.waitForTimeout(350);
  await mobile.mouse.up();
  const moved = await mobile.evaluate(() => window.virtualworld.getDiagnostics().player);
  assert.ok(Math.hypot(moved[0] - position[0], moved[2] - position[2]) > 0.3);
  await mobile.waitForTimeout(100);
  const released = await mobile.evaluate(() => window.virtualworld.getDiagnostics().player);
  await mobile.waitForTimeout(200);
  const stopped = await mobile.evaluate(() => window.virtualworld.getDiagnostics().player);
  assert.ok(Math.hypot(stopped[0] - released[0], stopped[2] - released[2]) < 0.03);
  assert.equal(
    await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    true,
  );
  await mobile.screenshot({ path: join(output, 'explore-mobile.png') });
  check('Touch layout supports real joystick movement and release; no horizontal overflow');
  await mobile.goto(origin);
  await mobile.screenshot({ path: join(output, 'home-mobile.png'), fullPage: true });
  const blocked = await browser.newContext();
  await blocked.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('disabled storage');
      },
    });
  });
  const noStorage = await blocked.newPage();
  noStorage.on('pageerror', (e) => report.errors.push(e.message));
  await noStorage.goto(`${origin}/?project=little-prince-desert`);
  await ready(noStorage);
  await noStorage.getByRole('button', { name: '播放设置', exact: true }).click();
  await noStorage.getByLabel('画面质量').selectOption('balanced');
  check('World playback and shared preferences tolerate disabled browser storage');
  report.measurements = await page.evaluate(async () => {
    const samples = [],
      start = performance.now();
    let last = start;
    while (performance.now() - start < 1000) {
      await new Promise(requestAnimationFrame);
      const now = performance.now();
      samples.push(now - last);
      last = now;
    }
    samples.sort((a, b) => a - b);
    return {
      gpu: window.virtualworld.getDiagnostics().gpu,
      fps: (samples.length * 1000) / (last - start),
      p95FrameMs: samples[Math.floor(samples.length * 0.95)],
      quality: window.virtualworld.getDiagnostics().quality,
    };
  });
  assert.deepEqual(report.errors, []);
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.failure = String(error);
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close();
  app.kill();
  await new Promise((r) => model.close(r));
  if (resolve(dirname(root)) !== resolve(tmpdir())) throw new Error('Unexpected temporary root');
  await rm(root, { recursive: true, force: true });
}
