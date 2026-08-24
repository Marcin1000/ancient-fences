import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * What is actually installed, read from whatever lockfile the project keeps.
 * Deliberately forgiving: a lockfile we cannot parse means we say less, never
 * that we say something wrong.
 */
export async function readInstalled(root) {
  const installed = new Map();
  await npmLock(root, installed);
  await yarnLock(root, installed);
  await pnpmLock(root, installed);
  return installed;
}

async function npmLock(root, out) {
  let raw;
  try {
    raw = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
  } catch {
    return;
  }
  // lockfileVersion 2 and 3 keep everything under "packages", keyed by path.
  for (const [path, entry] of Object.entries(raw.packages ?? {})) {
    if (!path || !entry?.version) continue;
    const name = entry.name ?? path.replace(/^.*node_modules\//, '');
    if (name) keep(out, name, entry.version);
  }
  for (const [name, entry] of Object.entries(raw.dependencies ?? {})) {
    if (entry?.version) keep(out, name, entry.version);
  }
}

async function yarnLock(root, out) {
  let text;
  try {
    text = await readFile(join(root, 'yarn.lock'), 'utf8');
  } catch {
    return;
  }
  let current = null;
  for (const line of text.split('\n')) {
    const header = line.match(/^"?((?:@[^/\s"]+\/)?[^@\s"]+)@/);
    if (header && !line.startsWith(' ')) {
      current = header[1];
      continue;
    }
    const version = line.match(/^\s+version:?\s+"?([\w.\-+]+)"?/);
    if (version && current) {
      keep(out, current, version[1]);
      current = null;
    }
  }
}

async function pnpmLock(root, out) {
  let text;
  try {
    text = await readFile(join(root, 'pnpm-lock.yaml'), 'utf8');
  } catch {
    return;
  }
  for (const line of text.split('\n')) {
    const m = line.match(/^\s{2}\/?((?:@[^/\s]+\/)?[^/\s@]+)[@/](\d+\.\d+\.\d+[\w.\-+]*)/);
    if (m) keep(out, m[1], m[2]);
  }
}

/** Keep the highest version seen: transitive copies of a package are common. */
function keep(map, name, version) {
  const prev = map.get(name);
  if (!prev) {
    map.set(name, version);
    return;
  }
  const a = prev.split('.').map(Number);
  const b = version.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) {
      if ((b[i] ?? 0) > (a[i] ?? 0)) map.set(name, version);
      return;
    }
  }
}
