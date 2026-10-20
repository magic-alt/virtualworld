import { readFileSync } from 'node:fs';

/** Keep native sources readable; never interpolate scene text into C#. */
export function unityFiles(): Record<string, string> {
  const paths = [
    'Runtime/VirtualWorldMetadata.cs',
    'Runtime/VirtualWorldData.cs',
    'Runtime/VirtualWorldCatalog.cs',
    'Runtime/VirtualWorldSceneRuntime.cs',
    'Runtime/VirtualWorldCharacter.cs',
    'Runtime/VirtualWorldAnimator.cs',
    'Runtime/VirtualWorldOrbit.cs',
    'Runtime/VirtualWorldMechanism.cs',
    'Runtime/VirtualWorldProgress.cs',
    'Editor/VirtualWorldImporter.cs',
    'Editor/VirtualWorldValidation.cs',
    'Editor/VirtualWorldFonts.cs',
    'Scripts/prepare-font.mjs',
    'Scripts/NotoSansCJK-OFL.txt',
    'README-Unity.md',
  ];
  return Object.fromEntries(
    paths.map((path) => [
      path,
      readFileSync(new URL(`./native/unity/${path}`, import.meta.url), 'utf8'),
    ]),
  );
}
