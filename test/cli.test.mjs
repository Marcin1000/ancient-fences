import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
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

// A codebase with nothing to report must say so in words. An empty table
// under the heading "check these first" is not an answer.
const quiet = await mkdtemp(join(tmpdir(), 'ancient-quiet-'));
await writeFile(join(quiet, 'lib.js'), '!function(e){if("object"==typeof exports)module.exports=e()}(function(){});\n' + '// padding\n'.repeat(4000));
await writeFile(join(quiet, 'app.js'), 'export const x = 1;\n');
const empty = await run('node', [cli, quiet, '--no-blame']);
assert.match(empty.stdout, /Nothing found/);
assert.match(empty.stdout, /lib\.js\s+\[bundle\]/, 'a skipped file is named, so nobody has to trust the count');
await rm(quiet, { recursive: true, force: true });

const help = await run('node', [cli, 'help']);
assert.match(help.stdout, /npx ancient-fences \[path\]/, 'help still reachable by name');

// A path that is not there must fail loudly. Reporting zero fences for a
// directory nobody looked at reads like an all clear, which is the one thing
// this tool must never say by accident.
const missing = await run('node', [cli, join(dir, 'nowhere')]).then(
  (r) => ({ code: 0, ...r }),
  (e) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }),
);
assert.equal(missing.code, 1, 'a missing path is an error, not an empty report');
assert.match(missing.stderr, /nothing to scan/);
assert.doesNotMatch(missing.stdout ?? '', /fences standing/);

// The help text shows "--report[=file]", and it is easy to paste it straight
// onto the path. Say what happened instead of scanning a directory named
// after the option.
const glued = await run('node', [cli, '.--report[=file]'], { cwd: dir }).catch((e) => e);
assert.match(glued.stderr, /option got stuck to the path/);


// A mistyped flag must stop the run. Silently ignoring "--chek" printed a
// normal report, and the reader believed the trackers had been consulted.
const typo = await run('node', [cli, dir, '--chek', '--no-blame']).catch((e) => e);
assert.equal(typo.code, 2, 'an unknown option is a usage error');
assert.match(typo.stderr, /unknown option --chek/);

// Two paths at once is a mistake, not a merge.
const two = await run('node', [cli, dir, dir, '--no-blame']).catch((e) => e);
assert.equal(two.code, 2);

// A single file is a legitimate thing to scan.
const one = await run('node', [cli, join(dir, 'app.js'), '--no-blame']);
assert.match(one.stdout, /2\s+fences standing/);

// The cache belongs to the user, not to the repository being scanned. The
// first version left a file behind in someone else's working tree.
const home = await mkdtemp(join(tmpdir(), 'ancient-home-'));
await run('node', [cli, dir, '--no-blame', '--check', `--api-base=${apiBase}`], {
  env: { ...process.env, XDG_CACHE_HOME: home },
});
await assert.rejects(readFile(join(dir, '.ancient-fences-cache.json'), 'utf8'), 'nothing is written into the scanned repo');
const cached = await readdir(join(home, 'ancient-fences'));
assert.equal(cached.length, 1, 'the state is cached under the user cache directory');
const entry = JSON.parse(await readFile(join(home, 'ancient-fences', cached[0]), 'utf8'));
assert.ok(Object.values(entry)[0].checkedAt, 'every cached state records when it was read');

// A shallow clone cannot date a line, and the report has to say so instead of
// printing a confident zero.
const shallow = await mkdtemp(join(tmpdir(), 'ancient-shallow-'));
await run('git', ['init', '-q', '-b', 'main', shallow]);
await writeFile(join(shallow, 'app.js'), '// Workaround for https://github.com/lovell/sharp/issues/1\nexport const a = 1;\n');
await run('git', ['add', '-A'], { cwd: shallow });
await run('git', ['-c', 'user.email=t@e.pl', '-c', 'user.name=T', 'commit', '-qm', 'x'], { cwd: shallow });
const clone = join(await mkdtemp(join(tmpdir(), 'ancient-clone-')), 'c');
await run('git', ['clone', '-q', '--depth', '1', `file://${shallow}`, clone]);
const shallowOut = await run('node', [cli, clone]);
assert.match(shallowOut.stdout, /age not measured/);
assert.match(shallowOut.stdout, /shallow clone/);
assert.doesNotMatch(shallowOut.stdout, /fences untouched for 3\+ years/, 'no zero that reads like an all clear');

await rm(home, { recursive: true, force: true });
await rm(shallow, { recursive: true, force: true });
await rm(clone, { recursive: true, force: true });

server.close();
await rm(dir, { recursive: true, force: true });
console.log('cli: 25 assertions passed');
