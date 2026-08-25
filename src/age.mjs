import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * How long the fence has stood: when anyone last touched this line.
 * This is the one number nobody can fake. A comment can lie, blame cannot.
 */
export async function blameYear(repo, file, line) {
  try {
    const { stdout } = await run(
      'git',
      ['blame', '--porcelain', '-L', `${line},${line}`, '--', file],
      { cwd: repo, maxBuffer: 1024 * 1024 },
    );
    const m = stdout.match(/^author-time (\d+)$/m);
    if (!m) return null;
    return new Date(Number(m[1]) * 1000);
  } catch {
    return null;
  }
}

/**
 * Whether ages can be measured here at all.
 *
 * A shallow clone (`git clone --depth 1`, and every CI checkout by default)
 * rewrites every line's date to the day it was fetched. Blame then answers
 * "touched today" for an eight-year-old workaround, and the report says
 * nothing is old. That reads as an all clear, so the tool has to say plainly
 * that it could not measure rather than print a confident zero.
 */
export async function historyDepth(repo) {
  const git = async (args) => {
    try {
      const { stdout } = await run('git', args, { cwd: repo });
      return stdout.trim();
    } catch {
      return null;
    }
  };
  if (await git(['rev-parse', '--git-dir']) === null) {
    return { usable: false, why: 'not a git repository, so fence age cannot be measured' };
  }
  if (await git(['rev-parse', '--is-shallow-repository']) === 'true') {
    return {
      usable: false,
      shallow: true,
      why: 'shallow clone: git dates every line to the day it was fetched, so fence age cannot be measured (clone with full history, or actions/checkout with fetch-depth: 0)',
    };
  }
  const count = await git(['rev-list', '--count', 'HEAD']);
  if (count === null) return { usable: false, why: 'no commits yet, so fence age cannot be measured' };
  return { usable: true, commits: Number(count) };
}

export async function blameAll(repo, fences, concurrency = 8) {
  let i = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (i < fences.length) {
      const f = fences[i++];
      f.lastTouched = await blameYear(repo, f.file, f.line);
    }
  });
  await Promise.all(workers);
  return fences;
}
