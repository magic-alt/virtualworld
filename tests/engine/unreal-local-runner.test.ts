import { spawn, spawnSync } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const template = resolve('generators/scene-builder/src/engine-export/native/unreal');
const temporary: string[] = [];
const revision = '0b22180d5d5d48b13457b683f4405113b6afd87b';
const native = () =>
  import(/* @vite-ignore */ pathToFileURL(join(template, 'Scripts/native.mjs')).href);

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture() {
  // Discovery and Node's ESM loader canonicalize macOS /var aliases to /private/var.
  const root = await realpath(await mkdtemp(join(tmpdir(), 'unreal-local-验收 ')));
  temporary.push(root);
  await mkdir(join(root, 'Content/VirtualWorldData'), { recursive: true });
  await writeFile(
    join(root, 'VirtualWorld.uproject'),
    await readFile(join(template, 'VirtualWorld.uproject')),
  );
  await writeFile(
    join(root, 'Content/VirtualWorldData/engine-manifest.json'),
    JSON.stringify({
      version: 1,
      target: 'unreal',
      coordinates: { handedness: 'right', up: 'Y', units: 'metres', quaternion: 'xyzw' },
      entrySceneId: 'test-scene',
      assets: [],
      scenes: [
        {
          id: 'test-scene',
          name: '测试',
          nodes: [],
          metadataJson: JSON.stringify({ id: 'test-scene', nodes: [] }),
        },
      ],
    }),
  );
  return root;
}

async function engine(parent: string, name: string, minor = 6, platform = 'linux') {
  const root = join(parent, name);
  const editor =
    platform === 'win32'
      ? 'Win64/UnrealEditor.exe'
      : platform === 'darwin'
        ? 'Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor'
        : 'Linux/UnrealEditor';
  const build =
    platform === 'win32' ? 'Build.bat' : platform === 'darwin' ? 'Mac/Build.sh' : 'Linux/Build.sh';
  const generate =
    platform === 'win32'
      ? 'GenerateProjectFiles.bat'
      : platform === 'darwin'
        ? 'Mac/GenerateProjectFiles.sh'
        : 'Linux/GenerateProjectFiles.sh';
  for (const path of [
    `Engine/Binaries/${editor}`,
    `Engine/Build/BatchFiles/${build}`,
    `Engine/Build/BatchFiles/${generate}`,
    `Engine/Build/BatchFiles/${platform === 'win32' ? 'RunUAT.bat' : 'RunUAT.sh'}`,
  ]) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), 'CONTROLLED TEST FIXTURE: not an Unreal binary.');
  }
  await writeFile(
    join(root, 'Engine/Build/Build.version'),
    JSON.stringify({ MajorVersion: 5, MinorVersion: minor, PatchVersion: 2 }),
  );
  return root;
}

const noProbe = () => ({
  status: 1,
  stdout: '',
  stderr: 'Not installed in this controlled fixture.',
});
const verifiedDependencies = {
  verifyPlugin: () => revision,
  verifyFont: () => ({ path: 'fixture-font', nativeExecution: false }),
};

// These real child processes exercise pipe/log handling only. They never invoke UBT or Unreal.
function fixtureProcess(args: string[], options: Parameters<typeof spawn>[2], exitCode = 0) {
  return spawn(
    process.execPath,
    [
      '-e',
      `process.stdout.write(process.argv.slice(1).join("\\n")); process.stderr.write("fixture compiler output"); process.exitCode=${exitCode}`,
      '--',
      ...args,
    ],
    options,
  );
}

