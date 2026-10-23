import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { prepareNativeProject } from './native-project';

const projects = [
  {
    id: 'prince',
    path: 'projects/prince',
    entrySceneId: 'little-prince-desert',
    sceneIds: ['little-prince-desert', 'little-prince-b612', 'little-prince-earth'],
  },
  {
    id: 'joint',
    path: 'projects/joint',
    entrySceneId: 'demo-harmonic-joint',
    sceneIds: ['demo-harmonic-joint'],
  },
];
const cases = [
  { sceneId: 'little-prince-desert', project: 'prince', label: '小王子 · 沙漠相遇' },
  { sceneId: 'little-prince-b612', project: 'prince', label: '小王子 · B612' },
  { sceneId: 'little-prince-earth', project: 'prince', label: '小王子 · 地球' },
  { sceneId: 'demo-harmonic-joint', project: 'joint', label: 'H-100 · 谐波关节模组' },
];
const checks = [
  [
    'prince-single-player',
    'little-prince-desert',
    '只有一位可控小王子；飞行员保留为 NPC；材质与 Idle/Walk/Interact 动画正常。',
  ],
  [
    'prince-plane-movement',
    'little-prince-desert',
    'WASD 相机相对移动；空格跳跃后落地；碰撞和地图边界无穿透或掉落；按住空格不连跳。',
  ],
  [
    'prince-desert-story',
    'little-prince-desert',
    '依次靠近“请画一只羊”(meeting) 与“陪飞行员修理飞机”(plane)，按 E 交互，完成两步剧情并解锁 B612。当前章节没有数字对话选项。',
  ],
  [
    'prince-sphere-movement',
    'little-prince-b612',
    '沿球面走到背面；脚下与相机径向一致，跳跃后落回球面；无速度失控或地面穿透。',
  ],
  [
    'prince-b612-story',
    'little-prince-b612',
    '完成四步任务；前置条件、交互距离和章节解锁符合剧情。',
  ],
  [
    'prince-earth-story',
    'little-prince-earth',
    '狐狸 Idle 和小王子动画正常；玫瑰/狐狸对话与最终完成状态正确。',
  ],
  [
    'prince-chinese-font',
    'little-prince-desert',
    '三个章节的中文任务、对话、选项清晰，无方框/乱码；独立打包后再检查。',
  ],
  [
    'prince-save-reset',
    'little-prince-earth',
    '退出重开保留已验证进度；重置只影响本工程剧情；从各章节直接进入后重置回启动章节。',
  ],
  [
    'joint-orbit',
    'demo-harmonic-joint',
    '右拖/方向键全周旋转，Q/F 滚转，滚轮缩放；Home 回到初始视角；近看小零件不裁掉。',
  ],
  [
    'joint-transmission',
    'demo-harmonic-joint',
    '200/202 齿示例的输出/输入为 -0.01；正转与反转方向一致，暂停和单步生效。',
  ],
  [
    'joint-morph',
    'demo-harmonic-joint',
    '观察实际柔轮顶点全周形变；正负 WaveCos/WaveSin 连续，无闪烁、裂口或只读数变化。',
  ],
  [
    'joint-brake',
    'demo-harmonic-joint',
    '抱闸安装且断电时运行/单步受阻；上电释放后恢复；这是运动学示意，不是力矩仿真。',
  ],
  [
    'joint-visibility',
    'demo-harmonic-joint',
    '剖切/全壳、0–100% 爆炸、各子系统隐藏/隔离能切换并恢复；Home 不重置机构状态。',
  ],
  [
    'joint-materials',
    'demo-harmonic-joint',
    '金属、透明/半透明件、边缘和层级在真实 GPU 中可辨识，模型尺度保持约 Ø100 mm。',
  ],
  [
    'desktop-performance',
    'all',
    '记录 GPU、分辨率、FPS 与至少 5 分钟操作结果；无持续错误日志、崩溃或异常增长。',
  ],
  [
    'packaged-offline',
    'all',
    '独立桌面打包后关闭 Studio/断开模型服务仍能运行；资源、插件许可与中文字体许可完整。',
  ],
].map(([id, sceneId, expected]) => ({
  id,
  sceneId,
  expected,
  status: 'pending',
  notes: '',
  evidence: [] as string[],
}));

