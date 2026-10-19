// Exact built-in GLTFLoader extension handlers in pinned Three.js r180, excluding
// its legacy GLB 1 handler and the three decoder-dependent extensions below.
// Recheck against GLTFLoader.js constructor/plugins and parse() switch on upgrades.
const supportedRequiredExtensions = new Set([
  'KHR_lights_punctual',
  'KHR_materials_clearcoat',
  'KHR_materials_dispersion',
  'KHR_materials_ior',
  'KHR_materials_sheen',
  'KHR_materials_specular',
  'KHR_materials_transmission',
  'KHR_materials_iridescence',
  'KHR_materials_anisotropy',
  'KHR_materials_unlit',
  'KHR_materials_volume',
  'KHR_materials_emissive_strength',
  'KHR_texture_transform',
  'KHR_mesh_quantization',
  'EXT_materials_bump',
  'EXT_texture_webp',
  'EXT_texture_avif',
  'EXT_mesh_gpu_instancing',
]);

export function assertSelfContainedGlb(buffer: ArrayBuffer): void {
  if (buffer.byteLength < 20) throw new Error('无效 GLB 文件头');
  const view = new DataView(buffer);
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== buffer.byteLength ||
    view.getUint32(16, true) !== 0x4e4f534a
  )
    throw new Error('无效 GLB 2.0 容器');
  const length = view.getUint32(12, true);
  if (length > buffer.byteLength - 20) throw new Error('GLB JSON 数据截断');
  const doc = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, length)));
  for (const item of [...(doc.buffers || []), ...(doc.images || [])])
    if (item.uri && !item.uri.startsWith('data:'))
      throw new Error('GLB 包含外部资源，请将纹理和几何嵌入为自包含 GLB 后再导入');
  if (
    // r180 constructs its Draco handler from extensionsUsed and immediately
    // requires a decoder, even when a file also contains uncompressed fallback.
    // Optional BasisU/Meshopt keep their loader-supported fallback behavior.
    doc.extensionsUsed?.includes('KHR_draco_mesh_compression') ||
    doc.extensionsRequired?.some((e: string) =>
      ['KHR_draco_mesh_compression', 'KHR_texture_basisu', 'EXT_meshopt_compression'].includes(e),
    )
  )
    throw new Error('首版请导入不含 Draco / KTX2 / Meshopt 压缩的 GLB');
  const unsupported = doc.extensionsRequired?.filter(
    (extension: string) => !supportedRequiredExtensions.has(extension),
  );
  if (unsupported?.length)
    throw new Error(`GLB 包含运行时不支持的必需扩展: ${unsupported.join(', ')}`);
}
