import { isTestPath } from './paths.mjs';

const YEAR = 365.25 * 24 * 3600 * 1000;

export function yearsSince(date) {
  if (!date) return null;
  return (Date.now() - date.getTime()) / YEAR;
}

export const KIND_LABEL = {
  code: 'code written because of someone else’s bug',
  docs: 'documented limitation pointing at an issue',
  deadline: 'deadline written into a comment',
  unmarked: 'fence with no sign: nobody recorded why it is there',
};

export function summarize(fences, states = new Map()) {
  const byKind = { code: 0, docs: 0, deadline: 0, unmarked: 0 };
  let inTests = 0;
  const trackers = new Set();
  let overdue = 0;
  let old = 0;
  let oldest = null;
  for (const f of fences) {
    byKind[f.kind]++;
    if (isTestPath(f.file)) inTests++;
    if (f.premise.type === 'tracker') for (const r of f.premise.refs) trackers.add(r.id);
    if (f.premise.type === 'date' && f.premise.overdue) overdue++;
    const y = yearsSince(f.lastTouched);
    if (y !== null && y >= 3) old++;
    if (y !== null && (oldest === null || y > oldest)) oldest = y;
  }
  const verdicts = {};
  for (const f of fences) {
    if (!f.verdict) continue;
    if (states.size === 0 && f.premise.type !== 'date') continue;
    verdicts[f.verdict.level] = (verdicts[f.verdict.level] ?? 0) + 1;
  }
  return {
    total: fences.length,
    inTests,
    inSource: fences.length - inTests,
    byKind,
    trackers: trackers.size,
    overdue,
    old,
    oldest,
    verdicts,
    checked: states.size,
  };
}

/**
 * Fences per file, biggest first. The ranked list only shows the ones with a
 * tracker or a passed deadline, so without this a reader cannot tell where the
 * rest of the count comes from, and cannot check whether the tool skipped or
 * counted the right files.
 */
export function byFile(fences, limit = 8) {
  const counts = new Map();
  for (const f of fences) {
    const row = counts.get(f.file) ?? { file: f.file, total: 0, kinds: {} };
    row.total++;
    row.kinds[f.kind] = (row.kinds[f.kind] ?? 0) + 1;
    counts.set(f.file, row);
  }
  return [...counts.values()].sort((a, b) => b.total - a.total).slice(0, limit);
}

export function ranked(fences) {
  return fences
    .filter((f) => f.premise.type === 'tracker' || (f.premise.type === 'date' && f.premise.overdue))
    .sort((a, b) => {
      // Tests come last: a link to an issue in a test is usually the bug that
      // test guards, and a closed issue is a reason to keep it, not to remove it.
      const t = Number(isTestPath(a.file)) - Number(isTestPath(b.file));
      if (t !== 0) return t;
      return (yearsSince(b.lastTouched) ?? 0) - (yearsSince(a.lastTouched) ?? 0);
    });
}

function premiseOf(f) {
  return f.premise.type === 'tracker'
    ? f.premise.refs.map((r) => r.id).join(', ')
    : `deadline ${f.premise.date} (passed)`;
}

/** Long explanations have to stay readable in a terminal. */
function wrap(text, width) {
  const out = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    if (line && line.length + word.length + 1 > width) {
      out.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) out.push(line);
  return out;
}

