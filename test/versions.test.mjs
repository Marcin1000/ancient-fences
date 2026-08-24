import assert from 'node:assert/strict';
import { compareVersions, fixVersionFrom, packageForRef, shippedStatus } from '../src/versions.mjs';
import { verdict } from '../src/tracker.mjs';

assert.equal(compareVersions('1.4.0', '1.2.3'), 1);
assert.equal(compareVersions('2.0', '2.0.0'), 0);
assert.equal(compareVersions('nonsense', '1.0.0'), null);

// A release milestone is the most trustworthy statement of a fix version.
assert.deepEqual(fixVersionFrom({ milestone: { title: 'v3.2.0' } }), { version: '3.2.0', source: 'milestone' });
assert.deepEqual(fixVersionFrom({ body: 'This was fixed in 4.1.2, please upgrade.' }), { version: '4.1.2', source: 'issue text' });
assert.equal(fixVersionFrom({ body: 'no version here' }), null);

const installed = new Map([['sharp', '0.33.1'], ['@babel/core', '7.20.0']]);
assert.deepEqual(packageForRef('github:lovell/sharp#123', installed), { name: 'sharp', version: '0.33.1' });
assert.equal(packageForRef('github:some/unknown#1', installed), null);

assert.equal(shippedStatus({ fix: { version: '0.32.0', source: 'milestone' }, installed: { name: 'sharp', version: '0.33.1' } }).state, 'shipped');
assert.equal(shippedStatus({ fix: { version: '0.34.0', source: 'milestone' }, installed: { name: 'sharp', version: '0.33.1' } }).state, 'not upgraded');

// The verdict has to say two different things, because they need two different
// actions: delete the workaround, or upgrade before you can.
const fence = { premise: { type: 'tracker', refs: [{ id: 'github:lovell/sharp#123' }] } };
const closedWithFix = new Map([['github:lovell/sharp#123',
  { state: 'closed', closedAt: '2024-01-05T00:00:00Z', fix: { version: '0.32.0', source: 'milestone' } }]]);
const v1 = verdict(fence, closedWithFix, installed);
assert.equal(v1.level, 'remove');
assert.match(v1.why, /shipped in 0\.32\.0/);

const closedNotShipped = new Map([['github:lovell/sharp#123',
  { state: 'closed', closedAt: '2024-01-05T00:00:00Z', fix: { version: '0.34.0', source: 'milestone' } }]]);
const v2 = verdict(fence, closedNotShipped, installed);
assert.equal(v2.level, 'upgrade first');
assert.match(v2.why, /pinned at 0\.33\.1/);

// With no lockfile knowledge it must fall back to the weaker, honest answer.
const v3 = verdict(fence, closedWithFix, new Map());
assert.equal(v3.level, 'remove');
assert.match(v3.why, /reason disappeared 2024-01-05/);

console.log('versions: 15 assertions passed');
