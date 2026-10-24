/** Finalize only after Blender has successfully exported the measured assembly. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import validator from 'gltf-validator';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const reportPath = resolve(root, 'assets/manifests/showcase/harmonic-joint.json');
const assetPath = resolve(root, 'assets/optimized/showcase/harmonic-joint.glb');
const report = JSON.parse(await readFile(reportPath, 'utf8'));
const bytes = await readFile(assetPath);
const doc = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
const validation = await validator.validateBytes(new Uint8Array(bytes), {
  uri: 'harmonic-joint.glb',
  maxIssues: 1000,
});
report.gltfValidation = validation;
report.sha256 = createHash('sha256').update(bytes).digest('hex');
if (validation.issues.numErrors) throw new Error(JSON.stringify(validation.issues));
// Verify identity transforms and single primitive; assetNode clone(false) must select an actual Mesh.
for (const n of doc.nodes) {
  if (n.translation || n.rotation || n.scale || n.matrix)
    throw new Error(`Unexpected part transform: ${n.name}`);
  if (doc.meshes[n.mesh].primitives.length !== 1)
    throw new Error(`Multi-primitive mesh: ${n.name}`);
}
const defaults = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
  size: [1, 1, 1],
  color: '#b8c8d8',
  visible: true,
};
const group = (id, name) => ({ ...defaults, id, name, kind: 'group', parentId: 'joint-root' });
const nodes = [
  { ...defaults, id: 'joint-root', name: 'H-100 · SI assembly', kind: 'group' },
  group('wave-input', '输入 · 空心转子 / 波发生器'),
  group('flex-motion', '柔轮 · 200 齿杯'),
  group('output-motion', '输出 · 负向 100:1'),
];
nodes[1].joint = { axis: 'y', min: -Math.PI * 20, max: Math.PI * 20, value: 0, confirmed: false };
const fullHousingIds = [],
  sectionHousingIds = [],
  fixedNodeIds = [];
const fullNames = new Set(report.parts.filter((p) => p.sectionOf).map((p) => p.sectionOf));
for (const p of report.parts) {
  const id = `harmonic-${p.name}`;
  const parentId =
    p.assembly === 'input'
      ? 'wave-input'
      : p.assembly === 'flex'
        ? 'flex-motion'
        : p.assembly === 'output'
          ? 'output-motion'
          : 'joint-root';
  if (fullNames.has(p.name)) fullHousingIds.push(id);
  if (p.sectionOf) sectionHousingIds.push(id);
  if (p.assembly === 'fixed') fixedNodeIds.push(id);
  const top = /output|crossroller|retainer/.test(p.name);
  const layer =
    {
      drive: 0.075,
      brake: 0.035,
      motor: 0,
      encoders: top ? -0.105 : 0.005,
      reducer:
        p.assembly === 'flex'
          ? -0.085
          : /input|bearing-seat|support-plate|bearing-balls/.test(p.name)
            ? -0.025
            : -0.055,
      output: -0.135,
    }[p.subsystem] ?? 0;
  nodes.push({
    ...defaults,
    id,
    name: p.name,
    kind: 'mesh',
    shape: 'glb',
    assetId: 'harmonic-joint-glb',
    assetNode: p.path,
    parentId,
    visible: !p.sectionOf,
    explode:
      p.subsystem === 'housing' && !['base-flange', 'rear-bore-seal'].includes(p.name)
        ? [0.1, 0, 0]
        : [0, layer, 0],
  });
}
const scene = {
  version: 1,
  revision: 0,
  id: 'demo-harmonic-joint',
  name: 'H-100 · 谐波关节剖解',
  description:
    '从下往上：谐波减速器 → 无框电机 → 选配抱闸 → 驱动器 · Ø100 × 84.3 mm 主体 · 18 mm 贯通孔 · 官方资料参考 / 原创内部重建',
  mode: 'industrial',
  environment: { background: '#101722', lightIntensity: 1.8, ambientIntensity: 0.6 },
  camera: { position: [0.19, -0.1, -0.22], target: [0, 0.042, 0] },
  spawn: [0, 0.02, 0.35],
  nodes,
  mechanism: {
    kind: 'harmonic',
    waveNodeId: 'wave-input',
    flexNodeId: 'flex-motion',
    outputNodeId: 'output-motion',
    fixedNodeIds,
    flexTeeth: 200,
    ringTeeth: 202,
    cosMorph: 'WaveCos',
    sinMorph: 'WaveSin',
    fullHousingIds,
    sectionHousingIds,
    dimensions: report.dimensions,
    referenceNotes:
      '参考零差云控官方外形 STEP、Harmonic Drive 结构手册、意优及泰科公开集成架构。内部为运动学示意；轴承滚动、齿面接触、转矩惯量及弹性受力未求解。PCB 为布局示意，抱闸为瞬时理想保持。非制造或载荷／制动验证。',
    subsystems: [
      [
        'housing',
        '壳体与安装',
        '参考官方外形重构的紧凑铝筒、黑色减速器环体、分层后盖及定位台阶。输出面是独立旋转法兰；剖视展示内部驱动板。',
      ],
      ['motor', '无框力矩电机', '定子叠片、18 齿铜绕组、20 极永磁转子；0.4 mm 名义气隙。'],
      [
        'reducer',
        '谐波减速器',
        '202 齿固定刚轮、200 齿杯形柔轮、椭圆波发生器与薄壁轴承；反向 100:1。齿形与弹性仅作原理模拟。',
      ],
      [
        'drive',
        '集成驱动板',
        '最上层环形 PCB、独立固定支撑、带锁扣的电源／总线插座、功率级、母线电容、控制器、电源／通信与三相端子。布局示意，不是已验证电路。',
      ],
      [
        'encoders',
        '双编码器',
        '输入与输出独立码环、固定读头和支撑；不据此声明实际分辨率与测量精度。',
      ],
      [
        'brake',
        '永磁掉电抱闸',
        '电机上方、驱动器下方：选配磁轭、永磁体、释放线圈、衔铁与摩擦面。线圈通电释放、掉电理想保持；不计算制动距离。',
      ],
      [
        'output',
        '输出支承',
        '底部独立旋转法兰：12 个输出安装孔、16 个内六角紧固件，外侧固定环另有 12 个安装孔及 12 个沉孔螺钉。孔圈按官方外形图比例重建，内部连接为原理模拟。',
      ],
    ].map(([id, name, description]) => ({
      id,
      name,
      description,
      nodeIds: report.parts.filter((p) => p.subsystem === id).map((p) => `harmonic-${p.name}`),
      ...(id === 'brake' ? { optional: 'brake' } : {}),
    })),
  },
};
const interactions = {
  'harmonic-fixed-circular-spline-202': {
    title: '固定刚轮 · 202 齿',
    text: '刚轮通过外圈肩部固定在壳体，柔轮 200 齿。固定刚轮时，输出角速度 = −输入角速度 / 100。齿形是展示用近似轮廓，不用于制造。',
  },
  'harmonic-flex-cup': {
    title: '杯形柔轮 · 200 齿',
    text: '薄壁杯口随双波变形，0.3 mm 径向变形；杯底连接输出。双波形变跟随相对柔轮的输入相位。未进行应力、疲劳或寿命验证。',
  },
  'harmonic-crossrollers-32-alternating-45deg': {
    title: '交叉滚子输出轴承',
    text: '32 个滚子交替 ±45°，内圈随输出、外圈固定。滚道截面简化，滚子自转与保持架公转未模拟；本演示不证明载荷能力或预紧性能。',
  },
  'harmonic-hollow-input-shaft': {
    title: '中空输入及传力路径',
    text: '18 mm 连续通孔。转子 → 中空输入轴 → 椭圆波发生器 → 柔轮 → 输出颈与法兰。输入由上下两个独立支承轴承定位。',
  },
  'harmonic-base-flange': {
    title: '名义尺寸与边界',
    text: '主体直径 100 mm、主体长 84.3 mm、接口在主体外伸出约 3.8 mm，贯通孔 18 mm。外形比例与孔圈参考零差 eRob90 官方图纸放大重建。自绘演示尺寸，不是厂商商品复刻；没有工程确认或性能合格声明。',
  },
};
const dir = resolve(root, 'worlds/demo-harmonic-joint');
await mkdir(dir, { recursive: true });
const write = (p, data) => writeFile(p, JSON.stringify(data, null, 2) + '\n');
await write(resolve(dir, 'scene.json'), scene);
await write(resolve(dir, 'story.json'), { version: 1, worldId: scene.id, tasks: [], interactions });
await write(resolve(dir, 'assets.json'), {
  version: 1,
  worldId: scene.id,
  assets: [
    {
      id: 'harmonic-joint-glb',
      name: 'H-100 original parametric assembly',
      type: 'glb',
      url: '/assets/optimized/showcase/harmonic-joint.glb',
      bytes: bytes.length,
      source: 'generators/blender/harmonic/recipe.json',
    },
  ],
});
report.finalNodePathsVerified = true;
await write(reportPath, report);
console.log(
  JSON.stringify({
    parts: report.parts.length,
    errors: validation.issues.numErrors,
    warnings: validation.issues.numWarnings,
    bytes: bytes.length,
  }),
);
