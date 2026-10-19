/** Real getContext failure and WEBGL_lose_context recovery against production bundles. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, extname } from 'node:path';
import { createServer } from 'node:http';
import { unzipSync } from 'fflate';
import {
  blockInitialContext,
  ready,
  snapshot,
  lose,
  restore,
  capture,
  assertFrozen,
  verifySplatPixels,
} from './webgl-recovery-helpers.mjs';

const root = await mkdtemp(join(tmpdir(), 'vw-webgl-'));
const output = resolve('output/playwright/webgl-recovery');
await mkdir(output, { recursive: true });
const origin = 'http://127.0.0.1:3147';
const report = {
  checks: [],
  errors: [],
  captures: [],
  limitations: [
    'Point-cloud visual proof isolates the splat and samples colored pixels against uniform background. An earlier autoUpdate-build diagnostic retained a static-camera accumulator during hide/show; the final managed-update adapter detects visibility changes, but this suite deliberately uses independent visible-pixel evidence instead of that old oracle.',
    'Headless SwiftShader functional recovery; not hardware-driver, true mobile GPU or long-soak qualification.',
  ],
};
const check = (text) => {
  report.checks.push(text);
  console.log('PASS', text);
};
let app, browser, page, staticServer;
let appLog = '';
const code = `import {createApp} from './apps/web/server/app.ts';
const app=await createApp({dataRoot:process.env.VW_WEBGL_DATA,projectRoot:process.cwd(),studioRoot:'dist/web',playerRoot:'dist/player',llm:{baseUrl:'',model:'',key:''}});
await app.listen({host:'127.0.0.1',port:3147});
process.on('SIGTERM',()=>void app.close().then(()=>process.exit()));`;
async function seed(directory) {
  const read = async (name) =>
    JSON.parse(await readFile(`tests/fixtures/${directory}/${name}.json`, 'utf8'));
  const scene = await read('scene');
  const story = await read('story');
  const assets = await read('assets');
  const fixture = {
    ...scene,
    assets: assets.assets,
    tasks: story.tasks,
    nodes: scene.nodes.map((node) => ({
      ...node,
      ...(story.interactions[node.id] ? { interaction: story.interactions[node.id] } : {}),
    })),
  };
  if (directory === 'world') {
    fixture.spawn = [-3, 1, 3];
    const retained = new Set(['ground', 'keeper', 'star', 'gate', 'splat-cloud']);
    fixture.nodes = fixture.nodes.filter((node) => retained.has(node.id));
  }
  const response = await fetch(`${origin}/api/projects/${fixture.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scene: fixture, baseRevision: 0 }),
  });
  assert.equal(response.status, 200, await response.text());
  return fixture;
}
async function seedCampaign(world) {
  const ids = ['little-prince-desert', 'little-prince-b612', 'little-prince-earth'];
  const chapters = [];
  for (const [index, id] of ids.entries()) {
    const previous = await (await fetch(`${origin}/api/projects/${id}`)).json();
    const scene = structuredClone(world);
    scene.id = id;
    scene.name = `WebGL tiny chapter ${index + 1}`;
    scene.revision = previous.revision + 1;
    scene.campaign = { id: 'little-prince', chapterId: id, index };
    scene.tasks = [{ flag: 'met-keeper', label: '与测试向导交谈' }];
    scene.nodes.find((node) => node.id === 'keeper').interaction.completes = true;
    const response = await fetch(`${origin}/api/projects/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scene, baseRevision: previous.revision }),
    });
    assert.equal(response.status, 200, await response.text());
    chapters.push(scene);
  }
  return chapters;
}
async function completeTinyChapter(page, standalone = false) {
  await page.locator('.experience-hotspot[data-node-id=keeper]').click();
  await page
    .getByRole('button', { name: standalone ? '本章已完成 · 继续探索' : '关闭对话', exact: true })
    .click();
  assert.equal(
    await page.evaluate(() => window.virtualworld.getDiagnostics().story.completed),
    true,
  );
}
async function chooseNextChapter(page, expected) {
  const select = page.getByLabel('选择章节', { exact: true });
  // Real mouse hit-testing must succeed even in the narrow layout with the fault panel visible.
  await select.click();
  await select.press('ArrowDown');
  await select.press('Enter');
  await ready(page, expected);
  assert.equal(await page.locator('canvas').count(), 1);
}
async function stopApp() {
  if (!app || app.exitCode !== null || app.signalCode !== null) return;
  const stopped = once(app, 'exit');
  app.kill('SIGTERM');
  const timer = setTimeout(() => app.kill('SIGKILL'), 5000);
  try {
    await stopped;
  } finally {
    clearTimeout(timer);
  }
}
try {
  app = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], {
    env: { ...process.env, PORT: '3147', VW_WEBGL_DATA: join(root, 'data'), TRIPO_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  app.stdout.on('data', (chunk) => {
    appLog += chunk;
  });
  app.stderr.on('data', (chunk) => {
    appLog += chunk;
  });
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${origin}/api/health`)).ok) break;
    } catch {}
    assert.ok(i < 100 && app.exitCode === null, appLog || 'Server failed to start');
    await new Promise((done) => setTimeout(done, 100));
  }
  const industrial = await seed('industrial');
  const world = await seed('world');
  const chapters = await seedCampaign(world);
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined,
    args: ['--enable-unsafe-swiftshader'],
  });
  page = await browser.newPage({ viewport: { width: 1000, height: 720 } });
  page.on('pageerror', (error) => report.errors.push(error.message));
  await blockInitialContext(page);
  await page.goto(`${origin}/?edit=1&project=test-industrial`);
  await page.getByLabel('搜索对象', { exact: true }).waitFor();
  await page.waitForTimeout(6250);
  const panel = page.getByTestId('graphics-status-panel');
  await panel.waitFor({ state: 'visible', timeout: 2000 });
  assert.equal(await panel.getAttribute('data-status'), 'failed');
  assert.equal(await panel.getAttribute('role'), 'alert');
  await panel.getByRole('button', { name: '重试加载画面', exact: true }).waitFor();
  await page.screenshot({ path: join(output, 'editor-persistent-failure.png') });
  check('Editor initialization failure remains actionable after the six-second toast expiry');
  await page.getByRole('button', { name: '选择 展示基座', exact: true }).click();
  await page.getByLabel('对象名称', { exact: true }).fill('未保存的恢复回归基座');
  await page.getByLabel('对象名称', { exact: true }).press('Enter');
  await page.evaluate(() => {
    window.__webglTestBlocked = false;
  });
  await panel.getByRole('button', { name: '重试加载画面', exact: true }).click();
  await ready(page, industrial.id);
  assert.equal(
    await page.locator('canvas').count(),
    1,
    'Initialization retry leaked an abandoned canvas',
  );
  assert.equal(
    await page.evaluate(() => window.virtualworld.spec.nodes.find((n) => n.id === 'platform').name),
    '未保存的恢复回归基座',
  );
  const disk = await (await fetch(`${origin}/api/projects/${industrial.id}`)).json();
  assert.equal(
    disk.nodes.find((n) => n.id === 'platform').name,
    '展示基座',
    'Retry must not require saving unsaved SceneSpec',
  );
  await capture(page, output, 'editor-initial-retry', report);
  check('Retry initializes a nonblank editor scene and retains unsaved atomic edits');
  await page.close();

  page = await browser.newPage({ viewport: { width: 1000, height: 720 } });
  page.on('pageerror', (error) => report.errors.push(error.message));
  await blockInitialContext(page);
  await page.goto(origin);
  const homePanel = page.getByTestId('graphics-status-panel');
  await homePanel.waitFor({ state: 'visible' });
  assert.equal(await homePanel.getAttribute('data-status'), 'failed');
  assert.equal(await page.locator('.home-preview-poster').isVisible(), true);
  await page.screenshot({ path: join(output, 'home-preview-failure.png') });
  await page.evaluate(() => {
    window.__webglTestBlocked = false;
  });
  await homePanel.getByRole('button', { name: '重试加载画面', exact: true }).click();
  await ready(page, chapters[0].id);
  assert.equal(await page.locator('canvas').count(), 1);
  await page.locator('.home-preview.is-live').waitFor();
  assert.equal(await page.locator('.home-preview-poster').isVisible(), false);
  await capture(page, output, 'home-preview-initial-retry', report);
  check(
    'Home keeps its poster with a truly clickable fault panel, then retries its tiny live preview without unmounting',
  );
  await page.close();

  page = await browser.newPage({ viewport: { width: 1000, height: 720 } });
  page.on('pageerror', (error) => report.errors.push(error.message));
  await page.route('**/api/generation/capabilities', (route) =>
    route.fulfill({ json: { llm: true, tripo: false } }),
  );
  await page.route('**/api/agent', (route) => {
    const { scene } = route.request().postDataJSON();
    return route.fulfill({
      json: {
        summary: '测试声明式背景编辑',
        projectId: scene.id,
        baseRevision: scene.revision,
        commands: [{ type: 'setEnvironment', patch: { background: '#25364f' } }],
      },
    });
  });
  await page.goto(`${origin}/?project=${world.id}`);
  await ready(page, world.id);
  await page.waitForFunction(() => !!window.virtualworld.getDiagnostics().player);
  await page.locator('.experience-hotspot[data-node-id=keeper]').click();
  await page.getByRole('button', { name: '关闭对话', exact: true }).click();
  assert.ok(
    await page.evaluate(() =>
      window.virtualworld.getDiagnostics().story.flags.includes('met-keeper'),
    ),
  );
  await capture(page, output, 'world-before-loss', report);
  await verifySplatPixels(page, report, output);
  const worldSpec = (await snapshot(page)).spec;
  await page.keyboard.down('w');
  // Exercise the same public movement channel as the UI joystick, alongside held keyboard input.
  await page.evaluate(() => window.virtualworld.setMovement({ x: 0.6, y: 0, jump: false }));
  await page.waitForTimeout(180);
  await lose(page);
  const frozen = await assertFrozen(page, 350);
  // No keyup is sent until after recovery: loss must release held input itself.
  await restore(page, world.id);
  await page.waitForTimeout(100);
  const settled = (await snapshot(page)).player;
  await page.waitForTimeout(220);
  const released = (await snapshot(page)).player;
  assert.ok(
    Math.hypot(released[0] - settled[0], released[2] - settled[2]) < 0.03,
    'Held keyboard/joystick-channel input survived context loss',
  );
  assert.ok(
    Math.hypot(released[0] - frozen.player[0], released[2] - frozen.player[2]) < 0.25,
    'Recovery advanced missed movement time',
  );
  await page.keyboard.up('w');
  assert.equal((await snapshot(page)).spec, worldSpec);
  assert.ok(
    await page.evaluate(() =>
      window.virtualworld.getDiagnostics().story.flags.includes('met-keeper'),
    ),
    'Recovery discarded completed story progress',
  );
  await capture(page, output, 'world-after-loss', report);
  await verifySplatPixels(page, report, output);
  check(
    'Actual context loss freezes world frames/physics, releases held keyboard/joystick-channel input, and restores mesh plus visible splat pixels without a time jump',
  );

  await page.getByRole('button', { name: '暂停体验', exact: true }).click();
  await lose(page);
  await assertFrozen(page);
  await page.waitForFunction(
    () => window.virtualworld.getGraphicsState().status === 'failed',
    null,
    { timeout: 19000 },
  );
  const timedOutPanel = page.getByTestId('graphics-status-panel');
  assert.equal(await timedOutPanel.getAttribute('role'), 'alert');
  const timeoutRetry = timedOutPanel.getByRole('button', { name: '重试加载画面', exact: true });
  assert.equal(await timeoutRetry.isEnabled(), true);
  await timeoutRetry.click();
  await page.waitForFunction(() => window.virtualworld.getGraphicsState().status === 'lost');
  assert.equal(await timeoutRetry.isDisabled(), true);
  assert.equal(
    await page.evaluate(() => window.virtualworld.renderer.getContext().isContextLost()),
    true,
  );
  assert.equal(await page.locator('canvas').count(), 1);
  assert.equal((await snapshot(page)).paused, true);
  assert.equal((await snapshot(page)).spec, worldSpec);
  await assertFrozen(page);
  check(
    'A running native context timeout exposes Retry, and retry while still natively lost preserves its one canvas, SceneSpec and user pause',
  );
  await restore(page, world.id);
  assert.equal((await snapshot(page)).paused, true);
  const pausedPlayer = (await snapshot(page)).player;
  await page.waitForTimeout(200);
  assert.deepEqual((await snapshot(page)).player, pausedPlayer);
  await page.getByRole('button', { name: '继续体验', exact: true }).click();
  check('Repeated real context loss preserves the user pause state');

  await page.evaluate(() => {
    window.__webglVisibilityHidden = true;
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => window.__webglVisibilityHidden,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await lose(page);
  await assertFrozen(page);
  await restore(page, world.id);
  const hiddenFrame = (await snapshot(page)).frame;
  await page.waitForTimeout(160);
  assert.equal(
    (await snapshot(page)).frame,
    hiddenFrame,
    'Restore must honor document visibility suspension',
  );
  await page.evaluate(() => {
    window.__webglVisibilityHidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal((await snapshot(page)).paused, false);
  await page.waitForFunction(
    (frame) => window.virtualworld.renderer.info.render.frame > frame,
    hiddenFrame,
  );
  report.limitations.push(
    'Visibility uses a controlled document.hidden getter and real visibilitychange dispatch; context loss/restoration uses the real WebGL extension.',
  );
  check('Recovery preserves visibility suspension and resumes only after the visibility event');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '用 AI 改变世界', exact: true }).click();
  await page.getByLabel('描述世界修改', { exact: true }).fill('测试未保存场景在图形故障时仍可保存');
  await page.getByRole('button', { name: '生成修改提案', exact: true }).click();
  await page.getByTestId('ai-proposal').waitFor();
  await page.getByRole('button', { name: '应用提案', exact: true }).click();
  await ready(page, world.id);
  await lose(page);
  const saveResponse = page.waitForResponse(
    (response) =>
      response.url() === `${origin}/api/projects/${world.id}` &&
      response.request().method() === 'PUT',
  );
  const saveButton = page.getByRole('button', { name: '保存世界', exact: true });
  await saveButton.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, 'narrow-save-during-loss.png') });
  await saveButton.click();
  assert.equal((await saveResponse).status(), 200);
  const saved = await (await fetch(`${origin}/api/projects/${world.id}`)).json();
  assert.equal(saved.environment.background, '#25364f');
  assert.equal((await snapshot(page)).graphics.status, 'lost');
  await restore(page, world.id);
  await page.getByRole('button', { name: '关闭 AI 创作', exact: true }).click();
  report.limitations.push(
    'The unsaved-world Save scenario uses an intercepted declarative AI proposal fixture, then the real validated application command and persistence API.',
  );
  check(
    'Narrow-screen real Save click remains accessible while graphics are lost and persists the unsaved SceneSpec',
  );

  // An old detached canvas must not deliver recovery callbacks into the next runtime.
  await lose(page);
  await page.evaluate(() => {
    window.__oldRuntime = window.virtualworld;
    window.__oldGraphics = [];
    window.virtualworld.subscribeGraphics((state) => window.__oldGraphics.push(state.status));
  });
  await page.getByRole('button', { name: '返回世界首页', exact: true }).click();
  await page.getByRole('heading', { level: 1 }).filter({ hasText: '让想象' }).waitFor();
  const oldStates = await page.evaluate(() => ({
    events: window.__oldGraphics.length,
    frame: window.__oldRuntime.renderer.info.render.frame,
  }));
  await page.evaluate(() => window.__webglTestExtension.restoreContext());
  await page.waitForTimeout(250);
  assert.deepEqual(
    await page.evaluate(() => ({
      events: window.__oldGraphics.length,
      frame: window.__oldRuntime.renderer.info.render.frame,
    })),
    oldStates,
    'Disposed runtime emitted stale restoration callbacks',
  );
  assert.equal(await page.locator('[data-testid=graphics-status-panel]:visible').count(), 0);
  check('Unmounting while lost detaches graphics subscriptions and old canvas recovery callbacks');
  await page.close();

  page = await browser.newPage({ viewport: { width: 1000, height: 720 } });
  page.on('pageerror', (error) => report.errors.push(error.message));
  await page.goto(`${origin}/?project=demo-harmonic-joint`);
  await ready(page, 'demo-harmonic-joint');
  const jointSpec = (await snapshot(page)).spec;
  await page.getByRole('button', { name: '播放机构', exact: true }).click();
  await page.waitForTimeout(150);
  await lose(page);
  const jointFrozen = await assertFrozen(page, 350);
  await page.evaluate(() => window.virtualworld.stepMechanism(Math.PI / 12));
  assert.equal(
    (await snapshot(page)).mechanism.inputAngle,
    jointFrozen.mechanism.inputAngle,
    'Lost context accepted mechanism step input',
  );
  await restore(page, 'demo-harmonic-joint');
  await page.waitForTimeout(150);
  const resumed = (await snapshot(page)).mechanism;
  assert.ok(resumed.inputAngle > jointFrozen.mechanism.inputAngle, 'Mechanism did not resume');
  assert.ok(
    resumed.inputAngle - jointFrozen.mechanism.inputAngle < 0.5,
    'Mechanism jumped across the lost interval',
  );
  await page.getByRole('button', { name: '暂停体验', exact: true }).click();
  const pausedJoint = (await snapshot(page)).mechanism.inputAngle;
  await lose(page);
  await restore(page, 'demo-harmonic-joint');
  assert.equal((await snapshot(page)).paused, true);
  assert.equal((await snapshot(page)).mechanism.inputAngle, pausedJoint);
  assert.equal((await snapshot(page)).spec, jointSpec);
  await capture(page, output, 'mechanism-after-loss', report);
  check(
    'H-100 actual loss freezes mechanism/input, resumes without missed-time catchup, and preserves explicit pause',
  );
  await page.close();

  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (error) => report.errors.push(error.message));
  await page.goto(`${origin}/?project=${chapters[0].id}`);
  await ready(page, chapters[0].id);
  await completeTinyChapter(page);
  await lose(page);
  await chooseNextChapter(page, chapters[1].id);
  await capture(page, output, 'narrow-campaign-switch-while-lost', report);
  check(
    'Narrow-screen real chapter selector remains clickable during loss and switches to a usable tiny-fixture runtime',
  );
  await page.close();

  const exported = await fetch(`${origin}/api/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scene: chapters[0] }),
  });
  assert.equal(
    exported.status,
    200,
    exported.status === 200 ? 'Export succeeded' : await exported.text(),
  );
  const files = unzipSync(new Uint8Array(await exported.arrayBuffer()));
  const exportedRoot = join(root, 'export');
  for (const [name, data] of Object.entries(files)) {
    const file = join(exportedRoot, name);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, data);
  }
  await stopApp();
  await assert.rejects(fetch(`${origin}/api/health`));
  staticServer = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://127.0.0.1').pathname;
      if (!path.startsWith('/webgl/') || path.includes('..')) {
        res.writeHead(404).end();
        return;
      }
      const file = join(exportedRoot, path.slice('/webgl/'.length));
      const types = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.wasm': 'application/wasm',
      };
      res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
      res.end(await readFile(file));
    } catch {
      res.writeHead(404).end();
    }
  });
  staticServer.listen(3148, '127.0.0.1');
  await once(staticServer, 'listening');
  page = await browser.newPage({ viewport: { width: 1000, height: 720 } });
  page.on('pageerror', (error) => report.errors.push(error.message));
  const external = [];
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:3148' || url.pathname.startsWith('/api/')) {
      external.push(url.href);
      return route.abort();
    }
    return route.continue();
  });
  await blockInitialContext(page);
  await page.goto('http://127.0.0.1:3148/webgl/index.html');
  await page.getByTestId('graphics-status-panel').waitFor({ state: 'visible' });
  await page.evaluate(() => {
    window.__webglTestBlocked = false;
  });
  await page.getByRole('button', { name: '重试加载画面', exact: true }).click();
  await ready(page, chapters[0].id);
  await completeTinyChapter(page, true);
  await capture(page, output, 'export-initial-retry', report);
  await verifySplatPixels(page, report, output);
  await lose(page);
  await assertFrozen(page);
  await restore(page, chapters[0].id);
  await capture(page, output, 'export-restored', report);
  await verifySplatPixels(page, report, output);
  await page.setViewportSize({ width: 390, height: 844 });
  await lose(page);
  await chooseNextChapter(page, chapters[1].id);
  await capture(page, output, 'export-chapter-switch-while-lost', report);
  assert.deepEqual(external, [], 'Offline export requested API/external resources');
  check(
    'Real tiny-campaign ZIP at a subdirectory retries initialization, restores visible mesh+splat and permits narrow chapter switching while lost without API/external network',
  );
  assert.deepEqual(report.errors, []);
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.failure = String(error);
  report.runtime = await page
    ?.evaluate(() => window.virtualworld?.getDiagnostics())
    .catch(() => undefined);
  report.body = await page
    ?.locator('body')
    .innerText()
    .catch(() => undefined);
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser?.close();
  await stopApp();
  if (staticServer) {
    staticServer.closeAllConnections();
    await new Promise((done) => staticServer.close(done));
  }
  await rm(root, { recursive: true, force: true });
}
