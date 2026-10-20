import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/** Plain source files are kept beside the generator so C++ remains reviewable. */
export function unrealFiles(): Record<string, string> {
  const root = fileURLToPath(new URL('./native/unreal/', import.meta.url));
  const files: Record<string, string> = {};
  const visit = (relative: string) => {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (entry.name.startsWith('.')) continue;
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files[path] = readFileSync(join(root, path), 'utf8');
      else throw new Error(`Unexpected Unreal runtime source entry: ${path}`);
    }
  };
  visit('');
  return files;
}
