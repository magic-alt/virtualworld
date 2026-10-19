/** Real Godot verification. Usage: node --import tsx scripts/verify-godot-export.ts /path/to/godot */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { unzipSync } from 'fflate';
import { emptyScene, node, type SceneNode } from '@virtualworld/scene-schema';
import { createExport } from '../apps/web/server/export';

const binary = process.argv[2] || process.env.GODOT_BINARY;
if (!binary) throw new Error('Pass the real Godot executable path or GODOT_BINARY');
const directory = await mkdtemp(join(tmpdir(), 'vw-native-godot-'));
const scene = emptyScene('world');
scene.id = 'native-asymmetric';
const fixtureNode = (id: string, kind: SceneNode['kind'], extra: Partial<SceneNode>) =>
  node(id, id, 'box', [0, 0, 0], [1, 1, 1], '#abcdef', { kind, ...extra });
scene.nodes = [
  fixtureNode('parent', 'group', {
    position: [10, 2, -3],
    rotation: [0, 0, Math.PI / 2],
    scale: [2, 3, 4],
  }),
  fixtureNode('asymmetric', 'mesh', {
    parentId: 'parent',
    shape: 'box',
    size: [2, 4, 6],
    position: [1, 2, 3],
    rotation: [0, 0, Math.PI / 2],
    joint: { axis: 'x', value: Math.PI / 2, min: 0, max: Math.PI, confirmed: true },
  }),
  fixtureNode('uniform', 'group', { position: [-20, 0, 0], scale: [2, 2, 2] }),
  fixtureNode('box', 'mesh', {
    parentId: 'uniform',
    shape: 'box',
    size: [2, 4, 6],
    collider: { shape: 'box', size: [2, 4, 6] },
  }),
  fixtureNode('ball', 'mesh', {
    parentId: 'uniform',
    shape: 'sphere',
    position: [5, 0, 0],
    collider: { shape: 'ball', size: [1.5, 8, 9] },
  }),
  fixtureNode('mesh', 'mesh', {
    parentId: 'uniform',
    shape: 'box',
    position: [0, 6, 0],
    collider: { shape: 'mesh', size: [1, 1, 1] },
  }),
  fixtureNode('hidden', 'group', { visible: false }),
  fixtureNode('hidden-child', 'mesh', {
    parentId: 'hidden',
    shape: 'box',
    collider: { shape: 'box', size: [2, 3, 4] },
  }),
];
type Row = {
  id?: string;
  path: string;
  type: string;
  globalTransform: number[][];
  boundsCorners?: number[][];
  shape?: string;
  size?: number[];
  radius?: number;
  faceCount?: number;
  visible?: boolean;
  background?: string;
  ambientEnergy?: number;
};
const close = (actual: number[], expected: number[]) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, i) =>
    assert.ok(Math.abs(value - expected[i]) < 0.0001, `${actual} != ${expected}`),
  );
};
function verify(rows: Row[]) {
  const wrapper = rows.find((row) => row.id === 'asymmetric');
  assert.ok(wrapper, 'stable wrapper exists');
  [
    [0, 0, 4],
    [0, -2, 0],
    [3, 0, 0],
    [4, 4, 9],
  ].forEach((column, i) => close(wrapper.globalTransform[i], column));
  const mesh = rows.find((row) => row.path.startsWith(wrapper.path + '/') && row.boundsCorners);
  assert.ok(mesh?.boundsCorners);
  close(
    [0, 1, 2].map((axis) => Math.min(...mesh.boundsCorners!.map((v) => v[axis]))),
    [-5, 0, 5],
  );
  close(
    [0, 1, 2].map((axis) => Math.max(...mesh.boundsCorners!.map((v) => v[axis]))),
    [13, 8, 13],
  );
  const box = rows.find((row) => row.path.includes('/box/') && row.shape === 'BoxShape3D');
  assert.ok(box?.size);
  close(box.size, [2, 4, 6]);
  close(box.globalTransform[0], [2, 0, 0]);
  close(box.globalTransform[1], [0, 2, 0]);
  close(box.globalTransform[2], [0, 0, 2]);
  const ball = rows.find((row) => row.path.includes('/ball/') && row.shape === 'SphereShape3D');
  assert.ok(ball);
  assert.equal(ball.radius, 1.5);
  close(ball.globalTransform[0], [2, 0, 0]);
  assert.ok(
    rows.some(
      (row) =>
        row.path.includes('/mesh/') &&
        row.shape === 'ConcavePolygonShape3D' &&
        row.faceCount === 12,
    ),
  );
  const hidden = rows.find((row) => row.id === 'hidden-child');
  assert.ok(hidden);
  assert.ok(
    !rows.some((row) => row.path.startsWith(hidden.path + '/') && row.shape),
    'hidden ancestor removes collision',
  );
  const hiddenMeshes = rows.filter(
    (row) => row.path.startsWith(hidden.path + '/') && row.boundsCorners,
  );
  assert.ok(hiddenMeshes.length > 0);
  assert.ok(hiddenMeshes.every((row) => row.visible === false));
  assert.ok(rows.some((row) => row.type === 'Camera3D'));
  const environment = rows.find((row) => row.type === 'WorldEnvironment');
  assert.equal(environment?.background, '101722ff');
  assert.equal(environment?.ambientEnergy, 1.5);
}
function invoke(args: string[]) {
  const result = spawnSync(binary!, ['--headless', '--path', directory, ...args], {
    encoding: 'utf8',
    timeout: 60000,
    env: {
      ...process.env,
      GODOT_SILENCE_ROOT_WARNING: '1',
      XDG_DATA_HOME: join(directory, '.userdata'),
      XDG_CONFIG_HOME: join(directory, '.config'),
      XDG_CACHE_HOME: join(directory, '.cache'),
    },
  });
  const output = result.stdout + result.stderr;
  process.stdout.write(output);
  assert.ifError(result.error);
  assert.equal(result.status, 0, 'Godot process exit');
  assert.ok(
    !/(?:SCRIPT ERROR|Parse Error|^ERROR:)/m.test(output),
    'Godot must have no parse/runtime errors even with exit 0',
  );
  return output;
}
function run(script: string, args: string[] = []) {
  const output = invoke(['--script', script, '--', ...args]);
  const report = output
    .split('\n')
    .find(
      (line) => line.startsWith('{"engine":') || (line.startsWith('{') && line.includes('"nodes"')),
    );
  assert.ok(report, 'real native inspection JSON');
  const parsed = JSON.parse(report);
  assert.equal(parsed.engine.major, 4);
  assert.equal(parsed.engine.minor, 5);
  assert.equal(parsed.engine.patch, 1);
  assert.equal(parsed.sceneId, scene.id);
  verify(parsed.nodes);
  return parsed;
}
try {
  await mkdir(join(directory, 'public'));
  const files = unzipSync(
    await createExport(scene, {
      target: 'godot',
      playerRoot: join(directory, 'missing-player'),
      assetRoot: join(directory, 'assets'),
      publicRoot: join(directory, 'public'),
    }),
  );
  for (const [path, bytes] of Object.entries(files)) {
    await mkdir(join(directory, path, '..'), { recursive: true });
    await writeFile(join(directory, path), bytes);
  }
  invoke(['--quit-after', '2']);
  const live = run('inspect.gd', [scene.id, 'res://editable.tscn']);
  const reload = (await readFile(join(directory, 'inspect.gd'), 'utf8')).replace(
    'var world = importer.build_scene(scene_id)',
    'var world = load("res://editable.tscn").instantiate()',
  );
  await writeFile(join(directory, 'reload.gd'), reload);
  const saved = run('reload.gd');
  assert.equal(saved.nodes.length, live.nodes.length, 'PackedScene retains descendants and owners');
  console.log(
    `PASS Godot ${live.engine.string}: independent asymmetric matrices/bounds, box/ball/mesh collision, inherited visibility, camera/environment, editable PackedScene reload (${live.nodes.length} native nodes)`,
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
