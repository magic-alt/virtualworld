import { chromium } from 'playwright';
import { existsSync, mkdirSync, writeFileSync, readFileSync, mkdtempSync, statSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { unzipSync, strFromU8 } from 'fflate';
import assert from 'node:assert/strict';
const output = resolve('output/playwright');
mkdirSync(output, { recursive: true });
const dataRoot = mkdtempSync(join(tmpdir(), 'virtualworld-browser-'));
const app = spawn(process.execPath, ['--import', 'tsx', 'apps/web/server/index.ts'], {
  env: {
    ...process.env,
    PORT: '3133',
    VW_DATA_ROOT: dataRoot,
    LLM_BASE_URL: '',
    LLM_MODEL: '',
    LLM_API_KEY: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let appLog = '';
app.stdout.on('data', (chunk) => (appLog += chunk));
app.stderr.on('data', (chunk) => (appLog += chunk));
const executablePath =
  process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
  [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ].find(existsSync);
const browser = await chromium.launch({
  headless: true,
  executablePath,
  args: ['--enable-webgl', '--ignore-gpu-blocklist'],
});
const report = {
  browser: await browser.version(),
  executablePath,
  checks: [],
  errors: [],
  measurements: {},
  exports: {},
};
let staticServer, modelServer, aiApp;
const check = (message) => {
  report.checks.push(message);
  console.log('PASS', message);
};
async function measureFrames(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const samples = [];
        let previous = performance.now();
        const started = previous;
        const frame = (now) => {
          samples.push(now - previous);
          previous = now;
          if (now - started < 3000) return requestAnimationFrame(frame);
          const sorted = samples.slice().sort((a, b) => a - b),
            canvas = document.querySelector('canvas');
          resolve({
            durationMs: now - started,
            fps: (samples.length * 1000) / (now - started),
            p95FrameMs: sorted[Math.floor(sorted.length * 0.95)],
            viewport: { width: innerWidth, height: innerHeight },
            canvas: { width: canvas.width, height: canvas.height },
            gpu: window.virtualworld.getDiagnostics().gpu,
          });
        };
        requestAnimationFrame(frame);
      }),
  );
}
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch('http://127.0.0.1:3133/api/health')).ok) break;
    } catch {}
    if (i === 99) throw new Error('Server startup failed: ' + appLog);
    await new Promise((r) => setTimeout(r, 100));
  }
  let intentional503 = false;
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    acceptDownloads: true,
  });
  page.on('pageerror', (e) => report.errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !(intentional503 && m.text().includes('503')))
      report.errors.push(`${m.text()} ${m.location().url}`);
  });
  const ready = async () => {
    await page.waitForFunction(
      () => window.virtualworld && !window.virtualworld.getDiagnostics().loading,
      {},
      { timeout: 45000 },
    );
    await page.waitForTimeout(1500);
  };
  await page.goto('http://127.0.0.1:3133/?project=demo-industrial');
  await page.getByRole('button', { name: '导出网页', exact: true }).waitFor();
  await ready();
  await page.screenshot({ path: join(output, 'industrial.png') });
  check('Industrial studio renders');
  const industrial = await page.evaluate(() => window.virtualworld.getDiagnostics());
  report.measurements.industrial = industrial;
  assert.equal(industrial.errors.length, 0);
  for (const id of ['generated-forest', 'generated-desert']) {
    const generated = await (await fetch(`http://127.0.0.1:3133/api/projects/${id}`)).json();
    assert.equal(generated.id, id);
    await page.getByRole('button', { name: '切换项目', exact: true }).click();
    await page.locator('.project-menu button').filter({ hasText: generated.name }).click();
    await page.waitForFunction((id) => window.virtualworld.spec.id === id, id);
    await ready();
    assert.equal(
      (await page.evaluate(() => window.virtualworld.getDiagnostics())).errors.length,
      0,
    );
    await page.getByRole('button', { name: '体验', exact: true }).click();
    await page.waitForFunction(() => !!window.virtualworld.getDiagnostics().player);
    await page.screenshot({ path: join(output, `${id}.png`) });
    await page.getByRole('button', { name: '退出体验', exact: true }).click();
  }
  await page.getByRole('button', { name: '切换到工业展示', exact: true }).click();
  await page.waitForFunction(() => window.virtualworld.spec.id === 'demo-industrial');
  await ready();
  check(
    'Both CLI-generated worlds load from the project catalog and start the shared playable runtime',
  );
  const cameraBefore = await page.evaluate(() => ({
    position: window.virtualworld.camera.position.toArray(),
    revision: window.virtualworld.spec.revision,
  }));
  await page.getByRole('button', { name: '设为默认视角', exact: true }).click();
  await page.waitForFunction(
    (revision) => window.virtualworld.spec.revision > revision,
    cameraBefore.revision,
  );
  const cameraSaved = await page.evaluate(() => window.virtualworld.spec.camera.position);
  assert.ok(
    cameraSaved.every((value, index) => Math.abs(value - cameraBefore.position[index]) < 0.000001),
  );
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  check('Current camera can be saved as the portable default view and undone');
  await page.getByRole('button', { name: '选择 05 · 输出轴', exact: true }).click();
  const nameInput = page.getByRole('textbox', { name: '对象名称', exact: true });
  await nameInput.fill('已编辑的输出轴');
  await nameInput.press('Enter');
  await page.getByRole('button', { name: '选择 已编辑的输出轴', exact: true }).waitFor();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await page.getByRole('button', { name: '选择 05 · 输出轴', exact: true }).waitFor();
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await page.getByRole('button', { name: '保存项目', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '项目已保存到本地' }).waitFor();
  await page.reload();
  await ready();
  await page.getByRole('button', { name: '选择 已编辑的输出轴', exact: true }).waitFor();
  check('Edit, undo, redo, save and reload preserve stable node IDs');
  const memoryBefore = await page.evaluate(() => ({ ...window.virtualworld.renderer.info.memory }));
  for (let i = 0; i < 6; i++) {
    const revision = await page.evaluate(() => window.virtualworld.spec.revision);
    const field = page.getByRole('textbox', { name: '对象名称', exact: true });
    await field.fill(`壳体 ${i}`);
    await field.press('Enter');
    await page.waitForFunction(
      (r) => window.virtualworld.spec.revision > r && !window.virtualworld.getDiagnostics().loading,
      revision,
    );
    await page.waitForTimeout(80);
  }
  const memoryAfter = await page.evaluate(() => ({ ...window.virtualworld.renderer.info.memory }));
  report.measurements.repeatedEdits = { before: memoryBefore, after: memoryAfter };
  assert.ok(memoryAfter.geometries <= memoryBefore.geometries + 2);
  assert.ok(memoryAfter.textures <= memoryBefore.textures + 1);
  check('Repeated edits release shadow targets and helper GPU resources');
  await page.getByRole('slider', { name: '爆炸展开', exact: true }).fill('1');
  assert.equal(
    await page.evaluate(() => window.virtualworld.objects.get('housing').position.x),
    -2.2,
  );
  await page.getByRole('slider', { name: '爆炸展开', exact: true }).fill('0');
  assert.equal(await page.evaluate(() => window.virtualworld.objects.get('housing').position.x), 0);
  check('Exploded view restores exact original transforms');
  await page
    .getByLabel('导入模型文件', { exact: true })
    .setInputFiles('public/fixtures/cube-mm.step');
  await page
    .getByRole('status')
    .filter({ hasText: '已导入 cube-mm.step' })
    .waitFor({ timeout: 90000 });
  await ready();
  assert.ok(
    (await page.evaluate(() => window.virtualworld.spec.assets)).some((a) =>
      a.source?.includes('STEP'),
    ),
  );
  assert.ok(
    await page.evaluate(() => {
      const runtime = window.virtualworld;
      return runtime.spec.nodes
        .filter((n) => n.shape === 'glb')
        .some((n) => {
          let meshes = 0;
          runtime.objects.get(n.id)?.traverse((o) => {
            if (o.isMesh && o.geometry.attributes.position.count > 0) meshes++;
          });
          return meshes > 0;
        });
    }),
    'Imported STEP must contain actual visible mesh geometry',
  );
  check('Browser Worker converts actual STEP into visible portable GLB and scene hierarchy');
  await page.screenshot({ path: join(output, 'cad-import.png') });
  const focusedBefore = await page.evaluate(() => window.virtualworld.camera.position.toArray());
  const importedName = page.getByRole('textbox', { name: '对象名称', exact: true });
  const beforeRevision = await page.evaluate(() => window.virtualworld.spec.revision);
  await importedName.fill('CAD 装配');
  await importedName.press('Enter');
  await page.waitForFunction(
    (revision) =>
      window.virtualworld.spec.revision > revision && !window.virtualworld.getDiagnostics().loading,
    beforeRevision,
  );
  const focusedAfter = await page.evaluate(() => window.virtualworld.camera.position.toArray());
  assert.ok(focusedAfter.every((v, i) => Math.abs(v - focusedBefore[i]) < 0.00001));
  check('Local edits preserve the focused CAD camera view');
  const firstImport = await page.evaluate(() => ({
    nodes: window.virtualworld.spec.nodes.length,
    assets: window.virtualworld.spec.assets.length,
  }));
  await page.getByRole('status').getByRole('button', { name: '关闭通知', exact: true }).click();
  await page
    .getByLabel('导入模型文件', { exact: true })
    .setInputFiles('public/fixtures/cube-mm.step');
  await page
    .getByRole('status')
    .filter({ hasText: '已导入 cube-mm.step' })
    .waitFor({ timeout: 90000 });
  await ready();
  const secondImport = await page.evaluate(() => ({
    nodes: window.virtualworld.spec.nodes.length,
    assets: window.virtualworld.spec.assets.length,
  }));
  assert.ok(secondImport.nodes > firstImport.nodes);
  assert.equal(secondImport.assets, firstImport.assets);
  check('Importing the same model twice creates separate instances and reuses its resource');
  await page.getByRole('button', { name: '保存项目', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '项目已保存到本地' }).waitFor();
  await page.getByRole('button', { name: '验证', exact: true }).click();
  await page.getByTestId('validation-result').waitFor();
  await page.getByRole('button', { name: '关闭验证', exact: true }).click();
  check('Scene resource validation succeeds after CAD import');
  async function exportCurrent(label) {
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出网页', exact: true }).click();
    const d = await downloading;
    const bytes = readFileSync(await d.path()),
      files = unzipSync(bytes);
    assert.ok(files['index.html']);
    assert.ok(files['scene.json']);
    const scene = JSON.parse(strFromU8(files['scene.json']));
    for (const a of scene.assets) {
      assert.ok(a.url.startsWith('assets/'));
      assert.ok(files[a.url]);
    }
    report.exports[label] = { bytes: bytes.length, files: Object.keys(files).length, scene };
    writeFileSync(join(output, `${label}.zip`), bytes);
    return files;
  }
  const industrialFiles = await exportCurrent('industrial');
  check('Industrial export includes converted CAD with relative asset URLs');
  await page.getByRole('button', { name: '切换到故事世界', exact: true }).click();
  await ready();
  const world = await page.evaluate(() => window.virtualworld.getDiagnostics());
  report.measurements.world = world;
  assert.equal(world.errors.length, 0);
  assert.equal(world.splats, 1200);
  await page.screenshot({ path: join(output, 'world-editor.png') });
  check('Mesh and 1,200 actual Gaussian Splats render together');
  assert.equal(await page.evaluate(() => window.virtualworld.camera.near), 0.05);
  check('Switching away from tiny CAD restores camera depth precision');
  const sceneBefore = await page.evaluate(() => JSON.stringify(window.virtualworld.spec));
  await page.getByRole('button', { name: '体验', exact: true }).click();
  await page.waitForFunction(() => !!window.virtualworld.getDiagnostics().player);
  await page.waitForTimeout(750);
  check('Third-person character and physics start');
  async function move(axis, target, targetPage = page) {
    const position = await targetPage.evaluate(() => window.virtualworld.getDiagnostics().player);
    const from = position[axis];
    if (Math.abs(from - target) < 0.15) return;
    const increasing = target > from;
    const key = axis === 0 ? (increasing ? 'd' : 'a') : increasing ? 's' : 'w';
    await targetPage.keyboard.down(key);
    try {
      await targetPage.waitForFunction(
        ({ axis, target, increasing }) => {
          const p = window.virtualworld.getDiagnostics().player;
          return p && (increasing ? p[axis] >= target : p[axis] <= target);
        },
        { axis, target, increasing },
        { timeout: 20000, polling: 50 },
      );
    } finally {
      await targetPage.keyboard.up(key);
    }
  }
  async function interact(x, z, title) {
    await move(0, x);
    await move(2, z);
    await page.keyboard.press('e');
    await page.getByRole('dialog', { name: title, exact: true }).waitFor();
    await page.getByRole('button', { name: '知道了', exact: true }).click();
  }
  await interact(-3, 2, '守灯人 · 诺亚');
  await interact(4.3, 0, '遗失的星核');
  await move(0, 0);
  await move(2, -5);
  await page.keyboard.press('e');
  await page.getByRole('dialog', { name: '归航星门', exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() => window.virtualworld.getDiagnostics().story.completed),
    true,
  );
  await page.screenshot({ path: join(output, 'world-completed.png') });
  check('Keyboard exploration, collision, dialogue prerequisites and final quest complete');
  assert.equal(await page.evaluate(() => JSON.stringify(window.virtualworld.spec)), sceneBefore);
  await page.getByRole('button', { name: '退出体验', exact: true }).click();
  check('Play mode does not mutate the editor SceneSpec');
  await page.getByRole('button', { name: '体验', exact: true }).click();
  await page.waitForFunction(() => window.virtualworld.getDiagnostics().story.completed);
  await page.getByRole('button', { name: '退出体验', exact: true }).click();
  check('Re-entering the shared runtime resumes completed progress separately from SceneSpec');
  const worldFiles = await exportCurrent('world');
  await page
    .getByRole('button', { name: /AI 助手/ })
    .first()
    .click();
  await page.getByRole('textbox', { name: 'AI 创作指令', exact: true }).fill('把树改成粉色');
  intentional503 = true;
  await page.getByRole('button', { name: '生成编辑提案', exact: true }).click();
  await page.getByText(/尚未配置 AI 接口/).waitFor();
  intentional503 = false;
  check('Missing API credentials are reported without simulated AI edits (expected HTTP 503)');
  await page.close();
  app.kill();
  staticServer = createServer((req, res) => {
    const path = (req.url || '').split('?')[0];
    const label = path.startsWith('/industrial/') ? 'industrial' : 'world';
    const files = label === 'industrial' ? industrialFiles : worldFiles;
    const filename = path.replace(/^\/(industrial|world)\//, '') || 'index.html';
    const file = files[filename];
    if (!file) {
      res.statusCode = 404;
      res.end('missing ' + filename);
      return;
    }
    const type =
      {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.wasm': 'application/wasm',
      }[extname(filename)] || 'application/octet-stream';
    res.setHeader('Content-Type', type);
    res.end(file);
  });
  await new Promise((r) => staticServer.listen(3134, '127.0.0.1', r));
  for (const label of ['industrial', 'world']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const external = [];
    await context.route('**/*', (route) => {
      if (new URL(route.request().url()).hostname !== '127.0.0.1') {
        external.push(route.request().url());
        return route.abort();
      }
      return route.continue();
    });
    const p = await context.newPage();
    p.on('pageerror', (e) => report.errors.push(`export-${label}: ${e.message}`));
    await p.goto(`http://127.0.0.1:3134/${label}/index.html`);
    await p.waitForFunction(
      () => window.virtualworld && !window.virtualworld.getDiagnostics().loading,
      {},
      { timeout: 45000 },
    );
    if (label === 'world')
      await p.waitForFunction(() => !!window.virtualworld.getDiagnostics().player);
    await p.waitForTimeout(1500);
    const diagnostics = await p.evaluate(() => window.virtualworld.getDiagnostics());
    assert.equal(diagnostics.errors.length, 0);
    assert.deepEqual(external, []);
    await p.screenshot({ path: join(output, `${label}-export.png`) });
    report.measurements[`${label}Export`] = diagnostics;
    await p.setViewportSize({ width: 1280, height: 720 });
    await p.waitForTimeout(500);
    report.measurements[`${label}Performance`] = await measureFrames(p);
    if (!/SwiftShader|llvmpipe|software/i.test(diagnostics.gpu))
      assert.ok(
        report.measurements[`${label}Performance`].fps >= 30,
        `${label} should sustain 30 FPS on the measured hardware`,
      );
    check(
      `${label} standalone export runs under subdirectory with studio stopped and external network blocked`,
    );
    if (label === 'world') {
      await move(0, -3, p);
      await move(2, 2, p);
      await p.keyboard.press('e');
      await p.waitForFunction(() =>
        window.virtualworld.getDiagnostics().story.flags.includes('met-keeper'),
      );
      await p.reload();
      await p.waitForFunction(
        () =>
          window.virtualworld?.getDiagnostics().player &&
          window.virtualworld.getDiagnostics().story.flags.includes('met-keeper'),
      );
      check('Standalone story progress survives a real browser reload');
      await p.getByRole('button', { name: '重置旅程', exact: true }).click();
      assert.deepEqual(
        await p.evaluate(() => window.virtualworld.getDiagnostics().story.flags),
        [],
      );
      await p.reload();
      await p.waitForFunction(() => !!window.virtualworld?.getDiagnostics().player);
      assert.deepEqual(
        await p.evaluate(() => window.virtualworld.getDiagnostics().story.flags),
        [],
      );
      check('Resetting the journey clears persisted progress across reloads');
    }
    await context.close();
  }
  let requests = 0;
  modelServer = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body);
    const prompt = JSON.parse(payload.messages[1].content).instruction;
    requests++;
    if (prompt.includes('延迟')) await new Promise((r) => setTimeout(r, 1800));
    const commands = prompt.includes('延迟')
      ? [{ type: 'setEnvironment', patch: { background: '#345678' } }]
      : [{ type: 'updateNode', id: 'shaft', patch: { color: '#dbb77b' } }];
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              role: 'assistant',
              content: JSON.stringify({ summary: '为选中零件调整金属颜色', commands }),
            },
          },
        ],
      }),
    );
  });
  await new Promise((r) => modelServer.listen(3135, '127.0.0.1', r));
  aiApp = spawn(process.execPath, ['--import', 'tsx', 'apps/web/server/index.ts'], {
    env: {
      ...process.env,
      PORT: '3136',
      VW_DATA_ROOT: mkdtempSync(join(tmpdir(), 'virtualworld-ai-')),
      LLM_BASE_URL: 'http://127.0.0.1:3135/v1',
      LLM_MODEL: 'local-http-fixture',
      LLM_API_KEY: 'fixture-only',
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch('http://127.0.0.1:3136/api/health')).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  const aiPage = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  aiPage.on('pageerror', (e) => report.errors.push(e.message));
  await aiPage.goto('http://127.0.0.1:3136/?project=demo-industrial');
  await aiPage.waitForFunction(
    () => window.virtualworld && !window.virtualworld.getDiagnostics().loading,
  );
  await aiPage
    .getByRole('button', { name: /AI 助手/ })
    .first()
    .click();
  await aiPage.getByRole('textbox', { name: 'AI 创作指令', exact: true }).fill('延迟调整环境');
  await aiPage.getByRole('button', { name: '生成编辑提案', exact: true }).click();
  for (let i = 0; i < 50 && !requests; i++) await aiPage.waitForTimeout(50);
  assert.ok(requests > 0);
  await aiPage.getByRole('button', { name: '切换到故事世界', exact: true }).click();
  await aiPage.waitForFunction(
    () =>
      window.virtualworld.spec.id === 'demo-world' && !window.virtualworld.getDiagnostics().loading,
  );
  await aiPage.waitForTimeout(2200);
  assert.equal(await aiPage.getByTestId('ai-proposal').count(), 0);
  assert.equal(
    await aiPage.evaluate(() => window.virtualworld.spec.environment.background),
    '#151a30',
  );
  check('Delayed model responses are aborted and cannot cross project boundaries');
  await aiPage.getByRole('button', { name: '切换到工业展示', exact: true }).click();
  await aiPage.waitForFunction(
    () =>
      window.virtualworld.spec.id === 'demo-industrial' &&
      !window.virtualworld.getDiagnostics().loading,
  );
  await aiPage.route('**/api/assets?name=*', async (route) => {
    await new Promise((r) => setTimeout(r, 1200));
    try {
      await route.continue();
    } catch {}
  });
  const uploading = aiPage.waitForRequest((r) => r.url().includes('/api/assets?name='));
  await aiPage
    .getByLabel('导入模型文件', { exact: true })
    .setInputFiles('public/fixtures/cube-mm.step');
  await uploading;
  await aiPage.getByRole('button', { name: '切换到故事世界', exact: true }).click();
  await aiPage.waitForFunction(
    () =>
      window.virtualworld.spec.id === 'demo-world' && !window.virtualworld.getDiagnostics().loading,
  );
  await aiPage.waitForTimeout(1800);
  assert.equal(
    await aiPage.evaluate(() =>
      window.virtualworld.spec.nodes.some((n) => n.id.startsWith('import-')),
    ),
    false,
  );
  check('In-flight CAD import cannot modify a newly opened project');
  await aiPage.unroute('**/api/assets?name=*');
  await aiPage.getByRole('button', { name: '切换到工业展示', exact: true }).click();
  await aiPage.waitForFunction(
    () =>
      window.virtualworld.spec.id === 'demo-industrial' &&
      !window.virtualworld.getDiagnostics().loading,
  );
  await aiPage
    .getByRole('button', { name: /AI 助手/ })
    .first()
    .click();
  const unchanged = await aiPage.evaluate(() =>
    window.virtualworld.spec.nodes.find((n) => n.id === 'housing'),
  );
  await aiPage.getByRole('textbox', { name: 'AI 创作指令', exact: true }).fill('将输出轴改成金色');
  await aiPage.getByRole('button', { name: '生成编辑提案', exact: true }).click();
  await aiPage.getByTestId('ai-proposal').waitFor();
  await aiPage.screenshot({ path: join(output, 'ai-proposal.png') });
  await aiPage.getByRole('button', { name: '应用修改', exact: true }).click();
  await aiPage.waitForFunction(
    () => window.virtualworld.spec.nodes.find((n) => n.id === 'shaft').color === '#dbb77b',
  );
  assert.deepEqual(
    await aiPage.evaluate(() => window.virtualworld.spec.nodes.find((n) => n.id === 'housing')),
    unchanged,
  );
  await aiPage.getByRole('button', { name: '撤销', exact: true }).click();
  await aiPage.waitForFunction(
    () => window.virtualworld.spec.nodes.find((n) => n.id === 'shaft').color === '#d4dce5',
  );
  check(
    'Actual local HTTP model proposal previews, applies locally and undoes without changing unrelated nodes',
  );
  await aiPage.close();
  assert.deepEqual(report.errors, []);
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.failure = String(error);
  console.error(error);
  process.exitCode = 1;
} finally {
  writeFileSync(join(output, 'browser.json'), JSON.stringify(report, null, 2));
  await browser.close();
  app.kill();
  aiApp?.kill();
  if (staticServer) await new Promise((r) => staticServer.close(r));
  if (modelServer) {
    modelServer.closeAllConnections();
    await new Promise((r) => modelServer.close(r));
  }
}
