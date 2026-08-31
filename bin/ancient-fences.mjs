#!/usr/bin/env node
import { resolve, basename, dirname, join } from 'node:path';
import { writeFile, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { walkFiles } from '../src/walk.mjs';
import { detectFences } from '../src/detect.mjs';
import { blameAll, historyDepth } from '../src/age.mjs';
import { checkGithubRefs, verdict } from '../src/tracker.mjs';
import { renderText, renderHtml, renderTasks, summarize } from '../src/report.mjs';
import { projectName } from '../src/name.mjs';
import { readInstalled } from '../src/lockfile.mjs';

const args = process.argv.slice(2);

// "ancient-fences ." has to scan the current directory. The first version read
// any first argument as a command name, so the documented form printed the
// help text and did nothing. Only the words below are commands; everything
// else is a path.
const COMMANDS = new Set(['scan', 'help']);
const cmd = args[0] && COMMANDS.has(args[0]) ? args[0] : 'scan';
const flags = args.filter((a) => a.startsWith('--'));
const has = (f) => flags.some((x) => x === f);
const value = (f) => {
  const hit = flags.find((x) => x.startsWith(`${f}=`));
  return hit ? hit.slice(f.length + 1) : null;
};
const positional = args.filter((a) => !a.startsWith('--') && !COMMANDS.has(a));

const KNOWN = new Set([
  '--check', '--report', '--tasks', '--api-base', '--json', '--no-blame',
  '--include-generated', '--no-cache', '--cache', '--help', '--max-age-days',
]);

const usage = `ancient-fences: find the code you wrote because of someone else's bug,
then check whether that bug is still there.

  npx ancient-fences [path] [options]

  --check             ask GitHub whether the referenced issues are still open
                      (set GITHUB_TOKEN to lift the 60 requests/hour limit)
  --report[=file]     write a shareable HTML report (default: ancient-fences.html)
  --tasks[=file]      write the dead fences as instructions for a coding agent
  --api-base=URL      alternate API (GitHub Enterprise, or a mock in tests)
  --json              full machine-readable output
  --no-blame          skip fence age (faster, tells you less)
  --include-generated scan bundles and minified builds too. They are skipped by
                      default: their fences belong to the libraries they were
                      built from, not to you
  --cache=FILE        where to keep issue states (default: your user cache
                      directory, never inside the repository being scanned)
  --no-cache          ignore any cached issue state and ask the tracker again
  --max-age-days=N    how old a cached state may be before it is re-checked
                      (default 7)
`;

if (cmd !== 'scan' || has('--help')) {
  console.log(usage);
  process.exit(0);
}

// A mistyped flag used to be ignored in silence, so "--chek" printed a normal
// report and the reader believed the issues had been checked. Anything this
// tool does not understand stops it.
const unknown = flags.filter((f) => !KNOWN.has(f.split('=')[0]));
if (unknown.length > 0) {
  console.error(`ancient-fences: unknown option ${unknown.join(', ')}`);
  console.error(usage);
  process.exit(2);
}
if (positional.length > 1) {
  console.error(`ancient-fences: one path at a time, got ${positional.length}: ${positional.join(', ')}`);
  process.exit(2);
}

const days = value('--max-age-days');
if (days !== null && (!Number.isFinite(Number(days)) || Number(days) < 0)) {
  console.error(`ancient-fences: --max-age-days needs a number of days that is zero or more, not "${days}"`);
  process.exit(2);
}

// An empty value is almost always a shell mishap (--report=$FILE with FILE
// unset). Writing to the current directory, or crashing on it, are both worse
// than saying what happened.
for (const f of ['--report', '--tasks', '--cache', '--api-base']) {
  if (flags.includes(`${f}=`)) {
    console.error(`ancient-fences: ${f}= needs a value`);
    process.exit(2);
  }
}

const target = resolve(positional[0] ?? process.cwd());

// Scanning a path that is not there used to print a clean report saying zero
// fences, which reads exactly like good news. A tool that says "nothing to
// worry about" when it looked at nothing is worse than no tool.
let single = null;
let root = target;
try {
  const info = await stat(target);
  if (info.isFile()) {
    single = target;
    root = dirname(target);
  }
} catch {
  console.error(`ancient-fences: nothing to scan at ${target}`);
  if (positional[0] && positional[0].includes('--')) {
    console.error('It looks like an option got stuck to the path. Put a space before it:');
    console.error('  npx ancient-fences . --report');
  }
  process.exit(1);
}

const skipped = [];
const fences = [];
if (single) {
  const { readFile } = await import('node:fs/promises');
  const name = basename(single);
  fences.push(...detectFences(name, await readFile(single, 'utf8')));
} else {
  for await (const file of walkFiles(root, { skipped, includeGenerated: has('--include-generated') })) {
    fences.push(...detectFences(file.path, file.text));
  }
}

// Age comes from git blame, so it is only a number when there is history to
// read. A shallow clone dates every line to the day it was fetched, which
// turned "the oldest fence here is 8 years old" into a confident zero.
// --no-blame is a choice, not a measurement. Saying "0 untouched for 3+
// years" after skipping the only step that could tell is the same lie as
// measuring a shallow clone.
const history = has('--no-blame')
  ? { usable: false, why: '--no-blame was given, and blame is the only thing that knows' }
  : await historyDepth(root);
if (history.usable) await blameAll(root, fences);

let states = new Map();
const checking = has('--check');
const cachePath = value('--cache') ? resolve(value('--cache')) : defaultCachePath(root);
if (checking) {
  const ids = new Set();
  for (const f of fences) {
    if (f.premise.type === 'tracker') {
      for (const r of f.premise.refs) if (r.id.startsWith('github:')) ids.add(r.id);
    }
  }
  states = await checkGithubRefs([...ids], {
    apiBase: value('--api-base') ?? undefined,
    cachePath,
    noCache: has('--no-cache'),
    maxAgeDays: Number(value('--max-age-days') ?? 7),
  });
}

// What the lockfile says you actually run turns "the issue is closed" into
// "you can delete this today", or into "upgrade before you can". Verdicts are
// computed whether or not the tracker was consulted, because a deadline that
// has passed needs no network to judge.
const installed = await readInstalled(root);
for (const f of fences) f.verdict = verdict(f, states, installed);

const summary = summarize(fences, states);
summary.skipped = skipped.length;
summary.skippedFiles = skipped;
summary.history = history;
summary.checkedAt = checking ? checkTimestamp(states) : null;

// Scanning one file, its own name is the subject. Scanning a repository, the
// folder is the last resort: a full clone of webpack in webpackfull/ produced
// a report titled "webpackfull".
const name = single ? basename(single) : await projectName(root);

const reportFlag = flags.find((f) => f === '--report' || f.startsWith('--report='));
if (reportFlag) {
  const out = resolve(value('--report') ?? 'ancient-fences.html');
  await write(out, renderHtml(fences, summary, name, checking), 'report');
}

const tasksFlag = flags.find((f) => f === '--tasks' || f.startsWith('--tasks='));
if (tasksFlag) {
  const out = resolve(value('--tasks') ?? 'ancient-fences-tasks.md');
  await write(out, renderTasks(fences, name, checking), 'agent tasks');
}

/** A file that cannot be written is reported as such, not as a stack trace. */
async function write(out, body, what) {
  try {
    await writeFile(out, body, 'utf8');
  } catch (err) {
    console.error(`ancient-fences: could not write ${out}: ${err.message}`);
    process.exit(2);
  }
  console.error(`${what} written to ${out}`);
}

if (has('--json')) {
  console.log(JSON.stringify({ repo: root, summary, fences, skipped }, null, 2));
} else {
  console.log(renderText(fences, summary, name, checking));
}

/**
 * Issue states are cached so a second run does not spend the hourly request
 * budget again. The first version wrote that cache into the repository being
 * scanned, which left a file behind in someone else's working tree.
 */
function defaultCachePath(repo) {
  const base = process.env.XDG_CACHE_HOME
    ?? (process.platform === 'win32' ? process.env.LOCALAPPDATA : null)
    ?? join(homedir() || tmpdir(), '.cache');
  const key = createHash('sha256').update(resolve(repo)).digest('hex').slice(0, 16);
  return join(base, 'ancient-fences', `${key}.json`);
}

function checkTimestamp(states) {
  const times = [...states.values()].map((s) => s.checkedAt).filter(Boolean).sort();
  return times.length ? { oldest: times[0], newest: times[times.length - 1] } : null;
}
