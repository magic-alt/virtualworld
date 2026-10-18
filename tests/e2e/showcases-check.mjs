/** Real Edge showcase qualification. Story traversal uses explicitly labelled fixture teleports. */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join, extname, sep, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { unzipSync } from 'fflate';
import assert from 'node:assert/strict';

const origin = 'http://127.0.0.1:3138';
const output = resolve('output/playwright/showcases');
mkdirSync(output, { recursive: true });
const dataRoot = mkdtempSync(join(tmpdir(), 'virtualworld-showcases-'));
const executablePath =
  process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
  [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ].find(existsSync);
const report = {
  version: 1,
  startedAt: new Date().toISOString(),
  viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
  executablePath,
  checks: [],
  errors: [],
  profiles: {},
  movement: {},
  interactions: [],
  mechanism: {},
  staticRequests: [],
  limitations: [
    'Keyboard W movement and Space jump are exercised separately in every chapter.',
    'Story progression uses explicit test-fixture character/body teleports near each interaction, then public runtime.interact(id) with real distance enforcement; this is not full-route keyboard navigation.',
    'Local retained Blender assets and static export are tested; no live paid provider or hardware/load/FEA qualification is performed.',
  ],
};
let app,
  browser,
  staticServer,
  page,
  appLog = '',
  ownedApp = false;
