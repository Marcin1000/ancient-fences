import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readInstalled } from '../src/lockfile.mjs';

const dir = await mkdtemp(join(tmpdir(), 'ancient-lock-'));

await writeFile(join(dir, 'package-lock.json'), JSON.stringify({
  lockfileVersion: 3,
  packages: {
    '': { name: 'app', version: '1.0.0' },
    'node_modules/sharp': { version: '0.33.1' },
    'node_modules/@babel/core': { version: '7.20.0' },
    'node_modules/other/node_modules/sharp': { version: '0.31.0' },
  },
}));

const installed = await readInstalled(dir);
assert.equal(installed.get('sharp'), '0.33.1', 'keeps the highest version, not the last one seen');
assert.equal(installed.get('@babel/core'), '7.20.0');

// A project with no lockfile must simply say less, never fail.
const empty = await readInstalled(join(tmpdir(), 'definitely-not-a-project-' + Date.now()));
assert.equal(empty.size, 0);

await writeFile(join(dir, 'package-lock.json'), '{ this is not json');
const broken = await readInstalled(dir);
assert.equal(broken.size, 0, 'an unparseable lockfile is silence, not a crash');

console.log('lockfile: 4 assertions passed');
