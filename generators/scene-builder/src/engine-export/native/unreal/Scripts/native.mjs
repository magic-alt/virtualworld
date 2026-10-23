import { randomUUID } from 'node:crypto';
import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { checkData } from './check-data.mjs';
import { installPlugin, verifyPlugin } from './prepare-plugin.mjs';
import { prepareFont, verifyFont } from './prepare-font.mjs';
import { pluginRevision } from './pin.mjs';
import { discoverEngine, hostContext, probeCommand, toolchainChecks } from './environment.mjs';
import { batchInvocation, runLoggedProcess } from './process.mjs';
import { collectEvidence, digest, fingerprintInputs, occupied } from './evidence.mjs';

export { discoverEngine, batchInvocation };
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const commands = {
  doctor: ['engine', 'json'],
  check: ['engine', 'scene', 'data-only', 'json'],
  prepare: ['engine', 'font-source', 'json'],
  generate: ['engine'],
  build: ['engine'],
  open: ['engine', 'scene'],
  run: ['engine', 'scene'],
  smoke: ['engine', 'timeout'],
  package: ['engine'],
  evidence: ['engine', 'out', 'json'],
};
const usage = `Usage: node Scripts/native.mjs <command> [options]

doctor [--engine PATH] [--json]       Diagnose data, engine, plugin, CJK font and C++ SDK offline.
check --data-only [--scene ID]        Verify exported data without an engine or downloads.
prepare [--font-source FILE]         Explicitly prepare pinned glTFRuntime and Noto CJK font.
generate [--engine PATH]             Generate IDE project files using the selected engine.
build [--engine PATH]                Build VirtualWorldEditor Development for this platform.
open [--engine PATH] [--scene ID]     Open the project in Unreal Editor (then press Play).
run [--engine PATH] [--scene ID]      Launch the native game renderer; close it to return.
smoke [--engine PATH] [--timeout N]   Check every exported scene; timeout N is seconds (default 300).
package [--engine PATH]              Run the native desktop BuildCookRun pipeline.
evidence [--engine PATH] [--out DIR]  Copy existing logs/reports into a fresh evidence directory.

Engine priority: --engine, UE_ROOT, local Launcher/registry/default installations.
Automatic selection uses the highest valid installed UE 5.x version (5.4 minimum source baseline).
Run doctor to see the exact selection; use --engine to choose another installed version.
No command installs an engine or SDK. Only prepare downloads pinned plugin/font dependencies.
Doctor/data/evidence results never certify native compilation, rendering or manual acceptance.`;

export function parseNativeArgs(argv) {
  if (!argv.length || argv[0] === '--help' || argv[0] === 'help') {
    if (argv.length > 1) throw new Error('Unexpected argument after help.');
    return { command: 'help', options: {} };
  }
  const command = argv[0];
  if (!Object.hasOwn(commands, command))
    throw new Error(`Unknown native command: ${command}.\n${usage}`);
  const options = Object.fromEntries(
    commands[command].map((name) => [
      name,
      { type: ['data-only', 'json'].includes(name) ? 'boolean' : 'string' },
    ]),
  );
  options.help = { type: 'boolean' };
  const parsed = parseArgs({
    args: argv.slice(1),
    options,
    strict: true,
    allowPositionals: false,
    tokens: true,
  });
  const seen = new Set();
  for (const token of parsed.tokens) {
    if (token.kind !== 'option') continue;
    if (seen.has(token.name)) throw new Error(`Duplicate option --${token.name}.`);
    seen.add(token.name);
    if (
      typeof token.value === 'string' &&
      (!token.value.trim() || token.value.startsWith('--') || /[\0\r\n]/.test(token.value))
    )
      throw new Error(`Invalid value for option --${token.name}.`);
  }
  if (parsed.values.help) return { command: 'help', options: {} };
  if (parsed.values['data-only'] && parsed.values.engine)
    throw new Error('Option --engine cannot be combined with --data-only.');
  if (parsed.values.timeout !== undefined) {
    if (
      !/^\d+$/.test(parsed.values.timeout) ||
      Number(parsed.values.timeout) < 1 ||
      Number(parsed.values.timeout) > 7200
    )
      throw new Error('Smoke --timeout must be a whole number of seconds from 1 through 7200.');
    parsed.values.timeout = Number(parsed.values.timeout);
  }
  return { command, options: parsed.values };
}

