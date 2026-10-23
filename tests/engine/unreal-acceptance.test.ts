import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { prepareUnrealAcceptance } from '../../scripts/unreal-acceptance';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function temporary() {
  const root = await mkdtemp(join(tmpdir(), 'vw-unreal-acceptance-'));
  roots.push(root);
  return root;
}

async function fixtureKit(root: string) {
  const data = join(root, 'projects/prince/Content/VirtualWorldData');
  await mkdir(data, { recursive: true });
  const bytes = JSON.stringify({ fixture: 'launcher argument routing, not engine execution' });
  await writeFile(join(data, 'engine-manifest.json'), bytes);
  const kit = {
    version: 1,
    projects: [
      {
        id: 'prince',
        path: 'projects/prince',
        sceneIds: ['little-prince-b612'],
        manifestSha256: createHash('sha256').update(bytes).digest('hex'),
      },
    ],
    cases: [{ sceneId: 'little-prince-b612', project: 'prince', label: 'B612' }],
  };
  await writeFile(join(root, 'acceptance-kit.json'), JSON.stringify(kit));
}

it('refuses an existing acceptance directory and symlink without changing user work', async () => {
  const root = await temporary();
  const existing = join(root, 'existing');
  await mkdir(existing);
  await writeFile(join(existing, 'keep.txt'), 'user work');
  const link = join(root, 'link');
  await symlink(existing, link, process.platform === 'win32' ? 'junction' : 'dir');
  for (const out of [existing, link])
    await expect(prepareUnrealAcceptance({ out })).rejects.toThrow(/exists|存在/);
  expect(await readFile(join(existing, 'keep.txt'), 'utf8')).toBe('user work');
});

it('exports a standalone two-project kit with four real cases and pending human acceptance', async () => {
  const root = await temporary();
  const out = join(root, 'Unreal 验收 with spaces');
  const result = await prepareUnrealAcceptance({ out, projectRoot: resolve('.') });
  expect(result.projectPaths).toHaveLength(2);
  const kit = JSON.parse(await readFile(join(out, 'acceptance-kit.json'), 'utf8'));
  expect(kit.version).toBe(1);
  expect(kit.nativeExecution).toBe(false);
  expect(kit.cases.map((entry: { sceneId: string }) => entry.sceneId)).toEqual([
    'little-prince-desert',
    'little-prince-b612',
    'little-prince-earth',
    'demo-harmonic-joint',
  ]);
  for (const entry of kit.projects) {
    const base = join(out, entry.path);
    const manifest = JSON.parse(
      await readFile(join(base, 'Content/VirtualWorldData/engine-manifest.json'), 'utf8'),
    );
    expect(manifest.target).toBe('unreal');
    expect(manifest.scenes.map((scene: { id: string }) => scene.id)).toEqual(entry.sceneIds);
    for (const asset of manifest.assets)
      expect((await readFile(join(base, 'Content/VirtualWorldData', asset.path))).byteLength).toBe(
        asset.bytes,
      );
  }
  const checklist = JSON.parse(await readFile(join(out, 'manual-acceptance.json'), 'utf8'));
  expect(checklist.checks.length).toBeGreaterThan(10);
  expect(checklist.checks.every((check: { status: string }) => check.status === 'pending')).toBe(
    true,
  );
  expect(await readFile(join(out, 'Review.cmd'), 'utf8')).toContain('%~dp0');
  const runner = await import(/* @vite-ignore */ pathToFileURL(join(out, 'review.mjs')).href);
  expect((await runner.reviewCommand(['list'], out)).cases).toHaveLength(4);
  await expect(runner.reviewCommand(['play', '--scene', 'unknown'], out)).rejects.toThrow(
    /scene|场景/i,
  );
  await expect(
    runner.reviewCommand(['play', '--scene', 'little-prince-desert', '--typo'], out),
  ).rejects.toThrow(/Unknown|未知/);
}, 60000);

