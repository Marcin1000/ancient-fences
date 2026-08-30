import assert from 'node:assert/strict';
import { isTestPath } from '../src/paths.mjs';
import { summarize, ranked, renderTasks } from '../src/report.mjs';

// What counts as a test, on both kinds of path separator.
for (const p of ['test/a.js', 'tests/lib/b.js', 'src/__tests__/c.js', 'spec/d.js',
                 'src/thing.test.ts', 'src/thing.spec.js', 'e2e/x.js', 'test\\cli.test.mjs']) {
  assert.equal(isTestPath(p), true, p);
}
for (const p of ['src/a.js', 'lib/latest/b.js', 'src/contest.js', 'app/protest.ts', 'src/testing-library-setup.js']) {
  assert.equal(isTestPath(p), false, p);
}

const fence = (file, extra = {}) => ({
  file, line: 1, kind: 'code', text: 'x',
  premise: { type: 'tracker', refs: [{ id: 'github:a/b#1' }] },
  verdict: { level: 'remove', why: 'issue closed' },
  ...extra,
});

// The summary says how much of the total is test material.
const s = summarize([fence('src/a.js'), fence('tests/b.js'), fence('src/c.test.js')]);
assert.equal(s.total, 3);
assert.equal(s.inTests, 2);
assert.equal(s.inSource, 1);

// The list leads with what somebody can actually remove.
const order = ranked([fence('tests/b.js'), fence('src/a.js')]).map((f) => f.file);
assert.deepEqual(order, ['src/a.js', 'tests/b.js']);

// And the agent is never told to delete a regression test. This is the whole
// point of the distinction: an agent acts on these instructions without
// arguing, and deleting the test that guards a fixed bug is the worst thing
// this tool could cause.
const tasks = renderTasks([fence('src/a.js'), fence('tests/lib/rules/accessor-pairs.js')], 'demo', true);
assert.match(tasks, /## 1\. src\/a\.js:1/);
assert.doesNotMatch(tasks, /## 2\./, 'the test is not item two on the work list');
assert.match(tasks, /Not work: 1 of these are in tests/);
assert.match(tasks, /tests\/lib\/rules\/accessor-pairs\.js:1/);
assert.match(tasks, /not a reason to\ndelete it/);

// A run where every finding is in a test produces no work at all.
const onlyTests = renderTasks([fence('tests/b.js')], 'demo', true);
assert.match(onlyTests, /Nothing to remove in source/);
assert.match(onlyTests, /1 finding is in tests/);

console.log('paths: 21 assertions passed');
