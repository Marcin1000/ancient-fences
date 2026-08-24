import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { walkFiles, looksGenerated } from '../src/walk.mjs';

const pad = (label, bytes = 40 * 1024) => {
  const unit = `// ${label}\n`;
  return unit.repeat(Math.ceil(bytes / unit.length));
};

// The preamble every browserify bundle starts with, as it appears in a real
// one: html-docx.js, 406 kB of somebody else's libraries.
const BROWSERIFY = '!function(e){if("object"==typeof exports&&"undefined"!=typeof module)module.exports=e();else if("function"==typeof define&&define.amd)define([],e)}(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){}})});';

assert.equal(looksGenerated('html-docx.js', BROWSERIFY + pad('lodash')), 'bundle');
assert.equal(looksGenerated('app.min.js', 'const a = 1;\n'), 'built file');
assert.equal(looksGenerated('styles.bundle.css', 'a{color:red}'), 'built file');
assert.equal(looksGenerated('big.js', `const data = "${'x'.repeat(2000)}";\n` + pad('data')), 'minified');

// A hand-written module wrapper is not a build product, however it is spelled.
const HAND_WRITTEN = `(function (root, factory) {
  if (typeof exports === "object") { module.exports = factory(); }
  else { root.thing = factory(); }
}(this, function () {
  // Workaround for https://github.com/lovell/sharp/issues/1
  return {};
}));
`;
assert.equal(looksGenerated('thing.js', HAND_WRITTEN), null);

// Size is what separates the two: the same wrapper only counts as a bundle
// when it carries tens of kilobytes of code behind it.
assert.equal(looksGenerated('thing.js', HAND_WRITTEN + pad('modules')), 'bundle');

// And ordinary source is never touched, however long it gets.
assert.equal(looksGenerated('server.js', pad('a normal, long, hand-written file', 200 * 1024)), null);

const dir = await mkdtemp(join(tmpdir(), 'ancient-walk-'));
await mkdir(join(dir, 'lib'), { recursive: true });
await writeFile(join(dir, 'app.js'), '// Workaround for https://github.com/lovell/sharp/issues/1\n');
await writeFile(join(dir, 'lib', 'html-docx.js'), BROWSERIFY + pad('lodash'));

let skipped = [];
let seen = [];
for await (const f of walkFiles(dir, { skipped })) seen.push(f.path);
assert.deepEqual(seen, ['app.js'], 'the bundle is not the team\'s code');
assert.equal(skipped.length, 1);
assert.equal(skipped[0].why, 'bundle');

// Nothing is hidden for good: the flag brings it back.
skipped = [];
seen = [];
for await (const f of walkFiles(dir, { skipped, includeGenerated: true })) seen.push(f.path);
assert.equal(seen.length, 2);
assert.equal(skipped.length, 0);

await rm(dir, { recursive: true, force: true });
console.log('walk: 11 assertions passed');
