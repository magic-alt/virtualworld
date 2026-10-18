import { expect, it } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../apps/web/server/app';
import { industrialDemo } from '../fixtures/scenes';
import { assertScene, emptyScene } from '@virtualworld/scene-schema';

it('does not list, load or restore any of the four retired templates', async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), 'vw-retired-'));
  const retiredIds = ['demo-industrial', 'demo-world', 'generated-desert', 'generated-forest'];
  await mkdir(join(dataRoot, 'projects'));
  for (const id of retiredIds)
    await writeFile(
      join(dataRoot, `projects/${id}.json`),
      JSON.stringify({ ...industrialDemo(), id }),
    );
  const app = await createApp({ dataRoot });
  try {
    const listing = await app.inject('/api/projects');
    expect(listing.statusCode).toBe(200);
    expect(
      listing
        .json()
        .projects.map((p: { id: string }) => p.id)
        .sort(),
    ).toEqual(
      [
        'demo-harmonic-joint',
        'little-prince-desert',
        'little-prince-b612',
        'little-prince-earth',
      ].sort(),
    );
    for (const id of retiredIds) {
      expect((await app.inject(`/api/projects/${id}`)).statusCode).toBe(404);
      expect(
        (
          await app.inject({
            method: 'PUT',
            url: `/api/projects/${id}`,
            payload: { scene: { ...industrialDemo(), id }, baseRevision: 0 },
          })
        ).statusCode,
      ).toBe(400);
    }
    expect((await app.inject('/api/projects/demo-harmonic-joint')).statusCode).toBe(200);
  } finally {
    await app.close();
    await rm(dataRoot, { recursive: true, force: true });
  }
});
it('starts new scenes empty without retired geometry or campaign metadata', () => {
  for (const mode of ['world', 'industrial'] as const) {
    const scene = assertScene(emptyScene(mode));
    expect(scene.mode).toBe(mode);
    expect(scene.nodes).toEqual([]);
    expect(scene.assets).toEqual([]);
    expect(scene.campaign).toBeUndefined();
    expect(scene.mechanism).toBeUndefined();
  }
});
