import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { unzipSync, strFromU8 } from 'fflate';

const output = resolve('output/playwright/engine-export');
await mkdir(output, { recursive: true });
const dataRoot = await mkdtemp(join(tmpdir(), 'vw-browser-engine-export-'));
const verifyStartupFailure = process.argv.includes('--verify-startup-failure');
const readyMarker = `VW_ENGINE_EXPORT_READY_${randomUUID()} `;
const boot = `
import { createServer } from 'node:net';
import { once } from 'node:events';
import { createApp } from './apps/web/server/app.ts';
if (process.env.VW_EXPORT_SMOKE_EARLY_EXIT === '1') process.exit(23);
// Ask the OS for a port before fixing the local Origin policy. If another process
// wins the reservation/listen gap, startup fails before any readiness or request.
const reservation = createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));
const app = await createApp({
  dataRoot: process.env.VW_DATA_ROOT,
  accessPolicy: { mode: 'local', port },
  llm: { baseUrl: '', key: '', model: '' },
});
await app.listen({ host: '127.0.0.1', port });
process.on('SIGTERM', () => void app.close().then(() => process.exit(0)));
console.log(process.env.VW_EXPORT_SMOKE_READY_MARKER + JSON.stringify({ origin: 'http://127.0.0.1:' + port }));
`;
const app = spawn(process.execPath, ['--import', 'tsx', '-e', boot], {
  env: {
    ...process.env,
    VW_DATA_ROOT: dataRoot,
    VW_EXPORT_SMOKE_READY_MARKER: readyMarker,
    VW_EXPORT_SMOKE_EARLY_EXIT: verifyStartupFailure ? '1' : '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let appLog = '';
let resolveReady, rejectReady;
const ready = new Promise((resolve, reject) => {
  resolveReady = resolve;
  rejectReady = reject;
});
// Observe both spawn errors and exit from the outset, including exits before readiness.
const exited = new Promise((resolve) => {
  app.once('error', (error) => {
    rejectReady(new Error(`Application spawn failed: ${error.message}`));
    resolve({ error });
  });
  app.once('exit', (code, signal) => {
    rejectReady(
      new Error(`Application exited before readiness (code=${code}, signal=${signal}): ${appLog}`),
    );
    resolve({ code, signal });
  });
});
const startupTimeout = setTimeout(
  () => rejectReady(new Error('Application readiness timeout: ' + appLog)),
  15000,
);
void ready.then(
  () => clearTimeout(startupTimeout),
  () => clearTimeout(startupTimeout),
);
let stdout = '';
app.stdout.on('data', (chunk) => {
  appLog += chunk;
  stdout += chunk;
  let newline;
  while ((newline = stdout.indexOf('\n')) !== -1) {
    const line = stdout.slice(0, newline);
    stdout = stdout.slice(newline + 1);
    if (!line.startsWith(readyMarker)) continue;
    try {
      const { origin } = JSON.parse(line.slice(readyMarker.length));
      const url = new URL(origin);
      assert.equal(url.protocol, 'http:');
      assert.equal(url.hostname, '127.0.0.1');
      assert.ok(Number(url.port) > 0);
      assert.equal(url.origin, origin);
      resolveReady(origin);
    } catch (error) {
      rejectReady(error);
    }
  }
});
app.stderr.on('data', (chunk) => (appLog += chunk));
let browser;
const errors = [];
const checks = [];
try {
  if (verifyStartupFailure) {
    await assert.rejects(ready, /Application exited before readiness \(code=23/);
    assert.equal((await exited).code, 23);
    console.log(
      'PASS Child exit before readiness is reported and cleaned up without any HTTP request',
    );
  } else {
    const origin = await ready;
    assert.equal(app.exitCode, null, appLog);
    // Save a small real scene so native export does not depend on the large product demo.
    const scene = {
      version: 1,
      id: 'native-browser',
      name: 'Native browser fixture',
      description: '',
      mode: 'industrial',
      revision: 0,
      assets: [],
      tasks: [],
      nodes: [
        {
          id: 'box',
          name: 'Box',
          kind: 'mesh',
          shape: 'box',
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          size: [2, 4, 6],
          color: '#abcdef',
          visible: true,
        },
      ],
      environment: { background: '#101722', lightIntensity: 3, ambientIntensity: 1.5 },
      camera: { position: [8, 7, 8], target: [0, 0, 0] },
      spawn: [0, 1, 3],
    };
    assert.equal(
      (
        await fetch(`${origin}/api/projects/${scene.id}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ scene, baseRevision: 0 }),
        })
      ).status,
      200,
    );
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
      args: ['--enable-webgl', '--ignore-gpu-blocklist'],
    });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 960 },
      acceptDownloads: true,
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${origin}/?project=${scene.id}&edit=1`);
    await page.waitForFunction(
      () =>
        window.virtualworld?.spec.id === 'native-browser' &&
        !window.virtualworld.getDiagnostics().loading,
      {},
      { timeout: 45000 },
    );
    await page.getByRole('button', { name: '导出网页', exact: true }).waitFor();
    assert.equal(await page.getByLabel('导出目标', { exact: true }).inputValue(), 'web');
    checks.push('Default target is web and existing 导出网页 accessible action is preserved');
    for (const [target, label, required] of [
      ['godot', 'Godot', 'project.godot'],
      ['unity', 'Unity', 'Editor/VirtualWorldImporter.cs'],
    ]) {
      await page.getByLabel('导出目标', { exact: true }).selectOption(target);
      const [download, response] = await Promise.all([
        page.waitForEvent('download'),
        page.waitForResponse((response) => response.url() === `${origin}/api/export`),
        page.getByRole('button', { name: `导出 ${label}`, exact: true }).click(),
      ]);
      assert.equal(response.status(), 200);
      assert.equal(response.request().postDataJSON().target, target);
      assert.equal(download.suggestedFilename(), `${scene.name}-${target}.zip`);
      const path = join(output, `${target}.zip`);
      await download.saveAs(path);
      const files = unzipSync(await readFile(path));
      assert.ok(files[required]);
      assert.ok(!files['index.html']);
      assert.ok(files['compatibility.json']);
      assert.equal(JSON.parse(strFromU8(files['engine-manifest.json'])).target, target);
      await page
        .getByText(`${label} 已导出，请先阅读 compatibility.json 兼容性报告`, { exact: true })
        .waitFor();
      checks.push(
        `${label} selection sends native target and downloads a valid archive with compatibility report`,
      );
    }
    await page.getByLabel('导出目标', { exact: true }).selectOption('web');
    await page.getByRole('button', { name: '导出网页', exact: true }).waitFor();
    assert.deepEqual(errors, []);
    await page.screenshot({ path: join(output, 'target-selector.png') });
    await writeFile(
      join(output, 'report.json'),
      JSON.stringify({ browser: await browser.version(), checks, errors }, null, 2),
    );
    for (const check of checks) console.log('PASS', check);
  }
} finally {
  try {
    await browser?.close();
  } finally {
    if (app.pid && app.exitCode === null && app.signalCode === null) app.kill('SIGTERM');
    const killTimeout = setTimeout(() => app.kill('SIGKILL'), 5000);
    try {
      await exited;
    } finally {
      clearTimeout(killTimeout);
      await rm(dataRoot, { recursive: true, force: true });
    }
  }
}
