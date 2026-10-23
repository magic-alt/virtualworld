import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export function occupied(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

export function digest(path) {
  const hash = createHash('sha256');
  const descriptor = openSync(path, 'r');
  const buffer = Buffer.alloc(64 * 1024);
  try {
    let bytes;
    while ((bytes = readSync(descriptor, buffer, 0, buffer.length, null)))
      hash.update(buffer.subarray(0, bytes));
  } finally {
    closeSync(descriptor);
  }
  return hash.digest('hex');
}

export function fingerprintInputs(projectRoot) {
  const files = [];
  const visit = (path) => {
    const source = join(projectRoot, path);
    if (!occupied(source)) return;
    const information = lstatSync(source);
    if (information.isSymbolicLink())
      throw new Error(`Project input must not be a symbolic link: ${path}`);
    if (information.isDirectory()) {
      for (const entry of readdirSync(source).sort())
        if (!entry.startsWith('.')) visit(join(path, entry));
    } else if (information.isFile())
      files.push({
        path: path.replaceAll('\\', '/'),
        bytes: information.size,
        sha256: digest(source),
      });
  };
  for (const path of [
    'VirtualWorld.uproject',
    'Content/VirtualWorldData/engine-manifest.json',
    'Source',
    'Config',
    'Scripts',
  ])
    visit(path);
  return files;
}

function canonicalFuturePath(path) {
  let ancestor = resolve(path);
  while (!occupied(ancestor)) ancestor = dirname(ancestor);
  return resolve(realpathSync(ancestor), relative(ancestor, resolve(path)));
}

export function collectEvidence(projectRoot, requestedOut, doctor) {
  const out = resolve(
    requestedOut ||
      join(
        projectRoot,
        'Saved/VirtualWorld/evidence',
        `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`,
      ),
  );
  if (occupied(out))
    throw new Error(
      `Evidence destination already exists or is occupied: ${out}. Choose a fresh --out directory; previous evidence is never overwritten.`,
    );
  const canonicalOut = canonicalFuturePath(out);
  for (const source of [
    'Saved/Logs',
    'Saved/Screenshots',
    'Saved/VirtualWorld/native-runs',
    'Source',
    'Scripts',
    'Config',
    'Content/VirtualWorldFonts',
  ]) {
    const contained = relative(canonicalFuturePath(resolve(projectRoot, source)), canonicalOut);
    if (contained !== '..' && !contained.startsWith(`..${sep}`) && !isAbsolute(contained))
      throw new Error(
        'Evidence --out must not be inside a directory being collected. Choose a fresh sibling directory.',
      );
  }
  mkdirSync(dirname(out), { recursive: true });
  mkdirSync(out);
  const files = [];
  const warnings = [];
  const copy = (source, destination) => {
    if (!occupied(source)) return;
    const information = lstatSync(source);
    if (information.isSymbolicLink()) {
      warnings.push(`Skipped symbolic link: ${destination}`);
      return;
    }
    if (!information.isFile()) return;
    const path = join(out, destination);
    mkdirSync(dirname(path), { recursive: true });
    copyFileSync(source, path, constants.COPYFILE_EXCL);
    files.push({
      path: destination.replaceAll('\\', '/'),
      bytes: statSync(path).size,
      sha256: digest(path),
    });
  };
  const tree = (source, destination, accept = () => true) => {
    if (!occupied(source)) return;
    if (lstatSync(source).isSymbolicLink()) {
      warnings.push(`Skipped symbolic link: ${destination}`);
      return;
    }
    for (const entry of readdirSync(source, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory())
        tree(join(source, entry.name), join(destination, entry.name), accept);
      else if (entry.isSymbolicLink())
        warnings.push(`Skipped symbolic link: ${join(destination, entry.name)}`);
      else if (entry.isFile() && accept(entry.name))
        copy(join(source, entry.name), join(destination, entry.name));
    }
  };
  for (const name of [
    'VirtualWorld.uproject',
    'Content/VirtualWorldData/engine-manifest.json',
    'Saved/VirtualWorld/smoke-report.json',
  ])
    copy(join(projectRoot, name), name);
  for (const name of ['Source', 'Scripts', 'Config', 'Saved/VirtualWorld/native-runs'])
    tree(join(projectRoot, name), name);
  tree(join(projectRoot, 'Saved/Logs'), 'Saved/Logs', (name) => /\.(log|txt|json)$/i.test(name));
  tree(join(projectRoot, 'Saved/Screenshots'), 'Saved/Screenshots', (name) =>
    /\.(png|jpg|jpeg|webp)$/i.test(name),
  );
  tree(join(projectRoot, 'Content/VirtualWorldFonts'), 'Content/VirtualWorldFonts', (name) =>
    /\.(txt|json)$/i.test(name),
  );
  if (doctor.engine?.versionPath && existsSync(doctor.engine.versionPath))
    copy(doctor.engine.versionPath, 'engine/Build.version');
  writeFileSync(join(out, 'doctor.json'), `${JSON.stringify(doctor, null, 2)}\n`, { flag: 'wx' });
  files.push({
    path: 'doctor.json',
    bytes: statSync(join(out, 'doctor.json')).size,
    sha256: digest(join(out, 'doctor.json')),
  });
  const result = {
    kind: 'evidence-collection',
    createdAt: new Date().toISOString(),
    projectRoot,
    out,
    nativeExecution: false,
    nativeValidation: 'not-certified-by-collector',
    manualAcceptance: 'pending',
    packagedAcceptance: 'pending',
    note: 'Copies of existing reports and logs are observations, not a new test run. Check run IDs, engine/version, source/manifest hashes and failures before interpreting native reports. Screenshots, keyboard controls, CJK text, visual deformation and packaged execution require local review.',
    files,
    warnings,
  };
  writeFileSync(join(out, 'evidence.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  return result;
}
