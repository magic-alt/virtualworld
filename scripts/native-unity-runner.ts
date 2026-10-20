/** Self-contained, cross-platform launcher copied into a generated Unity project. */
export const unityRunner = `import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try {
 const { values, positionals } = parseArgs({ allowPositionals: true, options: { editor: { type: 'string' }, target: { type: 'string', default: 'StandaloneWindows64' }, out: { type: 'string' }, font: { type: 'string' } } });
 const action = positionals[0];
 if (!['import','validate','build'].includes(action)) throw new Error('Use import|validate|build --editor ABSOLUTE_UNITY_EDITOR [--target WebGL|StandaloneWindows64|StandaloneLinux64|StandaloneOSX] [--out FRESH_BUILD_DIRECTORY]');
 if (!values.editor || !existsSync(values.editor)) throw new Error('Unity Editor is unavailable. Supply --editor with the installed Unity 6 executable. No native validation was performed.');
 if (!['WebGL','StandaloneWindows64','StandaloneLinux64','StandaloneOSX'].includes(values.target)) throw new Error('Unsupported Unity build target');
 const method = { import: 'ImportBatch', validate: 'ValidateBatch', build: 'BuildBatch' }[action];
 const args = ['-batchmode','-quit','-projectPath',root,'-executeMethod','VirtualWorld.Editor.VirtualWorldImporter.'+method,'-virtualWorldManifest',resolve(root,'Assets/VirtualWorldExport/engine-manifest.json'),'-logFile',resolve(root,'unity-'+action+'.log')];
 if (values.font) args.push('-virtualWorldFont', values.font);
 if (action === 'build') {
  const destination = resolve(values.out || resolve(root,'Builds',values.target));
  if (existsSync(destination)) throw new Error('Build directory already exists; choose a fresh --out directory.');
  mkdirSync(dirname(destination), { recursive: true });
  const commandTarget = { StandaloneWindows64: 'Win64', StandaloneLinux64: 'Linux64', StandaloneOSX: 'OSXUniversal', WebGL: 'WebGL' }[values.target];
  args.push('-buildTarget',commandTarget,'-virtualWorldBuildTarget',values.target,'-virtualWorldBuildPath',destination);
 }
 const result = spawnSync(values.editor,args,{ cwd: root, stdio: 'inherit', shell: false });
 if (result.error) throw result.error;
 if (result.status !== 0) throw new Error('Unity exited '+result.status+'; inspect unity-'+action+'.log');
 console.log('Unity '+action+' process completed. Review the native report/log before claiming visual parity.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
`;
