# Contributing

Thanks for looking. This project is small on purpose: no dependencies, plain
ES modules, Node 20 or newer.

```bash
npm test        # runs everything, no network needed
```

## What is most useful right now

- **Detection for languages we handle badly.** The comment grouping is
  deliberately language-agnostic, which means it is wrong in places. Real
  examples from real repositories are the best bug reports.
- **More trackers.** Jira, GitLab, Linear and self-hosted Bugzilla all appear
  in comments. Each needs a pattern and a way to read issue state.
- **Fix versions.** We read a release milestone and "fixed in X" from the issue
  text. Release notes and closing pull requests would be better sources.

## What we will not do

- **No verdict without evidence.** If the issue state is unknown, the answer is
  `unchecked`. It is never `still valid`. A tool that reassures you without
  grounds is worse than no tool, and there is a test guarding this.
- **No editing your code.** Ancient Fences reports and, with `--tasks`, writes
  instructions. The removal is done by a person or by whatever agent the team
  already uses, with the test suite as the safety net.
- **No noise.** A finding that a maintainer would not act on is a bug. We would
  rather miss a fence than cry wolf about one.

## Tests

Every test runs offline. Tracker tests use a mock GitHub API on localhost, so
you never need a token to contribute.
