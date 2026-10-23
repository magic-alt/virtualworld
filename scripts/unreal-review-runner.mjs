import { spawn } from 'node:child_process';
import { copyFile, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';

const defaultRoot = dirname(fileURLToPath(import.meta.url));
const usage = `VirtualWorld Unreal 本地验收
node review.mjs menu [--engine UE_ROOT]
node review.mjs list
node review.mjs doctor|setup|build|smoke [--project prince|joint|all] [--engine UE_ROOT]
node review.mjs play|open --scene SCENE_ID [--engine UE_ROOT]
node review.mjs setup [--font-source DOWNLOADED_OTF] [--engine UE_ROOT]
node review.mjs report [--out FRESH_DIRECTORY]

play/open 会准备固定版本插件与字体并编译目标工程，再启动真实 Unreal。
doctor 不安装组件；report 只收集现有结果，不生成原生或人工通过结论。`;

function parse(argv) {
  const [command = 'menu', ...args] = argv;
  if (
    ![
      'menu',
      'list',
      'doctor',
      'setup',
      'build',
      'play',
      'open',
      'smoke',
      'report',
      'help',
    ].includes(command)
  )
    throw new Error(`Unknown command: ${command}\n${usage}`);
  const options = {};
  const allowed = {
    menu: ['engine', 'font-source'],
    list: [],
    help: [],
    doctor: ['engine', 'project'],
    setup: ['engine', 'project', 'font-source'],
    build: ['engine', 'project'],
    smoke: ['engine', 'project'],
    play: ['engine', 'scene'],
    open: ['engine', 'scene'],
    report: ['out'],
  };
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i].replace(/^--/, '');
    if (!args[i].startsWith('--') || !allowed[command].includes(name))
      throw new Error(`Unknown option: ${args[i]}`);
    if (Object.hasOwn(options, name)) throw new Error(`Duplicate option: ${args[i]}`);
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value: ${args[i]}`);
    options[name] = ['engine', 'font-source', 'out'].includes(name)
      ? resolve(args[i + 1])
      : args[i + 1];
  }
  if (['play', 'open'].includes(command) && !options.scene)
    throw new Error('--scene SCENE_ID is required. Run node review.mjs list.');
  return { command, options };
}

function isWithin(root, candidate) {
  const path = relative(root, candidate);
  return (
    path !== '..' &&
    !path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) &&
    !isAbsolute(path)
  );
}

export async function readKit(root) {
  const base = await realpath(root);
  const kit = JSON.parse(await readFile(join(base, 'acceptance-kit.json'), 'utf8'));
  if (
    kit.version !== 1 ||
    !Array.isArray(kit.projects) ||
    !Array.isArray(kit.cases) ||
    kit.projects.length === 0
  )
    throw new Error('Invalid acceptance-kit.json; regenerate the kit from the repository.');
  const ids = new Set();
  for (const project of kit.projects) {
    if (
      typeof project.id !== 'string' ||
      !/^[A-Za-z0-9_-]+$/.test(project.id) ||
      ids.has(project.id) ||
      typeof project.path !== 'string' ||
      !Array.isArray(project.sceneIds)
    )
      throw new Error('Invalid or duplicate kit project.');
    ids.add(project.id);
    const path = resolve(base, project.path);
    if (
      isAbsolute(project.path) ||
      project.path.includes('\\') ||
      !isWithin(base, path) ||
      path === base
    )
      throw new Error(`Project path outside kit: ${project.path}`);
    if (!isWithin(base, await realpath(path)))
      throw new Error(`Project path resolves outside kit: ${project.path}`);
  }
  const scenes = new Set();
  for (const entry of kit.cases) {
    const project = kit.projects.find((project) => project.id === entry.project);
    if (
      !project ||
      typeof entry.sceneId !== 'string' ||
      scenes.has(entry.sceneId) ||
      !project.sceneIds.includes(entry.sceneId)
    )
      throw new Error('Invalid or duplicate case scene in acceptance-kit.json.');
    scenes.add(entry.sceneId);
  }
  return kit;
}

function selectedProjects(kit, requested = 'all') {
  const projects =
    requested === 'all' ? kit.projects : kit.projects.filter((project) => project.id === requested);
  if (!projects.length) throw new Error(`Unknown project: ${requested}. Use prince, joint or all.`);
  return projects;
}

async function manifestBinding(root, project) {
  const path = join(root, project.path, 'Content/VirtualWorldData/engine-manifest.json');
  try {
    if (!isWithin(await realpath(join(root, project.path)), await realpath(path)))
      throw new Error('Manifest path resolves outside project.');
    const actual = createHash('sha256')
      .update(await readFile(path))
      .digest('hex');
    return {
      project: project.id,
      expected: project.manifestSha256 ?? null,
      actual,
      matched:
        /^[a-f0-9]{64}$/.test(project.manifestSha256 ?? '') && actual === project.manifestSha256,
    };
  } catch (error) {
    return {
      project: project.id,
      expected: project.manifestSha256 ?? null,
      actual: null,
      matched: false,
      error: error.message,
    };
  }
}

async function native(root, project, argv) {
  const directory = resolve(root, project.path);
  const script = join(directory, 'Scripts/native.mjs');
  if (!(await lstat(script)).isFile() || !isWithin(await realpath(root), await realpath(script)))
    throw new Error('Native helper path must be a regular file inside the kit.');
  if (argv[0] !== 'evidence' && !(await manifestBinding(root, project)).matched)
    throw new Error(
      `[${project.id}] Manifest changed or does not match this kit. Generate a fresh kit; report can still collect existing failure evidence.`,
    );
  console.log(`\n[${project.id}] ${argv[0]}`);
  await new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [script, ...argv], {
      cwd: directory,
      stdio: 'inherit',
      shell: false,
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolveRun();
      else
        reject(
          new Error(
            `[${project.id}] ${argv[0]} failed (exit ${code ?? signal}); inspect its Saved/VirtualWorld logs. No pass is recorded.`,
          ),
        );
    });
  });
}

async function collect(root, kit, requested) {
  const out = requested
    ? resolve(requested)
    : join(
        root,
        'reports',
        `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`,
      );
  let existing = out;
  while (true) {
    try {
      await lstat(existing);
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = dirname(existing);
      if (parent === existing) throw error;
      existing = parent;
    }
  }
  const physicalOut = resolve(await realpath(existing), relative(existing, out));
  for (const project of kit.projects) {
    if (isWithin(await realpath(join(root, project.path)), physicalOut))
      throw new Error(
        'Evidence output must not be inside a project directory. Choose the kit reports directory or a fresh external directory.',
      );
  }
  await mkdir(dirname(out), { recursive: true });
  // Exclusive reservation refuses existing folders and dangling symlinks.
  await mkdir(out);
  const result = {
    kind: 'acceptance-evidence-collection',
    createdAt: new Date().toISOString(),
    nativeExecutionVerified: false,
    visualAcceptanceVerified: false,
    source: kit.source,
    manifests: await Promise.all(kit.projects.map((project) => manifestBinding(root, project))),
    projects: [],
    manualChecklist: 'manual-acceptance.json',
  };
  await copyFile(join(root, 'acceptance-kit.json'), join(out, 'acceptance-kit.json'));
  await copyFile(join(root, 'manual-acceptance.json'), join(out, 'manual-acceptance.json'));
  for (const project of kit.projects) {
    try {
      await native(root, project, ['evidence', '--out', join(out, project.id)]);
      result.projects.push({ project: project.id, collected: true, path: project.id });
    } catch (error) {
      result.projects.push({ project: project.id, collected: false, error: error.message });
    }
  }
  await writeFile(join(out, 'collection.json'), JSON.stringify(result, null, 2) + '\n', {
    flag: 'wx',
  });
  await writeFile(
    join(out, 'README.txt'),
    'This folder collects existing results only. It is not a native engine or visual acceptance pass.\nCheck per-project command exit codes, matching smoke run IDs and your manual-acceptance.json.\nReview logs/screenshots for local paths or personal information before sharing.\n',
    { flag: 'wx' },
  );
  console.log(`验收资料目录: ${out}`);
  if (result.projects.some((project) => !project.collected))
    throw new Error(
      `Evidence collection incomplete; details retained in ${join(out, 'collection.json')}`,
    );
  return { ...result, path: out };
}

async function menu(root, options) {
  if (!process.stdin.isTTY)
    throw new Error(
      'Menu requires an interactive terminal. Use doctor, play, smoke or report commands instead.',
    );
  const input = createInterface({ input: process.stdin, output: process.stdout });
  const engineArgs = options.engine ? ['--engine', options.engine] : [];
  const choices = {
    1: ['doctor', ...engineArgs],
    2: [
      'setup',
      ...engineArgs,
      ...(options['font-source'] ? ['--font-source', options['font-source']] : []),
    ],
    3: ['play', '--scene', 'little-prince-desert', ...engineArgs],
    4: ['play', '--scene', 'little-prince-b612', ...engineArgs],
    5: ['play', '--scene', 'little-prince-earth', ...engineArgs],
    6: ['play', '--scene', 'demo-harmonic-joint', ...engineArgs],
    7: ['smoke', ...engineArgs],
    8: ['report'],
    9: ['open', '--scene', 'little-prince-desert', ...engineArgs],
    10: ['open', '--scene', 'demo-harmonic-joint', ...engineArgs],
  };
  try {
    while (true) {
      console.log(
        '\nVirtualWorld · Unreal 本地验收\n1 环境检查（不安装）\n2 准备固定版本插件和中文字体（首次联网下载）\n3 小王子：沙漠\n4 小王子：B612\n5 小王子：地球\n6 H-100 关节模组\n7 编译并运行两个工程的原生 smoke\n8 收集现有日志与人工验收表\n9 在 Editor 中打开小王子\n10 在 Editor 中打开关节模组\n0 退出\n启动项会检查依赖并增量编译；关闭引擎窗口后返回本菜单。',
      );
      const value = (await input.question('请选择: ')).trim();
      if (value === '0') break;
      if (!choices[value]) {
        console.log('请选择列表中的编号。');
        continue;
      }
      try {
        await reviewCommand(choices[value], root);
      } catch (error) {
        console.error(error.message);
      }
    }
  } finally {
    input.close();
  }
}

export async function reviewCommand(argv, root = defaultRoot) {
  const { command, options } = parse(argv);
  if (command === 'help') {
    console.log(usage);
    return;
  }
  const kit = await readKit(root);
  if (command === 'list') return { projects: kit.projects, cases: kit.cases };
  if (command === 'menu') return menu(root, options);
  if (command === 'report') return collect(root, kit, options.out);
  const engine = options.engine ? ['--engine', options.engine] : [];
  if (command === 'play' || command === 'open') {
    const entry = kit.cases.find((entry) => entry.sceneId === options.scene);
    if (!entry) throw new Error(`Unknown scene: ${options.scene}. Run node review.mjs list.`);
    const project = kit.projects.find((project) => project.id === entry.project);
    await native(root, project, ['prepare', ...engine]);
    await native(root, project, ['build', ...engine]);
    await native(root, project, [
      command === 'play' ? 'run' : 'open',
      ...engine,
      '--scene',
      entry.sceneId,
    ]);
    return;
  }
  const failures = [];
  for (const project of selectedProjects(kit, options.project)) {
    try {
      if (['setup', 'build', 'smoke'].includes(command))
        await native(root, project, [
          'prepare',
          ...engine,
          ...(options['font-source'] ? ['--font-source', options['font-source']] : []),
        ]);
      if (['build', 'smoke'].includes(command)) await native(root, project, ['build', ...engine]);
      if (command === 'doctor' || command === 'smoke')
        await native(root, project, [command, ...engine]);
    } catch (error) {
      failures.push(error.message);
    }
  }
  if (failures.length) throw new Error(failures.join('\n'));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await reviewCommand(process.argv.slice(2));
    if (result) console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