const check = (name) => {
  report.checks.push(name);
  console.log('PASS', name);
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function stopApp() {
  if (!app || !ownedApp) return;
  if (app.exitCode === null) {
    const ended = once(app, 'exit');
    app.kill();
    await Promise.race([
      ended,
      pause(5000).then(() => {
        if (app.exitCode === null) throw new Error('Owned showcase server did not exit');
      }),
    ]);
  }
  ownedApp = false;
}
async function ready(target, id, playing = false) {
  await target.waitForFunction(
    ({ id, playing }) => {
      const r = window.virtualworld;
      if (!r || r.spec.id !== id) return false;
      const d = r.getDiagnostics();
      return !d.loading && (!playing || !!d.player);
    },
    { id, playing },
    { timeout: 90000 },
  );
  const d = await target.evaluate(() => window.virtualworld.getDiagnostics());
  assert.deepEqual(d.errors, []);
}
async function range(locator, value) {
  await locator.focus();
  await locator.press('Home');
  const limits = await locator.evaluate((e) => ({ min: Number(e.min), step: Number(e.step || 1) }));
  const steps = Math.round((value - limits.min) / limits.step);
  for (let i = 0; i < steps; i++) await locator.press('ArrowRight');
  assert.equal(await locator.inputValue(), String(value));
  await locator.evaluate((e) => e.blur());
}
async function profile(target, key) {
  await target.waitForTimeout(1800);
  report.profiles[key] = await target.evaluate(
    () =>
      new Promise((resolve) => {
        const samples = [],
          draws = [],
          triangles = [];
        let first, previous;
        const step = (now) => {
          if (first === undefined) {
            first = previous = now;
            requestAnimationFrame(step);
            return;
          }
          samples.push(now - previous);
          previous = now;
          const r = window.virtualworld;
          draws.push(r.renderer.info.render.calls);
          triangles.push(r.renderer.info.render.triangles);
          if (now - first < 10000) {
            requestAnimationFrame(step);
            return;
          }
          const sorted = samples.slice().sort((a, b) => a - b),
            d = r.getDiagnostics(),
            canvas = r.renderer.domElement;
          const gl = r.renderer.getContext(),
            info = gl.getExtension('WEBGL_debug_renderer_info');
          const result = {
            durationMs: now - first,
            frames: samples.length,
            fps: (samples.length * 1000) / (now - first),
            p95FrameMs: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
            drawCallsMax: Math.max(...draws),
            trianglesMax: Math.max(...triangles),
            gpu: d.gpu,
            webglRenderer: info
              ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL)
              : gl.getParameter(gl.RENDERER),
            viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
            canvas: { width: canvas.width, height: canvas.height },
            runtime: d,
          };
          result.targetMet =
            result.fps >= 55 &&
            result.p95FrameMs <= 25 &&
            result.drawCallsMax < 150 &&
            result.trianglesMax < 750000;
          resolve(result);
        };
        requestAnimationFrame(step);
      }),
  );
  check(`Measured ${key}: 10s RAF, actual GPU / draw calls / triangles retained`);
}
async function movement(target, id) {
  await target.evaluate(() => document.activeElement?.blur());
  await target.waitForTimeout(800);
  const before = await target.evaluate(() => window.virtualworld.getDiagnostics().player);
  await target.keyboard.down('KeyW');
  try {
    await target.waitForFunction(
      () => {
        const r = window.virtualworld;
        return r.getDiagnostics().actorClip === r.spec.actor.clips.walk;
      },
      null,
      { timeout: 5000 },
    );
    await target.waitForTimeout(600);
  } finally {
    await target.keyboard.up('KeyW');
  }
  const after = await target.evaluate(() => window.virtualworld.getDiagnostics().player);
  const distance = Math.hypot(...after.map((v, i) => v - before[i]));
  assert.ok(distance > 0.3, `${id}: real W displacement ${distance}m`);
  await target.waitForTimeout(1000);
  await target.waitForFunction(() => {
    const r = window.virtualworld;
    return r.getDiagnostics().actorClip === r.spec.actor.clips.idle;
  });
  const grounded = await target.evaluate(() => {
    const r = window.virtualworld,
      p = r.getDiagnostics().player,
      n = r.spec.navigation;
    return n?.kind === 'sphere' ? Math.hypot(...p.map((v, i) => v - n.center[i])) : p[1];
  });
  await target.keyboard.down('Space');
  await target.waitForTimeout(180);
  await target.keyboard.up('Space');
  const apex = await target.evaluate(() => {
    const r = window.virtualworld,
      p = r.getDiagnostics().player,
      n = r.spec.navigation;
    return n?.kind === 'sphere' ? Math.hypot(...p.map((v, i) => v - n.center[i])) : p[1];
  });
  assert.ok(apex - grounded > 0.12, `${id}: real Space jump height ${apex - grounded}m`);
  report.movement[id] = {
    before,
    after,
    distance,
    jumpHeightAt180ms: apex - grounded,
    method: 'actual keyboard W and Space; no movement teleport',
  };
  await target.waitForTimeout(1000);
  check(`${id}: real W movement, Space jump, declared Walk / Idle clips`);
}
async function closeDialog(target, studio) {
  const button = studio
    ? target.getByRole('button', { name: '关闭对话', exact: true })
    : target.locator('.dialog > button').last();
  if (await button.count()) await button.click();
}
async function fixtureInteract(target, id, studio) {
  // Deliberate fixture mutation is limited to character/body pose, never SceneSpec or saved flags.
  const placement = await target.evaluate((id) => {
    const r = window.virtualworld,
      char = r.char,
      obj = r.objects.get(id);
    if (!char || !obj) throw new Error('Fixture target missing');
    const point = obj.getWorldPosition(char.object.position.clone()),
      up = char.up.clone(),
      feet = point.clone(),
      nav = r.spec.navigation;
    if (nav?.kind === 'sphere') {
      const center = point.clone().set(...nav.center);
      up.copy(point).sub(center).normalize();
      feet.copy(center).addScaledVector(up, nav.radius + 0.06);
    } else {
      up.set(0, 1, 0);
      feet.y = r.spec.spawn[1];
      feet.z += 1.2;
    }
    const offset = char.object.position
      .clone()
      .copy(char.body.translation())
      .sub(char.object.position)
      .length();
    const body = feet.clone().addScaledVector(up, offset);
    char.body.setTranslation({ x: body.x, y: body.y, z: body.z }, true);
    char.body.setNextKinematicTranslation({ x: body.x, y: body.y, z: body.z });
    char.object.position.copy(feet);
    return {
      id,
      feet: feet.toArray(),
      distance: feet.distanceTo(point),
      method: 'explicit story fixture teleport; not route navigation',
    };
  }, id);
  assert.ok(placement.distance < 2.6, `Fixture ${id} must remain within real interaction range`);
  await target.waitForTimeout(80);
  await target.evaluate((id) => window.virtualworld.interact(id), id);
  await target.waitForFunction(
    () => {
      const r = window.virtualworld;
      return r.getDiagnostics().actorClip === r.spec.actor.clips.interact;
    },
    null,
    { timeout: 5000 },
  );
  const state = await target.evaluate(() => window.virtualworld.getDiagnostics().story);
  report.interactions.push({
    ...placement,
    scene: await target.evaluate(() => window.virtualworld.spec.id),
    state,
  });
  await closeDialog(target, studio);
  return state;
}
async function completeChapter(target, studio) {
  const { id, targets } = await target.evaluate(() => ({
    id: window.virtualworld.spec.id,
    targets: window.virtualworld.spec.nodes
      .filter((n) => n.interaction)
      .map((n) => ({ id: n.id, ...n.interaction })),
  }));
  const terminal = targets.filter((t) => t.completes);
  assert.equal(terminal.length, 1, `${id}: one terminal interaction`);
  let state = await fixtureInteract(target, terminal[0].id, studio);
  assert.equal(state.completed, false, `${id}: terminal interaction cannot skip prerequisites`);
  const pending = targets.filter((t) => !t.completes);
  while (pending.length) {
    const index = pending.findIndex((t) =>
      (t.requires || []).every((f) => state.flags.includes(f)),
    );
    assert.ok(index >= 0, 'Interaction dependency graph must be reachable');
    const next = pending.splice(index, 1)[0];
    state = await fixtureInteract(target, next.id, studio);
    assert.equal(
      state.completed,
      false,
      `${id}: intermediate interaction must not complete chapter`,
    );
  }
  state = await fixtureInteract(target, terminal[0].id, studio);
  assert.equal(state.completed, true);
  check(
    `${id}: only final in-range interaction completes story (fixture teleports explicitly recorded)`,
  );
}
async function options(target, label) {
  return target
    .getByLabel(label, { exact: true })
    .locator('option')
    .evaluateAll((opts) =>
      opts.map((o) => ({ value: o.value, disabled: o.disabled, text: o.textContent })),
    );
}

