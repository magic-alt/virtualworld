import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { importNativeCad } from '@virtualworld/scene-builder/native-cad';
const index = process.argv.indexOf('--request');
if (index < 0 || !process.argv[index + 1]) throw new Error('Required: --request <request.json>');
const request = JSON.parse(await readFile(resolve(process.argv[index + 1]), 'utf8'));
if (Number(process.versions.node.split('.')[0]) < 24)
  throw new Error('Local CAD conversion requires Node.js 24 or later');
let result;
try {
  result = { success: true, requestId: request.requestId, ...(await importNativeCad(request)) };
} catch (error) {
  result = {
    success: false,
    requestId: request.requestId,
    error: error instanceof Error ? error.message : String(error),
  };
  process.exitCode = 1;
}
await writeFile(request.result + '.tmp', JSON.stringify(result));
await rename(request.result + '.tmp', request.result);
