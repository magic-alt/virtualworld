/** Isolated production-app + subdirectory standalone-export Little Prince qualification. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { unzipSync } from 'fflate';

const root = await mkdtemp(join(tmpdir(), 'vw-prince-'));
const output = resolve('output/playwright/prince-affordances');
await mkdir(output, { recursive: true });
const origin = 'http://127.0.0.1:3145';
const playerOrigin = 'http://127.0.0.1:3146';
const report = {
  checks: [],
  errors: [],
  limitations: ['Headless software-rendered browser; no hardware GPU qualification.'],
};
let app;
let checker;
let staticServer;
let appLog = '';
let interrupted = false;
const interrupt = () => {
  interrupted = true;
  checker?.kill('SIGTERM');
  app?.kill('SIGTERM');
};
process.on('SIGTERM', interrupt);
process.on('SIGINT', interrupt);
const check = (text) => {
  report.checks.push(text);
  console.log('PASS', text);
};
async function stopApp() {
  if (!app || app.exitCode !== null || app.signalCode !== null) return;
  const stopped = once(app, 'exit');
  app.kill('SIGTERM');
  let timer;
  await Promise.race([
    stopped,
    new Promise((resolve) => {
      timer = setTimeout(() => {
        app.kill('SIGKILL');
        resolve();
      }, 5000);
    }),
  ]);
  clearTimeout(timer);
  if (app.exitCode === null && app.signalCode === null) await stopped;
}
async function runPhase(phase) {
  checker = spawn(process.execPath, ['tests/e2e/prince-affordances-check.mjs'], {
    env: {
      ...process.env,
      VW_TEST_ORIGIN: origin,
      VW_PRINCE_PHASE: phase,
      VW_PRINCE_PLAYER_URL: `${playerOrigin}/prince/index.html`,
    },
    stdio: 'inherit',
  });
  const [code, signal] = await once(checker, 'exit');
  checker = undefined;
  assert.equal(code, 0, `Little Prince ${phase} checks failed (signal=${signal})`);
  const detail = JSON.parse(await readFile(join(output, `report-${phase}.json`), 'utf8'));
  assert.equal(detail.ok, true);
  report.checks.push(...detail.checks);
}
try {
  await Promise.all([readFile('dist/web/index.html'), readFile('dist/player/player.html')]);
  const code = `import {createApp} from './apps/web/server/app.ts';
    const app=await createApp({dataRoot:process.env.VW_PRINCE_DATA,projectRoot:process.cwd(),publicRoot:'public',studioRoot:'dist/web',playerRoot:'dist/player',llm:{baseUrl:'',model:'',key:''}});
    await app.listen({host:'127.0.0.1',port:3145});
    process.on('SIGTERM',()=>void app.close().then(()=>process.exit()));`;
  app = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], {
    env: { ...process.env, PORT: '3145', VW_PRINCE_DATA: join(root, 'data'), TRIPO_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
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
      if ((await fetch(`${origin}/api/health`)).ok) {
        healthy = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(healthy, `Production server did not become ready: ${appLog}`);
  check('Production app uses temporary data and PORT=3145');
  const sceneResponse = await fetch(`${origin}/api/projects/little-prince-desert`);
  assert.equal(sceneResponse.status, 200);
  const scene = await sceneResponse.json();
  const exported = await fetch(`${origin}/api/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scene }),
  });
  assert.equal(exported.status, 200, exported.status === 200 ? undefined : await exported.text());
  const zip = Buffer.from(await exported.arrayBuffer());
  const files = unzipSync(zip);
  assert.ok(files['index.html']);
  const manifest = JSON.parse(new TextDecoder().decode(files['campaign.json']));
  assert.equal(manifest.chapters.length, 3);
  for (const chapter of manifest.chapters) assert.ok(files[`${chapter.directory}/scene.json`]);
  await writeFile(join(output, 'little-prince.zip'), zip);
  check('Real export contains all three campaign scenes and standalone runtime');
  await runPhase('application');
  await stopApp();
  let unavailable = false;
  try {
    await fetch(`${origin}/api/health`);
  } catch {
    unavailable = true;
  }
  assert.ok(unavailable, 'The original API must be stopped before export qualification');
  check('Original API stopped before standalone player checks');
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
} catch (error) {
  report.ok = false;
  report.failure = String(error);
  report.errors.push(String(error));
  process.exitCode = 1;
  console.error(error);
} finally {
  checker?.kill('SIGTERM');
  await stopApp();
  if (staticServer?.listening) await new Promise((resolve) => staticServer.close(resolve));
  await writeFile(join(output, 'runner-report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(output, 'server.log'), appLog);
  assert.equal(resolve(dirname(root)), resolve(tmpdir()));
  await rm(root, { recursive: true, force: true });
  process.off('SIGTERM', interrupt);
  process.off('SIGINT', interrupt);
}
