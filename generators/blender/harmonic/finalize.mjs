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
      p.assembly === 'input'
        ? [0, -0.11, 0]
        : p.assembly === 'flex'
          ? [0, 0.1, 0]
          : top
            ? [0, 0.18, 0]
            : p.name.includes('housing') || p.name.includes('cooling')
              ? [0.16, 0, 0]
              : [0, -0.035, 0],
  });
}
const scene = {
  version: 1,
  revision: 0,
  id: 'demo-harmonic-joint',
  name: 'H-100 · 谐波关节剖解',
  description:
    '原创参数化工程教学样件 · 215 × 180 × 165 mm · 20 mm 中空通孔 · 非制造图 / 非额定性能证明',
  mode: 'industrial',
  environment: { background: '#101722', lightIntensity: 3, ambientIntensity: 1.5 },
  camera: { position: [0.3, 0.29, -0.34], target: [0, 0.085, 0] },
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
  },
};
const interactions = {
  'harmonic-fixed-circular-spline-202': {
    title: '固定刚轮 · 202 齿',
    text: '刚轮通过外圈肩部固定在壳体，柔轮 200 齿。固定刚轮时，输出角速度 = −输入角速度 / 100。齿形是展示用近似轮廓，不用于制造。',
  },
  'harmonic-flex-cup': {
    title: '杯形柔轮 · 200 齿',
    text: '薄壁杯口随双波变形，0.5 mm 径向变形；杯底连接输出。WaveCos / WaveSin 驱动相对柔轮的波相位。未进行应力、疲劳或寿命验证。',
  },
  'harmonic-crossrollers-32-alternating-45deg': {
    title: '交叉滚子输出轴承',
    text: '32 个滚子交替 ±45°，内圈随输出、外圈固定。滚道截面简化；本演示不证明载荷能力或预紧性能。',
  },
  'harmonic-hollow-input-shaft': {
    title: '中空输入及传力路径',
    text: '20 mm 连续通孔。转子 → 中空输入轴 → 椭圆波发生器 → 柔轮 → 输出颈与法兰。输入由上下两个独立支承轴承定位。',
  },
  'harmonic-base-flange': {
    title: '名义尺寸与边界',
    text: '底座直径 215 mm，壳体直径 180 mm，总高 165 mm。8 × Ø6.6 mm 底座通孔；输出 8 × Ø4.2 mm 孔。SI 单位，Y 轴向上。没有人工确认，也未声明扭矩、热、电气或 FEA 合格。',
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
