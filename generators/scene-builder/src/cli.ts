import 'dotenv/config';
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { generateWorld } from './generate';
import { readWorld, listWorlds } from './io';
import { optimizeGlb, atomicWrite } from './pipeline';
import { optimizeWithBlender } from '@virtualworld/blender';
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    id: { type: 'string' },
    description: { type: 'string' },
    reference: { type: 'string' },
    planner: { type: 'string', default: 'llm' },
    assets: { type: 'string', default: 'builtin' },
    root: { type: 'string', default: '.' },
    world: { type: 'string' },
    input: { type: 'string' },
    output: { type: 'string' },
    blender: { type: 'boolean', default: false },
    'task-id': { type: 'string' },
    'task-node': { type: 'string' },
    help: { type: 'boolean' },
  },
});
const command = positionals[0];
try {
  if (values.help || !command) {
    console.log(`AI 3D World Generator (Node 24)
generate --id <id> --description <text> [--planner llm|builtin] [--assets builtin|tripo] [--reference image.png|https://...] [--blender] [--task-id task_...]
validate --world worlds/<id>  (or all worlds under --root)
optimize --input source.glb --output optimized.glb [--blender]
All commands accept --root <project-directory>. Paid asset generation requires --assets tripo and TRIPO_API_KEY.`);
  } else if (command === 'generate') {
    if (!values.id || !values.description)
      throw new Error('generate requires --id and --description');
    if (
      !['llm', 'builtin'].includes(values.planner!) ||
      !['builtin', 'tripo'].includes(values.assets!)
    )
      throw new Error('Unknown planner or asset provider');
    const result = await generateWorld({
      root: values.root!,
      id: values.id,
      description: values.description,
      referenceImage: values.reference,
      planner: values.planner as 'builtin' | 'llm',
      assets: values.assets as 'builtin' | 'tripo',
      blender: values.blender,
      taskId: values['task-id'],
      taskNodeId: values['task-node'],
    });
    console.log(
      JSON.stringify(
        {
          world: result.directory,
          manifest: result.manifest,
          nodes: result.scene.nodes.length,
          assets: result.scene.assets.length,
        },
        null,
        2,
      ),
    );
  } else if (command === 'validate') {
    const worlds = values.world
      ? [{ directory: values.world, scene: await readWorld(resolve(values.root!, values.world)) }]
      : await listWorlds(join(resolve(values.root!), 'worlds'));
    const { validateWorldAssets } = await import('./validate');
    for (const world of worlds) await validateWorldAssets(world.scene, resolve(values.root!));
    console.log(
      JSON.stringify(
        {
          valid: true,
          worlds: worlds.map((w) => ({
            directory: w.directory,
            id: w.scene.id,
            nodes: w.scene.nodes.length,
            assets: w.scene.assets.length,
          })),
        },
        null,
        2,
      ),
    );
  } else if (command === 'optimize') {
    if (!values.input || !values.output) throw new Error('optimize requires --input and --output');
    const source = resolve(values.root!, values.input),
      output = resolve(values.root!, values.output);
    if (source === output) throw new Error('Output must differ from source');
    let input = source;
    if (values.blender) {
      input = `${output}.blender.glb`;
      await optimizeWithBlender(source, input);
    }
    const result = await optimizeGlb(await readFile(input), output);
    await atomicWrite(`${output}.manifest.json`, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
  } else throw new Error(`Unknown command: ${command}`);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
}
