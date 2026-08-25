import assert from 'node:assert/strict';
import { detectFences } from '../src/detect.mjs';

// 1. A bare tracker link is enough: someone wrote this code because of that bug.
const a = detectFences('x.ts', '// AcceptCHFrame disabled because of crbug.com/1348106.\nconst args = [];\n');
assert.equal(a.length, 1);
assert.equal(a[0].premise.type, 'tracker');
assert.equal(a[0].premise.refs[0].id, 'crbug:1348106');
assert.equal(a[0].kind, 'code');

// 2. The same link inside a doc comment is a different repair: docs, not code.
const b = detectFences('y.ts', '  /**\n   * Does not affect WebSockets, see\n   * {@link https://crbug.com/563644}\n   */\n');
assert.equal(b.length, 1);
assert.equal(b[0].kind, 'docs');

// 3. A deadline written into a comment, already passed.
const c = detectFences('z.py', '# temporary shim, remove after 2021-06-01\n');
assert.equal(c[0].premise.type, 'date');
assert.equal(c[0].premise.overdue, true);

// 4. An ordinary comment is not a fence. Otherwise the tool drowns in noise.
assert.equal(detectFences('q.js', '// Returns users sorted by last name.\n').length, 0);

// 5. A fence with no sign: clearly a workaround, no recorded reason.
const e = detectFences('w.go', '// HACK: do not touch, breaks in production\n');
assert.equal(e[0].kind, 'unmarked');
assert.equal(e[0].premise.type, 'none');

console.log('detect: 9 assertions passed');
// 6. A weak word on its own is ordinary English, not evidence. Counting
// "until" and "polyfill" as fences produced 232 findings on webpack, of which
// almost none were fences.
assert.equal(detectFences('a.js', '// Valid only until the next call to parseHtml.\n').length, 0);
assert.equal(detectFences('a.js', '// Exactly one polyfill per page, before the body scripts.\n').length, 0);
assert.equal(detectFences('a.js', '// Memoized evaluation is a few ms; a regression here is exponential.\n').length, 0);

// 7. The same weak word counts once the comment names the condition.
const g = detectFences('a.js', '// Temporary, remove after 2020-03-01 when the API is stable.\n');
assert.equal(g.length, 1);
assert.equal(g[0].kind, 'deadline');

// 8. "remove this" is a fence in a note and prose everywhere else.
assert.equal(detectFences('a.js', '// TODO webpack 6: remove this class\n').length, 1);
assert.equal(detectFences('a.js', '// We iterate over the children to remove this from their parents.\n').length, 0);

// 9. A comment after code, on a line that also contains a string. The first
// version skipped any line with a quote and missed these entirely.
const h = detectFences('a.js', 'const u = fetch("/x"); // workaround for https://github.com/nodejs/node/issues/1\n');
assert.equal(h.length, 1);
assert.equal(h[0].premise.refs[0].id, 'github:nodejs/node#1');

// 10. A URL inside a string is not a comment, however much it looks like one.
assert.equal(detectFences('a.js', 'const u = "https://github.com/nodejs/node/issues/2"; // fine\n').length, 0);

// 11. A stylesheet selector is not a comment. "#hack-banner {" was reported as
// a fence with no sign.
assert.equal(detectFences('a.css', '#hack-banner {\n  display: none;\n}\n').length, 0);
assert.equal(detectFences('a.css', '/* Workaround for a Safari repaint bug, see https://bugs.webkit.org/show_bug.cgi?id=1 */\n').length, 1);

// 12. Floor division in Python is not a comment either.
assert.equal(detectFences('a.py', 'rows = total // per_page  # hack, remove after 2019-01-01\n').length, 1);
assert.equal(detectFences('a.py', 'rows = total // per_page + workaround_offset\n').length, 0);

// 13. The comment text keeps the words and drops the markers, because it is
// read by people and pasted into agent tasks.
const i = detectFences('a.js', '// Workaround for https://github.com/a/b/issues/9\n// Remove once fixed upstream.\n');
assert.equal(i[0].text.includes('// Remove'), false, 'the marker of the second line is stripped');
assert.equal(i[0].text.startsWith('//'), false);
assert.match(i[0].text, /Remove once fixed upstream/);

console.log('detect: 16 more assertions passed (precision)');


// Where the fences are, so a count can be checked against the files it came
// from. The ranked list only shows the ones with a tracker, which leaves the
// rest of the total unexplained.
{
  const { byFile } = await import('../src/report.mjs');
  const rows = byFile([
    { file: 'lib/big.js', kind: 'unmarked' },
    { file: 'lib/big.js', kind: 'docs' },
    { file: 'app.js', kind: 'code' },
  ]);
  assert.equal(rows[0].file, 'lib/big.js');
  assert.equal(rows[0].total, 2);
  assert.deepEqual(rows[0].kinds, { unmarked: 1, docs: 1 });
  console.log('detect: 3 more assertions passed (byFile)');
}