describe('Unreal local launcher contract (no native compilation)', () => {
  it('rejects unknown, duplicate and command-inappropriate options before preflight', async () => {
    const { nativeCommand } = await native();
    const root = await fixture();
    for (const args of [
      ['check', '--data-only', '--engnie', 'typo'],
      ['check', '--data-only', '--scene', 'test-scene', '--scene', 'test-scene'],
      ['smoke', '--scene', 'test-scene'],
      ['build', '--data-only'],
      ['doctor', 'unexpected'],
      ['smoke', '--timeout', 'NaN'],
      ['run', '--engine'],
      ['run', '--import', 'one.step', '--import', 'two.step'],
      ['open', '--import', 'model.step'],
      ['package', '--configuration', 'Shipping', '--configuration', 'Development'],
    ])
      expect(() => nativeCommand(args, root)).toThrow(/option|argument|value|timeout/i);
    expect(nativeCommand(['check', '--data-only'], root)).toMatchObject({
      nativeExecution: false,
      scenes: 1,
    });
  });

  it('uses explicit engine over UE_ROOT and never falls back from an invalid explicit path', async () => {
    const { discoverEngine } = await native();
    const root = await fixture();
    const chosen = await engine(root, 'Engine 甲', 5);
    const environment = await engine(root, 'Engine 乙', 6);
    expect(
      discoverEngine(
        { engine: chosen },
        { platform: 'linux', env: { UE_ROOT: environment }, probe: noProbe },
      ).engine,
    ).toMatchObject({ root: chosen, version: '5.5.2', source: '--engine' });
    expect(
      discoverEngine({}, { platform: 'linux', env: { UE_ROOT: environment }, probe: noProbe })
        .engine,
    ).toMatchObject({ root: environment, version: '5.6.2', source: 'UE_ROOT' });
    expect(() =>
      discoverEngine(
        { engine: join(root, 'missing') },
        { platform: 'linux', env: { UE_ROOT: environment }, probe: noProbe },
      ),
    ).toThrow(/explicit|--engine|Build.version/i);
  });

  it('reads Build.version and rejects an engine below the existing V5 target baseline', async () => {
    const { discoverEngine } = await native();
    const root = await fixture();
    const old = await engine(root, 'UE_5.8-label-is-not-evidence', 3);
    expect(() =>
      discoverEngine({ engine: old }, { platform: 'linux', env: {}, probe: noProbe }),
    ).toThrow(/5\.4|V5/);
    await writeFile(join(old, 'Engine/Build/Build.version'), '{invalid');
    expect(() =>
      discoverEngine({ engine: old }, { platform: 'linux', env: {}, probe: noProbe }),
    ).toThrow(/Build.version/);
  });

  it('discovers LauncherInstalled.dat locations with spaces/CJK and selects the highest valid installed minor', async () => {
    const { discoverEngine } = await native();
    const root = await fixture();
    const first = await engine(root, '引擎 第一个', 4, 'win32');
    const newest = await engine(root, '引擎 第二个', 6, 'win32');
    const programData = join(root, 'Program Data');
    const location = join(programData, 'Epic/UnrealEngineLauncher/LauncherInstalled.dat');
    await mkdir(dirname(location), { recursive: true });
    await writeFile(
      location,
      JSON.stringify({
        InstallationList: [
          { AppName: 'UE_5.4', InstallLocation: first },
          { AppName: 'SomeOtherGame', InstallLocation: '/do-not-inspect' },
          { AppName: 'UE_5.6', InstallLocation: newest },
          { AppName: 'UE_5.9', InstallLocation: join(root, 'stale install') },
        ],
      }),
    );
    const found = discoverEngine(
      {},
      {
        platform: 'win32',
        env: { ProgramData: programData, ProgramFiles: join(root, 'no defaults') },
        probe: noProbe,
      },
    );
    expect(found.engine).toMatchObject({ root: newest, version: '5.6.2', source: 'Epic Launcher' });
    expect(found.candidates.filter((item: { valid: boolean }) => item.valid)).toHaveLength(2);
    expect(found.warnings.join(' ')).toMatch(/stale install/);
  });

  it('continues from malformed launcher metadata to known installation directories', async () => {
    const { discoverEngine } = await native();
    const root = await fixture();
    const programData = join(root, 'ProgramData');
    const location = join(programData, 'Epic/UnrealEngineLauncher/LauncherInstalled.dat');
    await mkdir(dirname(location), { recursive: true });
    await writeFile(location, 'broken JSON');
    const programFiles = join(root, 'Program Files');
    const found = await engine(join(programFiles, 'Epic Games'), 'UE_5.5', 5, 'win32');
    const result = discoverEngine(
      {},
      {
        platform: 'win32',
        env: { ProgramData: programData, ProgramFiles: programFiles },
        probe: noProbe,
      },
    );
    expect(result.engine.root).toBe(found);
    expect(result.warnings.join(' ')).toMatch(/LauncherInstalled.dat/);
  });

  it('reports missing data, plugin, font, engine and Windows toolchain together without native execution', async () => {
    const { nativeCommand } = await native();
    const root = await fixture();
    await rm(join(root, 'Content'), { recursive: true });
    const report = nativeCommand(['doctor'], root, {
      platform: 'win32',
      env: { ProgramData: join(root, 'absent'), ProgramFiles: join(root, 'absent') },
      probe: noProbe,
    });
    expect(report).toMatchObject({
      kind: 'doctor',
      ok: false,
      nativeExecution: false,
      nativeCompilation: 'not-run',
    });
    for (const id of ['data', 'plugin', 'font', 'engine', 'visual-cpp', 'windows-sdk']) {
      expect(report.checks.find((check: { id: string }) => check.id === id)).toMatchObject({
        status: 'error',
      });
    }
    expect(JSON.stringify(report)).toMatch(/Visual Studio|C\+\+/);
    await expect(readFile(join(root, 'Saved/VirtualWorld/smoke-report.json'))).rejects.toThrow();
  });

  it('quotes Windows batch arguments once, preserving spaces/CJK and rejecting cmd expansion characters', async () => {
    const { batchInvocation } = await native();
    const spec = batchInvocation(
      'C:\\Program Files\\Epic Games\\UE_5.6\\Engine\\Build\\BatchFiles\\Build.bat',
      ['VirtualWorldEditor', 'Win64', 'Development', 'D:\\用户 甲\\验收\\VirtualWorld.uproject'],
      { platform: 'win32', env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' } },
    );
    expect(spec.program).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(spec.options.windowsVerbatimArguments).toBe(true);
    expect(spec.args.slice(0, 4)).toEqual(['/d', '/s', '/v:off', '/c']);
    expect(spec.args[4]).toBe(
      '""C:\\Program Files\\Epic Games\\UE_5.6\\Engine\\Build\\BatchFiles\\Build.bat" "VirtualWorldEditor" "Win64" "Development" "D:\\用户 甲\\验收\\VirtualWorld.uproject""',
    );
    for (const bad of ['%USERPROFILE%', 'a&b', 'a!b', 'a"b', 'a\nb'])
      expect(() => batchInvocation('Build.bat', [bad], { platform: 'win32', env: {} })).toThrow(
        /metacharacter|unsupported/i,
      );
  });

  it('finds registry engine paths and reports actual Visual C++/SDK files without certifying their compatibility', async () => {
    const { nativeCommand } = await native();
    const root = await fixture();
    const installed = await engine(root, '注册表 安装', 6, 'win32');
    const visualStudio = join(root, 'VS 专业版');
    const sdk = join(root, 'Windows SDK');
    for (const path of [
      join(visualStudio, 'VC/Tools/MSVC/14.38.33130/bin/Hostx64/x64/cl.exe'),
      join(sdk, 'Include/10.0.22621.0/um/Windows.h'),
      join(sdk, 'Lib/10.0.22621.0/um/x64/kernel32.lib'),
      join(sdk, 'bin/10.0.22621.0/x64/rc.exe'),
    ]) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, 'test-only installed file marker');
    }
    const probe = (program: string, args: string[]) => {
      const stdout = program.endsWith('vswhere.exe')
        ? JSON.stringify([{ installationPath: visualStudio, installationVersion: '17.8.0' }])
        : program === 'git'
          ? 'git version fixture'
          : args.at(-1)?.includes('KitsRoot10')
            ? JSON.stringify([sdk])
            : JSON.stringify([installed]);
      return { status: 0, stdout, stderr: '' };
    };
    const report = nativeCommand(['doctor'], root, {
      ...verifiedDependencies,
      platform: 'win32',
      env: { ProgramData: join(root, 'missing'), ProgramFiles: join(root, 'missing') },
      probe,
    });
    expect(report.engine).toMatchObject({
      root: installed,
      source: 'Windows registry',
      version: '5.6.2',
    });
    expect(report.checks.find((check: { id: string }) => check.id === 'visual-cpp')).toMatchObject({
      status: 'ok',
      details: [
        { visualStudio: '17.8.0', version: '14.38.33130', path: expect.stringContaining('cl.exe') },
      ],
    });
    expect(report.checks.find((check: { id: string }) => check.id === 'windows-sdk')).toMatchObject(
      { status: 'ok', details: [{ root: sdk, version: '10.0.22621.0' }] },
    );
    expect(report).toMatchObject({ nativeExecution: false, nativeCompilation: 'not-run' });
  });

  it('keeps a verified existing plugin during explicit preparation and checks the font before any native launch', async () => {
    const { nativeCommand } = await native();
    const root = await fixture();
    const plugin = join(root, 'Plugins/glTFRuntime');
    await mkdir(plugin, { recursive: true });
    await writeFile(join(plugin, 'keep.txt'), 'retained');
    const prepared = await nativeCommand(
      ['prepare', '--font-source', join(root, 'offline-font.otf')],
      root,
      {
        verifyPlugin: () => revision,
        installPlugin: () => {
          throw new Error('Existing plugin must not be replaced');
        },
        prepareFont: async (_root: string, options: { fontSource: string }) => ({
          source: options.fontSource,
          nativeExecution: false,
        }),
      },
    );
    expect(prepared).toMatchObject({
      nativeExecution: false,
      pluginRevision: revision,
      font: { source: join(root, 'offline-font.otf') },
    });
    expect(await readFile(join(plugin, 'keep.txt'), 'utf8')).toBe('retained');
    expect(() => nativeCommand(['build'], root, { verifyPlugin: () => revision })).toThrow(
      /font|CJK/i,
    );
    await expect(readdir(join(root, 'Saved/VirtualWorld/native-runs'))).rejects.toThrow();
  });

  it('generates project files through UBT when a Launcher installation has no dedicated generation script', async () => {
    const { nativeCommand } = await native();
    const root = await fixture();
    const installed = await engine(root, 'Engine', 6);
    await rm(join(installed, 'Engine/Build/BatchFiles/Linux/GenerateProjectFiles.sh'));
    const result = await nativeCommand(['generate', '--engine', installed], root, {
      ...verifiedDependencies,
      platform: 'linux',
      env: process.env,
      spawn: (_program: string, args: string[], options: Parameters<typeof spawn>[2]) =>
        fixtureProcess(args, options),
      stdout: () => {},
      stderr: () => {},
    });
    const args = (await readFile(join(result.logDirectory, 'stdout.log'), 'utf8')).split('\n');
    expect(args).toContain(join(installed, 'Engine/Build/BatchFiles/Linux/Build.sh'));
    expect(args).toContain('-ProjectFiles');
    expect(args).toContain(`-project=${join(root, 'VirtualWorld.uproject')}`);
  });

  it('records real fixture process stdout, stderr, nonzero exit and independent historical logs', async () => {
    const { nativeCommand } = await native();
    const root = await fixture();
    const installed = await engine(root, 'Engine 代码', 6);
    const executeFixture = (
      _program: string,
      args: string[],
      options: Parameters<typeof spawn>[2],
    ) => fixtureProcess(args, options, 7);
    for (let index = 0; index < 2; index += 1) {
      await expect(
        nativeCommand(['build', '--engine', installed], root, {
          ...verifiedDependencies,
          platform: 'linux',
          env: process.env,
          spawn: executeFixture,
          stdout: () => {},
          stderr: () => {},
        }),
      ).rejects.toMatchObject({ exitCode: 7 });
    }
    const runs = await readdir(join(root, 'Saved/VirtualWorld/native-runs'));
    expect(runs).toHaveLength(2);
    for (const run of runs) {
      const directory = join(root, 'Saved/VirtualWorld/native-runs', run);
      expect(await readFile(join(directory, 'stdout.log'), 'utf8')).toContain('VirtualWorldEditor');
      expect(await readFile(join(directory, 'stderr.log'), 'utf8')).toBe('fixture compiler output');
      expect(JSON.parse(await readFile(join(directory, 'process.json'), 'utf8'))).toMatchObject({
        command: 'build',
        exitCode: 7,
        status: 'failed',
        engine: { version: '5.6.2' },
      });
      expect(JSON.parse(await readFile(join(directory, 'process.json'), 'utf8'))).toMatchObject({
        machine: { platform: 'linux', nodeVersion: process.versions.node },
        inputs: expect.arrayContaining([
          expect.objectContaining({
            path: 'Content/VirtualWorldData/engine-manifest.json',
            sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          }),
        ]),
      });
    }
    await expect(readFile(join(root, 'Saved/VirtualWorld/smoke-report.json'))).rejects.toThrow();
  });

  it('opens the editor without -game and launches a selected scene using discrete arguments', async () => {
    const { nativeCommand } = await native();
    const root = await fixture();
    const installed = await engine(root, 'Engine', 6);
    const executeFixture = (
      _program: string,
      args: string[],
      options: Parameters<typeof spawn>[2],
    ) => fixtureProcess(args, options);
    const context = {
      ...verifiedDependencies,
      platform: 'linux',
      env: process.env,
      spawn: executeFixture,
      stdout: () => {},
      stderr: () => {},
    };
    const opened = await nativeCommand(['open', '--engine', installed], root, context);
    const openArgs = (await readFile(join(opened.logDirectory, 'stdout.log'), 'utf8'))
      .trim()
      .split('\n');
    expect(openArgs).toContain(join(root, 'VirtualWorld.uproject'));
    expect(openArgs).not.toContain('-game');
    const played = await nativeCommand(
      ['run', '--engine', installed, '--scene', 'test-scene', '--import', 'fixture model.step'],
      root,
      context,
    );
    const runArgs = (await readFile(join(played.logDirectory, 'stdout.log'), 'utf8'))
      .trim()
      .split('\n');
    expect(runArgs).toContain('-game');
    expect(runArgs).toContain('-VirtualWorldScene=test-scene');
    expect(runArgs).toContain(`-VirtualWorldImport=${resolve('fixture model.step')}`);
  });

  it('archives the requested package configuration after preparing the runtime and propagates Node', async () => {
    const { nativeCommand } = await native();
    const root = await fixture();
    const installed = await engine(root, 'Engine', 6);
    let preparedRoot: string | undefined;
    let childEnvironment: NodeJS.ProcessEnv | undefined;
    const context = {
      ...verifiedDependencies,
      platform: 'linux',
      env: {},
      preparePackageRuntime: (path: string) => {
        preparedRoot = path;
      },
      spawn: (_program: string, args: string[], options: Parameters<typeof spawn>[2]) => {
        expect(preparedRoot).toBe(root);
        childEnvironment = options?.env;
        return fixtureProcess(args, options);
      },
      stdout: () => {},
      stderr: () => {},
    };
    const result = await nativeCommand(
      [
        'package',
        '--engine',
        installed,
        '--configuration',
        'Shipping',
        '--output',
        'release archive',
      ],
      root,
      context,
    );
    const args = (await readFile(join(result.logDirectory, 'stdout.log'), 'utf8'))
      .trim()
      .split('\n');
    expect(args).toContain('-clientconfig=Shipping');
    expect(args).toContain('-archive');
    expect(args).toContain(`-archivedirectory=${join(root, 'release archive')}`);
    expect(args).toContain('-prereqs');
    expect(childEnvironment?.VW_NODE_EXECUTABLE).toBe(process.execPath);
    expect(context.env).toEqual({});
    const preserved = '/installed/custom-node';
    await nativeCommand(['run', '--engine', installed], root, {
      ...context,
      env: { VW_NODE_EXECUTABLE: preserved },
    });
    expect(childEnvironment?.VW_NODE_EXECUTABLE).toBe(preserved);
  });

  it('refuses stale or incomplete smoke report fixtures, even when the process exits zero', async () => {
    const { validateSmokeReport } = await native();
    const manifestSha256 = 'a'.repeat(64);
    const valid = {
      runId: 'current-run',
      nativeExecution: true,
      passed: true,
      pluginRevision: revision,
      engineVersion: '5.6.2-123456+++UE5+Release-5.6',
      manifestSha256,
      visualParityVerified: false,
      keyboardLocomotionVerified: false,
      scenes: [{ sceneId: 'test-scene', passed: true }],
    };
    const expected = { manifestSha256, engineVersion: '5.6.2' };
    expect(validateSmokeReport(valid, 'current-run', ['test-scene'], expected)).toEqual(valid);
    for (const report of [
      { ...valid, runId: 'older-run' },
      { ...valid, pluginRevision: 'different' },
      { ...valid, scenes: [] },
      { ...valid, scenes: [{ sceneId: 'other-scene', passed: true }] },
      { ...valid, scenes: [{ sceneId: 'test-scene', passed: false }] },
      { ...valid, manifestSha256: 'b'.repeat(64) },
      { ...valid, engineVersion: '5.6.20-123456' },
    ])
      expect(() => validateSmokeReport(report, 'current-run', ['test-scene'], expected)).toThrow(
        /smoke|stale|revision|scene|manifest|engine/i,
      );
  });

  it('preserves a previous smoke report but never accepts it after a zero-exit fixture process', async () => {
    const { nativeCommand } = await native();
    const root = await fixture();
    const installed = await engine(root, 'Engine', 6);
    const saved = join(root, 'Saved/VirtualWorld');
    await mkdir(saved, { recursive: true });
    const stale = JSON.stringify({ runId: 'previous', nativeExecution: true, passed: true });
    await writeFile(join(saved, 'smoke-report.json'), stale);
    await expect(
      nativeCommand(['smoke', '--engine', installed], root, {
        ...verifiedDependencies,
        platform: 'linux',
        env: process.env,
        spawn: (_program: string, args: string[], options: Parameters<typeof spawn>[2]) =>
          fixtureProcess(args, options),
        stdout: () => {},
        stderr: () => {},
      }),
    ).rejects.toThrow(/stale/);
    const [run] = await readdir(join(saved, 'native-runs'));
    const path = join(saved, 'native-runs', run);
    expect(await readFile(join(path, 'prior-smoke-report.json'), 'utf8')).toBe(stale);
    expect(JSON.parse(await readFile(join(path, 'smoke-validation.json'), 'utf8'))).toMatchObject({
      passed: false,
      error: expect.stringMatching(/stale/),
    });
  });

  it('collects existing evidence without certifying it and refuses existing or symlink destinations', async () => {
    const { nativeCommand } = await native();
    const root = await fixture();
    const saved = join(root, 'Saved/VirtualWorld');
    await mkdir(saved, { recursive: true });
    const stale = JSON.stringify({ runId: 'old', passed: true, nativeExecution: true });
    await writeFile(join(saved, 'smoke-report.json'), stale);
    await mkdir(join(root, 'Saved/Screenshots/Windows'), { recursive: true });
    await writeFile(
      join(root, 'Saved/Screenshots/Windows/用户截图.png'),
      'screenshot fixture bytes',
    );
    const out = join(root, 'evidence 证据');
    const report = nativeCommand(['evidence', '--out', out], root, {
      platform: 'linux',
      env: {},
      probe: noProbe,
    });
    expect(report).toMatchObject({ kind: 'evidence-collection', nativeExecution: false, out });
    expect(await readFile(join(out, 'Saved/VirtualWorld/smoke-report.json'), 'utf8')).toBe(stale);
    expect(await readFile(join(out, 'Saved/Screenshots/Windows/用户截图.png'), 'utf8')).toBe(
      'screenshot fixture bytes',
    );
    const summary = JSON.parse(await readFile(join(out, 'evidence.json'), 'utf8'));
    expect(summary.manualAcceptance).toBe('pending');
    expect(summary.nativeValidation).toBe('not-certified-by-collector');
    expect(
      summary.files.find((entry: { path: string }) => entry.path.endsWith('smoke-report.json')),
    ).toMatchObject({
      bytes: Buffer.byteLength(stale),
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(() => nativeCommand(['evidence', '--out', out], root)).toThrow(/exist|occupied/i);
    const link = join(root, 'evidence-link');
    await symlink(out, link, 'dir');
    expect(() => nativeCommand(['evidence', '--out', link], root)).toThrow(/exist|occupied/i);
  });

  it('rejects a fresh evidence directory reached through an alias into the collected source tree', async () => {
    const { nativeCommand } = await native();
    const root = await fixture();
    await mkdir(join(root, 'Source'));
    await writeFile(join(root, 'Source/Runtime.cpp'), 'source fixture');
    await symlink(
      join(root, 'Source'),
      join(root, 'source-alias'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    expect(() =>
      nativeCommand(['evidence', '--out', join(root, 'source-alias/new-evidence')], root, {
        platform: 'linux',
        env: {},
        probe: noProbe,
      }),
    ).toThrow(/inside|collected/i);
    await expect(readdir(join(root, 'Source/new-evidence'))).rejects.toThrow();
    expect(() =>
      nativeCommand(['evidence', '--out', join(root, 'Source/..evidence')], root, {
        platform: 'linux',
        env: {},
        probe: noProbe,
      }),
    ).toThrow(/inside|collected/i);
  });

  it('runs the native CLI when invoked through a directory alias', async () => {
    const root = await fixture();
    const alias = join(root, 'ScriptsAlias');
    await symlink(join(template, 'Scripts'), alias, 'junction');
    const result = spawnSync(process.execPath, [join(alias, 'native.mjs'), '--help'], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: node Scripts/native.mjs');
  });

  it('rejects misspelled direct plugin options before attempting dependency preparation', async () => {
    const root = await fixture();
    await mkdir(join(root, 'Scripts'));
    for (const name of ['prepare-plugin.mjs', 'pin.mjs'])
      await writeFile(join(root, 'Scripts', name), await readFile(join(template, 'Scripts', name)));
    await mkdir(join(root, 'Plugins/glTFRuntime'), { recursive: true });
    await writeFile(join(root, 'Plugins/glTFRuntime/keep.txt'), 'retained');
    const alias = join(root, 'ScriptsAlias');
    await symlink(join(root, 'Scripts'), alias, 'junction');
    for (const scripts of [join(root, 'Scripts'), alias]) {
      const result = spawnSync(
        process.execPath,
        [join(scripts, 'prepare-plugin.mjs'), '--verfiy'],
        { encoding: 'utf8' },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/Unknown option/);
    }
    expect(await readFile(join(root, 'Plugins/glTFRuntime/keep.txt'), 'utf8')).toBe('retained');
  });

  it('terminates the fixture process directly when Windows tree termination returns failure', async () => {
    const { runLoggedProcess } = await import(
      /* @vite-ignore */ pathToFileURL(join(template, 'Scripts/process.mjs')).href
    );
    const root = await fixture();
    const logs = join(root, 'logs');
    await mkdir(logs);
    let directTermination = false;
    const spawnFixture = (
      program: string,
      args: string[],
      options: Parameters<typeof spawn>[2],
    ) => {
      const child = spawn(program, args, options);
      const terminate = child.kill.bind(child);
      child.kill = (signal) => {
        directTermination = true;
        return terminate(signal);
      };
      return child;
    };
    // The Windows taskkill boundary is injected; the real child is a Node fixture, not Unreal.
    await expect(
      runLoggedProcess(
        { program: process.execPath, args: ['-e', 'setTimeout(() => {}, 500)'], options: {} },
        {
          command: 'smoke',
          projectRoot: root,
          engine: { root, version: '5.6.2', source: 'fixture' },
          logDirectory: logs,
          timeoutSeconds: 0.03,
          inputs: [],
        },
        {
          platform: 'win32',
          env: process.env,
          probe: noProbe,
          spawn: spawnFixture,
          stdout: () => {},
          stderr: () => {},
        },
      ),
    ).rejects.toMatchObject({ exitCode: 124 });
    expect(directTermination).toBe(true);
    expect(JSON.parse(await readFile(join(logs, 'process.json'), 'utf8'))).toMatchObject({
      timedOut: true,
      status: 'failed',
    });
  });
});
