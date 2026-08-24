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
  const trackers = new Set();
  let overdue = 0;
  let old = 0;
  let oldest = null;
  for (const f of fences) {
    byKind[f.kind]++;
    if (f.premise.type === 'tracker') for (const r of f.premise.refs) trackers.add(r.id);
    if (f.premise.type === 'date' && f.premise.overdue) overdue++;
    const y = yearsSince(f.lastTouched);
    if (y !== null && y >= 3) old++;
    if (y !== null && (oldest === null || y > oldest)) oldest = y;
  }
  const verdicts = {};
  for (const f of fences) {
    if (!f.verdict) continue;
    verdicts[f.verdict.level] = (verdicts[f.verdict.level] ?? 0) + 1;
  }
  return { total: fences.length, byKind, trackers: trackers.size, overdue, old, oldest, verdicts, checked: states.size };
}

export function ranked(fences) {
  return fences
    .filter((f) => f.premise.type === 'tracker' || (f.premise.type === 'date' && f.premise.overdue))
    .sort((a, b) => (yearsSince(b.lastTouched) ?? 0) - (yearsSince(a.lastTouched) ?? 0));
}

function premiseOf(f) {
  return f.premise.type === 'tracker'
    ? f.premise.refs.map((r) => r.id).join(', ')
    : `deadline ${f.premise.date} (passed)`;
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
  L.push('  ' + '-'.repeat(70));
  L.push(`  ${n(summary.trackers)}  distinct external issues to check`);
  L.push(`  ${n(summary.old)}  fences untouched for 3+ years`);
  if (summary.oldest !== null) L.push(`  ${n(Math.round(summary.oldest))}  years old is the oldest one`);
  L.push('');

  if (checked) {
    L.push('  VERDICTS');
    L.push('  ' + '-'.repeat(70));
    for (const [level, count] of Object.entries(summary.verdicts).sort((a, b) => b[1] - a[1])) {
      L.push(`  ${String(count).padStart(4)}  ${level}`);
    }
    L.push('');
  }

  L.push('  CHECK THESE FIRST  (longest untouched)');
  L.push('  ' + '='.repeat(70));
  for (const f of ranked(fences).slice(0, 15)) {
    const y = yearsSince(f.lastTouched);
    const age = y === null ? '   ?  ' : `${y.toFixed(1)} yr`;
    L.push(`  ${age.padStart(7)}  ${f.file}:${f.line}   [${f.kind}]`);
    L.push(`           reason:   ${premiseOf(f)}`);
    L.push(`           comment:  ${f.text.slice(0, 92)}`);
    if (f.verdict) L.push(`           VERDICT:  ${f.verdict.level} (${f.verdict.why})`);
    L.push('');
  }
  L.push('  Every closed issue above is code you can delete.');
  L.push('');
  return L.join('\n');
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * A standalone report meant to be forwarded to whoever pays for the codebase.
 * Developers find the fences; someone else decides what they cost.
 */
export function renderHtml(fences, summary, repoName, checked = false) {
  const rows = ranked(fences).slice(0, 40).map((f) => {
    const y = yearsSince(f.lastTouched);
    const v = f.verdict;
    return `<tr>
      <td class="num">${y === null ? '-' : y.toFixed(1) + ' yr'}</td>
      <td><code>${esc(f.file)}:${f.line}</code><p>${esc(f.text.slice(0, 130))}</p></td>
      <td class="num">${esc(premiseOf(f))}</td>
      <td>${v ? `<span class="v v-${esc(v.level.replace(/\s+/g, '-'))}">${esc(v.level)}</span><p>${esc(v.why)}</p>` : '<span class="v">not checked</span>'}</td>
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
table{border-collapse:collapse;width:100%;min-width:46rem;font-size:.88rem}
th,td{text-align:left;padding:.8rem 1rem;border-bottom:1px solid var(--line);vertical-align:top}
thead th{font-family:ui-monospace,monospace;font-size:.64rem;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:400;background:var(--surface2);white-space:nowrap}
td p{margin:.35rem 0 0;color:var(--dim);font-size:.82rem}
td.num{white-space:nowrap;color:var(--dim);font-variant-numeric:tabular-nums;font-size:.8rem}
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
    <div class="stat"><b>${summary.trackers}</b><span>external issues to check</span></div>
    <div class="stat"><b>${summary.old}</b><span>untouched for 3+ years</span></div>
    <div class="stat"><b>${summary.oldest === null ? '-' : Math.round(summary.oldest)}</b><span>years, the oldest one</span></div>
  </div>
  <h2>Check these first</h2>
  <div class="scroll"><table>
    <thead><tr><th>Untouched</th><th>Where</th><th>Reason given</th><th>${checked ? 'Verdict' : 'State'}</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
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
export function renderTasks(fences, repoName) {
  const dead = fences.filter((f) => f.verdict && (f.verdict.level === 'remove' || f.verdict.level === 'upgrade first'));
  const L = [];
  L.push(`# Dead fences in ${repoName}`);
  L.push('');
  L.push(`Each item below is code kept alive by a condition that no longer holds.`);
  L.push(`Verified against the referenced tracker${dead.some((f) => /shipped in/.test(f.verdict.why)) ? ' and the lockfile' : ''}.`);
  L.push('');
  if (dead.length === 0) {
    L.push('Nothing to remove. Run with --check first if you have not.');
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
  L.push('---');
  L.push('Generated by Ancient Fences. Verify each removal with tests before merging.');
  return L.join('\n');
}
