import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { Group, Mesh, SphereGeometry, MeshStandardMaterial, CylinderGeometry } from 'three';
import { emptyScene, node } from '@virtualworld/scene-schema';
import { DEMO_JOINT_DYNAMICS } from '@virtualworld/engine/joint-dynamics';
import { inspectCadGlb, prepareRealJoint } from '@virtualworld/scene-builder/real-joint';
import { proceduralModel } from '../../generators/scene-builder/src/engine-export/assets.ts';
const output = resolve('output/playwright/cad-joint');
await mkdir(output, { recursive: true });
const group = new Group();
const material = new MeshStandardMaterial({ color: '#cccccc' });
const shaft = new Mesh(new CylinderGeometry(0.006, 0.006, 0.04, 16), material);
shaft.rotation.x = Math.PI / 2;
shaft.position.z = 0.02;
shaft.name = 'shaft';
group.add(shaft);
for (const x of [-0.013, 0.013]) {
  const ball = new Mesh(new SphereGeometry(0.002, 16, 12), material);
  ball.geometry.translate(x, 0, 0.022);
  ball.name = 'same';
  group.add(ball);
}
const bytes = await proceduralModel(group),
  inventory = await inspectCadGlb(bytes),
  hash = createHash('sha256').update(bytes).digest('hex');
