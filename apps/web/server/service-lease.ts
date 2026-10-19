import { mkdir, lstat, readFile, writeFile, unlink, rmdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

/** A single writer lease, deliberately never stolen automatically after a crash. */
export async function acquireServiceLease(root: string): Promise<() => Promise<void>> {
  const directory = join(resolve(root), '.service-lease');
  await mkdir(resolve(root), { recursive: true });
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    throw new Error(
      `Workspace service lease is occupied at ${directory}. Inspect owner.json and stop all ` +
        'services using this workspace before manually removing the lease directory. ' +
        'An ambiguous or stale lease is never stolen automatically.',
      { cause: error },
    );
  }
  const identity = await lstat(directory);
  const ownDirectory = async () => {
    const current = await lstat(directory);
    return current.isDirectory() && current.dev === identity.dev && current.ino === identity.ino;
  };
  const token = randomUUID();
  const ownerPath = join(directory, 'owner.json');
  try {
    await writeFile(
      ownerPath,
      JSON.stringify({
        version: 1,
        pid: process.pid,
        hostname: hostname(),
        token,
        createdAt: new Date().toISOString(),
      }) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
  } catch (error) {
    // Only our newly acquired directory and its own metadata can be cleaned up.
    if (await ownDirectory().catch(() => false)) {
      await unlink(ownerPath).catch(() => {});
      await rmdir(directory).catch(() => {});
    }
    throw error;
  }
  let released: Promise<void> | undefined;
  return () => {
    released ??= (async () => {
      try {
        if (!(await ownDirectory())) throw new Error('Service lease directory ownership changed');
        const owner = JSON.parse(await readFile(ownerPath, 'utf8')) as { token?: string };
        if (owner.token !== token)
          throw new Error('Service lease ownership changed; refusing release');
        await unlink(ownerPath);
        await rmdir(directory);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          // External workspace cleanup may race shutdown. Only an absent directory
          // is already released; a missing owner file in an existing lease is not.
          try {
            await lstat(directory);
          } catch (missing) {
            if ((missing as NodeJS.ErrnoException).code === 'ENOENT') return;
          }
        }
        throw error;
      }
    })();
    return released;
  };
}
