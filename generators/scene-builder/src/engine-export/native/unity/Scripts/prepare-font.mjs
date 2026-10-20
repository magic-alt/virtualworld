import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Noto Sans CJK Sans2.004, pinned to the upstream release commit and exact file bytes.
const revision = '523d033d6cb47f4a80c58a35753646f5c3608a78';
const filename = 'NotoSansCJKsc-Regular.otf';
const url = `https://raw.githubusercontent.com/notofonts/noto-cjk/${revision}/Sans/OTF/SimplifiedChinese/${filename}`;
const fontSha256 = '2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b';
const licenseSha256 = '6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2';
const limit = 32 * 1024 * 1024;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
function verify(bytes, expected, label) {
  if (sha(bytes) !== expected)
    throw new Error(`${label} SHA-256 mismatch; refusing unverified font data.`);
  return bytes;
}
function localFile(path) {
  if (!statSync(path).isFile() || statSync(path).size > limit)
    throw new Error(`Invalid or oversized font input: ${path}`);
  return readFileSync(path);
}

export async function prepareFont(args = process.argv.slice(2)) {
  const options = new Map();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (options.has(key)) throw new Error(`Duplicate option: ${key}`);
    if (key === '--verify') options.set(key, true);
    else if (
      ['--project', '--font-source'].includes(key) &&
      args[i + 1] &&
      !args[i + 1].startsWith('--')
    )
      options.set(key, args[++i]);
    else
      throw new Error(
        'Usage: node Scripts/prepare-font.mjs [--project PROJECT] [--font-source DOWNLOADED_OTF] [--verify]',
      );
  }
  const project = realpathSync(
    resolve(options.get('--project') ?? join(dirname(fileURLToPath(import.meta.url)), '..')),
  );
  if (!existsSync(join(project, 'Assets')))
    throw new Error('Unity Assets directory is missing. Pass --project <Unity project root>.');
  const assets = realpathSync(join(project, 'Assets'));
  const path = relative(project, assets);
  if (path.startsWith('..') || isAbsolute(path))
    throw new Error('Assets resolves outside the selected Unity project.');
  const destination = join(assets, 'VirtualWorldFonts');
  if (options.get('--verify')) {
    verify(localFile(join(destination, filename)), fontSha256, 'Installed font');
    verify(localFile(join(destination, 'OFL.txt')), licenseSha256, 'Installed font license');
    console.log(`Verified Noto Sans CJK Sans2.004: ${destination}`);
  } else {
    if (existsSync(destination))
      throw new Error(
        `Font directory already exists: ${destination}. It will not be overwritten; use --verify to check the pinned installation.`,
      );
    const license = verify(
      readFileSync(new URL('./NotoSansCJK-OFL.txt', import.meta.url)),
      licenseSha256,
      'Bundled font license',
    );
    let bytes;
    if (options.get('--font-source')) bytes = localFile(resolve(options.get('--font-source')));
    else {
      const response = await fetch(url, { signal: AbortSignal.timeout(45000) });
      if (!response.ok)
        throw new Error(
          `Official font download failed: HTTP ${response.status}. Download ${url} separately and pass --font-source PATH.`,
        );
      if (Number(response.headers.get('content-length')) > limit)
        throw new Error('Official font response exceeds the supported size.');
      bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > limit)
        throw new Error('Official font response exceeds the supported size.');
    }
    verify(bytes, fontSha256, 'Noto Sans CJK font');
    // Atomic directory creation refuses even an empty destination created during the download.
    mkdirSync(destination);
    writeFileSync(join(destination, filename), bytes, { flag: 'wx' });
    writeFileSync(join(destination, 'OFL.txt'), license, { flag: 'wx' });
    writeFileSync(
      join(destination, 'font-source.json'),
      JSON.stringify(
        {
          family: 'Noto Sans CJK SC',
          release: 'Sans2.004',
          revision,
          url,
          fontSha256,
          licenseSha256,
          licenseUrl: `https://github.com/notofonts/noto-cjk/blob/${revision}/LICENSE`,
        },
        null,
        2,
      ) + '\n',
      { flag: 'wx' },
    );
    console.log(
      `Prepared ${join(destination, filename)} with its SIL Open Font License. Unity import/build will validate the authored glyph coverage.`,
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await prepareFont();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