const scene = emptyScene();
scene.camera = { position: [0.12, 0.1, 0.12], target: [0, 0.02, 0] };
scene.assets.push({
  id: 'cad',
  name: 'CAD fixture',
  type: 'glb',
  url: '/assets/optimized/cad.glb',
  bytes: bytes.length,
});
scene.nodes.push(
  node('cad', 'CAD', 'glb', [0, 0, 0], [1, 1, 1], '#ffffff', {
    assetId: 'cad',
    materialOverride: false,
    rotation: [-Math.PI / 2, 0, 0],
  }),
);
const config = {
  kind: 'cad-joint',
  modelNodeId: 'cad',
  sourceSha256: 'a'.repeat(64),
  modelSha256: hash,
  dynamics: DEMO_JOINT_DYNAMICS,
  gear: { status: 'unresolved', notes: 'Fixture has no teeth' },
  bindings: inventory.meshes.map((m, i) => ({
    gltfNodeIndex: m.gltfNodeIndex,
    originalPath: m.path,
    role: i === 0 ? 'input' : 'ball',
    pivot: [0, 0, 0.022],
    axis: [0, 0, 1],
    ...(i ? { center: m.sphere.center, bearingId: 'b' } : {}),
  })),
  bearings: [
    { id: 'b', innerSpeedFactor: 1, outerSpeedFactor: 0, pitchRadius: 0.013, ballRadius: 0.002 },
  ],
  fixedNodeIds: [],
  fullHousingIds: [],
  sectionHousingIds: [],
  dimensions: { baseDiameter: 0.08, housingDiameter: 0.08, totalHeight: 0.1, boreDiameter: 0.01 },
  principle: {
    kind: 'illustrative-harmonic',
    flexTeeth: 60,
    ringTeeth: 62,
    radius: 0.025,
    amplitude: 0.001,
    toothHeight: 0.0002,
    clearance: 0.00005,
    position: [0.08, 0.02, 0],
    label: 'PRINCIPLE ONLY: assumed 60/62',
  },
};
const prepared = await prepareRealJoint(scene, bytes, config);
const code = `import{StudioRuntime}from'./packages/engine/src/runtime.ts';import{mountMechanismControls}from'./apps/web/shared/mechanism-controls.ts';const scene=await(await fetch('/scene.json')).json();const r=new StudioRuntime(document.querySelector('#view'),scene);window.virtualworld=r;await r.ready;const panel=mountMechanismControls(r);document.body.append(panel.element);window.ready=true;`;
const bundled = await build({
  stdin: { contents: code, resolveDir: process.cwd(), sourcefile: 'cad-fixture.ts' },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  write: false,
  outfile: 'main.js',
  loader: { '.css': 'css' },
  logLevel: 'silent',
});
const resources = new Map(
  bundled.outputFiles.map((f) => ['/' + f.path.split('/').at(-1), Buffer.from(f.contents)]),
);
resources.set('/scene.json', Buffer.from(JSON.stringify(prepared.scene)));
resources.set('/assets/optimized/cad.glb', Buffer.from(bytes));
resources.set(
  '/',
  Buffer.from(
    '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/main.css"><style>body{margin:0;background:#101722;color:white}#view{position:fixed;inset:0}</style></head><body><div id="view"></div><script type="module" src="/main.js"></script></body></html>',
  ),
);
const server = createServer((req, res) => {
  const b = resources.get(req.url);
  if (!b) {
    res.writeHead(404).end();
    return;
  }
  res.setHeader(
    'content-type',
    req.url.endsWith('.js')
      ? 'text/javascript'
      : req.url.endsWith('.css')
        ? 'text/css'
        : req.url.endsWith('.json')
          ? 'application/json'
          : req.url.endsWith('.glb')
            ? 'model/gltf-binary'
            : 'text/html',
  );
  res.end(b);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.route('**/*', (route) =>
    route.request().url().startsWith(origin) ? route.continue() : route.abort(),
  );
  await page.goto(origin);
  await page.waitForFunction(() => window.ready, { timeout: 30000 });
  assert.deepEqual(await page.evaluate(() => window.virtualworld.getDiagnostics().errors), []);
  await page.getByRole('button', { name: '播放机构', exact: true }).click();
  await page.waitForFunction(() => window.virtualworld.getMechanismState().actualInputRpm > 5.9);
  await page.getByLabel('显示滚动标记', { exact: true }).check();
  await page.getByLabel('独立原理层（演示假设）', { exact: true }).check();
  await page.getByLabel('抱闸线圈掉电', { exact: true }).check();
  await page.waitForFunction(
    () => window.virtualworld.getMechanismState().dynamics.brakePhase === 'holding',
  );
  let state = await page.evaluate(() => window.virtualworld.getMechanismState());
  assert.equal(state.actualInputRpm, 0);
  assert.ok(state.dynamics.dissipatedEnergy > 0);
  assert.equal(state.ratioKnown, false);
  await page.getByLabel('抱闸线圈掉电', { exact: true }).uncheck();
  await page.waitForFunction(
    () => window.virtualworld.getMechanismState().dynamics.brakePhase === 'released',
  );
  assert.equal((await page.evaluate(() => window.virtualworld.getMechanismState())).moving, false);
  await page.getByLabel('仿真时间倍率').selectOption('0.02');
  await page.getByRole('button', { name: '播放机构', exact: true }).click();
  await page.waitForFunction(() => window.virtualworld.getMechanismState().actualInputRpm > 1);
  await page.evaluate(() => window.virtualworld.setPaused(true));
  const before = await page.evaluate(() => window.virtualworld.getMechanismState().dynamics.time);
  await page.waitForTimeout(250);
  assert.equal(
    await page.evaluate(() => window.virtualworld.getMechanismState().dynamics.time),
    before,
  );
  await page.getByRole('button', { name: '运动归零', exact: true }).click();
  assert.equal(await page.getByLabel('仿真时间倍率').inputValue(), '1');
  assert.equal(await page.evaluate(() => window.virtualworld.getMechanismState().timeScale), 1);
  await page.getByLabel('仿真时间倍率').selectOption('0.02');
  assert.equal(await page.evaluate(() => window.virtualworld.getMechanismState().timeScale), 0.02);
  await page.screenshot({ path: output + '/principle-and-rolling.png' });
  assert.deepEqual(errors, []);
  await writeFile(
    output + '/result.json',
    JSON.stringify(
      {
        passed: true,
        fixtureOnly: true,
        externalNetworkBlocked: true,
        checks: [
          'realGLBhash-and-node-bindings',
          'sharedControls',
          'rollingMarkers',
          'separatePrincipleLayer',
          'finiteBraking',
          'releaseInterlock',
          'slowMotion',
          'pause',
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS CAD fixture browser controls, motion, markers, principle, finite brake, release, slow motion and pause; external network blocked',
  );
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
