import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fixVersionFrom, packageForRef, shippedStatus } from './versions.mjs';

/**
 * Checks whether the referenced issues are still open. Without this step the
 * tool is a glorified grep; with it, it answers the question nobody asks:
 * does the reason still exist?
 */
export async function checkGithubRefs(ids, opts = {}) {
  const apiBase = opts.apiBase ?? 'https://api.github.com';
  const token = opts.token ?? process.env.GITHUB_TOKEN ?? null;
  const cache = await loadCache(opts.cachePath);
  const result = new Map();

  for (const id of ids) {
    if (cache[id] && !opts.noCache) {
      result.set(id, cache[id]);
      continue;
    }
    const m = id.match(/^github:([\w.-]+)\/([\w.-]+)#(\d+)$/);
    if (!m) continue;
    const url = `${apiBase}/repos/${m[1]}/${m[2]}/issues/${m[3]}`;
    const headers = { accept: 'application/vnd.github+json', 'user-agent': 'ancient-fences' };
    if (token) headers.authorization = `Bearer ${token}`;

    let res;
    try {
      res = await fetch(url, { headers });
    } catch (err) {
      result.set(id, { state: 'unknown', reason: `network: ${err.message}` });
      continue;
    }
    if (res.status === 403 || res.status === 429) {
      result.set(id, { state: 'unknown', reason: 'rate limited or no access' });
      continue;
    }
    if (res.status === 404) {
      result.set(id, { state: 'unknown', reason: 'issue missing or private' });
      continue;
    }
    if (!res.ok) {
      result.set(id, { state: 'unknown', reason: `HTTP ${res.status}` });
      continue;
    }
    const body = await res.json();
    const entry = {
      state: body.state === 'closed' ? 'closed' : 'open',
      closedAt: body.closed_at ?? null,
      title: body.title ?? null,
      isPull: Boolean(body.pull_request),
      merged: body.pull_request?.merged_at ?? null,
      // Kept rather than the whole payload: this is the only part that tells
      // us whether the fix reached a release, and the cache stays small.
      fix: fixVersionFrom(body),
    };
    result.set(id, entry);
    cache[id] = entry;
  }

  await saveCache(opts.cachePath, cache);
  return result;
}

/**
 * What to do about it. Without a verdict the report is just a list of links.
 * `installed` is what the lockfile says you actually run, which is what turns
 * "the issue is closed" into "you can delete this today".
 */
export function verdict(fence, states, installed = new Map()) {
  if (fence.premise.type === 'date') {
    return fence.premise.overdue
      ? { level: 'remove', why: `deadline ${fence.premise.date} has passed` }
      : { level: 'still valid', why: `deadline ${fence.premise.date} not reached yet` };
  }
  if (fence.premise.type !== 'tracker') {
    return { level: 'unmarked', why: 'no recorded reason for this code' };
  }
  // An unknown state must never come out as "still valid". Not knowing is not
  // a green light, and a tool that reassures without grounds is worse than none.
  const known = fence.premise.refs
    .map((r) => states.get(r.id))
    .filter((s) => s && s.state !== 'unknown');
  if (known.length === 0) return { level: 'unchecked', why: 'could not determine issue state' };
  if (known.every((s) => s.state === 'closed')) {
    const shipped = shippedFor(fence, states, installed);
    if (shipped?.state === 'shipped') return { level: 'remove', why: shipped.text };
    if (shipped?.state === 'not upgraded') return { level: 'upgrade first', why: shipped.text };
    const when = known.map((s) => s.closedAt).filter(Boolean).sort().pop();
    return { level: 'remove', why: when ? `reason disappeared ${when.slice(0, 10)}` : 'issue closed' };
  }
  if (known.some((s) => s.state === 'closed')) {
    return { level: 'review', why: 'some of the reasons are gone' };
  }
  return { level: 'still valid', why: 'issue still open' };
}

/**
 * Did the fix reach a version you run? Answered only when both halves are
 * known: a version stated by the project, and that package in your lockfile.
 */
export function shippedFor(fence, states, installed) {
  if (!installed || installed.size === 0) return null;
  for (const ref of fence.premise.refs ?? []) {
    const state = states.get(ref.id);
    if (!state?.fix) continue;
    const pkg = packageForRef(ref.id, installed);
    if (!pkg) continue;
    const status = shippedStatus({ fix: state.fix, installed: pkg });
    if (status) return status;
  }
  return null;
}

async function loadCache(path) {
  if (!path) return {};
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return {};
  }
}

async function saveCache(path, cache) {
  if (!path) return;
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(cache, null, 1));
  } catch {
    /* a missing cache is annoying, not fatal */
  }
}
