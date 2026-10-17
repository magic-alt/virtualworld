import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
const execute = promisify(execFile);
export async function optimizeWithBlender(
  input: string,
  output: string,
  options: { binary?: string; ratio?: number; signal?: AbortSignal } = {},
) {
  if (extname(input).toLowerCase() !== '.glb' || extname(output).toLowerCase() !== '.glb')
    throw new Error('Blender batch input/output must be GLB');
  if (resolve(input) === resolve(output)) throw new Error('Blender output must differ from source');
  const ratio = options.ratio ?? 1;
  if (!Number.isFinite(ratio) || ratio < 0.05 || ratio > 1)
    throw new Error('Decimation ratio must be 0.05..1');
  await mkdir(dirname(resolve(output)), { recursive: true });
  const result = await execute(
    options.binary || process.env.BLENDER_BIN || 'blender',
    [
      '--background',
      '--factory-startup',
      '--python-exit-code',
      '1',
      '--python',
      fileURLToPath(new URL('../optimize.py', import.meta.url)),
      '--',
      '--input',
      resolve(input),
      '--output',
      resolve(output),
      '--ratio',
      String(ratio),
    ],
    { timeout: 120000, signal: options.signal, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
  );
  return { output: resolve(output), log: result.stdout };
}
