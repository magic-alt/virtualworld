import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { node } from '../../../packages/scene/src/demos';
import type { SceneAsset, SceneNode, Vector3Tuple } from '../../../packages/scene/src/schema';
import type { SceneCommand } from '../../../packages/scene/src/commands';
import { cadToGroup, type CadResult } from './cad';
import { assertSelfContainedGlb } from './glb';
export async function upload(file: Blob, name: string, signal?: AbortSignal): Promise<SceneAsset> {
  const response = await fetch(`/api/assets?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
    signal,
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error);
  return body;
}
function readStep(buffer: ArrayBuffer, signal: AbortSignal): Promise<CadResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker('/cad/worker.js');
    const done = () => {
      worker.terminate();
      signal.removeEventListener('abort', abort);
      clearTimeout(timer);
    };
    const abort = () => {
      done();
      reject(new DOMException('导入已取消', 'AbortError'));
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error('STEP 转换超过 90 秒，请简化模型后重试'));
    }, 90000);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    worker.onmessage = ({ data }) => {
      done();
      if (data.error) reject(new Error(data.error));
      else resolve(data.result);
    };
    worker.onerror = () => {
      done();
      reject(new Error('CAD Worker 加载失败，请运行 npm run fixtures'));
    };
    worker.postMessage(buffer, [buffer]);
  });
}
export function groupCommands(
  group: THREE.Object3D,
  asset: SceneAsset,
  name: string,
): SceneCommand[] {
  const prefix = `import-${crypto.randomUUID().slice(0, 8)}`;
  const commands: SceneCommand[] = [{ type: 'addAsset', asset }];
  function visit(object: THREE.Object3D, path: string, parentId?: string) {
    const id = path ? `${prefix}-${path.replaceAll('.', '-')}` : prefix;
    const mesh = object instanceof THREE.Mesh;
    const material = mesh
      ? ((Array.isArray(object.material)
          ? object.material[0]
          : object.material) as THREE.MeshStandardMaterial)
      : undefined;
    const color = material?.color ? `#${material.color.getHexString()}` : '#ffffff';
    const n: SceneNode = node(
      id,
      object.name || (path ? '零件' : name),
      mesh ? 'glb' : undefined,
      object.position.toArray() as Vector3Tuple,
      [1, 1, 1],
      color,
      {
        kind: mesh ? 'mesh' : 'group',
        parentId,
        rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
        scale: object.scale.toArray() as Vector3Tuple,
        ...(mesh ? { assetId: asset.id, assetNode: path, materialOverride: false } : {}),
        explode: mesh
          ? [object.position.x === 0 ? 0.5 : Math.sign(object.position.x), 0.5, 0]
          : undefined,
      },
    );
    commands.push({ type: 'addNode', node: n });
    object.children.forEach((child, i) => visit(child, path ? `${path}.${i}` : `${i}`, id));
  }
  visit(group, '');
  return commands;
}
export async function importFile(
  file: File,
  signal: AbortSignal,
  onProgress: (message: string) => void,
): Promise<SceneCommand[]> {
  if (file.size > 100 * 1024 * 1024) throw new Error('文件超过 100 MiB 上限');
  if (!file.size) throw new Error('文件为空');
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!['glb', 'step', 'stp', 'spz', 'ply'].includes(extension || ''))
    throw new Error('支持 GLB、STEP/STP、SPZ、Gaussian PLY');
  const safeName = file.name.replace(/[\\/\x00-\x1f]/g, '_');
  onProgress('读取模型…');
  const buffer = await file.arrayBuffer();
  if (signal.aborted) throw new DOMException('已取消', 'AbortError');
  if (extension === 'spz' || extension === 'ply') {
    if (extension === 'ply' && !new TextDecoder().decode(buffer.slice(0, 4096)).includes('f_dc_0'))
      throw new Error('需要包含 Gaussian 属性的 PLY，普通点云暂不支持');
    onProgress('保存 Gaussian Splat…');
    const asset = await upload(file, safeName, signal);
    return [
      { type: 'addAsset', asset },
      {
        type: 'addNode',
        node: {
          ...node(
            `splat-${crypto.randomUUID().slice(0, 8)}`,
            safeName,
            undefined,
            [0, 0, 0],
            [1, 1, 1],
            '#ffffff',
          ),
          kind: 'splat',
          assetId: asset.id,
        },
      },
    ];
  }
  let group: THREE.Group, asset: SceneAsset;
  if (extension === 'step' || extension === 'stp') {
    onProgress('正在本地转换 STEP（输出单位：米）…');
    const result = await readStep(buffer, signal);
    if (signal.aborted) throw new DOMException('已取消', 'AbortError');
    group = cadToGroup(result);
    onProgress('生成可移植 GLB…');
    const converted = (await new GLTFExporter().parseAsync(group, { binary: true })) as ArrayBuffer;
    group = (await new GLTFLoader().parseAsync(converted, '')).scene;
    await upload(file, safeName, signal);
    asset = await upload(new Blob([converted]), safeName.replace(/\.(step|stp)$/i, '.glb'), signal);
    asset.source = `${safeName} · STEP → Mesh · metres`;
  } else {
    onProgress('解析 GLB 层级…');
    assertSelfContainedGlb(buffer);
    group = (await new GLTFLoader().parseAsync(buffer, '')).scene;
    asset = await upload(file, safeName, signal);
  }
  if (signal.aborted) throw new DOMException('已取消', 'AbortError');
  onProgress('组装场景树…');
  return groupCommands(group, asset, safeName);
}
