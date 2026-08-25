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
