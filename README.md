<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Marcin1000/ancient-fences/main/assets/readme-banner.png">
  <img src="https://raw.githubusercontent.com/Marcin1000/ancient-fences/main/assets/readme-banner-light.png" alt="Ancient Fences" width="100%">
</picture>

<p align="center">
  <a href="https://www.npmjs.com/package/ancient-fences"><img alt="npm" src="https://img.shields.io/npm/v/ancient-fences?color=8B5514&labelColor=1E242B&style=flat-square"></a>
  <img alt="MIT licence" src="https://img.shields.io/badge/licence-MIT-8B5514?labelColor=1E242B&style=flat-square">
  <img alt="Node 20 or newer" src="https://img.shields.io/badge/node-%E2%89%A520-8B5514?labelColor=1E242B&style=flat-square">
  <img alt="Works with Claude Code, Cursor and Copilot" src="https://img.shields.io/badge/output-agent%20tasks-8B5514?labelColor=1E242B&style=flat-square">
</p>

# Ancient Fences

**Find outdated workarounds in a long-lived codebase, and turn the verified ones
into tasks a coding agent can act on.**

Dependabot bumps the version. Nobody removes the workaround you wrote because
the old version was broken.

```bash
npx ancient-fences .           # what is standing in this codebase
npx ancient-fences . --check   # and whether the reasons still hold
npx ancient-fences . --tasks   # the dead ones, written as work for your agent
```

No installation, no configuration, no account. It reads the repository you point
it at and prints what it found.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Marcin1000/ancient-fences/main/assets/shot-fences.png">
  <img src="https://raw.githubusercontent.com/Marcin1000/ancient-fences/main/assets/shot-fences-light.png" alt="Ancient Fences output for webpack: 90 fences standing, 39 of them in tests, the oldest untouched for 8.8 years" width="100%">
</picture>

A real run against a full clone of webpack. Nothing here is typed to look good.

## The problem

You hit a bug in a library. You write code around it and, if you are decent,
leave a note:

```js
// Workaround for https://github.com/some/lib/issues/2500 (remove when fixed)
```

Then the bug gets fixed. The issue is closed. The library is replaced. And
nothing happens, because there is no link between someone else's tracker and
your code. The workaround stays forever, and after two years nobody dares touch
it: the note says "bug", so maybe the bug is still there.

This is Chesterton's Fence at industrial scale. The code knows the fence is
there. Git knows how long it has stood. Nobody checks whether the reason still
exists.

## From workaround to agent task

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Marcin1000/ancient-fences/main/assets/diagram-fences.png">
  <img src="https://raw.githubusercontent.com/Marcin1000/ancient-fences/main/assets/diagram-fences-light.png" alt="Three stages: detect the workaround, check the reason still holds, hand off a task an agent can act on" width="100%">
</picture>

Ancient Fences does not edit your code, and that is deliberate. Knowing that a
fence is dead is the scarce part; every editor now ships something that can do
the deleting. So `--tasks` writes the verified findings as work:

```bash
npx ancient-fences . --check --tasks
```

You get a markdown file with one entry per dead fence: the file and line, the
reason originally recorded, what proves it no longer holds, and the instruction.
Each entry has this shape:

```markdown
## src/upload.js:212

- Recorded reason: github:some/lib#2500
- Evidence: the issue was closed on 2021-04-14, and the fix shipped in
  1.9.0 (milestone). Your lockfile has some-lib 2.3.1.
- Untouched for 4.2 years.

Remove the workaround and the comment that explains it, then run the test suite.
```

Point Claude Code, Cursor, Copilot or your own script at that file. The tests
are the safety net, which is why every instruction ends there.

## A real one, in full

In `webpack`, `test/configCases/plugins/terser-plugin/extract.js:3`:

```js
// ⚠️ move the following comment back to the top
// https://github.com/mishoo/UglifyJS2/issues/2500
```

The referenced issue is closed. Webpack dropped UglifyJS for terser in 2018, and
the string `uglify` does not appear anywhere else in the repository. The
directory is literally named `terser-plugin`. The line has stood untouched for
**8.8 years**, guarding a hole in a road that no longer exists.

That one lives in a test file, which is exactly why this tool would not ask you
to delete it. Read on.

## Tests are counted apart, and never listed as work

A comment in a test that links to an issue is usually the regression test for
that bug. It exists because of the bug, exactly like a workaround, but a closed
issue is the reason to **keep** it.

Four full clones, measured with this command:

| Repository | In source | In tests | Oldest |
|---|---|---|---|
| puppeteer/puppeteer | 32 | 45 | 9.1 yr |
| webpack/webpack | 51 | 39 | 8.8 yr |
| eslint/eslint | 43 | 399 | 8.2 yr |
| expressjs/express | 0 | 2 | 1.9 yr |

