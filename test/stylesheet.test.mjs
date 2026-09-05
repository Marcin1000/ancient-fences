import assert from 'node:assert/strict';
import { renderHtml, summarize } from '../src/report.mjs';


/**
 * A stray brace in the stylesheet is invisible in the source and silent in the
 * browser: CSS has no errors, it just discards the rule it cannot parse and
 * carries on. One orphan `}` shipped in 0.4.0 and took `th,td` with it, so
 * every table in every HTML report lost its padding, its alignment and its
 * vertical anchoring, on desktop only, in a file nobody opens in a debugger.
 *
 * This reads the emitted stylesheet the way a parser does.
 */
export function cssProblems(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const problems = [];
  let depth = 0;
  let line = 1;
  for (const ch of clean) {
    if (ch === '\n') line += 1;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth < 0) {
        problems.push(`line ${line}: a closing brace with nothing open, everything after it is discarded`);
        depth = 0;
      }
    }
  }
  if (depth > 0) problems.push(`${depth} block${depth === 1 ? '' : 's'} left unclosed`);
  return problems;
}

const styleOf = (html) => html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>'));

const fence = (file) => ({
  file, line: 1, kind: 'code', text: 'workaround', lastTouched: new Date('2020-01-01'),
  premise: { type: 'tracker', refs: [{ id: 'github:a/b#1' }] },
  verdict: { level: 'unchecked', why: 'not checked' },
});

const fences = [fence('src/a.js'), fence('test/b.test.js')];
const summary = { ...summarize(fences, new Map()), skipped: 0, skippedFiles: [], history: null, checkedAt: null };
const html = renderHtml(fences, summary, 'owner/repo', false);
const css = styleOf(html);

assert.deepEqual(cssProblems(css), [], 'the stylesheet must parse as written');

// The rules that carry the table. Losing any one of them is what the orphan
// brace actually did, and the page still looked like a page.
for (const selector of ['th,td{', 'thead th{', 'td.num{', 'table{', '.scroll{']) {
  assert.ok(css.includes(selector), `${selector} is missing from the stylesheet`);
}

// Padding and alignment are the load-bearing declarations in that rule: without
// them the text sits against the border and headers drift off their columns.
const cell = css.slice(css.indexOf('th,td{'), css.indexOf('}', css.indexOf('th,td{')));
assert.match(cell, /padding:/, 'table cells need padding or the text touches the border');
assert.match(cell, /text-align:left/, 'headers default to centred and stop lining up with their column');
assert.match(cell, /vertical-align:top/, 'a short cell must sit level with a tall one');

// The checker has to fail on the real thing, not just pass on a good file.
assert.equal(cssProblems('a{b:c}}d{e:f}').length, 1, 'an orphan closing brace is a problem');
assert.equal(cssProblems('a{b:c').length, 1, 'an unclosed block is a problem');
assert.deepEqual(cssProblems('@media (x){a{b:c}}'), [], 'nesting one level deep is fine');


console.log('stylesheet: 12 assertions passed');
