import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { pluginRepository, pluginRevision } from './pin.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function occupied(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
function git(cwd, args) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: args[0] === 'fetch' ? 300000 : 30000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (result.error || result.status !== 0)
    throw new Error(`git ${args[0]} failed: ${result.error?.message ?? result.stderr.trim()}`);
  return result.stdout.trim();
}
export function verifyPlugin(root = project) {
  const directory = join(root, 'Plugins', 'glTFRuntime');
  if (!existsSync(join(directory, 'glTFRuntime.uplugin')))
    throw new Error('glTFRuntime is missing. Run node Scripts/prepare-plugin.mjs first.');
  if (git(directory, ['rev-parse', 'HEAD']) !== pluginRevision)
    throw new Error(
      `glTFRuntime must be pinned to ${pluginRevision}; no automatic upgrade is allowed.`,
    );
  if (git(directory, ['status', '--porcelain', '--untracked-files=all']))
    throw new Error(
      'The pinned glTFRuntime source has local modifications or untracked files. Use a fresh, verified checkout.',
    );
  return pluginRevision;
}

export function installPlugin(root = project) {
  const destination = join(root, 'Plugins', 'glTFRuntime');
  let staging;
  try {
    if (occupied(destination))
      throw new Error(
        `Plugin directory already exists: ${destination}. It will not be overwritten; inspect it or use --verify.`,
      );
    mkdirSync(dirname(destination), { recursive: true });
    staging = mkdtempSync(join(dirname(destination), '.gltfruntime-'));
    git(staging, ['init', '--quiet']);
    git(staging, ['remote', 'add', 'origin', pluginRepository]);
    git(staging, ['fetch', '--depth=1', 'origin', pluginRevision]);
    git(staging, ['checkout', '--quiet', '--detach', 'FETCH_HEAD']);
    if (git(staging, ['rev-parse', 'HEAD']) !== pluginRevision)
      throw new Error('Fetched plugin revision does not match the pinned SHA.');
    if (!existsSync(join(staging, 'LICENSE')) || !existsSync(join(staging, 'glTFRuntime.uplugin')))
      throw new Error('Incomplete plugin checkout.');
    if (occupied(destination))
      throw new Error('Plugin destination became occupied during download.');
    renameSync(staging, destination);
    staging = undefined;
    return verifyPlugin(root);
  } catch (error) {
    if (staging) rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  try {
    const { values, tokens } = parseArgs({
      options: { verify: { type: 'boolean' }, help: { type: 'boolean' } },
      strict: true,
      allowPositionals: false,
      tokens: true,
    });
    const names = tokens.filter((token) => token.kind === 'option').map((token) => token.name);
    if (new Set(names).size !== names.length)
      throw new Error('Duplicate plugin preparation option.');
    if (values.help)
      console.log(
        'Usage: node Scripts/prepare-plugin.mjs [--verify]. Without --verify, explicitly fetch the pinned public plugin into a fresh directory.',
      );
    else {
      const revision = values.verify ? verifyPlugin() : installPlugin();
      console.log(
        `Verified glTFRuntime ${revision}; its MIT license and content remain in Plugins/glTFRuntime.`,
      );
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
