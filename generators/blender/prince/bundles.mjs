import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const world = path.join(root, 'worlds/little-prince');
const json = (file, value) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
};
const node = (id, name, assetId, position, extra = {}) => ({
  id,
  name,
  kind: 'mesh',
  shape: 'glb',
  assetId,
  position,
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
  size: [1, 1, 1],
  color: '#ffffff',
  visible: true,
  ...extra,
});
const proxy = (id, name, position) => ({
  id,
  name,
  kind: 'group',
  position,
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
  size: [1, 1, 1],
  color: '#ffffff',
  visible: true,
});
const chapters = [
  ['desert', '沙海中的相遇'],
  ['b612', '每天照料的小星球'],
  ['earth', '玫瑰与狐狸'],
];
json(path.join(world, 'campaign.json'), {
  version: 1,
  id: 'little-prince',
  title: '小王子：照料与相遇',
  description: '走过沙海、小星球与地球的花园，在照料与相遇中读懂牵挂。',
  chapters: chapters.map(([key, title], index) => ({
    id: 'little-prince-' + key,
    title,
    directory: 'chapters/' + key,
    ...(index ? { requires: ['little-prince-' + chapters[index - 1][0]] } : {}),
  })),
});
for (const [index, [key, title]] of chapters.entries()) {
  const id = 'little-prince-' + key;
  const names = [
    'prince-' + key,
    'prince-character',
    ...(index === 0 ? ['prince-pilot'] : []),
    ...(index === 2 ? ['prince-fox'] : []),
  ];
  const assets = names.map((name) => ({
    id: name,
    name,
    type: 'glb',
    url: '/assets/optimized/showcase/' + name + '.glb',
    bytes: readFileSync(path.join(root, 'assets/optimized/showcase/' + name + '.glb')).length,
    source: 'generators/blender/prince/build.py',
  }));
  const nodes = [
    node('landscape', title, 'prince-' + key, [0, 0, 0], {
      collider: {
        shape: index === 1 ? 'ball' : 'mesh',
        size: index === 1 ? [6, 6, 6] : [22, 1, 22],
      },
    }),
  ];
  const interactions = {};
  const tasks = [];
  const task = (nid, name, pos, text, flag, requires = []) => {
    nodes.push(proxy(nid, name, pos));
    interactions[nid] = { title: name, text, gives: flag, requires };
    tasks.push({ flag, label: name });
  };
  if (index === 0) {
    nodes.push(
      node('prince', '金发的小旅人', 'prince-character', [0.3, -0.08, -1.4], {
        animation: { clip: 'Idle', loop: true },
      }),
    );
    task(
      'meeting',
      '请画一只羊',
      [0.3, 0.8, -1.4],
      '发动机停在沙海深处。一个金发孩子却只惦记一只羊。我画了一个有透气孔的箱子，他说：这样，羊也有自己的家了。',
      'sheep',
    );
    task(
      'plane',
      '修理飞机',
      [-3, 0.8, -1],
      '我还需要修理引擎。孩子讲起远方的一朵花，让这片安静的沙漠第一次有了牵挂。',
      'depart',
      ['sheep'],
    );
  } else if (index === 1) {
    for (const [i, [x, z]] of [
      [-1.6, 0.8],
      [1.6, 0.7],
      [0.6, -1.7],
    ].entries()) {
      nodes.push({
        ...proxy('volcano-collider-' + i, '火山碰撞边界', [
          x,
          Math.sqrt(36 - x * x - z * z) + 0.22,
          z,
        ]),
        collider: { shape: 'ball', size: [0.53, 0.53, 0.53] },
      });
    }
    nodes.push({
      ...proxy('globe-collider', '玻璃罩碰撞边界', [0, 6.4, 0]),
      collider: { shape: 'ball', size: [0.32, 0.32, 0.32] },
    });
    task(
      'rose',
      '给玫瑰浇水',
      [0, 6.4, 0],
      '她有刺，也有难以说出的温柔。我替她挡风，给她浇水；照料让这朵花有了属于我们的时间。',
      'rose',
    );
    task(
      'volcano',
      '清扫火山',
      [-1.6, 5.9, 0.8],
      '两座火山仍有温度，第三座睡着了。我也把它扫干净：每天的小事，值得认真完成。',
      'volcano',
      ['rose'],
    );
    task(
      'sapling',
      '辨认猴面包树幼苗',
      [-2, 5.9, -0.9],
      '一株幼苗现在很小。我学着分辨它，及时整理小星球，免得根须日后挤满家园。',
      'sapling',
      ['volcano'],
    );
    task(
      'sunset',
      '安静地看日落',
      [2, 5.9, 1],
      '把椅子挪一点，就能再陪夕阳坐一会儿。今天的照料已经完成，想念也慢慢变得清楚。',
      'sunset',
      ['sapling'],
    );
  } else {
    nodes.push(
      node('fox', '麦田边的狐狸', 'prince-fox', [2, -0.06, -1], {
        animation: { clip: 'Idle', loop: true },
      }),
    );
    task(
      'garden',
      '初见玫瑰花园',
      [-1.6, 0.5, -1],
      '花园里有许多相似的玫瑰。我一时难过，以为远方那朵花并不特别。',
      'garden',
    );
    task(
      'friend',
      '每天靠近一点',
      [2, 0.5, -1],
      '狐狸请我别急。今天坐远些，明天再近一点；在约好的时刻出现，陌生的脚步就会渐渐成为期待。',
      'friend',
      ['garden'],
    );
    task(
      'wheat',
      '金色麦田',
      [3, 0.5, -2],
      '狐狸不吃麦子，可金色从此会让它想起我的头发。一起度过的时间，改变了我们看世界的方式。',
      'wheat',
      ['friend'],
    );
    task(
      'reflection',
      '再看玫瑰',
      [-1.7, 0.5, -0.5],
      '我回到花园，终于明白：我照料过的那朵，带着浇水、挡风和倾听的记忆。我要回去承担这份牵挂。',
      'reflection',
      ['wheat'],
    );
  }
  const scene = {
    version: 1,
    id,
    name: title,
    description: [
      '沙漠中，一位迫降的飞行员遇见金发的小旅人。走到机翼旁，听听那只箱子里的羊。',
      '在小小的星球上照料玫瑰、清扫火山、辨认幼苗，再陪夕阳坐一会儿。',
      '先走进玫瑰花园，再与麦田边的狐狸慢慢熟悉，最后回到花旁，想想远方的牵挂。',
    ][index],
    mode: 'world',
    revision: 0,
    nodes,
    environment: {
      background: index === 1 ? '#b76d62' : index === 0 ? '#dfb17a' : '#a4c7bd',
      lightIntensity: 2.5,
      ambientIntensity: 1.5,
      fog: 0.015,
    },
    camera: {
      position: index === 1 ? [8, 10, 8] : [6, 5, 8],
      target: index === 1 ? [0, 6, 0] : [0, 0.7, 0],
    },
    spawn: index === 1 ? [0.8, 6.1, 1.2] : [0, 0.1, 2],
    navigation: index === 1 ? { kind: 'sphere', center: [0, 0, 0], radius: 6 } : { kind: 'plane' },
    actor: {
      assetId: index === 0 ? 'prince-pilot' : 'prince-character',
      height: 1.6,
      clips: { idle: 'Idle', walk: 'Walk', interact: 'Interact' },
    },
    campaign: { id: 'little-prince', chapterId: id, index },
  };
  const folder = path.join(world, 'chapters', key);
  Object.values(interactions).at(-1).completes = true;
  json(path.join(folder, 'scene.json'), scene);
  json(path.join(folder, 'story.json'), { version: 1, worldId: id, tasks, interactions });
  json(path.join(folder, 'assets.json'), { version: 1, worldId: id, assets });
}
