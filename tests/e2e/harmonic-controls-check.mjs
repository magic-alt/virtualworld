import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve, sep, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { unzipSync } from 'fflate';
const executablePath =
  process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
  [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ].find(existsSync);
const browser = await chromium.launch({
  executablePath,
  headless: process.env.H100_HEADED !== '1',
});
mkdirSync('output/playwright/h100', { recursive: true });
const results = [],
  errors = [],
  requests = [];
const origin = process.env.H100_ORIGIN || 'http://127.0.0.1:3139';
let server,
  app,
  dataRoot,
  appLog = '';
const check = (name) => {
  results.push(name);
  console.log('PASS', name);
};
async function ready(page) {
  await page.waitForFunction(
    () => window.virtualworld && !window.virtualworld.getDiagnostics().loading,
  );
  await page.locator('.joint-panel').waitFor();
}
const state = (page) => page.evaluate(() => window.virtualworld.getMechanismState());
async function exercise(page, name) {
  console.log('START', name);
  const summary = page.locator('.joint-panel>summary');
  if (!(await page.locator('.joint-panel').evaluate((e) => e.open))) await summary.click();
  const original = await page.evaluate(() => JSON.stringify(window.virtualworld.spec));
  await page.getByRole('button', { name: '输入 +15°', exact: true }).click();
  let s = await state(page);
  assert.ok(Math.abs(s.inputAngle - Math.PI / 12) < 1e-8);
  assert.ok(Math.abs(s.outputAngle + Math.PI / 1200) < 1e-8);
  await page.getByRole('button', { name: '输入 −15°', exact: true }).click();
  console.log('STEP', name, 'phase');
  assert.equal((await state(page)).inputAngle, 0);
  const number = page.getByLabel('输入转速数值', { exact: true });
  await number.fill('12');
  await number.press('Tab');
  assert.equal((await state(page)).inputRpm, 12);
  await page.getByRole('button', { name: '播放机构', exact: true }).click();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: '暂停机构', exact: true }).click();
  s = await state(page);
  assert.ok(s.inputAngle > 0);
  assert.equal(s.actualInputRpm, 0);
  const angle = s.inputAngle;
  await page.waitForTimeout(120);
  assert.equal((await state(page)).inputAngle, angle);
  await number.fill('-12');
  await number.press('Tab');
  await page.getByRole('button', { name: '播放机构', exact: true }).click();
  await page.getByLabel('抱闸线圈掉电', { exact: true }).check();
  s = await state(page);
  assert.equal(s.brakePowered, false);
  assert.equal(s.actualInputRpm, 0);
  const held = s.inputAngle;
  await page.waitForTimeout(100);
  assert.equal((await state(page)).inputAngle, held);
  await page.getByLabel('抱闸线圈掉电', { exact: true }).uncheck();
  assert.equal((await state(page)).moving, false);
  await page.getByLabel('安装可选抱闸', { exact: true }).uncheck();
  assert.equal(await page.getByLabel('抱闸线圈掉电', { exact: true }).isDisabled(), true);
  await page.getByLabel('安装可选抱闸', { exact: true }).check();
  await page.getByRole('button', { name: '播放机构', exact: true }).click();
  await page.getByRole('button', { name: '播放设置', exact: true }).click();
  assert.equal((await state(page)).actualInputRpm, 0);
  const pausedAngle = (await state(page)).inputAngle;
  await page.getByLabel('画面质量', { exact: true }).selectOption('low');
  assert.equal(await page.evaluate(() => window.virtualworld.getDiagnostics().quality), 'low');
  await page.waitForTimeout(100);
  assert.equal((await state(page)).inputAngle, pausedAngle);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  assert.equal((await state(page)).moving, true);
  await page.getByRole('button', { name: '暂停机构', exact: true }).click();
  await page.getByRole('button', { name: '暂停体验', exact: true }).click();
  assert.equal(
    await page.getByRole('button', { name: '播放机构', exact: true }).isDisabled(),
    true,
  );
  await page.getByRole('button', { name: '继续体验', exact: true }).click();
  await page.getByRole('button', { name: '运动归零', exact: true }).click();
  console.log('STEP', name, 'transport');
  assert.equal((await state(page)).inputAngle, 0);
  await page.getByLabel('剖视', { exact: true }).check();
  await page.getByLabel('爆炸展开', { exact: true }).fill('1');
  await page.waitForTimeout(200);
  assert.equal((await state(page)).explosion, 1);
  await page.screenshot({ path: `output/playwright/h100/${name}-exploded.png` });
  for (const view of ['正视', '侧视', '顶视', '底视', '默认视角', '适配当前模型'])
    await page.getByRole('button', { name: view, exact: true }).click();
  for (const title of [
    '壳体与安装',
    '无框力矩电机',
    '谐波减速器',
    '集成驱动板',
    '双编码器',
    '永磁掉电抱闸',
    '输出支承',
  ]) {
    await page.getByRole('button', { name: `了解${title}`, exact: true }).click();
    await page.getByRole('button', { name: `单独观察${title}`, exact: true }).click();
    assert.ok((await state(page)).isolatedSubsystem);
    await page.getByRole('button', { name: '恢复全部部件', exact: true }).click();
    await page.getByLabel(`显示${title}`, { exact: true }).uncheck();
  }
  // Hide every subsystem simultaneously and recover through the visible panel.
  for (const el of await page.locator('.joint-subsystem input').all()) await el.uncheck();
  assert.equal((await state(page)).hiddenSubsystems.length, 7);
  await page.getByRole('button', { name: '适配当前模型', exact: true }).click();
  assert.equal(
    await page.evaluate(() => window.virtualworld.camera.position.toArray().every(Number.isFinite)),
    true,
  );
  await page.getByRole('button', { name: '恢复展示', exact: true }).click();
  s = await state(page);
  assert.equal(s.explosion, 0);
  assert.equal(s.section, false);
  assert.equal(s.inputRpm, 6);
  assert.deepEqual(s.hiddenSubsystems, []);
  assert.equal(await page.evaluate(() => JSON.stringify(window.virtualworld.spec)), original);
  await page.screenshot({ path: `output/playwright/h100/${name}-assembled.png` });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(await page.evaluate(() => window.virtualworld.getDiagnostics().errors), []);
  check(
    `${name}: transport, phase, speed, brake, settings, views, all subsystem controls, reset and transient SceneSpec`,
  );
}
try {
  if (!process.env.H100_ORIGIN) {
    assert.ok(
      existsSync('dist/web/index.html') && existsSync('dist/player/player.html'),
      'Run npm run build first',
    );
    let occupied = false;
    try {
      await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(800) });
      occupied = true;
    } catch {}
    assert.equal(occupied, false, 'Refusing to reuse occupied H-100 test port 3139');
    dataRoot = mkdtempSync(join(tmpdir(), 'virtualworld-h100-'));
    app = spawn(process.execPath, ['--import', 'tsx', 'apps/web/server/index.ts'], {
      env: {
        ...process.env,
        PORT: '3139',
        VW_DATA_ROOT: dataRoot,
        LLM_BASE_URL: '',
        LLM_MODEL: '',
        LLM_API_KEY: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    app.stdout.on('data', (c) => (appLog += c));
    app.stderr.on('data', (c) => (appLog += c));
    let healthy = false;
    for (let i = 0; i < 100; i++) {
      try {
        healthy = (await fetch(`${origin}/api/health`)).ok;
        if (healthy) break;
      } catch {}
      if (app.exitCode !== null) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(healthy, appLog);
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.route('**/api/generation/capabilities', (route) =>
    route.fulfill({ json: { llm: true } }),
  );
  await page.route('**/api/agent', (route) => {
    const { scene } = route.request().postDataJSON();
    return route.fulfill({
      json: {
        projectId: scene.id,
        baseRevision: scene.revision,
        summary: 'Local fixture: softer ambient light',
        commands: [{ type: 'setEnvironment', patch: { ambientIntensity: 0.75 } }],
      },
    });
  });
  let fixtureSaves = 0;
  await page.route('**/api/projects/demo-harmonic-joint', (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    fixtureSaves++;
    return route.fulfill({ json: route.request().postDataJSON().scene });
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}/?project=demo-harmonic-joint`);
  await ready(page);
  const exposed = await page.evaluate(() => {
    const r = window.virtualworld,
      object = r.objects.get('harmonic-housing-full');
    let shellTop = -Infinity,
      shellBottom = Infinity;
    object.traverse((child) => {
      if (child.isMesh) {
        child.geometry.computeBoundingBox();
        shellTop = Math.max(shellTop, child.geometry.boundingBox.max.y);
        shellBottom = Math.min(shellBottom, child.geometry.boundingBox.min.y);
      }
    });
    return {
      shellTop,
      shellBottom,
      fullShellVisible: object.visible,
      pillars: r.objects.get('harmonic-reducer-mount-pillars-4')?.visible,
      bridges: r.objects.get('harmonic-output-bearing-bridges-4')?.visible,
    };
  });
  assert.ok(Math.abs(exposed.shellTop - 0.106) < 1e-6);
  assert.ok(Math.abs(exposed.shellBottom - 0.042) < 1e-6);
  assert.equal(exposed.fullShellVisible, true);
  assert.equal(exposed.pillars, true);
  assert.equal(exposed.bridges, true);
  await page.getByRole('button', { name: '顶视', exact: true }).click();
  await page.screenshot({ path: 'output/playwright/h100/open-output-top.png' });
  await page.getByRole('button', { name: '底视', exact: true }).click();
  await page.screenshot({ path: 'output/playwright/h100/open-output-bottom.png' });
  await page.getByRole('button', { name: '默认视角', exact: true }).click();
  await page.screenshot({ path: 'output/playwright/h100/open-output-assembled.png' });
  check(
    'assembled reducer/output is exposed below the motor-only shell, with real support bays and inspection openings',
  );
  await page.getByRole('button', { name: '全屏显示', exact: true }).click();
  await page.waitForFunction(() => !!document.fullscreenElement);
  assert.equal(
    await page.getByRole('button', { name: '退出全屏', exact: true }).count(),
    1,
    'fullscreen label must track actual document state',
  );
  await page.getByRole('button', { name: '退出全屏', exact: true }).click();
  await page.waitForFunction(() => !document.fullscreenElement);
  await page.screenshot({ path: 'output/playwright/h100/initial-desktop.png' });
  await exercise(page, 'desktop');
  await page.getByLabel('剖视', { exact: true }).check();
  await page.screenshot({ path: 'output/playwright/h100/desktop-section.png' });
  await page.getByRole('button', { name: '恢复展示', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出世界', exact: true }).click();
  assert.ok((await download).suggestedFilename().endsWith('.zip'));
  check('web export button downloads a world ZIP');
  await page.getByRole('button', { name: '用 AI 改变世界', exact: true }).click();
  assert.equal(await page.getByRole('complementary', { name: 'AI 世界创作' }).isVisible(), true);
  const previousAmbient = await page.evaluate(
    () => window.virtualworld.spec.environment.ambientIntensity,
  );
  await page.getByLabel('描述世界修改', { exact: true }).fill('调整关节展示灯光');
  await page.getByRole('button', { name: '生成修改提案', exact: true }).click();
  await page.getByTestId('ai-proposal').waitFor();
  assert.equal(
    await page.evaluate(() => window.virtualworld.spec.environment.ambientIntensity),
    previousAmbient,
  );
  await page.getByRole('button', { name: '应用提案', exact: true }).click();
  await page.waitForFunction(
    () =>
      window.virtualworld?.spec.environment.ambientIntensity === 0.75 &&
      !window.virtualworld.getDiagnostics().loading,
  );
  await page.getByRole('button', { name: '撤销修改', exact: true }).click();
  await page.waitForFunction(
    (ambient) =>
      window.virtualworld?.spec.environment.ambientIntensity === ambient &&
      !window.virtualworld.getDiagnostics().loading,
    previousAmbient,
  );
  await page.getByRole('button', { name: '保存世界', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="保存世界"]')?.disabled);
  assert.equal(fixtureSaves, 1);
  check(
    'H-100 AI preview/apply/undo/save with local HTTP fixtures; no persisted project mutation or live paid provider',
  );
  await page.getByRole('button', { name: '关闭 AI 创作', exact: true }).click();
  await page.getByRole('button', { name: '高级编辑', exact: true }).click();
  await page.waitForFunction(
    () =>
      window.virtualworld?.spec.id === 'demo-harmonic-joint' &&
      !window.virtualworld.getDiagnostics().loading &&
      window.virtualworld.getDiagnostics().mode === 'edit',
  );
  assert.equal(await page.evaluate(() => window.virtualworld.spec.id), 'demo-harmonic-joint');
  await page.goto(`${origin}/?project=demo-harmonic-joint`);
  await ready(page);
  assert.equal((await state(page)).inputAngle, 0);
  assert.equal(await page.locator('.joint-panel').count(), 1);
  await page.evaluate(() => (window.h100PreviousRuntime = window.virtualworld));
  await page.getByRole('button', { name: '返回世界首页', exact: true }).click();
  await page.waitForFunction(
    () =>
      !document.querySelector('.world-experience') &&
      window.h100PreviousRuntime.renderer.domElement.isConnected === false,
  );
  check('AI dialog, advanced editor, back navigation and runtime cleanup/re-entry');
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await mobile.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('storage disabled fixture');
      },
    });
  });
  const phone = await mobile.newPage();
  phone.on('pageerror', (e) => errors.push(e.message));
  await phone.goto(`${origin}/?project=demo-harmonic-joint`);
  await ready(phone);
  await exercise(phone, 'mobile-storage-disabled');
  const scene = await phone.evaluate(() => window.virtualworld.spec);
  const exported = await fetch(`${origin}/api/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scene }),
  });
  assert.equal(exported.status, 200);
  const files = unzipSync(new Uint8Array(await exported.arrayBuffer()));
  const mime = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.glb': 'model/gltf-binary',
  };
  server = createServer((req, res) => {
    const path =
      decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\//, '') ||
      'index.html';
    const file = files[path];
    res.writeHead(file ? 200 : 404, {
      'content-type': mime[extname(path)] ?? 'application/octet-stream',
    });
    res.end(file ?? 'Not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const staticOrigin = `http://127.0.0.1:${server.address().port}`;
  const offline = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await offline.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    const parsed = new URL(url);
    const blocked = parsed.origin !== staticOrigin || parsed.pathname.startsWith('/api/');
    requests.push({ url, blocked });
    return blocked ? route.abort() : route.continue();
  });
  const player = await offline.newPage();
  player.on('pageerror', (e) => errors.push(e.message));
  await player.goto(staticOrigin);
  await ready(player);
  assert.equal(
    await player.locator('.toolbar').isVisible(),
    false,
    'hidden legacy toolbar must not render as an empty pill',
  );
  await exercise(player, 'offline-player');
  assert.equal(
    requests.some((r) => r.blocked),
    false,
  );
  check('exported player works with editor API and all external origins blocked');
  assert.deepEqual(errors, []);
} catch (error) {
  errors.push(String(error));
  for (const context of browser.contexts())
    for (const page of context.pages())
      await page
        .screenshot({
          path: `output/playwright/h100/failure-${browser.contexts().indexOf(context)}.png`,
        })
        .catch(() => {});
  throw error;
} finally {
  writeFileSync(
    'output/playwright/h100/controls.json',
    JSON.stringify(
      {
        checks: results,
        errors,
        requests,
        limitations: [
          'Brake, electronics and geometry are illustrative; AI response/save use local HTTP fixtures; no live paid provider or hardware validation.',
        ],
      },
      null,
      2,
    ),
  );
  if (server) await new Promise((resolve) => server.close(resolve));
  await browser.close();
  if (app && app.exitCode === null) {
    app.kill();
    await new Promise((resolve) => app.once('exit', resolve));
  }
  if (dataRoot) {
    const target = resolve(dataRoot);
    assert.ok(
      target.startsWith(resolve(tmpdir()) + sep) &&
        basename(target).startsWith('virtualworld-h100-'),
    );
    rmSync(target, { recursive: true, force: true });
  }
}
