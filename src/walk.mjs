import { readdir, readFile, stat } from 'node:fs/promises';
import { join, extname, relative } from 'node:path';

const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', 'vendor', 'target',
  '.next', '.nuxt', 'coverage', '__pycache__', '.venv', 'venv', 'third_party',
]);

const TEXT_EXT = new Set([
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.php',
  '.c', '.h', '.cc', '.cpp', '.hpp', '.cs', '.m', '.mm',
  '.sh', '.bash', '.zsh', '.sql', '.css', '.scss', '.less',
  '.yml', '.yaml', '.toml', '.tf', '.gradle', '.dockerfile', '.vue', '.svelte',
]);

const MAX_BYTES = 512 * 1024;

export async function* walkFiles(root) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) stack.push(full);
        continue;
      }
      if (!e.isFile()) continue;
      const ext = extname(e.name).toLowerCase();
      if (!TEXT_EXT.has(ext) && e.name.toLowerCase() !== 'dockerfile') continue;
      let info;
      try {
        info = await stat(full);
      } catch {
        continue;
      }
      if (info.size > MAX_BYTES || info.size === 0) continue;
      let text;
      try {
        text = await readFile(full, 'utf8');
      } catch {
        continue;
      }
      yield { path: relative(root, full), text };
    }
  }
}
