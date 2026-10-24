// Opt-in real-engine check. Requires an already compiled native export and a rendering-capable desktop.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, stat, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const option = (n) => process.argv[process.argv.indexOf(n) + 1];
assert(
  process.argv.includes('--engine') && process.argv.includes('--project'),
  'Required: --engine UE_ROOT --project PROJECT',
);
const project = resolve(option('--project')),
  engine = resolve(option('--engine'));
assert.equal(
  process.platform,
  'darwin',
  'This acceptance harness currently targets the tested macOS desktop',
);
const executable = join(engine, 'Engine/Binaries/Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor');
const temporary = await mkdtemp(join(tmpdir(), 'vw-native-cad-'));
const cube = join(temporary, '外部 10mm.STP');
await cp('public/fixtures/cube-mm.step', cube);
const invalid = join(temporary, 'invalid.step');
await writeFile(invalid, 'ISO-10303-21; invalid CAD');
const output = resolve('output/playwright/native-cad');
await mkdir(output, { recursive: true });
const results = [];
for (const [input, success] of [
  [cube, true],
  [invalid, false],
]) {
  const reportPath = join(project, 'Saved/VirtualWorld/import-report.json');
  const before = await stat(reportPath)
    .then((s) => s.mtimeMs)
    .catch(() => 0);
  const child = spawn(
    executable,
    [
      join(project, 'VirtualWorld.uproject'),
      '/Engine/Maps/Entry',
      '-game',
      '-unattended',
      '-nosound',
      `-VirtualWorldImport=${input}`,
    ],
    {
      cwd: project,
      env: { ...process.env, VW_NODE_EXECUTABLE: process.execPath },
      stdio: 'ignore',
    },
  );
  let exited = false;
  child.on('exit', () => (exited = true));
  try {
    let report;
    for (let i = 0; i < 180; i++) {
      const changed = await stat(reportPath)
        .then((s) => s.mtimeMs > before)
        .catch(() => false);
      if (changed) {
        report = JSON.parse(await readFile(reportPath, 'utf8'));
        break;
      }
      if (exited) throw new Error('UE exited without a new CAD report');
      await new Promise((r) => setTimeout(r, 1000));
    }
    assert(report, 'No fresh native CAD report');
    assert.equal(report.success, success);
    if (success) {
      assert(report.sceneId.startsWith('cad-'));
      assert(report.staticMeshes > 0);
      for (const size of report.boundsCentimetres)
        assert(Math.abs(size - 1) < 0.001, `10mm cube has wrong native size: ${size} cm`);
    } else
      assert.equal(
        report.sceneId,
        'demo-harmonic-joint',
        'Failed conversion replaced active scene',
      );
    results.push(report);
  } finally {
    child.kill('SIGTERM');
    if (!exited) await new Promise((r) => child.once('exit', r));
  }
}
// Delay only the test subprocess's Node startup so shutdown happens while real CAD work is pending.
const delay = join(temporary, 'delay.cjs');
await writeFile(delay, 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10000);');
const reportPath = join(project, 'Saved/VirtualWorld/import-report.json');
const before = (await stat(reportPath)).mtimeMs;
const quitting = spawn(
  executable,
  [
    join(project, 'VirtualWorld.uproject'),
    '/Engine/Maps/Entry',
    '-game',
    '-unattended',
    '-nosound',
    `-VirtualWorldImport=${cube}`,
    '-ExecCmds=Quit',
  ],
  {
    cwd: project,
    env: {
      ...process.env,
      VW_NODE_EXECUTABLE: process.execPath,
      NODE_OPTIONS: `--require=${delay}`,
    },
    stdio: 'ignore',
  },
);
await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    quitting.kill('SIGTERM');
    reject(new Error('UE shutdown timeout'));
  }, 60000);
  quitting.once('exit', () => {
    clearTimeout(timeout);
    resolve();
  });
});
assert((await stat(reportPath)).mtimeMs > before, 'Shutdown did not produce a fresh import result');
const cancelled = JSON.parse(await readFile(reportPath, 'utf8'));
assert.equal(cancelled.success, false);
assert.match(cancelled.message, /player closed/);
assert.equal(cancelled.sceneId, 'demo-harmonic-joint');
results.push(cancelled);
await writeFile(
  join(output, 'report.json'),
  JSON.stringify(
    {
      nativeExecution: true,
      checks: [
        'real 10mm STEP/STP geometry in native centimetres',
        'Unicode and space path',
        'invalid CAD preserves H-100',
        'shutdown cancels pending local conversion',
      ],
      results,
    },
    null,
    2,
  ),
);
console.log(
  'PASS real UE CAD geometry, units, Unicode/space paths and invalid-file scene preservation',
);
