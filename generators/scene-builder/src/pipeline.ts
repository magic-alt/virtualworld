import { NodeIO, VERSION } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, weld, prune, getBounds } from '@gltf-transform/functions';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { assertSelfContainedGlb } from '@virtualworld/asset-runtime';
const require = createRequire(import.meta.url);
const validator = require('gltf-validator') as {
  version(): string;
  validateBytes(
    bytes: Uint8Array,
    options: unknown,
  ): Promise<{ issues: { numErrors: number; numWarnings: number; messages: unknown[] } }>;
};
export const sha256 = (bytes: Uint8Array | string) =>
  createHash('sha256').update(bytes).digest('hex');
export async function atomicWrite(path: string, bytes: Uint8Array | string) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, bytes);
  await rename(temp, path);
}
export async function validateGlb(bytes: Uint8Array) {
  assertSelfContainedGlb(Uint8Array.from(bytes).buffer);
  const report = await validator.validateBytes(bytes, {
    format: 'glb',
    maxIssues: 100,
    writeTimestamp: false,
  });
  if (report.issues.numErrors)
    throw new Error(`glTF validation failed: ${JSON.stringify(report.issues)}`);
  return {
    errors: report.issues.numErrors,
    warnings: report.issues.numWarnings,
    messages: report.issues.messages,
  };
}
/** No lossy codecs: the shared browser loader needs no extra decoders. */
export async function optimizeGlb(
  bytes: Uint8Array,
  output: string,
  options: { normalizeExtent?: number } = {},
) {
  await validateGlb(bytes);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const document = await io.readBinary(bytes);
  await document.transform(dedup(), weld(), prune());
  if (options.normalizeExtent !== undefined) {
    if (!Number.isFinite(options.normalizeExtent) || options.normalizeExtent <= 0)
      throw new Error('Invalid normalization extent');
    const scene = document.getRoot().getDefaultScene() || document.getRoot().listScenes()[0];
    if (!scene) throw new Error('GLB has no scene');
    const bounds = getBounds(scene);
    const extent = Math.max(...bounds.max.map((v, i) => v - bounds.min[i]));
    if (!Number.isFinite(extent) || extent < 1e-8) throw new Error('GLB has no finite geometry');
    const scale = options.normalizeExtent / extent;
    const wrapper = document.createNode('Generated asset normalization');
    for (const child of scene.listChildren()) wrapper.addChild(child);
    wrapper.setScale([scale, scale, scale]);
    wrapper.setTranslation([
      -(bounds.min[0] + bounds.max[0]) * 0.5 * scale,
      -bounds.min[1] * scale,
      -(bounds.min[2] + bounds.max[2]) * 0.5 * scale,
    ]);
    scene.addChild(wrapper);
  }
  const optimized = await io.writeBinary(document);
  const validation = await validateGlb(optimized);
  await atomicWrite(output, optimized);
  return {
    version: 1 as const,
    sourceSha256: sha256(bytes),
    outputSha256: sha256(optimized),
    sourceBytes: bytes.byteLength,
    outputBytes: optimized.byteLength,
    tools: { pipeline: 'scene-builder/1', gltfTransform: VERSION, validator: validator.version() },
    validation,
  };
}
