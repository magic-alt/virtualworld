import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { assembleWorld } from '@virtualworld/scene-builder';
import { primitive } from '@virtualworld/engine/geometry';
import { writeEngineExport } from '@virtualworld/scene-builder/engine-export';
import { unityFiles } from '../../generators/scene-builder/src/engine-export/unity';

const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const world = (path: string) =>
  assembleWorld(
    json(`${path}/scene.json`),
    json(`${path}/story.json`),
    json(`${path}/assets.json`),
  );

it('ships a self-contained Unity source package with native import, validation and build entry points', () => {
  const files = unityFiles();
  for (const path of [
    'Runtime/VirtualWorldMetadata.cs',
    'Runtime/VirtualWorldData.cs',
    'Runtime/VirtualWorldCatalog.cs',
    'Runtime/VirtualWorldSceneRuntime.cs',
    'Runtime/VirtualWorldCharacter.cs',
    'Runtime/VirtualWorldAnimator.cs',
    'Runtime/VirtualWorldOrbit.cs',
    'Runtime/VirtualWorldMechanism.cs',
    'Runtime/VirtualWorldProgress.cs',
    'Editor/VirtualWorldImporter.cs',
    'Editor/VirtualWorldValidation.cs',
    'Editor/VirtualWorldFonts.cs',
    'Scripts/prepare-font.mjs',
    'Scripts/NotoSansCJK-OFL.txt',
    'README-Unity.md',
  ]) {
    expect(files[path], path).toBeTypeOf('string');
    expect(files[path].length, path).toBeGreaterThan(100);
  }
  // Runtime scripts must compile in a player, where UnityEditor is unavailable.
  for (const [path, source] of Object.entries(files)) {
    expect(path).not.toMatch(/(^\/|\.\.)/);
    if (path.startsWith('Runtime/')) expect(source, path).not.toMatch(/\bUnityEditor\b/);
  }
  for (const method of ['ImportBatch', 'ValidateBatch', 'BuildBatch'])
    expect(files['Editor/VirtualWorldImporter.cs']).toMatch(
      new RegExp(`public static void ${method}\\(`),
    );
});

it('rejects corrupt offline font input and preserves an existing font installation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'unity-font-'));
  try {
    mkdirSync(join(root, 'Assets'));
    for (const [path, source] of Object.entries(unityFiles())) {
      if (!path.startsWith('Scripts/')) continue;
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), source);
    }
    const source = join(root, 'corrupt.otf');
    writeFileSync(source, 'not the pinned font');
    const helper = await import(
      /* @vite-ignore */ pathToFileURL(join(root, 'Scripts/prepare-font.mjs')).href
    );
    const invoke = () => helper.prepareFont(['--project', root, '--font-source', source]);
    await expect(invoke()).rejects.toThrow(/SHA-256/);
    const destination = join(root, 'Assets/VirtualWorldFonts');
    expect(existsSync(destination)).toBe(false);
    mkdirSync(destination);
    writeFileSync(join(destination, 'keep.txt'), 'existing user font setup');
    await expect(invoke()).rejects.toThrow(/already exists/);
    expect(readFileSync(join(destination, 'keep.txt'), 'utf8')).toBe('existing user font setup');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('packages the authored Prince campaign and real harmonic morph assets with the native player', async () => {
  const campaign = json('worlds/little-prince/campaign.json');
  const scenes = [
    ...campaign.chapters.map((chapter: { directory: string }) =>
      world(`worlds/little-prince/${chapter.directory}`),
    ),
    world('worlds/demo-harmonic-joint'),
  ];
  const files = new Map<string, Uint8Array>();
  await writeEngineExport({
    target: 'unity',
    scenes,
    entrySceneId: scenes[0].id,
    assetBytes: (url) => readFileSync(url.replace(/^\//, '')),
    primitiveFactory: primitive,
    emit: (path, data) => files.set(path, data),
  });
  const manifest = JSON.parse(new TextDecoder().decode(files.get('engine-manifest.json')));
  expect(manifest.scenes.map((scene: { id: string }) => scene.id)).toEqual(scenes.map((s) => s.id));
  for (const [path, source] of Object.entries(unityFiles()))
    expect(new TextDecoder().decode(files.get(path)), path).toBe(source);
  const mechanism = manifest.scenes.find(
    (scene: { id: string }) => scene.id === 'demo-harmonic-joint',
  );
  const flexible = mechanism.nodes.find((node: { id: string }) => node.id === 'harmonic-flex-cup');
  const bytes = Buffer.from(files.get(`models/${flexible.model}.glb`)!);
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  expect(gltf.meshes[0].extras.targetNames).toEqual(['WaveCos', 'WaveSin']);
  expect(gltf.meshes[0].primitives[0].targets).toHaveLength(2);
  expect(JSON.parse(mechanism.metadataJson).mechanism.flexTeeth).toBe(200);
  for (const scene of manifest.scenes.slice(0, 3)) {
    const authored = JSON.parse(scene.metadataJson);
    expect(authored.actor.clips).toEqual({ idle: 'Idle', walk: 'Walk', interact: 'Interact' });
    expect(authored.tasks.length).toBeGreaterThan(0);
    expect(
      authored.nodes.some(
        (node: { interaction?: { completes?: boolean } }) => node.interaction?.completes,
      ),
    ).toBe(true);
  }
}, 60000);
