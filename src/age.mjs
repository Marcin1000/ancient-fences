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
