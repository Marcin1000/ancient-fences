/**
 * A closed issue is weak evidence. The strong question is whether the fix
 * actually shipped in a version you are running. Everything here answers that,
 * with no dependencies and no network.
 */

const SEMVER = /(\d+)\.(\d+)(?:\.(\d+))?/;

export function parseVersion(text) {
  if (!text) return null;
  const m = String(text).match(SEMVER);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
}

/** -1, 0, 1 like a comparator. Returns null when either side is unparseable. */
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Where a fix version can be stated, in descending order of trust:
 * a release milestone, then a maintainer writing "fixed in 1.2.3" in the body.
 */
export function fixVersionFrom(issue) {
  if (!issue) return null;
  const milestone = issue.milestone?.title;
  if (milestone && parseVersion(milestone)) {
    return { version: milestone.match(SEMVER)[0], source: 'milestone' };
  }
  const body = issue.body ?? '';
  const m = body.match(/\b(?:fixed|resolved|released|landed|shipped)\s+in\s+v?(\d+\.\d+(?:\.\d+)?)/i);
  if (m) return { version: m[1], source: 'issue text' };
  return null;
}

/**
 * Guess which installed package a tracker reference belongs to.
 * Repository name equals package name often enough to be useful, and being
 * wrong here only means we stay silent rather than say something false.
 */
export function packageForRef(refId, installed) {
  const m = refId.match(/^github:([\w.-]+)\/([\w.-]+)#\d+$/);
  if (!m) return null;
  const [, owner, repo] = m;
  const candidates = [repo, repo.toLowerCase(), `@${owner}/${repo}`, `${owner}-${repo}`];
  for (const name of candidates) {
    if (installed.has(name)) return { name, version: installed.get(name) };
  }
  return null;
}

/**
 * The three answers worth having about one fence, once versions are known.
 * "shipped" is the only one that lets you delete code with confidence.
 */
export function shippedStatus({ fix, installed }) {
  if (!fix || !installed) return null;
  const cmp = compareVersions(installed.version, fix.version);
  if (cmp === null) return null;
  if (cmp >= 0) {
    return {
      state: 'shipped',
      text: `fix shipped in ${fix.version} (${fix.source}), you run ${installed.name} ${installed.version}`,
    };
  }
  return {
    state: 'not upgraded',
    text: `fix shipped in ${fix.version}, but ${installed.name} is pinned at ${installed.version}`,
  };
}
