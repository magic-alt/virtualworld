import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export function hostContext(overrides = {}) {
  return { platform: process.platform, env: process.env, probe: spawnSync, ...overrides };
}

function envValue(env, name, fallback = '') {
  const key = Object.keys(env).find((item) => item.toLowerCase() === name.toLowerCase());
  return (key && env[key]) || fallback;
}

function directories(path) {
  if (!existsSync(path)) return [];
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function file(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function probeCommand(context, program, args) {
  try {
    return context.probe(program, args, {
      env: context.env,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (error) {
    return { status: null, error, stdout: '', stderr: error.message };
  }
}

// Fixed read-only scripts avoid both code interpolation and reg.exe's legacy-codepage output.
// PowerShell and vswhere explicitly emit UTF-8 so CJK install paths survive discovery.
const registryEngines = `
$items = @()
foreach ($key in @('Registry::HKEY_LOCAL_MACHINE\\SOFTWARE\\EpicGames\\Unreal Engine', 'Registry::HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\EpicGames\\Unreal Engine')) {
  if (Test-Path -LiteralPath $key) {
    foreach ($child in Get-ChildItem -LiteralPath $key -ErrorAction SilentlyContinue) {
      $entry = Get-ItemProperty -LiteralPath $child.PSPath -ErrorAction SilentlyContinue
      if ($entry.InstalledDirectory) { $items += [string]$entry.InstalledDirectory }
    }
  }
}
$custom = 'Registry::HKEY_CURRENT_USER\\SOFTWARE\\Epic Games\\Unreal Engine\\Builds'
if (Test-Path -LiteralPath $custom) {
  $entry = Get-ItemProperty -LiteralPath $custom -ErrorAction SilentlyContinue
  foreach ($property in $entry.PSObject.Properties) {
    if ($property.Name -notlike 'PS*' -and $property.Value -is [string]) { $items += $property.Value }
  }
}
ConvertTo-Json -InputObject @($items) -Compress
`;

const registrySdk = `
$items = @()
foreach ($key in @('Registry::HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows Kits\\Installed Roots', 'Registry::HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows Kits\\Installed Roots')) {
  if (Test-Path -LiteralPath $key) {
    $entry = Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue
    if ($entry.KitsRoot10) { $items += [string]$entry.KitsRoot10 }
  }
}
ConvertTo-Json -InputObject @($items) -Compress
`;

function queryRegistry(context, script) {
  const executable = join(
    envValue(context.env, 'SystemRoot', 'C:\\Windows'),
    'System32/WindowsPowerShell/v1.0/powershell.exe',
  );
  const result = probeCommand(context, executable, [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); ${script}`,
  ]);
  if (result.error || result.status !== 0) return undefined;
  try {
    const values = JSON.parse(String(result.stdout).replace(/^\uFEFF/, ''));
    return Array.isArray(values) ? values.filter((value) => typeof value === 'string') : [];
  } catch {
    return undefined;
  }
}

export function engineLayout(root, platform) {
  const target = { win32: 'Win64', darwin: 'Mac', linux: 'Linux' }[platform];
  if (!target) throw new Error(`Unsupported native helper platform: ${platform}`);
  const batch = join(root, 'Engine/Build/BatchFiles');
  const generateCandidates =
    platform === 'win32'
      ? [join(batch, 'GenerateProjectFiles.bat'), join(root, 'GenerateProjectFiles.bat')]
      : [join(batch, target, 'GenerateProjectFiles.sh'), join(root, 'GenerateProjectFiles.sh')];
  return {
    target,
    editor: join(
      root,
      'Engine/Binaries',
      target,
      platform === 'win32'
        ? 'UnrealEditor.exe'
        : platform === 'darwin'
          ? 'UnrealEditor.app/Contents/MacOS/UnrealEditor'
          : 'UnrealEditor',
    ),
    build: join(batch, platform === 'win32' ? 'Build.bat' : `${target}/Build.sh`),
    generate: generateCandidates.find(file),
    uat: join(batch, platform === 'win32' ? 'RunUAT.bat' : 'RunUAT.sh'),
  };
}

function inspectEngine(candidate, platform) {
  const root = resolve(candidate.root);
  const versionPath = join(root, 'Engine/Build/Build.version');
  let version;
  try {
    version = JSON.parse(readFileSync(versionPath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(`Cannot read engine Build.version at ${versionPath}: ${error.message}`);
  }
  const numbers = [version.MajorVersion, version.MinorVersion, version.PatchVersion];
  if (!numbers.every((part) => Number.isSafeInteger(part) && part >= 0))
    throw new Error(`Invalid engine version fields in ${versionPath}`);
  if (numbers[0] !== 5 || numbers[1] < 4)
    throw new Error(
      `Unreal ${numbers.join('.')} is outside this source baseline: UE 5.4 or newer 5.x is required by BuildSettingsVersion.V5. This is not a compilation compatibility guarantee.`,
    );
  const paths = engineLayout(root, platform);
  if (!file(paths.editor))
    throw new Error(
      `Unreal Editor executable is absent: ${paths.editor}. Verify this engine installation in Epic Games Launcher.`,
    );
  return {
    root: realpathSync(root),
    version: numbers.join('.'),
    versionNumbers: numbers,
    buildVersion: version,
    source: candidate.source,
    versionPath,
    ...paths,
  };
}

/** Selects a local installation only; it never installs, upgrades or edits an engine. */
export function discoverEngine(options = {}, overrides = {}) {
  const context = hostContext(overrides);
  const explicit = options.engine || envValue(context.env, 'UE_ROOT');
  if (explicit) {
    const source = options.engine ? '--engine' : 'UE_ROOT';
    try {
      const engine = inspectEngine({ root: explicit, source }, context.platform);
      return { engine, candidates: [{ ...engine, valid: true }], warnings: [] };
    } catch (error) {
      throw new Error(
        `${source} selected ${explicit}: ${error.message} Correct that explicit selection; no other engine was substituted.`,
      );
    }
  }
  const candidates = [];
  const warnings = [];
  const seen = new Set();
  const add = (root, source) => {
    if (typeof root !== 'string' || !root.trim()) return;
    const key = context.platform === 'win32' ? resolve(root).toLowerCase() : resolve(root);
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ root: resolve(root), source });
  };
  const home = envValue(
    context.env,
    context.platform === 'win32' ? 'USERPROFILE' : 'HOME',
    homedir(),
  );
  const launcherPaths =
    context.platform === 'win32'
      ? [
          join(
            envValue(context.env, 'ProgramData', 'C:\\ProgramData'),
            'Epic/UnrealEngineLauncher/LauncherInstalled.dat',
          ),
        ]
      : context.platform === 'darwin'
        ? [
            join(
              home,
              'Library/Application Support/Epic/UnrealEngineLauncher/LauncherInstalled.dat',
            ),
            '/Library/Application Support/Epic/UnrealEngineLauncher/LauncherInstalled.dat',
          ]
        : [];
  for (const path of launcherPaths) {
    if (!existsSync(path)) continue;
    try {
      const data = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
      if (!Array.isArray(data.InstallationList))
        throw new Error('InstallationList is not an array');
      for (const item of data.InstallationList)
        if (typeof item?.AppName === 'string' && /^UE_5(?:\.|$)/.test(item.AppName))
          add(item.InstallLocation, 'Epic Launcher');
    } catch (error) {
      warnings.push(`Ignored malformed ${path}: ${error.message}`);
    }
  }
  if (context.platform === 'win32') {
    const roots = queryRegistry(context, registryEngines);
    if (roots) for (const root of roots) add(root, 'Windows registry');
    else
      warnings.push(
        'Windows registry lookup was unavailable; use --engine if your custom installation is not discovered.',
      );
  }
  const defaultParents =
    context.platform === 'win32'
      ? [
          ...new Set(
            [
              envValue(context.env, 'ProgramW6432'),
              envValue(context.env, 'ProgramFiles', 'C:\\Program Files'),
            ].filter(Boolean),
          ),
        ].map((path) => join(path, 'Epic Games'))
      : context.platform === 'darwin'
        ? ['/Users/Shared/Epic Games', '/Users/Shared']
        : ['/opt', join(home, 'Epic Games')];
  for (const parent of defaultParents)
    for (const name of directories(parent))
      if (/^UE_5(?:\.|$)/.test(name)) add(join(parent, name), 'Known install directory');
  if (context.platform === 'linux')
    for (const path of ['/opt/UnrealEngine', '/opt/unreal-engine', join(home, 'UnrealEngine')])
      if (existsSync(join(path, 'Engine/Build/Build.version')))
        add(path, 'Known install directory');
  const inspected = candidates.map((candidate) => {
    try {
      return { ...inspectEngine(candidate, context.platform), valid: true };
    } catch (error) {
      warnings.push(`${candidate.root}: ${error.message}`);
      return { ...candidate, valid: false, error: error.message };
    }
  });
  const valid = inspected
    .filter((candidate) => candidate.valid)
    .sort((a, b) => {
      for (let index = 0; index < 3; index += 1)
        if (a.versionNumbers[index] !== b.versionNumbers[index])
          return b.versionNumbers[index] - a.versionNumbers[index];
      return a.root.localeCompare(b.root);
    });
  if (!valid.length)
    throw new Error(
      `No usable Unreal Engine 5.4+ installation was found. Supply --engine "C:/Program Files/Epic Games/UE_5.x" (replace 5.x with your installed version), or set UE_ROOT. Install/verify UE and its native C++ toolchain using Epic's supported setup. ${warnings.join(' ')}`,
    );
  return { engine: valid[0], candidates: inspected, warnings };
}

export function toolchainChecks(overrides = {}, engine) {
  const context = hostContext(overrides);
  const checks = [];
  if (context.platform === 'win32') {
    const installer = join(
      envValue(context.env, 'ProgramFiles(x86)', 'C:\\Program Files (x86)'),
      'Microsoft Visual Studio/Installer/vswhere.exe',
    );
    const result = probeCommand(context, installer, [
      '-all',
      '-products',
      '*',
      '-requires',
      'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
      '-format',
      'json',
      '-utf8',
    ]);
    const compilers = [];
    if (!result.error && result.status === 0) {
      try {
        const installs = JSON.parse(String(result.stdout).replace(/^\uFEFF/, ''));
        for (const install of Array.isArray(installs) ? installs : []) {
          if (typeof install.installationPath !== 'string') continue;
          const tools = join(install.installationPath, 'VC/Tools/MSVC');
          for (const version of directories(tools)) {
            const compiler = ['Hostx64/x64/cl.exe', 'Hostarm64/x64/cl.exe']
              .map((relative) => join(tools, version, 'bin', relative))
              .find(file);
            if (compiler)
              compilers.push({
                visualStudio: install.installationVersion,
                version,
                path: compiler,
              });
          }
        }
      } catch {
        // Unreadable discovery output must not be reported as an installed compiler.
      }
    }
    checks.push({
      id: 'visual-cpp',
      status: compilers.length ? 'ok' : 'error',
      details: compilers,
      message: compilers.length
        ? 'Visual C++ compiler files detected. UnrealBuildTool must validate versions for the selected engine.'
        : 'Visual C++ compiler not detected. In Visual Studio Installer add Game development with C++, MSVC x64/x86 build tools, and the Windows SDK required by your installed UE version. VS Code alone is insufficient.',
    });
    const sdkRoots = [
      ...new Set(
        [
          ...(queryRegistry(context, registrySdk) || []),
          envValue(context.env, 'WindowsSdkDir'),
          join(
            envValue(context.env, 'ProgramFiles(x86)', 'C:\\Program Files (x86)'),
            'Windows Kits/10',
          ),
        ].filter(Boolean),
      ),
    ];
    const sdks = [];
    for (const root of sdkRoots)
      for (const version of directories(join(root, 'Include')))
        if (
          file(join(root, 'Include', version, 'um/Windows.h')) &&
          file(join(root, 'Lib', version, 'um/x64/kernel32.lib')) &&
          file(join(root, 'bin', version, 'x64/rc.exe'))
        )
          sdks.push({ root, version });
    checks.push({
      id: 'windows-sdk',
      status: sdks.length ? 'ok' : 'error',
      details: sdks,
      message: sdks.length
        ? 'Windows SDK headers, x64 libraries and resource compiler detected. UnrealBuildTool must validate the selected SDK version.'
        : 'Windows SDK headers/libraries/resource compiler not detected. Add the Windows 10/11 SDK required by this UE version using Visual Studio Installer, then rerun doctor.',
    });
  } else if (context.platform === 'darwin') {
    const developer = probeCommand(context, 'xcode-select', ['-p']);
    const sdk = probeCommand(context, 'xcrun', ['--sdk', 'macosx', '--show-sdk-path']);
    const available = developer.status === 0 && sdk.status === 0;
    checks.push({
      id: 'mac-toolchain',
      status: available ? 'ok' : 'error',
      message: available
        ? `Xcode/SDK detected: ${String(developer.stdout).trim()} / ${String(sdk.stdout).trim()}. UnrealBuildTool must validate the selected versions.`
        : 'Install/select the Xcode version required by your UE installation and complete its first launch, then rerun doctor.',
    });
  } else if (context.platform === 'linux') {
    const bundled =
      engine &&
      directories(join(engine.root, 'Engine/Extras/ThirdPartyNotUE/SDKs/HostLinux/Linux_x64'))
        .length > 0;
    const compiler = probeCommand(context, 'clang++', ['--version']);
    checks.push({
      id: 'linux-toolchain',
      status: bundled || compiler.status === 0 ? 'ok' : 'warning',
      message: bundled
        ? 'An engine-bundled Linux SDK directory is present; UnrealBuildTool must validate it.'
        : compiler.status === 0
          ? `${String(compiler.stdout).split('\n')[0]}. UnrealBuildTool must validate engine/toolchain compatibility.`
          : 'No bundled Linux SDK or clang++ was detected. Follow the Linux toolchain setup for the selected UE version; this doctor does not install an SDK.',
    });
  } else {
    checks.push({
      id: 'platform',
      status: 'error',
      message: `Unsupported desktop platform: ${context.platform}`,
    });
  }
  return checks;
}
