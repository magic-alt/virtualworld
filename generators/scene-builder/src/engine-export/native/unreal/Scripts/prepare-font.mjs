import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const revision = '523d033d6cb47f4a80c58a35753646f5c3608a78';
const filename = 'NotoSansCJKsc-Regular.otf';
const url = `https://raw.githubusercontent.com/notofonts/noto-cjk/${revision}/Sans/OTF/SimplifiedChinese/${filename}`;
const fontSha256 = '2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b';
const licenseSha256 = '6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2';
const limit = 32 * 1024 * 1024;
const metadata = {
  family: 'Noto Sans CJK SC',
  release: 'Sans2.004',
  revision,
  url,
  fontSha256,
  licenseSha256,
  licenseUrl: `https://github.com/notofonts/noto-cjk/blob/${revision}/LICENSE`,
};

function verify(bytes, expected, label) {
  if (createHash('sha256').update(bytes).digest('hex') !== expected)
    throw new Error(`${label} SHA-256 mismatch; refusing unverified font data.`);
  return bytes;
}
function localFile(path) {
  if (!statSync(path).isFile() || statSync(path).size > limit)
    throw new Error(`Invalid or oversized font input: ${path}`);
  return readFileSync(path);
}
function contained(root, path) {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\') && !isAbsolute(rel);
}
function directory(root) {
  const project = realpathSync(resolve(root));
  const content = join(project, 'Content');
  if (!existsSync(content) || !contained(project, realpathSync(content)))
    throw new Error('Unreal Content directory is missing or resolves outside the project.');
  const destination = join(content, 'VirtualWorldFonts');
  try {
    const info = lstatSync(destination);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      !contained(project, realpathSync(destination))
    )
      throw new Error('Font directory must not be a symlink or resolve outside the project.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return destination;
}

export function verifyFont(root = defaultRoot) {
  const destination = directory(root);
  for (const name of [filename, 'OFL.txt', 'font-source.json']) {
    const path = join(destination, name);
    if (!lstatSync(path).isFile())
      throw new Error(`Font installation must contain regular files: ${name}`);
  }
  verify(localFile(join(destination, filename)), fontSha256, 'Installed font');
  verify(localFile(join(destination, 'OFL.txt')), licenseSha256, 'Installed font license');
  const source = JSON.parse(readFileSync(join(destination, 'font-source.json'), 'utf8'));
  for (const [name, value] of Object.entries(metadata))
    if (source[name] !== value) throw new Error(`Installed font provenance mismatch: ${name}`);
  return { ...metadata, path: join(destination, filename), nativeExecution: false };
}

export async function prepareFont(root = defaultRoot, { fontSource } = {}) {
  const destination = directory(root);
  if (existsSync(destination)) return verifyFont(root);
  const license = verify(
    readFileSync(new URL('./NotoSansCJK-OFL.txt', import.meta.url)),
    licenseSha256,
    'Bundled font license',
  );
  let bytes;
  if (fontSource) bytes = localFile(resolve(fontSource));
  else {
    let response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(60000) });
    } catch (error) {
      throw new Error(
        `Official font download failed: ${error.message}. Download ${url} separately and pass --font-source PATH.`,
      );
    }
    if (!response.ok || !response.body)
      throw new Error(
        `Official font download failed: HTTP ${response.status}. Download ${url} separately and pass --font-source PATH.`,
      );
    if (Number(response.headers.get('content-length')) > limit)
      throw new Error('Font download exceeds size limit.');
    const chunks = [];
    let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > limit) throw new Error('Font download exceeds size limit.');
      chunks.push(Buffer.from(chunk));
    }
    bytes = Buffer.concat(chunks);
  }
  verify(bytes, fontSha256, 'Noto Sans CJK font');
  // Reserve only this new destination. Never clean up an existing installation.
  mkdirSync(destination);
  try {
    writeFileSync(join(destination, filename), bytes, { flag: 'wx' });
    writeFileSync(join(destination, 'OFL.txt'), license, { flag: 'wx' });
    writeFileSync(join(destination, 'font-source.json'), JSON.stringify(metadata, null, 2) + '\n', {
      flag: 'wx',
    });
    return verifyFont(root);
  } catch (error) {
    rmSync(destination, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({
      options: {
        project: { type: 'string' },
        'font-source': { type: 'string' },
        verify: { type: 'boolean' },
      },
    });
    const root = values.project ?? defaultRoot;
    const result = values.verify
      ? verifyFont(root)
      : await prepareFont(root, { fontSource: values['font-source'] });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
