import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { checkGithubRefs, verdict } from '../src/tracker.mjs';
import { unreachable } from '../src/report.mjs';

// Mock API: one closed issue, one open issue, one that does not exist.
const server = createServer((req, res) => {
  const map = {
    '/repos/a/b/issues/1': { state: 'closed', closed_at: '2018-08-31T10:00:00Z', title: 'old bug' },
    '/repos/a/b/issues/2': { state: 'open', closed_at: null, title: 'still open' },
  };
  const body = map[req.url];
  res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body ?? { message: 'Not Found' }));
});

await new Promise((r) => server.listen(0, r));
const apiBase = `http://127.0.0.1:${server.address().port}`;

const states = await checkGithubRefs(['github:a/b#1', 'github:a/b#2', 'github:a/b#9'], { apiBase });

assert.equal(states.get('github:a/b#1').state, 'closed');
assert.equal(states.get('github:a/b#1').closedAt, '2018-08-31T10:00:00Z');
assert.equal(states.get('github:a/b#2').state, 'open');
assert.equal(states.get('github:a/b#9').state, 'unknown');

const fence = (ids) => ({ premise: { type: 'tracker', refs: ids.map((id) => ({ id })) } });
assert.equal(verdict(fence(['github:a/b#1']), states).level, 'remove');
assert.match(verdict(fence(['github:a/b#1']), states).why, /2018-08-31/);
assert.equal(verdict(fence(['github:a/b#2']), states).level, 'still valid');
assert.equal(verdict(fence(['github:a/b#1', 'github:a/b#2']), states).level, 'review');

// Not knowing must never read as "still valid".
assert.equal(verdict(fence(['github:a/b#9']), states).level, 'unchecked');
assert.equal(verdict({ premise: { type: 'date', date: '2020-01-01', overdue: true } }, states).level, 'remove');

server.close();

// "unchecked" printed on its own reads as a bug in this tool. The reason the
// tracker could not answer was recorded and then thrown away before anybody
// could see it, so a rate limit and a missing network looked identical.
const fences = [
  { verdict: { level: 'unchecked', why: 'HTTP 403 (rate limit)' } },
  { verdict: { level: 'unchecked', why: 'HTTP 403 (rate limit)' } },
  { verdict: { level: 'unchecked', why: 'network: fetch failed' } },
  { verdict: { level: 'unmarked', why: 'no recorded reason for this code' } },
  { verdict: { level: 'remove', why: 'the issue is closed' } },
  { verdict: null },
  {},
];
assert.deepEqual(unreachable(fences), [
  ['HTTP 403 (rate limit)', 2],
  ['network: fetch failed', 1],
], 'grouped by reason, most common first');
assert.deepEqual(unreachable([]), []);
assert.deepEqual(unreachable([{ verdict: { level: 'unmarked', why: 'no recorded reason for this code' } }]), [],
  'a fence with no external reason was never going to be checked');

console.log('tracker: 13 assertions passed');
