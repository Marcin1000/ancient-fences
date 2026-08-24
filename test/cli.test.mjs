import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../bin/ancient-fences.mjs', import.meta.url));

// A tiny repository with one dead fence and one that is still justified.
const dir = await mkdtemp(join(tmpdir(), 'ancient-cli-'));
await writeFile(join(dir, 'app.js'), `// Workaround for https://github.com/lovell/sharp/issues/1
// Remove once upstream lands the fix.
export const resize = () => null;

// See https://github.com/lovell/sharp/issues/2 for why this is disabled.
export const rotate = () => null;
`);
await writeFile(join(dir, 'package-lock.json'), JSON.stringify({
  lockfileVersion: 3,
  packages: { '': { name: 'demo' }, 'node_modules/sharp': { version: '0.33.1' } },
}));

const server = createServer((req, res) => {
  const map = {
    '/repos/lovell/sharp/issues/1': { state: 'closed', closed_at: '2021-04-02T00:00:00Z', milestone: { title: 'v0.30.0' } },
    '/repos/lovell/sharp/issues/2': { state: 'open', closed_at: null },
  };
  const body = map[req.url];
  res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body ?? { message: 'Not Found' }));
});
await new Promise((r) => server.listen(0, r));
const apiBase = `http://127.0.0.1:${server.address().port}`;
const tasksFile = join(dir, 'tasks.md');

const { stdout } = await run('node', [
  cli, 'scan', dir, '--check', '--no-blame', `--api-base=${apiBase}`, `--tasks=${tasksFile}`,
]);

assert.match(stdout, /2\s+fences standing/);
assert.match(stdout, /remove/, 'the closed issue must produce a removal verdict');
assert.match(stdout, /still valid/, 'the open issue must stay justified');

const tasks = await readFile(tasksFile, 'utf8');
assert.match(tasks, /app\.js:1/);
assert.match(tasks, /shipped in 0\.30\.0/, 'the verdict must name the version that carried the fix');
assert.doesNotMatch(tasks, /app\.js:5/, 'a fence with an open issue is not work for an agent');

// The documented form is "ancient-fences ." and it must scan, not print help.
// The first version read the path as a command name and did nothing.
const forms = [
  [dir, '--no-blame'],
  ['scan', dir, '--no-blame'],
];
for (const argv of forms) {
  const { stdout: out } = await run('node', [cli, ...argv], { cwd: dir });
  assert.match(out, /fences standing/, `form "${argv.join(' ')}" must scan`);
}

const help = await run('node', [cli, 'help']);
assert.match(help.stdout, /npx ancient-fences \[path\]/, 'help still reachable by name');

server.close();
await rm(dir, { recursive: true, force: true });
console.log('cli: 9 assertions passed');
