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
    doc.extensionsRequired?.some((e: string) =>
      ['KHR_draco_mesh_compression', 'KHR_texture_basisu'].includes(e),
    )
  )
    throw new Error('首版请导入不含 Draco / KTX2 压缩的 GLB');
}