try {
  assert.ok(executablePath, 'Installed Edge not found');
  assert.ok(
    existsSync('dist/web/index.html') && existsSync('dist/player/player.html'),
    'Run npm run build before showcase qualification',
  );
  let occupied = false;
  try {
    await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(800) });
    occupied = true;
  } catch {}
  assert.equal(occupied, false, 'Port3138 is already occupied; refusing to reuse unrelated server');
  app = spawn(process.execPath, ['--import', 'tsx', 'apps/web/server/index.ts'], {
    env: {
      ...process.env,
      PORT: '3138',
      VW_DATA_ROOT: dataRoot,
      LLM_BASE_URL: '',
      LLM_MODEL: '',
      LLM_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  ownedApp = true;
  app.stdout.on('data', (c) => (appLog += c));
  app.stderr.on('data', (c) => (appLog += c));
  let healthy = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${origin}/api/health`)).ok) {
        healthy = true;
        break;
      }
    } catch {}
    if (app.exitCode !== null) break;
    await pause(100);
  }
  assert.ok(healthy, appLog);
  browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ['--enable-webgl', '--ignore-gpu-blocklist'],
  });
  report.browser = await browser.version();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  page = await context.newPage();
  page.on('pageerror', (e) => report.errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') report.errors.push(m.text());
  });
  await page.goto(`${origin}/?edit=1`);
  await ready(page, 'demo-harmonic-joint');
  check('Advanced editing retains the real harmonic engineering showcase');
  const baseline = await page.evaluate(() => {
    const r = window.virtualworld;
    return {
      revision: r.spec.revision,
      poses: Object.fromEntries(
        [...r.objects].map(([id, o]) => [
          id,
          { p: o.position.toArray(), r: o.rotation.toArray().slice(0, 3), visible: o.visible },
        ]),
      ),
    };
  });
  await page.getByRole('button', { name: '剖视', exact: true }).click();
  await page.waitForFunction(() => window.virtualworld.getDiagnostics().mechanism.section);
  assert.equal(
    await page.evaluate(() => {
      const r = window.virtualworld,
        m = r.spec.mechanism;
      return (
        m.fullHousingIds.every((id) => !r.objects.get(id).visible) &&
        m.sectionHousingIds.every((id) => r.objects.get(id).visible)
      );
    }),
    true,
  );
  await range(page.getByLabel('爆炸展开', { exact: true }), 1);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(output, 'harmonic-section-exploded.png') });
  await range(page.getByLabel('爆炸展开', { exact: true }), 0);
  await page.getByRole('button', { name: '剖视', exact: true }).click();
  const restored = await page.evaluate(() => {
    const r = window.virtualworld;
    return {
      revision: r.spec.revision,
      poses: Object.fromEntries(
        [...r.objects].map(([id, o]) => [
          id,
          { p: o.position.toArray(), r: o.rotation.toArray().slice(0, 3), visible: o.visible },
        ]),
      ),
    };
  });
  assert.deepEqual(restored, baseline);
  check('Section visibility and explosion restore exact poses without serializing play state');
  await page.getByRole('button', { name: '剖视', exact: true }).click();
  await range(page.getByLabel('输入转速', { exact: true }), 12);
  await page.getByRole('button', { name: '运动演示', exact: true }).click();
  const angles = () =>
    page.evaluate(() => {
      const r = window.virtualworld,
        m = r.spec.mechanism;
      return {
        input: r.objects.get(m.waveNodeId).rotation.y,
        flex: r.objects.get(m.flexNodeId).rotation.y,
        output: r.objects.get(m.outputNodeId).rotation.y,
        fixed: m.fixedNodeIds.map((id) => r.objects.get(id).rotation.toArray().slice(0, 3)),
        diagnostics: r.getDiagnostics().mechanism,
      };
    });
  for (const rpm of [12, -12]) {
    if (rpm < 0) await page.evaluate(() => window.virtualworld.setTransmissionSpeed(-12));
    const a = await angles();
    await page.waitForTimeout(850);
    const b = await angles(),
      di = b.input - a.input,
      dout = b.output - a.output;
    assert.ok(Math.sign(di) === Math.sign(rpm) && Math.abs(di) > 0.1);
    assert.ok(Math.abs(dout + di / 100) < 1e-7);
    assert.ok(Math.abs(b.flex - b.output) < 1e-7);
    assert.deepEqual(a.fixed, b.fixed);
    assert.equal(b.diagnostics.inputRpm, rpm);
    report.mechanism[rpm] = {
      before: a,
      after: b,
      measuredRatio: di / dout,
      method:
        rpm < 0
          ? 'public runtime.setTransmissionSpeed(-12); studio slider has nonnegative range'
          : 'real studio RPM slider',
    };
  }
  check(
    'Measured actual input/flex/output transforms show negative1:100 in both RPM directions; fixed parts stay fixed',
  );
  await profile(page, 'harmonic');
  await page.getByRole('button', { name: '停止运动', exact: true }).click();
  await page.evaluate(() => window.virtualworld.fitMechanismView('bottom'));
  const screen = await page.evaluate(() => {
    const r = window.virtualworld,
      o = r.objects.get('harmonic-output-flange'),
      p = r.camera.position.clone().set(0.031, 0.0001, 0);
    o.localToWorld(p);
    p.project(r.camera);
    const b = r.renderer.domElement.getBoundingClientRect();
    return { x: b.left + ((p.x + 1) * b.width) / 2, y: b.top + ((1 - p.y) * b.height) / 2 };
  });
  await page.mouse.click(screen.x, screen.y);
  await page.getByRole('textbox', { name: '对象名称', exact: true }).waitFor();
  assert.equal(
    await page.getByRole('textbox', { name: '对象名称', exact: true }).inputValue(),
    'output-flange',
  );
  await page.screenshot({ path: join(output, 'harmonic-section-selected.png') });
  check('Actual canvas ray selection identifies output flange');
  const harmonicExport = await fetch(`${origin}/api/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scene: await page.evaluate(() => window.virtualworld.spec) }),
  });
  assert.equal(harmonicExport.status, 200);
  const harmonicZip = Buffer.from(await harmonicExport.arrayBuffer()),
    harmonicFiles = unzipSync(harmonicZip);
  writeFileSync(join(output, 'harmonic.zip'), harmonicZip);
  const campaign = await (await fetch(`${origin}/api/campaigns/little-prince`)).json();
  assert.equal(campaign.scenes.length, 3);
  for (let i = 0; i < campaign.scenes.length; i++) {
    const scene = campaign.scenes[i];
    await page.goto(`${origin}/?project=${scene.id}&edit=1`);
    await ready(page, scene.id);
    const before = await options(page, '故事章节');
    if (i < 2) assert.equal(before[i + 1].disabled, true);
    await page.getByRole('button', { name: '体验', exact: true }).click();
    await ready(page, scene.id, true);
    await page.waitForFunction(() =>
      window.virtualworld
        .getDiagnostics()
        .hotspots.some((h) => Number.isFinite(h.x) && Number.isFinite(h.y)),
    );
    await movement(page, scene.id);
    await profile(page, scene.id);
    await page.screenshot({ path: join(output, `${scene.id}.png`) });
    await completeChapter(page, true);
    if (i < 2) {
      const after = await options(page, '故事章节');
      assert.equal(after[i + 1].disabled, false);
    }
    await page.getByRole('button', { name: '退出体验', exact: true }).click();
  }
  check('All three chapter assets load; chapter options unlock only after predecessor completion');
  const current = await page.evaluate(() => window.virtualworld.spec),
    revision = current.revision;
  const exported = await fetch(`${origin}/api/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scene: current }),
  });
  assert.equal(exported.status, 200);
  const zip = Buffer.from(await exported.arrayBuffer()),
    files = unzipSync(zip);
  writeFileSync(join(output, 'little-prince.zip'), zip);
  assert.ok(files['campaign.json']);
  const manifest = JSON.parse(new TextDecoder().decode(files['campaign.json']));
  for (const c of manifest.chapters) assert.ok(files[`${c.directory}/scene.json`]);
  assert.equal(
    JSON.parse(new TextDecoder().decode(files[`chapters/${current.id}/scene.json`])).revision,
    revision,
  );
  await context.close();
  await stopApp();
  check('Whole campaign exported and original API process stopped before standalone qualification');
  const mime = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.wasm': 'application/wasm',
    '.glb': 'model/gltf-binary',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
  };
  staticServer = createServer((req, res) => {
    const path =
      decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\//, '') ||
      'index.html';
    const data = path.startsWith('joint/') ? harmonicFiles[path.slice(6)] : files[path];
    res.writeHead(data ? 200 : 404, {
      'content-type': mime[extname(path)] || 'application/octet-stream',
    });
    res.end(data || 'Not found');
  });
  await new Promise((r) => staticServer.listen(0, '127.0.0.1', r));
  const staticOrigin = `http://127.0.0.1:${staticServer.address().port}`;
  const standalone = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  await standalone.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    const parsed = new URL(url);
    if (parsed.origin !== staticOrigin || parsed.pathname.startsWith('/api/')) {
      report.staticRequests.push({ url, blocked: true });
      return route.abort();
    }
    report.staticRequests.push({ url, blocked: false });
    return route.continue();
  });
  const jointPage = await standalone.newPage();
  jointPage.on('pageerror', (e) => report.errors.push(`static joint: ${e.message}`));
  jointPage.on('console', (m) => {
    if (m.type() === 'error') report.errors.push(`static joint: ${m.text()}`);
  });
  await jointPage.goto(`${staticOrigin}/joint/index.html`);
  await ready(jointPage, 'demo-harmonic-joint');
  await jointPage.getByLabel('剖视', { exact: true }).check();
  await jointPage.getByRole('button', { name: '播放机构', exact: true }).click();
  await profile(jointPage, 'full-harmonic');
  await jointPage.screenshot({ path: join(output, 'static-harmonic.png') });
  await jointPage.close();
  page = await standalone.newPage();
  page.on('pageerror', (e) => report.errors.push(`static: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') report.errors.push(`static: ${m.text()}`);
  });
  await page.goto(staticOrigin);
  for (let i = 0; i < manifest.chapters.length; i++) {
    const chapter = manifest.chapters[i];
    await ready(page, chapter.id, true);
    await profile(page, `full-${chapter.id}`);
    const state = await options(page, '选择章节');
    if (i < 2) assert.equal(state[i + 1].disabled, true);
    await page.screenshot({ path: join(output, `static-${chapter.id}.png`) });
    await completeChapter(page, false);
    if (i < 2) {
      assert.equal((await options(page, '选择章节'))[i + 1].disabled, false);
      await page.getByLabel('选择章节', { exact: true }).selectOption(manifest.chapters[i + 1].id);
    }
  }
  await page.reload();
  await ready(page, manifest.chapters[2].id, true);
  assert.equal(
    (await page.evaluate(() => window.virtualworld.getDiagnostics().story)).completed,
    true,
  );
  check(
    'Static campaign loads every chapter offline from API, enforces unlock and resumes validated completion after reload',
  );
  await page.getByRole('button', { name: '重置全部旅程', exact: true }).click();
  await ready(page, manifest.chapters[0].id, true);
  assert.deepEqual(
    (await page.evaluate(() => window.virtualworld.getDiagnostics().story)).flags,
    [],
  );
  assert.equal((await options(page, '选择章节'))[1].disabled, true);
  await page.reload();
  await ready(page, manifest.chapters[0].id, true);
  assert.equal(
    (await page.evaluate(() => window.virtualworld.getDiagnostics().story)).completed,
    false,
  );
  assert.equal(report.staticRequests.filter((r) => r.blocked).length, 0);
  check(
    'Static reset clears every chapter and persists; no API or external network requests occurred',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(output, 'mobile-layout.png') });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    true,
    'Standalone mobile layout must avoid horizontal page overflow',
  );
  check('390px standalone layout checked on desktop Edge; no mobile GPU claim');
  assert.deepEqual(report.errors, []);
  report.functionalPassed = true;
  report.performanceTargetPassed = Object.values(report.profiles).every((p) => p.targetMet);
  assert.ok(
    report.performanceTargetPassed,
    'Measured performance target missed; see profiles (functional checks retained separately)',
  );
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.failure = String(error);
  console.error(error);
  process.exitCode = 1;
  if (page)
    try {
      await page.screenshot({ path: join(output, 'failure.png') });
    } catch {}
} finally {
  report.finishedAt = new Date().toISOString();
  report.appLog = appLog;
  writeFileSync(join(output, 'showcases.json'), JSON.stringify(report, null, 2));
  await browser?.close();
  if (staticServer) {
    staticServer.closeAllConnections();
    await new Promise((r) => staticServer.close(r));
  }
  await stopApp();
  const verified = resolve(dataRoot);
  assert.ok(
    verified.startsWith(resolve(tmpdir()) + sep) &&
      basename(verified).startsWith('virtualworld-showcases-'),
    'Refusing cleanup outside owned temporary fixture directory',
  );
  rmSync(dataRoot, { recursive: true, force: true });
}