it('dispatches the requested chapter and a quoted engine path without a shell, and stops on build failure', async () => {
  const root = await temporary();
  const helper = join(root, 'projects/prince/Scripts/native.mjs');
  await mkdir(dirname(helper), { recursive: true });
  await writeFile(
    helper,
    `import{appendFileSync}from'node:fs';appendFileSync(new URL('../calls.jsonl',import.meta.url),JSON.stringify(process.argv.slice(2))+'\\n');if(process.argv.includes('build')&&process.env.VW_TEST_BUILD_FAILURE==='1')process.exit(17);`,
  );
  await fixtureKit(root);
  const runnerPath = resolve('scripts/unreal-review-runner.mjs');
  const runner = await import(/* @vite-ignore */ pathToFileURL(runnerPath).href);
  const engine = join(root, 'Epic Games', '虚幻 UE_5.7');
  await runner.reviewCommand(['play', '--scene', 'little-prince-b612', '--engine', engine], root);
  const calls = (await readFile(join(root, 'projects/prince/calls.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  expect(calls.map((call) => call[0])).toEqual(['prepare', 'build', 'run']);
  expect(calls.at(-1)).toEqual(['run', '--engine', engine, '--scene', 'little-prince-b612']);
  process.env.VW_TEST_BUILD_FAILURE = '1';
  try {
    await expect(
      runner.reviewCommand(['play', '--scene', 'little-prince-b612', '--engine', engine], root),
    ).rejects.toThrow(/17/);
  } finally {
    delete process.env.VW_TEST_BUILD_FAILURE;
  }
  const after = (await readFile(join(root, 'projects/prince/calls.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  expect(after.map((call) => call[0])).toEqual(['prepare', 'build', 'run', 'prepare', 'build']);
});

it('rejects kit path traversal and escaped project symlinks before executing helpers', async () => {
  const root = await temporary();
  const outside = await temporary();
  const runner = await import(
    /* @vite-ignore */ pathToFileURL(resolve('scripts/unreal-review-runner.mjs')).href
  );
  const config = {
    version: 1,
    projects: [{ id: 'prince', path: '../outside', sceneIds: ['little-prince-desert'] }],
    cases: [{ sceneId: 'little-prince-desert', project: 'prince' }],
  };
  await writeFile(join(root, 'acceptance-kit.json'), JSON.stringify(config));
  await expect(runner.reviewCommand(['doctor'], root)).rejects.toThrow(/path|目录|outside|路径/i);
  await symlink(outside, join(root, 'escaped'), process.platform === 'win32' ? 'junction' : 'dir');
  config.projects[0].path = 'escaped';
  await writeFile(join(root, 'acceptance-kit.json'), JSON.stringify(config));
  await expect(runner.reviewCommand(['doctor'], root)).rejects.toThrow(/path|outside|路径/i);
});

it('rejects project identifiers that could escape evidence output', async () => {
  const root = await temporary();
  await mkdir(join(root, 'projects/prince'), { recursive: true });
  const runner = await import(
    /* @vite-ignore */ pathToFileURL(resolve('scripts/unreal-review-runner.mjs')).href
  );
  await writeFile(
    join(root, 'acceptance-kit.json'),
    JSON.stringify({
      version: 1,
      projects: [{ id: '../outside', path: 'projects/prince', sceneIds: ['test'] }],
      cases: [{ sceneId: 'test', project: '../outside' }],
    }),
  );
  await expect(runner.reviewCommand(['report'], root)).rejects.toThrow(/project|identifier/i);
});

it('resolves caller-relative paths before changing into a native project', async () => {
  const root = await temporary();
  const helper = join(root, 'projects/prince/Scripts/native.mjs');
  await mkdir(dirname(helper), { recursive: true });
  await writeFile(
    helper,
    `import{writeFileSync}from'node:fs';writeFileSync(new URL('../calls.json',import.meta.url),JSON.stringify(process.argv.slice(2)));`,
  );
  await fixtureKit(root);
  const runner = await import(
    /* @vite-ignore */ pathToFileURL(resolve('scripts/unreal-review-runner.mjs')).href
  );
  await runner.reviewCommand(
    ['setup', '--engine', './Epic Games/UE_5.7', '--font-source', './downloads/Noto.otf'],
    root,
  );
  expect(JSON.parse(await readFile(join(root, 'projects/prince/calls.json'), 'utf8'))).toEqual([
    'prepare',
    '--engine',
    resolve('Epic Games/UE_5.7'),
    '--font-source',
    resolve('downloads/Noto.otf'),
  ]);
});

it('refuses to launch a changed manifest while still allowing its evidence to be collected', async () => {
  const root = await temporary();
  await fixtureKit(root);
  await writeFile(
    join(root, 'projects/prince/Content/VirtualWorldData/engine-manifest.json'),
    'changed after export',
  );
  await writeFile(
    join(root, 'manual-acceptance.json'),
    JSON.stringify({ checks: [{ status: 'pending' }] }),
  );
  const helper = join(root, 'projects/prince/Scripts/native.mjs');
  await mkdir(dirname(helper), { recursive: true });
  await writeFile(
    helper,
    `import{mkdirSync,writeFileSync}from'node:fs';import{join}from'node:path';if(process.argv[2]!=='evidence')process.exit(25);const out=process.argv[process.argv.indexOf('--out')+1];mkdirSync(out);writeFileSync(join(out,'fixture.json'),JSON.stringify({nativeExecution:false}));`,
  );
  const runner = await import(
    /* @vite-ignore */ pathToFileURL(resolve('scripts/unreal-review-runner.mjs')).href
  );
  await expect(
    runner.reviewCommand(['play', '--scene', 'little-prince-b612'], root),
  ).rejects.toThrow(/manifest.*changed|manifest.*match/i);
  const result = await runner.reviewCommand(['report', '--out', join(root, 'results')], root);
  expect(result.nativeExecutionVerified).toBe(false);
  expect(result.manifests[0].matched).toBe(false);
  expect(
    JSON.parse(await readFile(join(result.path, 'manual-acceptance.json'), 'utf8')).checks[0]
      .status,
  ).toBe('pending');
  await expect(runner.reviewCommand(['report', '--out', result.path], root)).rejects.toMatchObject({
    code: 'EEXIST',
  });
});

it('refuses evidence output inside a project, including a symlinked parent', async () => {
  const root = await temporary();
  await fixtureKit(root);
  const source = join(root, 'projects/prince/Source');
  await mkdir(source);
  await symlink(
    source,
    join(root, 'source-link'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const runner = await import(
    /* @vite-ignore */ pathToFileURL(resolve('scripts/unreal-review-runner.mjs')).href
  );
  for (const out of [join(source, 'new-report'), join(root, 'source-link/new-report')])
    await expect(runner.reviewCommand(['report', '--out', out], root)).rejects.toThrow(
      /inside.*project|project.*directory/i,
    );
  await expect(readFile(join(source, 'new-report/acceptance-kit.json'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
});