eslint has 399 findings in tests and 43 in its source. One combined number would
have made it look ten times worse than it is, and would have told an agent to
delete the tests that guard fixed bugs.

All four are maintained by good engineers. That is the point. The full reports
are published at
[ancientcode.net/reports](https://ancientcode.net/reports/).

## What it finds

| Kind | What it means | The repair when the reason dies |
|---|---|---|
| `code` | code written because of someone else's bug | delete the workaround |
| `docs` | a documented limitation pointing at an issue | the docs now lie, so fix them |
| `deadline` | a date written into a comment | the date passed, revisit |
| `unmarked` | clearly a workaround, no recorded reason | write the reason down, or remove it |

A comment counts as a fence when it links to an external tracker, or says
something that only a fence says ("workaround", "kludge", "no longer needed",
"do not upgrade"). Words that merely appear in fences ("until", "polyfill",
"temporary", "regression") count only when the comment also names the condition:
a deadline or a version. Phrases that read as prose elsewhere ("remove this",
"blocked by") count next to a `TODO`, `FIXME` or `HACK`, or next to a named
condition. Comment markers are read per language, so `#fff` in a stylesheet and
`a // b` in Python are not comments.

Trackers understood: GitHub issues and pull requests, Chromium (`crbug.com`),
Mozilla Bugzilla, WebKit.

## Verdicts

`remove` · `upgrade first` · `review` · `still valid` · `unchecked` · `unmarked`

A closed issue is weak evidence on its own. With `--check`, Ancient Fences also
reads the version the fix shipped in (a release milestone, or "fixed in 1.2.3"
in the issue) and compares it against your lockfile:

```
VERDICT:  remove (fix shipped in 0.30.0 (milestone), you run sharp 0.33.1)
VERDICT:  upgrade first (fix shipped in 0.34.0, but sharp is pinned at 0.33.1)
```

Those are two different jobs. The first is code you can delete this afternoon.
The second is the more uncomfortable finding: you are still paying to maintain a
workaround for a bug that was fixed years ago, because nobody upgraded.

`package-lock.json`, `yarn.lock` and `pnpm-lock.yaml` are read when present. No
lockfile means the tool says less, never something false.

Fence age comes from `git blame`, which needs history. In a shallow clone
(`--depth 1`, and every default CI checkout) git dates every line to the day it
was fetched, so the report says age was not measured rather than printing a
confident zero.

**An unknown issue state never produces `still valid`.** Not knowing is not a
green light, and when the tracker cannot answer the report says why. A tool that
reassures you without grounds is worse than no tool.

## A report you can forward

```bash
npx ancient-fences . --check --report=fences.html
```

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Marcin1000/ancient-fences/main/assets/report-fences.png">
  <img src="https://raw.githubusercontent.com/Marcin1000/ancient-fences/main/assets/report-fences-light.png" alt="The HTML report: counts, then the longest-untouched fences with their recorded reasons" width="100%">
</picture>

One HTML file, no scripts, no external requests.

## Options

```
--check             ask GitHub whether the referenced issues are still open
                    (set GITHUB_TOKEN to lift the 60 requests/hour limit)
--report[=file]     write a shareable HTML report (default: ancient-fences.html)
--tasks[=file]      write the dead fences as instructions for a coding agent
--api-base=URL      alternate API (GitHub Enterprise, or a mock in tests)
--json              full machine-readable output (counts split by source and tests)
--no-blame          skip fence age (faster, tells you less)
--include-generated scan bundles and minified builds too
--cache=FILE        where to keep issue states
--no-cache          ignore cached state and ask the tracker again
--max-age-days=N    how old a cached state may be before it is re-checked
                    (default 7)
```

An unknown option, or a number where a number cannot go, stops the run with exit
code 2 rather than being ignored. A mistyped flag that still prints a confident
report is worse than no report.

An issue state is a snapshot, not a fact. Closed issues get reopened, which is
why every cached state carries the date it was read.

## Tests

```bash
npm test
```

The tracker tests run against a mock GitHub API on localhost, so they work
offline and without a token.

## Status

Early, but real. Detection, ageing, issue checking, fix-version matching against
the lockfile, the HTML report and agent tasks all work and are covered by tests
that run offline. Not there yet: `@ancient premise:` annotations for conditions
that live outside a tracker (a contract, a vendor limit, a certificate expiry),
trackers other than GitHub and Chromium, and a GitHub Action that comments on
pull requests.

## Ancient Code

Ancient Fences answers one question about one repository. The same blindness
applies to everything else nobody re-checks in a long-running codebase: which
parts only one person understands, whether it builds from scratch, whether the
documentation still describes the system. [Ancient Code](https://ancientcode.net)
asks all of them, ships this scanner inside it, and is free and open source too:

```bash
npx ancient-code .
```

MIT licensed.
