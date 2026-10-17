import type { SceneSpec, SceneNode, Vector3Tuple } from './schema';
export function node(
  id: string,
  name: string,
  shape: SceneNode['shape'],
  position: Vector3Tuple,
  size: Vector3Tuple,
  color: string,
  extra: Partial<SceneNode> = {},
): SceneNode {
  return {
    id,
    name,
    kind: 'mesh',
    shape,
    position,
    size,
    color,
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    visible: true,
    ...extra,
  };
}
const common = {
  version: 1 as const,
  revision: 0,
  assets: [],
  tasks: [],
  environment: { background: '#10151f', lightIntensity: 3, ambientIntensity: 1.2 },
  camera: { position: [7, 5, 8] as Vector3Tuple, target: [0, 1, 0] as Vector3Tuple },
  spawn: [0, 1, 5] as Vector3Tuple,
};
export function industrialDemo(): SceneSpec {
  return {
    ...structuredClone(common),
    id: 'demo-industrial',
    name: '精密关节 · J-01',
    description: '从工程结构，到可交互的产品体验',
    mode: 'industrial',
    nodes: [
      node('platform', '展示基座', 'cylinder', [0, -0.22, 0], [5.8, 0.4, 5.8], '#171f2c', {
        roughness: 0.85,
      }),
      node('base', '01 · 安装底座', 'cylinder', [0, 0.16, 0], [2.15, 0.34, 2.15], '#333e50', {
        metalness: 0.75,
        roughness: 0.28,
        explode: [0, -0.7, 0],
        interaction: {
          title: '安装底座',
          text: '高刚性安装底座 · 4 × M8 安装孔\n外径 215 mm · 铝合金示意\n本样例为交互展示，尺寸不构成制造依据。',
        },
      }),
      node('housing', '02 · 伺服壳体', 'cylinder', [0, 1.05, 0], [1.65, 1.5, 1.65], '#758597', {
        metalness: 0.8,
        roughness: 0.27,
        explode: [-2.2, 0, 0],
        interaction: {
          title: '伺服壳体',
          text: '保护内部传动组件，提供散热与安装接口。\n可在属性面板修改材质和爆炸方向。',
        },
      }),
      node('ring-bottom', '03 · 密封环', 'torus', [0, 0.48, 0], [1.68, 0.1, 1.68], '#111a27', {
        rotation: [Math.PI / 2, 0, 0],
        explode: [0, 0.1, 2],
      }),
      node('ring-top', '04 · 输出端轴承', 'torus', [0, 1.72, 0], [1.72, 0.13, 1.72], '#a9b8c8', {
        metalness: 0.85,
        roughness: 0.2,
        rotation: [Math.PI / 2, 0, 0],
        explode: [0, 1.5, 0],
      }),
      node('shaft', '05 · 输出轴', 'cylinder', [0, 1.94, 0], [0.56, 0.8, 0.56], '#d4dce5', {
        metalness: 0.9,
        roughness: 0.2,
        explode: [0, 2.6, 0],
        joint: { axis: 'y', min: -1.57, max: 1.57, value: 0, confirmed: true },
        interaction: {
          title: '输出轴 · 旋转关节',
          text: '绕 Y 轴旋转，演示范围 −90° 至 +90°。\n使用顶部「运动演示」或右侧角度滑块查看。\n运动参数来自本样例的显式配置。',
        },
      }),
      node('flange', '06 · 输出法兰', 'cylinder', [0, 2.42, 0], [1.22, 0.22, 1.22], '#b3c0d0', {
        metalness: 0.9,
        roughness: 0.22,
        explode: [0, 3.2, 0],
      }),
      node('arm', '07 · 连接臂', 'box', [0.72, 0.15, 0], [1.8, 0.22, 0.42], '#e7a46c', {
        parentId: 'shaft',
        metalness: 0.6,
        roughness: 0.32,
        explode: [1.8, 0, 0],
      }),
      node('badge', '08 · 状态指示灯', 'box', [0, 1.03, 0.828], [0.45, 0.13, 0.04], '#80e6c0', {
        emissive: 0.8,
        explode: [0, 0, 2.8],
      }),
      ...Array.from({ length: 8 }, (_, i) => {
        const angle = (i * Math.PI) / 4;
        return node(
          `bolt-${i}`,
          `紧固件 ${i + 1}`,
          'cylinder',
          [Math.cos(angle) * 0.87, 0.38, Math.sin(angle) * 0.87],
          [0.13, 0.14, 0.13],
          '#b9c6d5',
          {
            metalness: 0.95,
            roughness: 0.3,
            explode: [Math.cos(angle) * 1.7, 0.8, Math.sin(angle) * 1.7],
          },
        );
      }),
      ...Array.from({ length: 12 }, (_, i) => {
        const angle = (i * Math.PI) / 6;
        return node(
          `fin-${i}`,
          `散热筋 ${i + 1}`,
          'box',
          [Math.cos(angle) * 0.827, 1.05, Math.sin(angle) * 0.827],
          [0.05, 1.06, 0.09],
          '#64758a',
          {
            rotation: [0, -angle, 0],
            metalness: 0.75,
            explode: [Math.cos(angle) * 1.8, 0, Math.sin(angle) * 1.8],
          },
        );
      }),
    ],
  };
}
export function worldDemo(): SceneSpec {
  const scene: SceneSpec = {
    ...structuredClone(common),
    id: 'demo-world',
    name: '星屿来信',
    description: '一座浮岛，一封未寄出的信，和等待被点亮的星空。',
    mode: 'world',
    environment: { background: '#151a30', lightIntensity: 2.6, ambientIntensity: 1.4, fog: 0.018 },
    camera: { position: [17, 12, 19], target: [0, 1, 0] },
    spawn: [0, 1, 6],
    assets: [
      {
        id: 'stardust',
        name: '星尘 · Gaussian Splat',
        type: 'splat',
        url: '/fixtures/stardust.ply',
        bytes: 0,
      },
    ],
    tasks: [
      { flag: 'met-keeper', label: '与守灯人交谈' },
      { flag: 'found-star', label: '在晶石花园寻找星核' },
      { flag: 'sent-letter', label: '将星核送到星门' },
    ],
    nodes: [
      node('island', '浮岛 · 岩层', 'rock', [0, -2.5, 0], [20, 4.6, 18], '#58678c'),
      node('ground', '浮岛 · 草地', 'cylinder', [0, -0.28, 0], [20, 0.6, 18], '#6c8b87', {
        collider: { shape: 'box', size: [18, 0.6, 16] },
      }),
      node('path', '星砂小径', 'box', [0, 0.04, 0], [2.1, 0.05, 13], '#aeb9a1'),
      node('observatory', '旧日观测台', 'cylinder', [0, 0.16, -4.8], [5, 0.35, 5], '#c7c9b6', {
        collider: { shape: 'box', size: [3.8, 0.35, 3.8] },
      }),
      node('gate', '归航星门', 'arch', [0, 0.35, -5], [3.2, 4.5, 0.65], '#d8d3bc', {
        emissive: 0.1,
        interaction: {
          title: '归航星门',
          text: '星核点亮了沉睡的星门。\n信已寄出，远方的你终会收到。\n\n谢谢你，让这座小岛重新拥有了星光。',
          requires: ['found-star'],
          gives: 'sent-letter',
          completes: true,
        },
      }),
      node('keeper', '守灯人 · 诺亚', 'character', [-3, 0, 2], [0.7, 1.7, 0.7], '#e7ba81', {
        interaction: {
          title: '守灯人 · 诺亚',
          text: '欢迎来到星屿，旅人。\n我有一封写给远方的信，却失去了点亮星门的星核。\n去右边的晶石花园找找吧，那里的光从未熄灭。',
          gives: 'met-keeper',
          choices: [
            {
              label: '这是什么地方？',
              text: '星屿是遗失的信件短暂停留的地方。每一束星光，都在等待一个愿意倾听的人。',
            },
            { label: '我会帮你找回星核', text: '谢谢你。沿着花园的微光，你会找到它。' },
          ],
        },
      }),
      node('star', '遗失的星核', 'crystal', [4.3, 0.9, 0], [0.65, 1.3, 0.65], '#a4ecf0', {
        emissive: 0.8,
        interaction: {
          title: '遗失的星核',
          text: '你轻轻拾起星核。温柔的光在掌心亮起。\n带它前往岛屿北侧的归航星门。',
          requires: ['met-keeper'],
          gives: 'found-star',
        },
      }),
      {
        ...node('splat-cloud', '星尘 · 3DGS', undefined, [0, 4, -5], [1, 1, 1], '#ffffff'),
        kind: 'splat',
        assetId: 'stardust',
      },
      node('letter', '未寄出的信', 'box', [-3, 0.8, 3.4], [0.55, 0.08, 0.4], '#efdfbc', {
        interaction: {
          title: '未寄出的信',
          text: '「如果你看见这片星光，请记得：\n再遥远的旅途，也有一盏灯为你亮着。」',
        },
      }),
    ],
  };
  const positions: [number, number, number][] = [
    [-6, 0, -3],
    [-7, 0, 1],
    [-5.6, 0, 5],
    [6.5, 0, -4],
    [7, 0, 3],
    [4, 0, 6],
    [-4, 0, -6],
  ];
  positions.forEach((p, i) =>
    scene.nodes.push(
      node(
        `tree-${i}`,
        `星杉 ${i + 1}`,
        'tree',
        p,
        [1.6, 3 + (i % 3) * 0.5, 1.6],
        ['#8faeaa', '#aac1ac', '#7a9f9c'][i % 3],
        { collider: { shape: 'ball', size: [0.35, 0.8, 0.35] } },
      ),
    ),
  );
  for (let i = 0; i < 14; i++) {
    const a = i * 2.4;
    scene.nodes.push(
      node(
        `crystal-${i}`,
        `晶石 ${i + 1}`,
        'crystal',
        [4.4 + Math.sin(a) * 1.5, 0.2, Math.cos(a) * 1.7],
        [0.22, 0.5 + (i % 3) * 0.2, 0.22],
        i % 2 ? '#8bbbc9' : '#c1b0df',
        { emissive: 0.15 },
      ),
    );
  }
  for (let i = 0; i < 15; i++) {
    const a = i * 2.399;
    scene.nodes.push(
      node(
        `pebble-${i}`,
        `星岩 ${i + 1}`,
        'rock',
        [Math.sin(a) * 7.5, 0.2, Math.cos(a) * 6.5],
        [0.7, 0.5, 0.8],
        '#8998ab',
      ),
    );
  }
  return scene;
}