function provenance(root: string) {
  const git = (args: string[]) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  const revision = git(['rev-parse', 'HEAD']);
  const status = git(['status', '--porcelain']);
  return {
    repository: 'https://github.com/magic-alt/virtualworld',
    commit: revision.status === 0 ? revision.stdout.trim() : null,
    dirty: status.status === 0 ? Boolean(status.stdout.trim()) : null,
  };
}

export async function prepareUnrealAcceptance(options: { out: string; projectRoot?: string }) {
  const out = resolve(options.out);
  const root = resolve(options.projectRoot ?? '.');
  try {
    await lstat(out);
    throw new Error(`Output already exists; choose a fresh directory: ${out}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await mkdir(dirname(out), { recursive: true });
  await mkdir(out);
  try {
    const projectRecords = [];
    for (const project of projects) {
      await prepareNativeProject({
        target: 'unreal',
        sceneId: project.entrySceneId,
        out: join(out, project.path),
        projectRoot: root,
      });
      const bytes = await readFile(
        join(out, project.path, 'Content/VirtualWorldData/engine-manifest.json'),
      );
      projectRecords.push({
        ...project,
        manifestSha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
    const kit = {
      version: 1,
      kind: 'unreal-local-acceptance-kit',
      generatedAt: new Date().toISOString(),
      nativeExecution: false,
      source: provenance(root),
      projects: projectRecords,
      cases,
    };
    await writeFile(join(out, 'acceptance-kit.json'), JSON.stringify(kit, null, 2) + '\n', {
      flag: 'wx',
    });
    await writeFile(
      join(out, 'manual-acceptance.json'),
      JSON.stringify(
        {
          version: 1,
          kind: 'manual-review',
          recordedBy: '',
          unrealVersion: '',
          os: '',
          gpu: '',
          resolution: '',
          allowedStatuses: ['pending', 'pass', 'fail', 'blocked'],
          checks,
        },
        null,
        2,
      ) + '\n',
      { flag: 'wx' },
    );
    await writeFile(
      join(out, 'review.mjs'),
      await readFile(new URL('./unreal-review-runner.mjs', import.meta.url)),
      { flag: 'wx' },
    );
    await writeFile(
      join(out, 'Review.cmd'),
      '@echo off\r\nsetlocal\r\nchcp 65001 >nul\r\nwhere node >nul 2>nul\r\nif errorlevel 1 (\r\n  echo Node.js 24 is required. Install it and reopen this window.\r\n  pause\r\n  exit /b 1\r\n)\r\nnode "%~dp0review.mjs" menu %*\r\nset "vw_review_exit=%errorlevel%"\r\nif not "%vw_review_exit%"=="0" pause\r\nexit /b %vw_review_exit%\r\n',
      { flag: 'wx' },
    );
    await writeFile(
      join(out, 'README-验收.md'),
      await readFile(join(root, 'docs/unreal-local-acceptance.md')),
      { flag: 'wx' },
    );
    return {
      path: out,
      projectPaths: projects.map((project) => join(out, project.path)),
      cases: cases.map((entry) => entry.sceneId),
      nativeExecution: false,
    };
  } catch (error) {
    await rm(out, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({
      options: { out: { type: 'string' }, help: { type: 'boolean' } },
    });
    if (values.help) console.log('npm run unreal:prepare -- --out FRESH_DIRECTORY');
    else {
      if (!values.out) throw new Error('Required: --out FRESH_DIRECTORY');
      console.log(JSON.stringify(await prepareUnrealAcceptance({ out: values.out }), null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
