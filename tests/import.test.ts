import { it, expect } from 'vitest';
import { ProjectScope } from '../apps/studio/src/operations';
import { assertSelfContainedGlb } from '../apps/studio/src/glb';
function glb(doc: unknown) {
  const text = JSON.stringify(doc),
    length = Math.ceil(text.length / 4) * 4;
  const data = new ArrayBuffer(20 + length),
    view = new DataView(data);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, data.byteLength, true);
  view.setUint32(12, length, true);
  view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(data, 20).fill(32);
  new Uint8Array(data, 20, text.length).set(new TextEncoder().encode(text));
  return data;
}
it('does not accept async work from another project, including returning to the same project ID', () => {
  const scope = new ProjectScope('A'),
    token = scope.capture();
  expect(scope.isCurrent(token)).toBe(true);
  scope.switchTo('B');
  expect(scope.isCurrent(token)).toBe(false);
  scope.switchTo('A');
  expect(scope.isCurrent(token)).toBe(false);
});
it('rejects GLB external buffer/image dependencies before parsing or export', () => {
  expect(() =>
    assertSelfContainedGlb(
      glb({ asset: { version: '2.0' }, buffers: [{ uri: 'https://example.com/mesh.bin' }] }),
    ),
  ).toThrow(/外部/);
  expect(() =>
    assertSelfContainedGlb(glb({ asset: { version: '2.0' }, images: [{ uri: 'local.png' }] })),
  ).toThrow(/外部/);
  expect(() =>
    assertSelfContainedGlb(
      glb({ asset: { version: '2.0' }, images: [{ uri: 'data:image/png;base64,AA==' }] }),
    ),
  ).not.toThrow();
});
it('rejects malformed binary containers', () =>
  expect(() => assertSelfContainedGlb(new ArrayBuffer(9))).toThrow());