export function renderText(fences, summary, repoName, checked = false) {
  const L = [];
  const n = (x) => String(x).padStart(4);
  L.push('');
  L.push(`  ANCIENT FENCES · ${repoName}`);
  L.push('  ' + '='.repeat(70));
  L.push(`  ${n(summary.total)}  fences standing in this codebase`);
  L.push(`  ${n(summary.byKind.code)}  code written because of someone else's bug`);
  L.push(`  ${n(summary.byKind.docs)}  documented limitations pointing at an issue`);
  L.push(`  ${n(summary.byKind.deadline)}  deadlines in comments (passed: ${summary.overdue})`);
  L.push(`  ${n(summary.byKind.unmarked)}  fences with no sign`);
  if (summary.inTests) {
    L.push(`  ${n(summary.inTests)}  of them in tests, where a link to an issue is usually the bug`);
    L.push('        that test guards, so a closed issue means keep it, not remove it');
  }
  L.push('  ' + '-'.repeat(70));
  L.push(`  ${n(summary.trackers)}  distinct external issues to check`);
  if (summary.history && summary.history.usable === false) {
    L.push(`    --  age not measured`);
    for (const line of wrap(summary.history.why, 62)) L.push(`        ${line}`);
  } else {
    L.push(`  ${n(summary.old)}  fences untouched for 3+ years`);
    if (summary.oldest !== null && summary.oldest >= 1) {
      L.push(`  ${n(summary.oldest.toFixed(1))}  years old is the oldest one`);
    } else if (summary.oldest !== null) {
      L.push(`        every fence here was touched within the last year`);
    }
  }
  if (summary.checkedAt) {
    const { oldest, newest } = summary.checkedAt;
    L.push(oldest.slice(0, 10) === newest.slice(0, 10)
      ? `        issue states read ${newest.slice(0, 10)}`
      : `        issue states read between ${oldest.slice(0, 10)} and ${newest.slice(0, 10)}`);
  }
  if (summary.skipped) {
    L.push(`  ${n(summary.skipped)}  bundled or minified files left out: their fences belong to`);
    L.push('        the libraries they were built from (--include-generated to scan them)');
    for (const f of (summary.skippedFiles ?? []).slice(0, 6)) L.push(`        ${f.path}  [${f.why}]`);
    if ((summary.skippedFiles ?? []).length > 6) L.push(`        and ${summary.skippedFiles.length - 6} more`);
  }
  L.push('');

  if (checked) {
    L.push('  VERDICTS');
    L.push('  ' + '-'.repeat(70));
    for (const [level, count] of Object.entries(summary.verdicts).sort((a, b) => b[1] - a[1])) {
      L.push(`  ${String(count).padStart(4)}  ${level}`);
    }
    L.push('');
  }

  if (summary.total === 0) {
    L.push('  Nothing found. No comment in this codebase records an external');
    L.push('  reason for the code around it: no tracker link, no deadline, no');
    L.push('  note about a workaround. That is either a clean codebase or an');
    L.push('  undocumented one, and this tool cannot tell those apart.');
    L.push('');
    return L.join('\n');
  }

  L.push('  WHERE THEY ARE');
  L.push('  ' + '-'.repeat(70));
  for (const row of byFile(fences)) {
    const kinds = Object.entries(row.kinds).map(([k, n]) => `${n} ${k}`).join(', ');
    L.push(`  ${n(row.total)}  ${row.file}  (${kinds})`);
  }
  L.push('');

  const list = ranked(fences);
  L.push(`  CHECK THESE FIRST  (longest untouched)`);
  L.push('  ' + '='.repeat(70));
  if (list.length > 15) {
    L.push(`  showing 15 of ${list.length} with a recorded reason; --json or --report has them all`);
    L.push('');
  }
  for (const f of list.slice(0, 15)) {
    const y = yearsSince(f.lastTouched);
    const age = y === null ? '   ?  ' : `${y.toFixed(1)} yr`;
    L.push(`  ${age.padStart(7)}  ${f.file}:${f.line}   [${f.kind}]`);
    L.push(`           reason:   ${premiseOf(f)}`);
    L.push(`           comment:  ${f.text.slice(0, 92)}`);
    if (showVerdict(f, checked)) L.push(`           VERDICT:  ${f.verdict.level} (${f.verdict.why})`);
    L.push('');
  }
  L.push(checked
    ? '  Every closed issue above is code you can delete.'
    : '  Run again with --check to ask the trackers whether these reasons still hold.');
  L.push('');
  return L.join('\n');
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * A standalone report meant to be forwarded to whoever pays for the codebase.
 * Developers find the fences; someone else decides what they cost.
 */
/**
 * A verdict is worth showing when it means something. Without --check the only
 * ones the tool can stand behind are the deadlines, which need no network, and
 * repeating "the tracker was not consulted" on forty rows says nothing.
 */
function showVerdict(fence, checked) {
  return Boolean(fence.verdict) && (checked || fence.premise.type === 'date');
}

export function renderHtml(fences, summary, repoName, checked = false) {
  const rows = ranked(fences).slice(0, 40).map((f) => {
    const y = yearsSince(f.lastTouched);
    const v = f.verdict;
    return `<tr>
      <td class="num">${y === null ? '-' : y.toFixed(1) + ' yr'}</td>
      <td><code>${esc(f.file)}:${f.line}</code><p>${esc(f.text.slice(0, 130))}</p></td>
      <td class="num">${esc(premiseOf(f))}</td>
      <td>${showVerdict(f, checked) ? `<span class="v v-${esc(v.level.replace(/\s+/g, '-'))}">${esc(v.level)}</span><p>${esc(v.why)}</p>` : '<span class="v">not checked</span>'}</td>
    </tr>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ancient Fences: ${esc(repoName)}</title>
<style>
:root{--ground:#0F1216;--surface:#171C22;--surface2:#1E242B;--line:#2B333B;--ink:#E7E1D4;--dim:#A7A69C;--muted:#83877F;--gold:#E0A45C;--inst:#8FC3D2}
@media (prefers-color-scheme:light){:root{--ground:#E3E2DC;--surface:#EDEBE4;--surface2:#F3F1EB;--line:#CFCCC1;--ink:#1A1E22;--dim:#4A4F53;--muted:#6B6F68;--gold:#8F5B18;--inst:#2E6B7C}}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:68rem;margin:0 auto;padding:0 clamp(1rem,4vw,2.5rem)}
header{border-bottom:1px solid var(--line);padding:3rem 0 2rem}
h1{font:300 clamp(2rem,5vw,3.2rem)/1.05 ui-serif,Georgia,serif;letter-spacing:-.02em;margin:0}
.sub{color:var(--dim);margin:.7rem 0 0}
.mono,code,.num{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.mono{font-size:.7rem;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr));gap:1px;background:var(--line);border:1px solid var(--line);margin:2.5rem 0}
.stat{background:var(--surface);padding:1.1rem 1.2rem;display:flex;flex-direction:column;gap:.3rem}
.stat b{font:400 2rem/1 ui-monospace,monospace;color:var(--gold);font-variant-numeric:tabular-nums}
.stat span{font-size:.78rem;color:var(--dim);line-height:1.35}
h2{font:300 1.6rem/1.1 ui-serif,Georgia,serif;margin:2.5rem 0 1rem}
.scroll{overflow-x:auto;border:1px solid var(--line);background:var(--surface)}
table{border-collapse:collapse;width:100%;min-width:40rem;font-size:.88rem;table-layout:fixed}
th,td{text-align:left;padding:.8rem 1rem;border-bottom:1px solid var(--line);vertical-align:top}
thead th{font-family:ui-monospace,monospace;font-size:.64rem;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:400;background:var(--surface2);white-space:nowrap}
td p{margin:.35rem 0 0;color:var(--dim);font-size:.82rem}
td.num{color:var(--dim);font-variant-numeric:tabular-nums;font-size:.8rem;overflow-wrap:anywhere}
col.age{width:6rem}col.reason{width:14rem}col.state{width:12rem}
code{overflow-wrap:anywhere}
code{font-size:.82rem;color:var(--ink)}
.v{font-family:ui-monospace,monospace;font-size:.7rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.v-remove{color:var(--gold)}
.v-review{color:var(--inst)}
footer{border-top:1px solid var(--line);margin-top:3rem;padding:2rem 0 4rem;color:var(--muted);font-size:.85rem}
footer strong{color:var(--ink)}
footer p{max-width:62ch}
</style></head><body>
<header><div class="wrap">
  <p class="mono">Ancient Fences · ${esc(new Date().toISOString().slice(0, 10))}</p>
  <h1>${esc(repoName)}</h1>
  <p class="sub">Code that exists because of an external problem, and whether that problem is still there.</p>
</div></header>
<main class="wrap">
  <div class="stats">
    <div class="stat"><b>${summary.total}</b><span>fences standing</span></div>
    <div class="stat"><b>${summary.byKind.code}</b><span>written because of someone else's bug</span></div>
    <div class="stat"><b>${summary.inTests ?? 0}</b><span>of them in tests, where a closed issue means keep</span></div>
    <div class="stat"><b>${summary.trackers}</b><span>external issues to check</span></div>
    <div class="stat"><b>${summary.history && summary.history.usable === false ? '-' : summary.old}</b><span>untouched for 3+ years</span></div>
    <div class="stat"><b>${summary.history && summary.history.usable === false ? '-' : (summary.oldest === null ? '-' : summary.oldest.toFixed(1))}</b><span>years, the oldest one</span></div>
  </div>
  ${summary.history && summary.history.usable === false ? `<p class="sub">Age was not measured: ${esc(summary.history.why)}.</p>` : ''}
  ${summary.checkedAt ? `<p class="sub">Issue states read ${esc(summary.checkedAt.newest.slice(0, 10))}.</p>` : ''}
  ${!checked && summary.trackers > 0 ? `<p class="sub">The trackers were not consulted in this run, so the state column is empty. <code>--check</code> asks them whether these issues are still open.</p>` : ''}
  ${summary.total === 0 ? `<h2>Nothing found</h2>
  <p class="sub">No comment in this codebase records an external reason for the code around it: no tracker link, no deadline, no note about a workaround. That is either a clean codebase or an undocumented one, and this tool cannot tell those apart.</p>` : `<h2>Check these first</h2>
  <div class="scroll"><table>
    <colgroup><col class="age"><col><col class="reason"><col class="state"></colgroup>
    <thead><tr><th>Untouched</th><th>Where</th><th>Reason given</th><th>${checked ? 'Verdict' : 'State'}</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`}
  ${fences.length ? `<h2>Where they are</h2>
  <div class="scroll"><table>
    <thead><tr><th>File</th><th>Fences</th><th>Kinds</th></tr></thead>
    <tbody>${byFile(fences, 15).map((r) => `<tr><td><code>${esc(r.file)}</code></td><td class="num">${r.total}</td><td class="num">${esc(Object.entries(r.kinds).map(([k, n]) => `${n} ${k}`).join(', '))}</td></tr>`).join('\n')}</tbody>
  </table></div>` : ''}
  ${summary.skipped ? `<h2>Left out</h2>
  <p class="sub">${summary.skipped} file${summary.skipped === 1 ? ' was' : 's were'} skipped as a build product. The fences inside a bundle belong to the libraries it was built from, not to this team.</p>
  <div class="scroll"><table>
    <thead><tr><th>File</th><th>Why</th></tr></thead>
    <tbody>${(summary.skippedFiles ?? []).map((f) => `<tr><td><code>${esc(f.path)}</code></td><td class="num">${esc(f.why)}</td></tr>`).join('\n')}</tbody>
  </table></div>` : ''}
</main>
<footer><div class="wrap">
  <p><strong>This is one repository and one kind of risk.</strong> The same blindness applies to everything else nobody re-checks: what was already paid for, which parts only one person understands, whether this codebase could be handed to another team at all. That is what Ancient Code measures.</p>
  <p style="margin-top:1rem">Generated by <strong>Ancient Fences</strong>. Open source, MIT.</p>
</div></footer>
</body></html>`;
}

/**
 * The dead fences, written as work for whatever agent the team already uses.
 * Ancient Fences does not edit code: knowing a fence is dead is the scarce
 * part, and every editor now ships something that can do the deleting.
 */
export function renderTasks(fences, repoName, checked = false) {
  const all = fences.filter((f) => f.verdict && (f.verdict.level === 'remove' || f.verdict.level === 'upgrade first'));
  const dead = all.filter((f) => !isTestPath(f.file));
  const inTests = all.filter((f) => isTestPath(f.file));
  const L = [];
  L.push(`# Dead fences in ${repoName}`);
  L.push('');
  L.push(`Each item below is code kept alive by a condition that no longer holds.`);
  if (checked) {
    L.push(`Verified against the referenced tracker${dead.some((f) => /shipped in/.test(f.verdict.why)) ? ' and the lockfile' : ''}.`);
  } else {
    L.push(`The trackers were not consulted in this run, so only deadlines written into`);
    L.push(`the comments were judged. Run with --check to include issue state.`);
  }
  L.push('');
  if (dead.length === 0) {
    L.push(checked
      ? 'Nothing to remove in source: every recorded reason still holds.'
      : 'Nothing to remove from deadlines alone. Run again with --check to ask the trackers.');
    if (inTests.length > 0) {
      L.push('');
      L.push(`${inTests.length} finding${inTests.length === 1 ? ' is' : 's are'} in tests, listed at the end. They are not work.`);
    }
    return L.join('\n');
  }
  dead.forEach((f, i) => {
    const y = yearsSince(f.lastTouched);
    L.push(`## ${i + 1}. ${f.file}:${f.line}`);
    L.push('');
    L.push(`- Recorded reason: ${premiseOf(f)}`);
    L.push(`- Current state: ${f.verdict.why}`);
    if (y !== null) L.push(`- Untouched for: ${y.toFixed(1)} years`);
    L.push(`- Comment says: ${f.text.slice(0, 160)}`);
    L.push('');
    if (f.verdict.level === 'upgrade first') {
      L.push(`Task: do not remove this yet. Upgrade the package to the version named above, run the test suite, and only then delete the workaround and this comment.`);
    } else if (f.kind === 'docs') {
      L.push(`Task: the documented limitation no longer exists. Correct the documentation here, do not touch behaviour.`);
    } else {
      L.push(`Task: remove the workaround this comment describes, along with the comment. Keep the change minimal, then run the project's test suite and report what broke.`);
    }
    L.push('');
  });
  if (inTests.length > 0) {
    L.push('---');
    L.push('');
    L.push(`## Not work: ${inTests.length} of these are in tests`);
    L.push('');
    L.push('A test that links to an issue is usually the regression test for that');
    L.push('bug. The issue being closed is why the test exists, not a reason to');
    L.push('delete it. Do not touch these unless the behaviour they check is gone:');
    L.push('');
    for (const f of inTests.slice(0, 40)) {
      L.push(`- ${f.file}:${f.line} (${premiseOf(f)})`);
    }
    L.push('');
  }
  L.push('---');
  L.push('Generated by Ancient Fences. Verify each removal with tests before merging.');
  return L.join('\n');
}