function diagnose(projectRoot, options, context) {
  const checks = [];
  const nodeVersion = process.versions.node;
  checks.push({
    id: 'node',
    status: nodeVersion.split('.')[0] === '24' ? 'ok' : 'error',
    message: `Node.js ${nodeVersion}. These scripts require Node.js 24.`,
  });
  const inspect = (id, operation, action) => {
    try {
      const details = operation();
      checks.push({
        id,
        status: 'ok',
        details,
        message: `${id} inspection completed; no native execution.`,
      });
      return details;
    } catch (error) {
      checks.push({ id, status: 'error', message: `${error.message} ${action}` });
      return undefined;
    }
  };
  const data = inspect(
    'data',
    () => checkData(projectRoot),
    'Keep the complete export and canonical Content/VirtualWorldData/models files together.',
  );
  inspect(
    'plugin',
    () => context.verifyPlugin(projectRoot),
    'Run node Scripts/native.mjs prepare to fetch the pinned plugin; an existing modified plugin is never replaced.',
  );
  inspect(
    'font',
    () => context.verifyFont(projectRoot),
    'Run node Scripts/native.mjs prepare (or prepare --font-source PATH for an offline pinned font).',
  );
  const git = probeCommand(context, 'git', ['--version']);
  checks.push({
    id: 'git',
    status: git.status === 0 ? 'ok' : 'error',
    message:
      git.status === 0
        ? String(git.stdout).trim()
        : 'Git is required to prepare and verify the exact glTFRuntime revision. Install Git and reopen your terminal.',
  });
  const discovery = inspect(
    'engine',
    () => discoverEngine(options, context),
    'Use --engine with the installation root, not UnrealEditor.exe or the Engine subdirectory.',
  );
  const engine = discovery?.engine;
  if (engine) {
    checks.push({
      id: 'build-tools',
      status: existsSync(engine.build) && existsSync(engine.uat) ? 'ok' : 'error',
      message:
        existsSync(engine.build) && existsSync(engine.uat)
          ? 'Engine build/UAT scripts detected. Project generation uses the supplied helper or UBT -ProjectFiles mode.'
          : 'Engine build/UAT scripts are missing. Verify or complete this engine installation before generating/building.',
    });
    checks.push({
      id: 'compatibility',
      status: 'warning',
      message: `Detected UE ${engine.version}. UE 5.4+ is a source baseline, not a tested-version certification; compile this project and the pinned plugin with this exact engine.`,
    });
  }
  checks.push(...toolchainChecks(context, engine));
  return {
    kind: 'doctor',
    ok: checks.every((check) => check.status !== 'error'),
    nativeExecution: false,
    nativeCompilation: 'not-run',
    rendering: 'not-run',
    projectRoot,
    platform: context.platform,
    ...(data ? { data } : {}),
    ...(engine ? { engine, candidates: discovery.candidates, warnings: discovery.warnings } : {}),
    checks,
  };
}

export function validateSmokeReport(report, runId, expectedScenes, expected) {
  if (
    !report ||
    report.runId !== runId ||
    report.nativeExecution !== true ||
    report.passed !== true
  )
    throw new Error('Native smoke failed or its report is stale.');
  if (report.pluginRevision !== pluginRevision)
    throw new Error('Native smoke plugin revision does not match the pinned dependency.');
  if (
    !/^[a-f0-9]{64}$/.test(report.manifestSha256) ||
    report.manifestSha256 !== expected?.manifestSha256
  )
    throw new Error('Native smoke manifest digest does not match the data used for this launch.');
  const reportedVersion =
    typeof report.engineVersion === 'string' &&
    report.engineVersion.match(/^(\d+\.\d+\.\d+)(?:[-+]|$)/)?.[1];
  if (!reportedVersion || reportedVersion !== expected?.engineVersion)
    throw new Error(
      'Native smoke engine version does not match the selected engine Build.version.',
    );
  const ids = Array.isArray(report.scenes) ? report.scenes.map((scene) => scene.sceneId) : [];
  if (
    ids.length !== expectedScenes.length ||
    new Set(ids).size !== ids.length ||
    expectedScenes.some((id) => !ids.includes(id)) ||
    report.scenes.some((scene) => scene.passed !== true)
  )
    throw new Error('Native smoke scene coverage/assertions do not match the exported manifest.');
  if (report.visualParityVerified !== false || report.keyboardLocomotionVerified !== false)
    throw new Error('Native smoke cannot certify manual visual or keyboard acceptance.');
  return report;
}

