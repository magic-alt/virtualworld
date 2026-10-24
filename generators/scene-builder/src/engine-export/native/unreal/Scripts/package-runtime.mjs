import {
  existsSync,
  readFileSync,
  mkdirSync,
  copyFileSync,
  chmodSync,
  writeFileSync,
  lstatSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

export function packageOptions(args, host = process.platform, projectRoot = process.cwd()) {
  const platform = { darwin: 'Mac', win32: 'Win64', linux: 'Linux' }[host];
  if (!platform) throw new Error(`Unsupported packaging host: ${host}`);
  const values = {};
  for (let i = 0; i < args.length; i++) {
    if (!['--platform', '--configuration', '--output'].includes(args[i])) continue;
    const key = args[i],
      value = args[++i];
    if (values[key] !== undefined || !value || value.startsWith('--'))
      throw new Error(`Missing or duplicate package option ${key}`);
    values[key] = value;
  }
  if (values['--platform'] && values['--platform'] !== platform)
    throw new Error(
      `Build ${values['--platform']} on its native host; this host supports ${platform}. Windows .exe packaging requires Windows and its UE C++ toolchain.`,
    );
  const configuration = values['--configuration'] ?? 'Development';
  if (!['Development', 'Shipping'].includes(configuration))
    throw new Error('Package configuration must be Development or Shipping');
  return {
    platform,
    configuration,
    archive: resolve(projectRoot, values['--output'] ?? join('Packaged', platform, configuration)),
  };
}

/** Copy the installed host runtime, never download or execute a new binary. */
export function preparePackageRuntime(projectRoot, options = {}) {
  if (!existsSync(join(projectRoot, 'Content/VirtualWorldTools/Cad/import-cad.mjs')))
    return { included: false, reason: 'CAD helper absent' };
  const executable = options.execPath ?? process.execPath,
    platform = options.platform ?? process.platform,
    version = options.nodeVersion ?? process.versions.node;
  if (Number(version.split('.')[0]) < 24)
    throw new Error('Offline CAD packaging requires installed Node.js24 or newer');
  const license = [
    join(dirname(executable), 'LICENSE'),
    join(dirname(executable), '../LICENSE'),
  ].find(existsSync);
  if (!license)
    throw new Error(
      'Node runtime LICENSE is missing. Use an official Node distribution containing its LICENSE.',
    );
  const destination = join(projectRoot, 'Content/VirtualWorldTools/Node');
  if (existsSync(destination) && lstatSync(destination).isSymbolicLink())
    throw new Error('Refusing a symlinked runtime destination');
  mkdirSync(destination, { recursive: true });
  const binary = join(destination, platform === 'win32' ? 'node.exe' : 'node');
  for (const file of [binary, join(destination, 'LICENSE'), join(destination, 'runtime.json')])
    if (existsSync(file) && lstatSync(file).isSymbolicLink())
      throw new Error('Refusing a symlinked runtime file');
  const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
  copyFileSync(executable, binary);
  if (platform !== 'win32') chmodSync(binary, 0o755);
  copyFileSync(license, join(destination, 'LICENSE'));
  const sha256 = digest(executable);
  if (digest(binary) !== sha256) throw new Error('Bundled runtime copy hash mismatch');
  const result = {
    included: true,
    version,
    platform,
    architecture: process.arch,
    sha256,
    licenseSha256: digest(license),
  };
  writeFileSync(join(destination, 'runtime.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}
