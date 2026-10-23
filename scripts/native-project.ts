import { mkdir, writeFile, rm, lstat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { unzipSync } from 'fflate';
import { listCampaigns, listWorlds } from '@virtualworld/scene-builder/io';
import { createExport } from '../apps/web/server/export';
import { unityRunner } from './native-unity-runner';

export async function prepareNativeProject(options: {
  target: 'unity' | 'unreal';
  sceneId: string;
  out: string;
  projectRoot?: string;
}) {
  if (!['unity', 'unreal'].includes(options.target)) throw new Error('Choose unity or unreal');
  const projectRoot = resolve(options.projectRoot ?? '.');
  const projectPath = resolve(options.out);
  try {
    await lstat(projectPath);
    throw new Error(`Output already exists; choose a fresh directory: ${projectPath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const worlds = await listWorlds(join(projectRoot, 'worlds'));
  const scene = worlds.find((world) => world.scene.id === options.sceneId)?.scene;
  if (!scene) throw new Error(`Unknown world: ${options.sceneId}`);
  const campaigns = await listCampaigns(join(projectRoot, 'worlds'));
  const campaign = scene.campaign
    ? campaigns.find((entry) => entry.id === scene.campaign!.id)
    : undefined;
  const scenes = campaign
    ? campaign.chapters.map((chapter) => {
        const chapterScene = worlds.find((world) => world.scene.id === chapter.id)?.scene;
        if (!chapterScene) throw new Error(`Missing campaign chapter: ${chapter.id}`);
        return chapterScene;
      })
    : [scene];
  const archive = await createExport(scene, {
    target: options.target,
    playerRoot: join(projectRoot, 'dist/player'),
    assetRoot: join(projectRoot, 'data/assets'),
    publicRoot: join(projectRoot, 'public'),
    runtimeAssetRoot: join(projectRoot, 'assets'),
    ...(campaign ? { campaign: { manifest: campaign, scenes } } : {}),
  });
  const files = unzipSync(archive);
  await mkdir(dirname(projectPath), { recursive: true });
  // Exclusive reservation: never replace an existing folder, including an empty one or symlink.
  await mkdir(projectPath);
  try {
    const base =
      options.target === 'unity' ? join(projectPath, 'Assets/VirtualWorldExport') : projectPath;
    for (const [name, bytes] of Object.entries(files)) {
      const destination = resolve(base, name);
      const rel = relative(base, destination);
      if (name.includes('\\') || isAbsolute(name) || rel.startsWith('..') || isAbsolute(rel))
        throw new Error('Unsafe native archive path');
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, bytes, { flag: 'wx' });
    }
    if (options.target === 'unity') {
      await mkdir(join(projectPath, 'Packages'));
      await mkdir(join(projectPath, 'ProjectSettings'));
      await writeFile(
        join(projectPath, 'Packages/manifest.json'),
        JSON.stringify(
          {
            dependencies: {
              'com.unity.cloud.gltfast': '6.14.1',
              'com.unity.modules.animation': '1.0.0',
              'com.unity.modules.audio': '1.0.0',
              'com.unity.modules.imgui': '1.0.0',
              'com.unity.modules.inputlegacy': '1.0.0',
              'com.unity.modules.textrendering': '1.0.0',
              'com.unity.modules.jsonserialize': '1.0.0',
              'com.unity.modules.physics': '1.0.0',
              'com.unity.modules.imageconversion': '1.0.0',
              'com.unity.modules.unitywebrequest': '1.0.0',
              'com.unity.modules.unitywebrequesttexture': '1.0.0',
            },
          },
          null,
          2,
        ) + '\n',
      );
      await mkdir(join(projectPath, 'Scripts'));
      await writeFile(join(projectPath, 'Scripts/native.mjs'), unityRunner);
      for (const name of ['Scripts/prepare-font.mjs', 'Scripts/NotoSansCJK-OFL.txt']) {
        if (!files[name]) throw new Error(`Unity font preparation file is missing: ${name}`);
        await writeFile(join(projectPath, name), files[name], { flag: 'wx' });
      }
    }
    const bindings = scenes.map((entry) => ({
      engine: options.target,
      sceneId: entry.id,
      revision: entry.revision,
      url:
        options.target === 'unity'
          ? `http://127.0.0.1:8080/?sceneId=${encodeURIComponent(entry.id)}`
          : 'http://127.0.0.1:8080/',
      default: false,
    }));
    await writeFile(
      join(projectPath, 'engine-runtime-config.example.json'),
      JSON.stringify(bindings, null, 2) + '\n',
    );
    await writeFile(
      join(projectPath, 'README-local.md'),
      `# ${options.target === 'unity' ? 'Unity' : 'Unreal Engine'} native project\n\nEntry scene: ${scene.id}. ${scenes.length} scene(s) retained.\n\nThis is source code and original/derived assets, not a compiled game. Install the native editor and dependencies before running. Native execution has not been certified by this exporter.\n\n${
        options.target === 'unity'
          ? 'Use Unity 6 with the built-in render pipeline. Run `node Scripts/prepare-font.mjs` to prepare the pinned, licensed Chinese font, then `node Scripts/native.mjs import --editor "C:/Program Files/Unity/Hub/Editor/YOUR_VERSION/Editor/Unity.exe"`. The first import restores pinned glTFast 6.14.1. Run `validate` with the same editor path. Build with `build --target StandaloneWindows64` or `build --target WebGL`; each --out is a fresh build directory. For an alternative font use --font Assets/Fonts/YourFont.ttf and preserve its license. The importer creates runnable scenes and a catalog below Assets/VirtualWorldExport/VirtualWorld-Native. Open a generated scene and press Play. For a later chapter, use a completed save or choose its exported entry explicitly.\n'
          : 'Run `node Scripts/native.mjs doctor` to detect the installed UE5 and inspect the toolchain. Run `node Scripts/native.mjs prepare` to prepare the pinned glTFRuntime plugin and licensed CJK font. Build with `node Scripts/native.mjs build`, then run `node Scripts/native.mjs run --scene ' +
            scene.id +
            '`. Pass --engine "D:/Epic Games/UE_5.7" (your actual root) or UE_ROOT when automatic discovery cannot select the right installation. Source baseline is UE5.4+; actual compatibility requires compilation. `open`, `generate`, `smoke`, `package` and `evidence --out FRESH_DIRECTORY` are also available. Read README-Unreal.md for controls, diagnostics and packaging.\n'
      }\n## Browser entry\n\nServe the actual Unity Web build or an Unreal Pixel Streaming frontend. Edit engine-runtime-config.example.json to use the correct deployment URLs, and set VW_ENGINE_RUNTIMES to that JSON in the Studio server environment. For Unreal, each advertised scene must point to a session launched for that scene; an URL query alone does not select the native game scene. Set default:true only after validating the build. Restart Studio. A configured deployment is not an automatic build or GPU server. Existing web playback remains available.\n\nRead compatibility.json and the engine-specific README before release.\n`,
    );
    return {
      projectPath,
      target: options.target,
      entrySceneId: scene.id,
      sceneIds: scenes.map((entry) => entry.id),
    };
  } catch (error) {
    // This invocation exclusively created this output; never delete a pre-existing project.
    await rm(projectPath, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({
      options: {
        target: { type: 'string' },
        scene: { type: 'string' },
        out: { type: 'string' },
        help: { type: 'boolean' },
      },
    });
    if (values.help) {
      console.log(
        'npm run native:export -- --target unity|unreal --scene SCENE_ID --out FRESH_DIRECTORY',
      );
    } else {
      if (!values.scene || !values.out || (values.target !== 'unity' && values.target !== 'unreal'))
        throw new Error('Required: --target unity|unreal --scene SCENE_ID --out FRESH_DIRECTORY');
      console.log(
        JSON.stringify(
          await prepareNativeProject({
            target: values.target,
            sceneId: values.scene,
            out: values.out,
          }),
          null,
          2,
        ),
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
