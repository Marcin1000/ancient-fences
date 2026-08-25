import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fixVersionFrom, packageForRef, shippedStatus } from './versions.mjs';

/**
 * Checks whether the referenced issues are still open. Without this step the
 * tool is a glorified grep; with it, it answers the question nobody asks:
 * does the reason still exist?
 */
export async function checkGithubRefs(ids, opts = {}) {
  const apiBase = (opts.apiBase ?? 'https://api.github.com').replace(/\/+$/, '');
  const token = opts.token ?? process.env.GITHUB_TOKEN ?? null;
  const maxAgeDays = Number.isFinite(opts.maxAgeDays) ? opts.maxAgeDays : 7;
  const cache = opts.noCache ? {} : await loadCache(opts.cachePath);
  const result = new Map();

  for (const id of ids) {
    // An issue state is not a fact, it is a snapshot: closed issues get
    // reopened. A cache with no age would let this tool say "the reason
    // disappeared" forever on the strength of one lookup, offline, with
    // nothing on screen to say how old the answer is.
    const cached = cache[id];
    if (cached && freshEnough(cached, maxAgeDays)) {
      result.set(id, cached);
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
      result.set(id, staleOr(cached, { state: 'unknown', reason: `network: ${err.message}` }));
      continue;
    }
    if (res.status === 403 || res.status === 429) {
      result.set(id, staleOr(cached, { state: 'unknown', reason: 'rate limited or no access' }));
      continue;
    }
    if (res.status === 404) {
      result.set(id, staleOr(cached, { state: 'unknown', reason: 'issue missing or private' }));
      continue;
    }
    if (!res.ok) {
      result.set(id, staleOr(cached, { state: 'unknown', reason: `HTTP ${res.status}` }));
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
      checkedAt: new Date().toISOString(),
    };
    result.set(id, entry);
    cache[id] = entry;
  }

  await saveCache(opts.cachePath, cache);
  return result;
}

function freshEnough(entry, maxAgeDays) {
  if (!entry?.checkedAt) return false;
  const age = Date.now() - new Date(entry.checkedAt).getTime();
  return Number.isFinite(age) && age >= 0 && age < maxAgeDays * 24 * 3600 * 1000;
}

/**
 * The tracker could not be reached now. An old answer is still worth more than
 * nothing, as long as every report that uses it says how old it is.
 */
function staleOr(cached, failure) {
  if (!cached || !cached.checkedAt) return failure;
  return { ...cached, stale: true, reason: `${failure.reason}; using the state read on ${cached.checkedAt.slice(0, 10)}` };
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
  const seen = fence.premise.refs.map((r) => states.get(r.id)).filter(Boolean);
  const known = seen.filter((s) => s.state !== 'unknown');
  if (known.length === 0) {
    // Not asking and asking without an answer are different states, and a
    // report that spells both "unchecked" invites the reader to assume the
    // worse one happened.
    return seen.length === 0
      ? { level: 'unchecked', why: 'the tracker was not consulted in this run (--check does that)' }
      : { level: 'unchecked', why: seen[0].reason ?? 'could not determine issue state' };
  }
  // An answer read from an old cache still says when it was read, in the
  // verdict itself, so nobody acts on a year-old snapshot believing it is now.
  const asOf = known.some((s) => s.stale)
    ? ` (state as of ${known.map((s) => s.checkedAt).filter(Boolean).sort()[0]?.slice(0, 10)})`
    : '';
  if (known.every((s) => s.state === 'closed')) {
    const shipped = shippedFor(fence, states, installed);
    if (shipped?.state === 'shipped') return { level: 'remove', why: shipped.text + asOf };
    if (shipped?.state === 'not upgraded') return { level: 'upgrade first', why: shipped.text + asOf };
    const when = known.map((s) => s.closedAt).filter(Boolean).sort().pop();
    return { level: 'remove', why: (when ? `reason disappeared ${when.slice(0, 10)}` : 'issue closed') + asOf };
  }
  if (known.some((s) => s.state === 'closed')) {
    return { level: 'review', why: 'some of the reasons are gone' + asOf };
  }
  return { level: 'still valid', why: 'issue still open' + asOf };
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