function launch(command, options, projectRoot, data, engine, context) {
  const parent = join(projectRoot, 'Saved/VirtualWorld/native-runs');
  mkdirSync(parent, { recursive: true });
  const logDirectory = mkdtempSync(
    join(parent, `${new Date().toISOString().replace(/[:.]/g, '-')}-${command}-`),
  );
  const projectFile = join(projectRoot, 'VirtualWorld.uproject');
  const runId = randomUUID();
  const smokePath = join(projectRoot, 'Saved/VirtualWorld/smoke-report.json');
  const manifestPath = join(projectRoot, 'Content/VirtualWorldData/engine-manifest.json');
  const manifestSha256 = digest(manifestPath);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const expectedScenes = manifest.scenes.map((scene) => scene.id);
  let invocation;
  if (['generate', 'build', 'package'].includes(command)) {
    let script;
    let args;
    if (command === 'generate') {
      script = engine.generate || engine.build;
      args = [
        ...(engine.generate ? [] : ['-ProjectFiles']),
        `-project=${projectFile}`,
        '-game',
        '-engine',
        '-progress',
        '-CurrentPlatform',
      ];
    } else if (command === 'build') {
      script = engine.build;
      args = [
        'VirtualWorldEditor',
        engine.target,
        'Development',
        `-project=${projectFile}`,
        '-WaitMutex',
        '-NoHotReloadFromIDE',
      ];
    } else {
      script = engine.uat;
      args = [
        'BuildCookRun',
        `-project=${projectFile}`,
        '-noP4',
        '-build',
        '-cook',
        '-stage',
        '-pak',
        '-package',
        `-platform=${engine.target}`,
        '-clientconfig=Development',
        '-map=/Engine/Maps/Entry',
        '-utf8output',
      ];
    }
    if (!existsSync(script))
      throw new Error(`Engine script is absent: ${script}. Verify your UE installation.`);
    invocation = batchInvocation(script, args, context);
  } else {
    const args = [
      projectFile,
      '/Engine/Maps/Entry',
      '-log',
      '-windowed',
      '-ResX=1280',
      '-ResY=720',
      `-abslog=${join(logDirectory, 'engine.log')}`,
    ];
    if (command !== 'open') args.push('-game');
    if (command === 'smoke') {
      args.push('-unattended', '-nosound', '-VirtualWorldSmoke', `-VirtualWorldSmokeRun=${runId}`);
      if (occupied(smokePath))
        copyFileSync(
          smokePath,
          join(logDirectory, 'prior-smoke-report.json'),
          constants.COPYFILE_EXCL,
        );
    } else args.push(`-VirtualWorldScene=${data.sceneId}`);
    invocation = { program: engine.editor, args, options: {} };
  }
  context.stdout(
    Buffer.from(
      `Using Unreal ${engine.version}: ${engine.root}\n${command} logs: ${logDirectory}\n`,
    ),
  );
  const record = {
    command,
    projectRoot,
    engine,
    logDirectory,
    inputs: fingerprintInputs(projectRoot),
    ...(command === 'smoke'
      ? { timeoutSeconds: options.timeout ?? 300, nativeReportPath: smokePath }
      : {}),
  };
  const validation = (passed, error) =>
    writeFileSync(
      join(logDirectory, 'smoke-validation.json'),
      `${JSON.stringify({ kind: 'smoke-report-validation', nativeExecution: false, reportPath: smokePath, runId, passed, manifestSha256, engineVersion: engine.version, manifestSceneIds: expectedScenes, ...(error ? { error } : {}), visualParityVerified: false, keyboardLocomotionVerified: false }, null, 2)}\n`,
      { flag: 'wx' },
    );
  return runLoggedProcess(invocation, record, context)
    .then((result) => {
      if (command !== 'smoke') return result;
      if (!existsSync(smokePath))
        throw new Error(`Native smoke exited without its report. Logs: ${logDirectory}`);
      const report = JSON.parse(readFileSync(smokePath, 'utf8').replace(/^\uFEFF/, ''));
      if (digest(manifestPath) !== manifestSha256)
        throw new Error(
          'Exported manifest changed during native smoke; rerun against a stable project.',
        );
      validateSmokeReport(report, runId, expectedScenes, {
        manifestSha256,
        engineVersion: engine.version,
      });
      validation(true);
      return { ...report, logDirectory };
    })
    .catch((error) => {
      if (command === 'smoke') validation(false, error.message);
      error.logDirectory = logDirectory;
      throw error;
    })
    .finally(() => {
      if (command === 'smoke' && existsSync(smokePath))
        copyFileSync(
          smokePath,
          join(logDirectory, 'native-smoke-report.json'),
          constants.COPYFILE_EXCL,
        );
    });
}

