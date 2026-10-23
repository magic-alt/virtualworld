import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat, access } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { Box3, Vector3 } from 'three';
import { NodeIO } from '@gltf-transform/core';
import { cadToGroup, type CadResult } from '@virtualworld/asset-runtime';
import { applyCommands, emptyScene, node } from '@virtualworld/scene-schema';
import { proceduralModel } from './engine-export/assets';
import { nativeNode } from './engine-export/manifest';

const require = createRequire(import.meta.url);
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** A fresh, self-contained import. The manifest is written last as the completion marker. */
export async function convertStep(sourcePath: string, outputDirectory: string): Promise<void> {
  try {
    await access(outputDirectory);
    throw new Error('Import output already exists');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (!['.stp', '.step'].includes(extname(sourcePath).toLowerCase()))
    throw new Error('Select a STEP/STP file');
  const size = (await stat(sourcePath)).size;
  if (!size || size > 100 * 1024 * 1024) throw new Error('STEP file is empty or exceeds 100 MiB');
  const source = await readFile(sourcePath);
  if (source.length !== size) throw new Error('STEP source changed while reading');
  const occt = await require('occt-import-js')({ print: () => {}, printErr: () => {} });
  const result: CadResult = occt.ReadStepFile(source, {
    linearUnit: 'meter',
    linearDeflectionType: 'bounding_box_ratio',
    linearDeflection: 0.002,
    angularDeflection: 0.3,
  });
  if (!result.success || !result.meshes?.length) throw new Error('STEP has no visible geometry');
  let vertices = 0,
    indices = 0;
  for (const mesh of result.meshes) {
    const p = mesh.attributes.position.array,
      ix = mesh.index.array;
    vertices += p.length / 3;
    indices += ix.length;
    if (
      !p.length ||
      p.length % 3 ||
      !ix.length ||
      ix.length % 3 ||
      p.some((v) => !Number.isFinite(v)) ||
      ix.some((i) => !Number.isInteger(i) || i < 0 || i >= p.length / 3)
    )
      throw new Error('STEP contains invalid geometry');
  }
  if (vertices > 2_000_000 || indices > 6_000_000 || result.meshes.length > 5000)
    throw new Error('STEP geometry exceeds supported complexity');
  const group = cadToGroup(result);
  const bounds = new Box3().setFromObject(group),
    extent = bounds.getSize(new Vector3()).length();
  if (bounds.isEmpty() || !Number.isFinite(extent) || extent < 1e-8 || extent > 10000)
    throw new Error('STEP has unusable physical bounds');
  const bytes = await proceduralModel(group);
  if (bytes.length > 256 * 1024 * 1024) throw new Error('Converted GLB exceeds 256 MiB');
  const validator = require('gltf-validator');
  const validation = await validator.validateBytes(bytes, {
    format: 'glb',
    maxIssues: 100,
    writeTimestamp: false,
  });
  if (validation.issues.numErrors) throw new Error('STEP GLB validation failed');
  // Bind the whole final GLB; its hierarchy stays intact and native framing uses its actual meshes.
  const doc = await new NodeIO().readBinary(bytes);
  if (!doc.getRoot().listScenes()[0] || !doc.getRoot().listMeshes().length)
    throw new Error('STEP GLB has no scene geometry');
  const hash = digest(bytes),
    sourceHash = digest(source),
    name = basename(sourcePath).slice(0, 200);
  const scene = applyCommands({ ...emptyScene(), id: `step-${sourceHash.slice(0, 20)}` }, 0, [
    { type: 'renameProject', name },
    {
      type: 'addAsset',
      asset: {
        id: `a-${hash.slice(0, 20)}`,
        name,
        type: 'glb',
        url: `assets/${hash}.glb`,
        bytes: bytes.length,
        source: 'Local STEP → Mesh · metres; static model',
      },
    },
    {
      type: 'addNode',
      node: node('module', name, 'glb', [0, 0, 0], [1, 1, 1], '#ffffff', {
        assetId: `a-${hash.slice(0, 20)}`,
        materialOverride: false,
      }),
    },
  ]);
  const manifest = {
    version: 1,
    target: 'unreal',
    coordinates: { handedness: 'right', up: 'Y', units: 'metres', quaternion: 'xyzw' },
    entrySceneId: scene.id,
    assets: [{ id: hash, sha256: hash, bytes: bytes.length, path: `models/${hash}.glb` }],
    scenes: [
      {
        id: scene.id,
        name,
        nodes: [nativeNode(scene.nodes[0], scene, hash)],
        camera: scene.camera,
        environment: scene.environment,
        spawn: scene.spawn,
        metadataJson: JSON.stringify(scene),
      },
    ],
  };
  await mkdir(outputDirectory); // Exclusive ownership: never reuse a failed or completed import.
  await mkdir(join(outputDirectory, 'source'));
  await mkdir(join(outputDirectory, 'models'));
  const json = (path: string, value: unknown) =>
    writeFile(join(outputDirectory, path), JSON.stringify(value, null, 2));
  await writeFile(join(outputDirectory, 'source', basename(sourcePath)), source);
  await writeFile(join(outputDirectory, `models/${hash}.glb`), bytes);
  await json('scene.json', scene);
  await json('validation.json', {
    sourceSha256: sourceHash,
    glbSha256: hash,
    errors: validation.issues.numErrors,
    warnings: validation.issues.numWarnings,
    messages: validation.issues.messages,
  });
  await json('engine-manifest.json', manifest);
}
