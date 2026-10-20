/** Isolated production-app + subdirectory standalone-export Little Prince qualification. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { unzipSync } from 'fflate';

const root = await mkdtemp(join(tmpdir(), 'vw-prince-'));
const output = resolve('output/playwright/prince-affordances');
await mkdir(output, { recursive: true });
const origin = 'http://127.0.0.1:3145';
const playerOrigin = 'http://127.0.0.1:3146';
const uiDeadline = 90000;
const movementDeadline = 180000;
const shutdownDeadline = 5000;
const reportPath = join(output, 'runner-report.json');
const report = {
  ok: false,
  status: 'running',
  checks: [],
  errors: [],
  phases: [],
  limitations: ['Headless software-rendered browser; no hardware GPU qualification.'],
};
let app;
let checker;
let staticServer;
let appLog = '';
let interrupted = false;
const interrupt = () => {
  interrupted = true;
  signalChild(checker, 'SIGTERM');
  signalChild(app, 'SIGTERM');
};
process.on('SIGTERM', interrupt);
process.on('SIGINT', interrupt);
async function checkpoint(stage) {
  report.progress = { stage, at: new Date().toISOString() };
  await writeFile(`${reportPath}.tmp`, JSON.stringify(report, null, 2));
  await rename(`${reportPath}.tmp`, reportPath);
}
const check = async (text) => {
  report.checks.push(text);
  await checkpoint(text);
  console.log('PASS', text);
};
async function bounded(promise, timeout, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function signalChild(child, signal) {
  if (!child?.pid) return;
  signalProcessGroup(child.pid, signal);
}
function signalProcessGroup(pid, signal) {
  try {
    process.kill(process.platform === 'win32' ? pid : -pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}
async function stopChild(child) {
  if (!child?.pid) return;
  if (child.exitCode !== null || child.signalCode !== null) {
    if (child.exitCode !== 0) signalChild(child, 'SIGKILL');
    return;
  }
  const exited = once(child, 'exit');
  signalChild(child, 'SIGTERM');
  try {
    await bounded(exited, shutdownDeadline, 'Child SIGTERM shutdown');
  } catch {
    signalChild(child, 'SIGKILL');
    await bounded(exited, shutdownDeadline, 'Child SIGKILL shutdown');
  }
}
async function stopApp() {
  await stopChild(app);
}
async function runPhase(phase) {
  assert.equal(interrupted, false, 'Test interrupted');
  // A full campaign has ten encounters plus terrain, release and lifecycle checks.
  // These are process ceilings only; the 60/90/180 s condition-based checks stay bounded.
  const phaseState = {
    phase,
    status: 'running',
    timeoutMs: (phase === 'application' ? 2 : 1) * 20 * uiDeadline,
    checkpointTimeoutMs: movementDeadline + uiDeadline,
  };
  report.phases.push(phaseState);
  await checkpoint(`${phase}: starting checker`);
  checker = spawn(process.execPath, ['tests/e2e/prince-affordances-check.mjs'], {
    env: {
      ...process.env,
      VW_TEST_ORIGIN: origin,
      VW_PRINCE_PHASE: phase,
      VW_PRINCE_PLAYER_URL: `${playerOrigin}/prince/index.html`,
    },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    detached: process.platform !== 'win32',
  });
  const child = checker;
  let phaseTimer;
  let progressTimer;
  let shutdownTimer;
  let onProgress;
  let onDisconnect;
  const watchdog = new Promise((_, reject) => {
    phaseTimer = setTimeout(
      () => reject(new Error(`${phase} exceeded its ${phaseState.timeoutMs} ms phase budget`)),
      phaseState.timeoutMs,
    );
    const renew = () => {
      clearTimeout(progressTimer);
      progressTimer = setTimeout(
        () =>
          reject(
            new Error(
              `${phase} produced no completed step/checkpoint for ${phaseState.checkpointTimeoutMs} ms; last step: ${phaseState.lastStep || 'startup'}`,
            ),
          ),
        phaseState.checkpointTimeoutMs,
      );
    };
    onProgress = (message) => {
      if (message?.type !== 'checkpoint' || message.phase !== phase) return;
      phaseState.lastStep = message.stage;
      phaseState.lastProgressAt = new Date().toISOString();
      if (Number.isSafeInteger(message.browserPid) && message.browserPid > 1)
        phaseState.browserPid = message.browserPid;
      renew();
    };
    child.on('message', onProgress);
    onDisconnect = () => {
      shutdownTimer = setTimeout(
        () => reject(new Error(`${phase} checker did not exit after closing its report channel`)),
        shutdownDeadline,
      );
    };
    child.once('disconnect', onDisconnect);
    renew();
  });
  try {
    const [code, signal] = await Promise.race([once(child, 'exit'), watchdog]);
    assert.equal(code, 0, `Little Prince ${phase} checks failed (signal=${signal})`);
    const detail = JSON.parse(await readFile(join(output, `report-${phase}.json`), 'utf8'));
    assert.equal(detail.ok, true);
    report.checks.push(...detail.checks);
    phaseState.status = 'passed';
    await checkpoint(`${phase}: completed`);
  } catch (error) {
    phaseState.status = 'failed';
    phaseState.failure = String(error);
    await checkpoint(`${phase}: failed; stopping checker`);
    throw error;
  } finally {
    clearTimeout(phaseTimer);
    clearTimeout(progressTimer);
    clearTimeout(shutdownTimer);
    child.off('message', onProgress);
    child.off('disconnect', onDisconnect);
    try {
      await stopChild(child);
    } finally {
      // Playwright owns a separate Chromium process group; the checker reports its PID.
      if (phaseState.status !== 'passed' && phaseState.browserPid)
        signalProcessGroup(phaseState.browserPid, 'SIGKILL');
      checker = undefined;
    }
  }
}
try {
  await checkpoint('Checking production build');
  await Promise.all([readFile('dist/web/index.html'), readFile('dist/player/player.html')]);
  const code = `import {createApp} from './apps/web/server/app.ts';
    const app=await createApp({dataRoot:process.env.VW_PRINCE_DATA,projectRoot:process.cwd(),publicRoot:'public',studioRoot:'dist/web',playerRoot:'dist/player',llm:{baseUrl:'',model:'',key:''}});
    await app.listen({host:'127.0.0.1',port:3145});
    process.on('SIGTERM',()=>void app.close().then(()=>process.exit()));`;
  app = spawn(process.execPath, ['--import', 'tsx', '-e', code], {
    env: { ...process.env, PORT: '3145', VW_PRINCE_DATA: join(root, 'data'), TRIPO_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  app.stdout.on('data', (chunk) => {
    appLog += chunk;
  });
  app.stderr.on('data', (chunk) => {
    appLog += chunk;
  });
  let healthy = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    assert.equal(interrupted, false, 'Test interrupted');
    assert.equal(app.exitCode, null, appLog || 'Production server exited before becoming ready');
    try {
      if ((await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(3000) })).ok) {
        healthy = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(healthy, `Production server did not become ready: ${appLog}`);
  await check('Production app uses temporary data and PORT=3145');
  const sceneResponse = await fetch(`${origin}/api/projects/little-prince-desert`, {
    signal: AbortSignal.timeout(uiDeadline),
  });
  assert.equal(sceneResponse.status, 200);
  const scene = await sceneResponse.json();
  const exported = await fetch(`${origin}/api/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scene }),
    signal: AbortSignal.timeout(uiDeadline),
  });
  assert.equal(exported.status, 200, exported.status === 200 ? undefined : await exported.text());
  const zip = Buffer.from(await exported.arrayBuffer());
  const files = unzipSync(zip);
  assert.ok(files['index.html']);
  const manifest = JSON.parse(new TextDecoder().decode(files['campaign.json']));
  assert.equal(manifest.chapters.length, 3);
  for (const chapter of manifest.chapters) assert.ok(files[`${chapter.directory}/scene.json`]);
  await writeFile(join(output, 'little-prince.zip'), zip);
  await check('Real export contains all three campaign scenes and standalone runtime');
  await runPhase('application');
  await stopApp();
  let unavailable = false;
  try {
    await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(3000) });
  } catch {
    unavailable = true;
  }
  assert.ok(unavailable, 'The original API must be stopped before export qualification');
  await check('Original API stopped before standalone player checks');
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.wasm': 'application/wasm',
    '.glb': 'model/gltf-binary',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
  };
  staticServer = createServer((request, response) => {
    let path;
    try {
      path = decodeURIComponent(new URL(request.url, playerOrigin).pathname);
    } catch {
      response.writeHead(400).end();
      return;
    }
    const name = path.startsWith('/prince/') ? path.slice('/prince/'.length) || 'index.html' : '';
    const bytes = files[name];
    response.writeHead(bytes ? 200 : 404, {
      'content-type': types[extname(name)] || 'application/octet-stream',
    });
    response.end(bytes || 'Not found');
  });
  staticServer.listen(3146, '127.0.0.1');
  await once(staticServer, 'listening');
  await runPhase('player');
  report.ok = true;
  report.status = 'passed';
} catch (error) {
  report.ok = false;
  report.status = 'failed';
  report.failure = String(error);
  report.errors.push(String(error));
  process.exitCode = 1;
  await checkpoint('Runner failed; cleaning up');
  console.error(error);
} finally {
  for (const cleanup of [
    () => stopChild(checker),
    () => stopApp(),
    async () => {
      if (staticServer?.listening) {
        const closed = new Promise((resolve) => staticServer.close(resolve));
        staticServer.closeAllConnections();
        await bounded(closed, shutdownDeadline, 'Static export server shutdown');
      }
    },
    () => writeFile(join(output, 'server.log'), appLog),
    async () => {
      assert.equal(resolve(dirname(root)), resolve(tmpdir()));
      await rm(root, { recursive: true, force: true });
    },
  ]) {
    try {
      await cleanup();
    } catch (error) {
      report.ok = false;
      report.status = 'failed';
      report.failure ||= String(error);
      report.errors.push(String(error));
      process.exitCode = 1;
    }
  }
  await checkpoint(report.ok ? 'Runner completed' : 'Runner failed');
  process.off('SIGTERM', interrupt);
  process.off('SIGINT', interrupt);
}
