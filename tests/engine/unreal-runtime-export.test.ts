import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import { assembleWorld } from '@virtualworld/scene-builder';
import { primitive } from '@virtualworld/engine/geometry';
import { writeEngineExport } from '@virtualworld/scene-builder/engine-export';
import { unrealFiles } from '../../generators/scene-builder/src/engine-export/unreal';

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function project() {
  const root = await mkdtemp(join(tmpdir(), 'virtualworld-unreal-'));
  temporary.push(root);
  for (const [path, source] of Object.entries(unrealFiles())) {
    expect(path).not.toMatch(/(^\/|\\|(^|\/)\.\.($|\/))/);
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), source);
  }
  const json = Buffer.from(
    JSON.stringify({ asset: { version: '2.0' }, scenes: [{ nodes: [] }] }).padEnd(80, ' '),
  );
  const glb = Buffer.alloc(20 + json.length);
  glb.writeUInt32LE(0x46546c67, 0);
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(json.length, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  json.copy(glb, 20);
  const id = createHash('sha256').update(glb).digest('hex');
  const data = join(root, 'Content/VirtualWorldData');
  await mkdir(join(data, 'models'), { recursive: true });
  await writeFile(join(data, `models/${id}.glb`), glb);
  const manifest = {
    version: 1,
    target: 'unreal',
    entrySceneId: 'test-scene',
    coordinates: { handedness: 'right', up: 'Y', units: 'metres', quaternion: 'xyzw' },
    assets: [{ id, sha256: id, bytes: glb.length, path: `models/${id}.glb` }],
    scenes: [
      {
        id: 'test-scene',
        name: 'Test',
        nodes: [],
        metadataJson: JSON.stringify({ id: 'test-scene', nodes: [] }),
      },
    ],
  };
  await writeFile(join(data, 'engine-manifest.json'), JSON.stringify(manifest));
  const native = await import(
    /* @vite-ignore */ pathToFileURL(join(root, 'Scripts/native.mjs')).href
  );
  const plugin = await import(
    /* @vite-ignore */ pathToFileURL(join(root, 'Scripts/prepare-plugin.mjs')).href
  );
  const run = (...args: string[]) => native.nativeCommand(args, root);
  return { root, data, id, manifest, run, install: () => plugin.installPlugin(root) };
}

it('generates an Unreal C++ project whose build and package configuration resolves its runtime files', async () => {
  const { root } = await project();
  const uproject = JSON.parse(await readFile(join(root, 'VirtualWorld.uproject'), 'utf8'));
  expect(uproject.Modules).toEqual([
    { Name: 'VirtualWorld', Type: 'Runtime', LoadingPhase: 'Default' },
  ]);
  expect(uproject.Plugins).toContainEqual({ Name: 'glTFRuntime', Enabled: true });
  for (const file of [
    'Source/VirtualWorld.Target.cs',
    'Source/VirtualWorldEditor.Target.cs',
    'Source/VirtualWorld/VirtualWorld.Build.cs',
    'Source/VirtualWorld/Private/VirtualWorldRuntime.cpp',
    'Source/VirtualWorld/Private/VirtualWorldRuntimeTests.cpp',
    'Scripts/prepare-plugin.mjs',
  ])
    expect((await readFile(join(root, file))).length, file).toBeGreaterThan(80);
  const config = await readFile(join(root, 'Config/DefaultGame.ini'), 'utf8');
  expect(config).toContain('DirectoriesToAlwaysStageAsNonUFS=(Path="VirtualWorldData")');
  expect(config).toContain('DirectoriesToAlwaysCook=(Path="/glTFRuntime")');
});

it('executes exported preflight against canonical bytes and refuses changed assets or escaping paths', async () => {
  const { data, id, manifest, run } = await project();
  const valid = run('check', '--data-only');
  expect(valid).toMatchObject({ kind: 'data-preflight', nativeExecution: false, scenes: 1 });
  await writeFile(join(data, `models/${id}.glb`), 'changed');
  expect(() => run('check', '--data-only')).toThrow(/length|hash/i);
  manifest.assets[0].path = '../outside.glb';
  await writeFile(join(data, 'engine-manifest.json'), JSON.stringify(manifest));
  expect(() => run('check', '--data-only')).toThrow(/canonical.*path/i);
});

it('refuses an actor without its whole-GLB binding before launching an engine', async () => {
  const { data, manifest, run } = await project();
  manifest.scenes[0].metadataJson = JSON.stringify({
    id: 'test-scene',
    nodes: [],
    actor: { assetId: 'prince', clips: { idle: 'Idle', walk: 'Walk', interact: 'Interact' } },
  });
  await writeFile(join(data, 'engine-manifest.json'), JSON.stringify(manifest));
  expect(() => run('check', '--data-only')).toThrow(/actorModel/);
});

it('does not overwrite a plugin directory or manufacture native smoke evidence when prerequisites are absent', async () => {
  const { root, run, install } = await project();
  const plugin = join(root, 'Plugins/glTFRuntime');
  await mkdir(plugin, { recursive: true });
  await writeFile(join(plugin, 'keep.txt'), 'keep');
  expect(() => install()).toThrow(/exists|occupied/i);
  expect(await readFile(join(plugin, 'keep.txt'), 'utf8')).toBe('keep');
  expect(() => run('smoke', '--engine', join(root, 'missing-engine'))).toThrow();
  await expect(readFile(join(root, 'Saved/VirtualWorld/smoke-report.json'))).rejects.toThrow();
});

it('runs the generated checker over real Prince campaign and harmonic exports, including named morph bindings', async () => {
  const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
  const world = (path: string) =>
    assembleWorld(
      json(`${path}/scene.json`),
      json(`${path}/story.json`),
      json(`${path}/assets.json`),
    );
  const campaign = json('worlds/little-prince/campaign.json');
  const chapters = campaign.chapters.map((chapter: { directory: string }) =>
    world(`worlds/little-prince/${chapter.directory}`),
  );
  for (const scenes of [chapters, [world('worlds/demo-harmonic-joint')]]) {
    const { root, data, run } = await project();
    const emitted = new Map<string, Uint8Array>();
    await writeEngineExport({
      target: 'unreal',
      scenes,
      entrySceneId: scenes[scenes.length - 1].id,
      ...(scenes.length === 3 ? { campaign } : {}),
      assetBytes: (url) => readFileSync(url.replace(/^\//, '')),
      primitiveFactory: primitive,
      emit: (path, bytes) => {
        emitted.set(path, bytes);
      },
    });
    for (const [path, bytes] of emitted) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), bytes);
    }
    expect(run('check', '--data-only')).toMatchObject({
      scenes: scenes.length,
      sceneId: scenes[scenes.length - 1].id,
      nativeExecution: false,
    });
    const manifest = JSON.parse(await readFile(join(data, 'engine-manifest.json'), 'utf8'));
    if (scenes.length === 1) {
      const metadata = JSON.parse(manifest.scenes[0].metadataJson);
      metadata.mechanism.cosMorph = 'MissingWave';
      manifest.scenes[0].metadataJson = JSON.stringify(metadata);
      await writeFile(join(data, 'engine-manifest.json'), JSON.stringify(manifest));
      expect(() => run('check', '--data-only')).toThrow(/named signed morph/);
    } else {
      expect(
        manifest.scenes.every((scene: { actorModel: string }) =>
          /^[a-f0-9]{64}$/.test(scene.actorModel),
        ),
      ).toBe(true);
    }
  }
}, 60000);