/** Data/diagnostic results and prerequisite errors are synchronous; actual engine commands are awaitable. */
export function nativeCommand(argv, projectRoot = project, overrides = {}) {
  const { command, options } = parseNativeArgs(argv);
  if (command === 'help') return { kind: 'help', text: usage };
  const context = hostContext({
    verifyPlugin,
    verifyFont,
    prepareFont,
    installPlugin,
    stdout: (chunk) => process.stdout.write(chunk),
    stderr: (chunk) => process.stderr.write(chunk),
    ...overrides,
  });
  projectRoot = resolve(projectRoot);
  if (command === 'doctor') return diagnose(projectRoot, options, context);
  if (command === 'evidence')
    return collectEvidence(projectRoot, options.out, diagnose(projectRoot, options, context));
  if (process.versions.node.split('.')[0] !== '24') throw new Error('Node.js 24 is required.');
  const data = checkData(projectRoot, options.scene);
  if (command === 'check' && options['data-only']) return data;
  if (command === 'prepare') {
    if (options.engine) discoverEngine(options, context);
    const plugin = occupied(join(projectRoot, 'Plugins/glTFRuntime'))
      ? context.verifyPlugin(projectRoot)
      : context.installPlugin(projectRoot);
    return Promise.resolve(
      context.prepareFont(projectRoot, { fontSource: options['font-source'] }),
    ).then((font) => ({
      kind: 'dependency-preparation',
      nativeExecution: false,
      pluginRevision: plugin,
      font,
    }));
  }
  context.verifyPlugin(projectRoot);
  context.verifyFont(projectRoot);
  const { engine } = discoverEngine(options, context);
  if (!existsSync(join(projectRoot, 'VirtualWorld.uproject')))
    throw new Error('VirtualWorld.uproject is missing. Keep the entire exported project together.');
  if (command === 'check') return { ...data, pluginRevision, engine, font: 'verified' };
  return launch(command, options, projectRoot, data, engine, context);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const argv = process.argv.slice(2);
    const result = await nativeCommand(argv);
    if (result?.kind === 'help') console.log(result.text);
    else if (result?.kind === 'doctor' && !argv.includes('--json')) {
      console.log(
        `Unreal local doctor: ${result.ok ? 'prerequisites detected' : 'action required'} (native compilation/rendering not run)`,
      );
      for (const check of result.checks)
        console.log(`[${check.status.toUpperCase()}] ${check.id}: ${check.message}`);
      if (result.engine)
        console.log(
          `Selected UE ${result.engine.version}: ${result.engine.root} (${result.engine.source})`,
        );
      for (const warning of result.warnings || []) console.log(`[WARNING] ${warning}`);
    } else if (result) console.log(JSON.stringify(result, null, 2));
    if (result?.kind === 'doctor' && !result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode =
      Number.isInteger(error.exitCode) && error.exitCode > 0 && error.exitCode <= 255
        ? error.exitCode
        : 1;
  }
}
