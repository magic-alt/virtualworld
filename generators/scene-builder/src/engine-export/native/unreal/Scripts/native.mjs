import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { checkData } from './check-data.mjs';
import { verifyPlugin } from './prepare-plugin.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function option(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`);
  return value;
}
function run(program, argv, timeout, cwd = project) {
  const result = spawnSync(program, argv, { cwd, stdio: 'inherit', timeout });
  if (result.error || result.status !== 0)
    throw new Error(
      `${program} failed (${result.status ?? result.error?.message}). No native pass is recorded.`,
    );
}
function batch(program, argv, cwd) {
  if (process.platform !== 'win32') return run('bash', [program, ...argv], undefined, cwd);
  // cmd.exe is required for Epic's .bat scripts. Reject its expansion/metacharacters.
  const values = [program, ...argv];
  if (values.some((value) => /["\r\n%!?^&|<>]/.test(value)))
    throw new Error(
      'Windows batch paths contain unsupported shell metacharacters. Use the Unreal Editor UI.',
    );
  run(
    'cmd.exe',
    ['/d', '/s', '/c', `"${values.map((value) => `"${value}"`).join(' ')}"`],
    undefined,
    cwd,
  );
}

export function nativeCommand(argv, projectRoot = project) {
  process.env.VW_NODE_EXECUTABLE ??= process.execPath;
  const args = [...argv];
  const command = args.shift();
  if (!['check', 'build', 'run', 'smoke', 'package'].includes(command))
    throw new Error(
      'Usage: node Scripts/native.mjs check [--data-only] | build|run|smoke|package --engine <UE_ROOT> [--scene <scene-id>]',
    );
  const scene = option(args, '--scene');
  const data = checkData(projectRoot, scene);
  if (command === 'check' && args.includes('--data-only')) {
    return data;
  } else {
    verifyPlugin(projectRoot);
    const engine = option(args, '--engine') ?? process.env.UE_ROOT;
    if (!engine)
      throw new Error('Unreal Engine is required. Supply --engine <installation root> or UE_ROOT.');
    const root = resolve(engine);
    const platform =
      process.platform === 'win32'
        ? 'Win64'
        : process.platform === 'darwin'
          ? 'Mac'
          : process.platform === 'linux'
            ? 'Linux'
            : undefined;
    if (!platform) throw new Error(`Unsupported native helper platform: ${process.platform}`);
    const editor = join(
      root,
      'Engine/Binaries',
      platform,
      platform === 'Win64'
        ? 'UnrealEditor.exe'
        : platform === 'Mac'
          ? 'UnrealEditor.app/Contents/MacOS/UnrealEditor'
          : 'UnrealEditor',
    );
    if (!existsSync(editor))
      throw new Error(
        `Unreal Editor executable is absent: ${editor}. Install Unreal Engine and its native C++ toolchain first.`,
      );
    const projectFile = join(projectRoot, 'VirtualWorld.uproject');
    // macOS fullscreen startup can wait indefinitely in FMacWindow before loading the scene.
    const windowArgs = process.platform === 'darwin' ? ['-windowed'] : [];
    if (command === 'check') return { ...data, plugin: 'verified', engine: editor };
    else if (command === 'build') {
      const build = join(
        root,
        'Engine/Build/BatchFiles',
        platform === 'Win64' ? 'Build.bat' : `${platform}/Build.sh`,
      );
      batch(
        build,
        [
          'VirtualWorldEditor',
          platform,
          'Development',
          projectFile,
          '-WaitMutex',
          '-NoHotReloadFromIDE',
        ],
        projectRoot,
      );
    } else if (command === 'package') {
      const uat = join(
        root,
        'Engine/Build/BatchFiles',
        platform === 'Win64' ? 'RunUAT.bat' : 'RunUAT.sh',
      );
      batch(
        uat,
        [
          'BuildCookRun',
          `-project=${projectFile}`,
          '-noP4',
          '-build',
          '-cook',
          '-stage',
          '-pak',
          '-package',
          `-platform=${platform}`,
          '-clientconfig=Development',
          '-map=/Engine/Maps/Entry',
          '-utf8output',
        ],
        projectRoot,
      );
    } else if (command === 'run') {
      run(
        editor,
        [
          projectFile,
          '/Engine/Maps/Entry',
          '-game',
          ...windowArgs,
          '-log',
          `-VirtualWorldScene=${data.sceneId}`,
          ...(option(args, '--import')
            ? [`-VirtualWorldImport=${resolve(option(args, '--import'))}`]
            : []),
        ],
        undefined,
        projectRoot,
      );
    } else {
      const runId = randomUUID();
      // A new ID prevents a stale report from satisfying this run. No NullRHI: importer/render resources must exist.
      run(
        editor,
        [
          projectFile,
          '/Engine/Maps/Entry',
          '-game',
          ...windowArgs,
          '-unattended',
          '-nosound',
          '-log',
          '-VirtualWorldSmoke',
          `-VirtualWorldSmokeRun=${runId}`,
        ],
        300000,
        projectRoot,
      );
      const path = join(projectRoot, 'Saved/VirtualWorld/smoke-report.json');
      if (!existsSync(path)) throw new Error('Native smoke exited without its report.');
      const report = JSON.parse(readFileSync(path, 'utf8'));
      if (report.runId !== runId || report.nativeExecution !== true || report.passed !== true)
        throw new Error(`Native smoke assertions failed or report is stale: ${path}`);
      return report;
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = nativeCommand(process.argv.slice(2));
    if (result) console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
