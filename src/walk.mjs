import { readdir, readFile, stat } from 'node:fs/promises';
import { join, extname, relative } from 'node:path';

const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', 'vendor', 'target',
  '.next', '.nuxt', 'coverage', '__pycache__', '.venv', 'venv', 'third_party',
  'bower_components', 'jspm_packages', 'site-packages', 'Pods',
]);

const TEXT_EXT = new Set([
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.php',
  '.c', '.h', '.cc', '.cpp', '.hpp', '.cs', '.m', '.mm',
  '.sh', '.bash', '.zsh', '.sql', '.css', '.scss', '.less',
  '.yml', '.yaml', '.toml', '.tf', '.gradle', '.dockerfile', '.vue', '.svelte',
]);

const MAX_BYTES = 512 * 1024;

// A bundle dropped into the repository is not code anyone here wrote, and the
// fences inside it belong to the libraries it was built from. Reporting them
// buries the ones the team can act on, which is the whole point of the tool.
const GENERATED_NAME = /(?:[.-]min\.[a-z]+|\.bundle\.[a-z]+|\.pack\.js|-bundle\.js)$/i;

// Only ever consulted on large files, so a hand-written module wrapper in a
// small file is never mistaken for a build product.
const GENERATED_HEAD = /webpackBootstrap|__webpack_require__|parcelRequire|System\.register\(|function e\(t,\s*n,\s*r\)\s*\{\s*function s\(|["']object["']\s*==\s*typeof\s+exports|typeof\s+exports\s*===?\s*["']object["']/;

const BIG_ENOUGH_TO_JUDGE = 32 * 1024;
const MINIFIED_LINE = 1000;

export function looksGenerated(name, text) {
  if (GENERATED_NAME.test(name)) return 'built file';
  if (text.length < BIG_ENOUGH_TO_JUDGE) return null;
  if (GENERATED_HEAD.test(text.slice(0, 4096))) return 'bundle';
  for (const line of text.split('\n')) {
    if (line.length >= MINIFIED_LINE) return 'minified';
  }
  return null;
}

/**
 * @param {string} root
 * @param {{ includeGenerated?: boolean, skipped?: Array }} options
 *   skipped is filled in as the walk runs, so the report can say how much of
 *   the repository was left out and why.
 */
export async function* walkFiles(root, { includeGenerated = false, skipped = [] } = {}) {
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
      const generated = looksGenerated(e.name, text);
      if (generated && !includeGenerated) {
        skipped.push({ path: relative(root, full), why: generated });
        continue;
      }
      yield { path: relative(root, full), text };
    }
  }
}
