import * as THREE from 'three';
export type CadResult = {
  success: boolean;
  root: { name: string; meshes: number[]; children: CadResult['root'][] };
  meshes: {
    name: string;
    color?: number[];
    attributes: { position: { array: number[] }; normal?: { array: number[] } };
    index: { array: number[] };
    brep_faces?: { first: number; last: number; color: number[] | null }[];
  }[];
};
export function cadToGroup(result: CadResult) {
  if (!result.success || !result.meshes.length) throw new Error('STEP 无有效网格');
  const makeMesh = (index: number) => {
    const m = result.meshes[index];
    if (!m) throw new Error('STEP 网格引用无效');
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(m.attributes.position.array, 3));
    g.setIndex(m.index.array);
    if (m.attributes.normal)
      g.setAttribute('normal', new THREE.Float32BufferAttribute(m.attributes.normal.array, 3));
    else g.computeVertexNormals();
    const baseColor = new THREE.Color().setRGB(
      ...((m.color || [0.64, 0.71, 0.8]) as [number, number, number]),
      THREE.SRGBColorSpace,
    );
    const mats = [
      new THREE.MeshStandardMaterial({ color: baseColor, metalness: 0.35, roughness: 0.45 }),
    ];
    if (m.brep_faces?.length) {
      // CAD faces are opaque and differ only in color. Batch equal colors instead
      // of making one renderer section (and one copied vertex stream in UE) per face.
      const materialIds = new Map<string, number>([[baseColor.toArray().join(','), 0]]);
      const batches = new Map<number, number[]>();
      const append = (start: number, count: number, material: number) => {
        const batch = batches.get(material) ?? [];
        for (let i = start; i < start + count; i++) batch.push(m.index.array[i]);
        batches.set(material, batch);
      };
      let cursor = 0;
      for (const face of m.brep_faces) {
        const start = face.first * 3,
          count = (face.last - face.first + 1) * 3;
        if (start > cursor) append(cursor, start - cursor, 0);
        let material = 0;
        if (face.color) {
          const color = new THREE.Color().setRGB(
            ...(face.color as [number, number, number]),
            THREE.SRGBColorSpace,
          );
          const key = color.toArray().join(',');
          material = materialIds.get(key) ?? mats.length;
          if (!materialIds.has(key)) {
            materialIds.set(key, material);
            mats.push(new THREE.MeshStandardMaterial({ color, metalness: 0.35, roughness: 0.45 }));
          }
        }
        append(start, count, material);
        cursor = start + count;
      }
      if (cursor < m.index.array.length) append(cursor, m.index.array.length - cursor, 0);
      const indices: number[] = [];
      for (const [material, batch] of batches) {
        g.addGroup(indices.length, batch.length, material);
        for (const index of batch) indices.push(index);
      }
      g.setIndex(indices);
    }
    const mesh = new THREE.Mesh(g, mats.length > 1 ? mats : mats[0]);
    mesh.name = m.name || `零件 ${index + 1}`;
    return mesh;
  };
  const visit = (root: CadResult['root']) => {
    const group = new THREE.Group();
    group.name = root.name || '装配';
    root.meshes?.forEach((i) => group.add(makeMesh(i)));
    root.children?.forEach((child) => group.add(visit(child)));
    return group;
  };
  return visit(result.root);
}
