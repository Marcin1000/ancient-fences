#!/usr/bin/env node
import { resolve, basename, join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { walkFiles } from '../src/walk.mjs';
import { detectFences } from '../src/detect.mjs';
import { blameAll } from '../src/age.mjs';
import { checkGithubRefs, verdict } from '../src/tracker.mjs';
import { renderText, renderHtml, renderTasks, summarize } from '../src/report.mjs';
import { readInstalled } from '../src/lockfile.mjs';

const args = process.argv.slice(2);
const cmd = args[0]?.startsWith('--') ? 'scan' : (args[0] ?? 'scan');
const flags = args.filter((a) => a.startsWith('--'));
const has = (f) => flags.some((x) => x === f);
const value = (f) => {
  const hit = flags.find((x) => x.startsWith(`${f}=`));
  return hit ? hit.slice(f.length + 1) : null;
};
const positional = args.slice(args[0]?.startsWith('--') ? 0 : 1).filter((a) => !a.startsWith('--'));
const root = resolve(positional[0] ?? process.cwd());

if (cmd !== 'scan') {
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
`;
  console.log(usage);
  process.exit(cmd === 'help' || has('--help') ? 0 : 1);
}

const fences = [];
for await (const file of walkFiles(root)) {
  fences.push(...detectFences(file.path, file.text));
}

if (!has('--no-blame')) await blameAll(root, fences);

let states = new Map();
const checking = has('--check');
if (checking) {
  const ids = new Set();
  for (const f of fences) {
    if (f.premise.type === 'tracker') {
      for (const r of f.premise.refs) if (r.id.startsWith('github:')) ids.add(r.id);
    }
  }
  states = await checkGithubRefs([...ids], {
    apiBase: value('--api-base') ?? undefined,
    cachePath: join(root, '.ancient-fences-cache.json'),
  });
  // What the lockfile says you actually run turns "the issue is closed" into
  // "you can delete this today", or into "upgrade before you can".
  const installed = await readInstalled(root);
  for (const f of fences) f.verdict = verdict(f, states, installed);
}

const summary = summarize(fences, states);
const name = basename(root);

const reportFlag = flags.find((f) => f === '--report' || f.startsWith('--report='));
if (reportFlag) {
  const out = resolve(value('--report') ?? 'ancient-fences.html');
  await writeFile(out, renderHtml(fences, summary, name, checking), 'utf8');
  console.error(`report written to ${out}`);
}

const tasksFlag = flags.find((f) => f === '--tasks' || f.startsWith('--tasks='));
if (tasksFlag) {
  const out = resolve(value('--tasks') ?? 'ancient-fences-tasks.md');
  await writeFile(out, renderTasks(fences, name), 'utf8');
  console.error(`agent tasks written to ${out}`);
}

if (has('--json')) {
  console.log(JSON.stringify({ repo: root, summary, fences }, null, 2));
} else {
  console.log(renderText(fences, summary, name, checking));
}
