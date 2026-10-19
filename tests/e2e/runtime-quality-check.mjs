/** Production-browser coverage for on-demand capture and renderer resource settings. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { checkLoadingBoundaries } from './loading-boundaries-check.mjs';

const dataRoot = await mkdtemp(join(tmpdir(), 'virtualworld-quality-'));
const output = resolve('output/playwright/runtime-quality');
await mkdir(output, { recursive: true });
const origin = 'http://127.0.0.1:3144';
const code = `import {createApp} from './apps/web/server/app.ts';
const app=await createApp({dataRoot:process.env.VW_QA_DATA,projectRoot:process.cwd(),publicRoot:'public',studioRoot:process.env.VW_QA_STUDIO_ROOT||'dist/web',playerRoot:'dist/player'});
await app.listen({host:'127.0.0.1',port:3144});
process.on('SIGTERM',()=>void app.close().then(()=>process.exit()));`;
const app = spawn(process.execPath, ['--import', 'tsx', '-e', code], {
  env: { ...process.env, PORT: '3144', VW_QA_DATA: dataRoot },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let appLog = '',
  browser,
  page;
app.stdout.on('data', (chunk) => (appLog += chunk));
app.stderr.on('data', (chunk) => (appLog += chunk));
const report = { checks: [], errors: [], captures: [] };
const check = (name) => {
  report.checks.push(name);
  console.log('PASS', name);
};
try {
  for (let attempt = 0; ; attempt++) {
    assert.ok(app.exitCode === null, appLog);
    try {
      if ((await fetch(`${origin}/api/health`)).ok) break;
    } catch {}
    assert.ok(attempt < 100, appLog || 'Application did not start');
    await new Promise((done) => setTimeout(done, 100));
  }
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined,
    args: ['--enable-unsafe-swiftshader'],
  });
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (error) => report.errors.push(error.message));
  await page.goto(`${origin}/?project=demo-harmonic-joint`);
  await page.waitForFunction(() => {
    const runtime = window.virtualworld;
    return runtime?.spec.id === 'demo-harmonic-joint' && !runtime.getDiagnostics().loading;
  });
  await page.getByRole('button', { name: '暂停体验', exact: true }).click();
  await page.screenshot({ path: join(output, 'joint-desktop.png') });
  const capture = async () => {
    const result = await page.evaluate(async () => {
      const runtime = window.virtualworld;
      const url = runtime.screenshot();
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0, 64, 64);
      const pixels = context.getImageData(0, 0, 64, 64).data;
      const colors = new Set();
      let opaque = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
        if (pixels[i + 3] === 255) opaque++;
      }
      return {
        width: image.width,
        height: image.height,
        expectedWidth: runtime.renderer.domElement.width,
        expectedHeight: runtime.renderer.domElement.height,
        colors: colors.size,
        opaque,
        paused: runtime.getDiagnostics().paused,
        preserved: runtime.renderer.getContext().getContextAttributes().preserveDrawingBuffer,
        gpu: runtime.getDiagnostics().gpu,
        data: url.split(',')[1],
      };
    });
    await writeFile(
      join(output, result.paused ? 'capture-paused.png' : 'capture-running.png'),
      Buffer.from(result.data, 'base64'),
    );
    delete result.data;
    report.captures.push(result);
    assert.equal(result.width, result.expectedWidth);
    assert.equal(result.height, result.expectedHeight);
    assert.equal(result.opaque, 64 * 64, 'Capture must contain the rendered opaque scene');
    assert.ok(result.colors > 30, `Capture is blank or nearly blank (${result.colors} colors)`);
    return result;
  };
  const paused = await capture();
  assert.equal(paused.paused, true);
  check('Paused screenshot contains a full-size, nonblank rendered PNG');
  assert.equal(paused.preserved, false, 'Ordinary rendering must not preserve every frame buffer');
  check('Renderer does not preserve its drawing buffer');
  await page.getByRole('button', { name: '继续体验', exact: true }).click();
  const running = await capture();
  assert.equal(running.paused, false);
  check('Running screenshot also captures the current scene on demand');
  assert.deepEqual(report.errors, []);
  assert.deepEqual(await page.evaluate(() => window.virtualworld.getDiagnostics().errors), []);
  check('No browser or runtime errors during capture');
  await page.getByRole('button', { name: '高级编辑', exact: true }).click();
  await page.waitForFunction(
    () =>
      window.virtualworld?.getDiagnostics().mode === 'edit' &&
      !window.virtualworld.getDiagnostics().loading,
  );
  await page.locator('.joint-panel--editor').waitFor();
  const editorScene = await page.evaluate(() => JSON.stringify(window.virtualworld.spec));
  const outputName = await page.evaluate(
    () => window.virtualworld.spec.nodes.find((node) => node.id === 'harmonic-output-flange').name,
  );
  await page.getByLabel('搜索对象', { exact: true }).fill(outputName);
  await page.getByRole('button', { name: `选择 ${outputName}`, exact: true }).click();
  await page.waitForFunction(
    () =>
      window.virtualworld.transform.object ===
      window.virtualworld.objects.get('harmonic-output-flange'),
  );
  assert.equal(await page.locator('.tree-row.selected').count(), 1);
  await page.getByRole('button', { name: '了解输出支承', exact: true }).click();
  await page.waitForFunction(() => !window.virtualworld.transform.object);
  assert.equal(await page.locator('.tree-row.selected').count(), 0);
  assert.equal(await page.getByLabel('对象名称', { exact: true }).count(), 0);
  assert.equal(
    await page.evaluate(() => window.virtualworld.getMechanismState().selectedSubsystem),
    'output',
  );
  assert.equal(await page.evaluate(() => JSON.stringify(window.virtualworld.spec)), editorScene);
  assert.deepEqual(await page.evaluate(() => window.virtualworld.getDiagnostics().errors), []);
  assert.deepEqual(report.errors, []);
  await page.screenshot({ path: join(output, 'editor-subsystem-selection.png') });
  check(
    'Entering subsystem inspection clears prior tree selection and transform handles without editing SceneSpec',
  );
  await page.close();
  await checkLoadingBoundaries(browser, origin, check);
} catch (error) {
  report.failure = String(error);
  report.page = await page
    ?.locator('body')
    .innerText()
    .catch(() => 'Page unavailable');
  report.runtime = await page
    ?.evaluate(() => window.virtualworld?.getDiagnostics())
    .catch(() => undefined);
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  console.error(
    JSON.stringify({ failure: report.failure, page: report.page, runtime: report.runtime }),
  );
  throw error;
} finally {
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser?.close();
  if (app.exitCode === null) {
    const exited = new Promise((done) => app.once('exit', done));
    app.kill('SIGTERM');
    await exited;
  }
  await rm(dataRoot, { recursive: true, force: true });
}
