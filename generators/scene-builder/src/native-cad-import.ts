import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, stat, lstat, rm } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Box3, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { cadToGroup } from '@virtualworld/asset-runtime';
import { emptyScene, node, applyCommands } from '@virtualworld/scene-schema';
import { validateGlb } from './pipeline';
import { proceduralModel } from './engine-export/assets';
import { writeEngineExport } from './engine-export/index';
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export async function importNativeCad(options: { input: string; output: string; catalog: string }) {
  const input = resolve(options.input),
    output = resolve(options.output),
    catalog = resolve(options.catalog);
  const extension = extname(input).toLowerCase();
  if (!['.step', '.stp'].includes(extension)) throw new Error('Choose a STEP or STP file');
  const info = await stat(input);
  if (!info.isFile() || info.size === 0 || info.size > 100 * 1024 * 1024)
    throw new Error('STEP must be a nonempty file, at most 100 MiB');
  try {
    await lstat(output);
    throw new Error('Import output already exists');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const previousBytes = await readFile(join(catalog, 'engine-manifest.json'));
  const previous = JSON.parse(previousBytes.toString());
  if (
    previous.version !== 1 ||
    previous.target !== 'unreal' ||
    !Array.isArray(previous.scenes) ||
    !Array.isArray(previous.assets)
  )
    throw new Error('Invalid existing Unreal catalog');
  const sourceBytes = await readFile(input);
  const sourceHash = sha(sourceBytes);
  const require = createRequire(import.meta.url);
  const bundled = join(dirname(fileURLToPath(import.meta.url)), 'occt-import-js.cjs');
  const factory = require(existsSync(bundled) ? bundled : 'occt-import-js');
  const occt = await factory({ print: () => {}, printErr: () => {} });
  const result = occt.ReadStepFile(sourceBytes, {
    linearUnit: 'meter',
    linearDeflectionType: 'bounding_box_ratio',
    linearDeflection: 0.002,
    angularDeflection: 0.3,
  });
  const group = cadToGroup(result);
  const glb = await proceduralModel(group);
  const validation = await validateGlb(glb);
  // Reload the actual serialized GLB, rather than trusting the CAD parser's success flag.
  const final = (await new GLTFLoader().parseAsync(Uint8Array.from(glb).buffer, '')).scene;
  const bounds = new Box3().setFromObject(final);
  const size = bounds.getSize(new Vector3());
  const center = bounds.getCenter(new Vector3());
  let meshes = 0;
  final.traverse((o) => {
    if (o.type === 'Mesh') meshes++;
  });
  if (
    bounds.isEmpty() ||
    !meshes ||
    ![...size.toArray(), ...center.toArray()].every(Number.isFinite) ||
    size.length() <= 0
  )
    throw new Error('STEP contains no finite visible geometry');
  const modelId = sha(glb);
  // Identical reimports are separate inspections; canonical asset bytes remain hash addressed.
  const sceneId = `cad-${sourceHash.slice(0, 16)}-${createHash('sha256').update(output).digest('hex').slice(0, 8)}`;
  const name = basename(input).slice(0, 200);
  const assetId = `a-${modelId.slice(0, 20)}`;
  const radius = Math.max(size.length() * 0.5, 0.0001);
  const offset = new Vector3(1, 0.7, 1)
    .normalize()
    .multiplyScalar((radius / Math.sin((25 * Math.PI) / 180)) * 1.25);
  const scene = applyCommands({ ...emptyScene(), id: sceneId }, 0, [
    { type: 'renameProject', name },
    { type: 'setEnvironment', patch: { lightIntensity: 1.8, ambientIntensity: 0.6 } },
    {
      type: 'configureScene',
      patch: {
        camera: { target: center.toArray(), position: center.clone().add(offset).toArray() },
        description: 'Local STEP inspection; static mesh, engineering parameters unconfirmed.',
      },
    },
    {
      type: 'addAsset',
      asset: {
        id: assetId,
        name,
        type: 'glb',
        url: `/assets/optimized/uploads/${modelId}.glb`,
        bytes: glb.length,
        source: `${name} · STEP → Mesh · metres`,
      },
    },
    {
      type: 'addNode',
      node: node('cad-model', name, 'glb', [0, 0, 0], [1, 1, 1], '#ffffff', {
        assetId,
        materialOverride: false,
      }),
    },
  ]);
  const files = new Map<string, Uint8Array>();
  await writeEngineExport({
    target: 'unreal',
    scenes: [scene],
    entrySceneId: scene.id,
    dataOnly: true,
    assetBytes: () => glb,
    primitiveFactory: () => {
      throw new Error('CAD has no procedural primitives');
    },
    emit: (p, b) => files.set(p, b),
  });
  const manifestPath = 'Content/VirtualWorldData/engine-manifest.json';
  const imported = JSON.parse(new TextDecoder().decode(files.get(manifestPath)!));
  const combined = {
    ...previous,
    entrySceneId: scene.id,
    scenes: [...previous.scenes, ...imported.scenes],
    assets: [
      ...previous.assets,
      ...imported.assets.filter(
        (a: { id: string }) => !previous.assets.some((b: { id: string }) => a.id === b.id),
      ),
    ],
    compatibility: [...(previous.compatibility ?? []), ...imported.compatibility],
  };
  await mkdir(output); // Reserve exclusively; never remove someone else's directory on failure.
  try {
    const dataDirectory = join(output, 'Content/VirtualWorldData');
    await mkdir(join(dataDirectory, 'models'), { recursive: true });
    for (const asset of previous.assets) {
      if (
        !/^[a-f0-9]{64}$/.test(asset.id) ||
        asset.sha256 !== asset.id ||
        asset.path !== `models/${asset.id}.glb`
      )
        throw new Error('Unsafe existing canonical model');
      const bytes = await readFile(join(catalog, asset.path));
      if (bytes.length !== asset.bytes || sha(bytes) !== asset.sha256)
        throw new Error('Existing canonical model hash mismatch');
      await writeFile(join(dataDirectory, asset.path), bytes);
    }
    for (const [path, bytes] of files) {
      await mkdir(dirname(join(output, path)), { recursive: true });
      await writeFile(join(output, path), bytes);
    }
    const source = `source/${sourceHash}${extension}`;
    await mkdir(join(output, 'source'));
    await writeFile(join(output, source), sourceBytes);
    await mkdir(join(output, 'optimized'));
    await writeFile(join(output, 'optimized', `${modelId}.glb`), glb);
    await mkdir(join(output, 'manifests'));
    await writeFile(join(output, 'scene.json'), JSON.stringify(scene, null, 2) + '\n');
    await writeFile(
      join(output, 'manifests/import.json'),
      JSON.stringify(
        {
          version: 1,
          name,
          source,
          sourceSha256: sourceHash,
          output: `optimized/${modelId}.glb`,
          outputSha256: modelId,
          coordinates: { units: 'metres', up: 'Y' },
          meshes,
          size: size.toArray(),
          tools: { occt: '0.0.23' },
          validation,
        },
        null,
        2,
      ) + '\n',
    );
    await writeFile(join(output, manifestPath), JSON.stringify(combined, null, 2) + '\n');
    return { sceneId, modelId, dataDirectory, size: size.toArray(), source };
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw error;
  }
}
