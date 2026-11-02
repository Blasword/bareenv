# bareenv

[![ci](https://github.com/Blasword/bareenv/actions/workflows/ci.yml/badge.svg)](https://github.com/Blasword/bareenv/actions/workflows/ci.yml) [![action](https://github.com/Blasword/bareenv/actions/workflows/action.yml/badge.svg)](https://github.com/Blasword/bareenv/actions/workflows/action.yml)

**Your pipeline was never run with `JAVA_HOME` unset.**

`bareenv` runs a command once per environment combination — unset, empty, invalid — and
tells you which ones break, why, and the exact command to reproduce it.

It is built for your own scripts: the verify step, the release gate, the `doctor` command
you wrote once and never tested without the variable that happened to be set on your
laptop.

No dependencies. No config to start. Node 18+.

## Where this came from

This tool exists because of a real bug: [morluto/rea#8171](https://github.com/morluto/rea/issues/8171).

A Ghidra verifier discovered and validated a JDK, then its launcher re-read `JAVA_HOME`
instead of using the validated result. With `JAVA_HOME` unset but a JDK on `PATH`, the
inspection succeeded, `rea doctor` reported healthy — and the launch failed at startup.

Finding that took a maintainer several rounds of hand-run environment combinations,
written up by hand in the issue. That is a tool's job. `bareenv` is that tool: it
turns one hand-built matrix into one command.

## What this is not

It is not an audit of other people's tools.

Running the corpus against six mature toolchains — `java`, `node`, `python`, `dotnet`,
Maven and Gradle — produced **zero findings**. Every one of them rejects a bogus
`JAVA_HOME` and falls back cleanly when it is unset.

That is the finding, not a failure of the tool. The bug this catches does not live in
products that thousands of people run every day; it lives in scripts that nobody ever
exercised twice. Which is exactly what `#8171` was: not a Ghidra bug, but a verification
script inside one repository.

## Demo

A miniature reproduction of that handoff lives in `fixtures/ghidra-verifier.mjs`.
It is not a decompiler — it reproduces the *shape* of the bug: discovery succeeds, the
launch re-reads the environment.

```
$ node fixtures/demo.mjs

command  node fixtures/ghidra-verifier.mjs
vary     JAVA_HOME  (mode single)

CASE               EXIT  TIME  VERDICT
-----------------  ----  ----  -------------
baseline           0     0.1s  pass
unset JAVA_HOME    1     0.1s  env-dependent
empty JAVA_HOME    1     0.1s  env-dependent
invalid JAVA_HOME  1     0.1s  expected-fail

2 environment-dependent failure(s)

  unset JAVA_HOME
    GhidraLaunchError: POSIX Ghidra requires its inspected JDK home
    repro: Remove-Item Env:\JAVA_HOME -ErrorAction SilentlyContinue; node fixtures/ghidra-verifier.mjs
```

On macOS and Linux the repro line reads `env -u JAVA_HOME node fixtures/ghidra-verifier.mjs`.

The `invalid` row is the important one. An explicitly invalid `JAVA_HOME` is *rejected*
here, which is correct, so it is not reported as a finding. Point the same run at
`fixtures/fallback-verifier.mjs` instead and that row becomes `accepted-invalid`: the bad
value was not rejected and the output changed. That is *not* counted as a finding, because
a tool that merely echoes the bad path into a diagnostic is not the same as one that
quietly swaps in a discovered value. Add `--strict-fallback` to count it anyway.

## Install

In CI, as an action — no clone, no install:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 22
- uses: Blasword/bareenv@v0.1.0
  with:
    vars: JAVA_HOME,PATH
    command: npm test
```

Locally, from a clone. There is no npm package yet:

```sh
git clone https://github.com/Blasword/bareenv
cd bareenv
node bin/bareenv.mjs run --var JAVA_HOME -- npm run verify
```

## Usage

```sh
bareenv run --var <NAME[,NAME]> [options] -- <command...>
bareenv detect      # which env vars does this repo read?
bareenv init        # write bareenv.json from what detect found
```

Each variable is tested in three states:

| state     | meaning                                                        |
| --------- | -------------------------------------------------------------- |
| `unset`   | removed from the child environment                             |
| `empty`   | set to the empty string                                        |
| `invalid` | a path that does not exist (only for path-like variable names) |

Options:

| flag | meaning |
| --- | --- |
| `--var` | variable to vary, repeatable, comma separated |
| `--mode single` | baseline plus one variable at a time (default) |
| `--mode full` | every combination of every state, capped at 64 cases |
| `--timeout <ms>` | per-case timeout, default `120000` |
| `--json <path>` | report path, default `.bareenv/report.json` |
| `--compare <path>` | flag findings that are not in a previous report |
| `--fail-on-findings` | exit 1 when a finding exists |
| `--strict-fallback` | count accepted-invalid values as findings |
| `--verbose` | print the tail of failing output |

Exit codes:

| code | meaning |
| --- | --- |
| `0` | ran (findings may still exist, see `--fail-on-findings`) |
| `1` | the baseline fails, or `--fail-on-findings` found something |
| `2` | findings that are not in the `--compare` report |
| `3` | usage error |

## What the verdicts mean

| verdict | meaning |
| --- | --- |
| `pass` | same result as the baseline |
| `env-dependent` | baseline passes, this case fails — **a finding** |
| `expected-fail` | an explicitly invalid value was rejected — the behavior you want |
| `not-observed` | identical behavior, so the command never looked at this variable |
| `accepted-invalid` | the bad value was not rejected and output changed — **not counted**, see `--strict-fallback` |
| `silent-fallback` | same, but counted — only with `--strict-fallback` |
| `baseline-broken` | the command fails before any variable changes; fix that first |
| `case-invalid` | the case could not start (for example an empty `PATH` on Windows) |

Only `env-dependent` counts by default. `not-observed` exists because `java -version` does
not read `JAVA_HOME`: reporting that it "accepted an invalid `JAVA_HOME`" would be a false
positive, and a tool that cries wolf once gets uninstalled.

## Design notes

Three decisions worth knowing about, because each of them removes a class of false
positive:

- **The command is pinned to an absolute path once, before any case runs.** Otherwise
  varying `PATH` would stop the shell from finding `node`/`npm`, and every `PATH` case
  would look like a finding.
- **Child output goes to temporary files, not pipes.** No buffer limits on large logs,
  and it survives sandboxes that deny pipe creation for children.
- **A shell is only used on Windows for `.cmd`/`.bat`.** Going through `cmd.exe` for
  everything makes quoting and `PATH` handling fragile; a direct spawn does not.

## Failing only on new findings

`--compare` checks the report against a previous run, so a PR that introduces a new
environment dependency fails while pre-existing ones stay quiet. Keep the base branch's
report as an artifact and point at it:

```sh
node bin/bareenv.mjs run --var JAVA_HOME --compare base.bareenv.json -- npm test
```

That exits `2` when the PR added a dependency and `0` when it only inherited old ones.

## Why this exists, in numbers

The shape of the failure is always the same: a variable is set on the machine where the
script was written, and the CI job never sets it, so one cell of the matrix is never run.

GitHub issue search, `type:issue`, open:

| query | issues |
| --- | --- |
| `JAVA_HOME "not set"` | 1126 |
| `ANDROID_HOME "not set"` | 3624 |

Three of them, picked because they are the exact shape this tool reports:

- [bazelbuild/examples#715](https://github.com/bazelbuild/examples/issues/715) — the macOS
  CI config never sets `ANDROID_HOME`, so that combination was never exercised.
- [unoplatform/uno.check#591](https://github.com/unoplatform/uno.check/issues/591) — both
  variables unset gives a `NullReferenceException` instead of a readable error.
- [uber/nanoscope#56](https://github.com/uber/nanoscope/issues/56) — a maintainer asking
  for the check this tool automates.

These are mentions, not confirmed instances, and the counts include unrelated uses. The
point is the order of magnitude: this is not a rare failure mode, it is a routine one.

## Corpus

`corpus.json` lists runtime-selecting CLIs and one diagnostic command per tool, because a
version printer rarely exercises runtime discovery while a command that prints a resolved
path does.

```sh
node scripts/corpus.mjs            # every installed tool
node scripts/corpus.mjs --only mvn,gradle
```

It writes `corpus-report.md` and `corpus-report.json`. Tools that are not installed are
listed as skipped, never as passes: a corpus that silently drops what it could not find
reads as a clean sweep when it is not.

## Two bugs it found in itself

The first run against a real `.cmd` shim exposed two defects in `bareenv`'s own
executable pinning, both silent until then:

- `{ ...process.env }` turns the case-insensitive environment object into a plain one, so
  a Windows `Path` key is not found by `env.PATH` and resolution quietly fell through.
- Maven ships an extensionless `mvn` script next to `mvn.cmd`; the extensionless one was
  tried first, so Windows picked a file it cannot execute.

Both are fixed and covered by regression tests. They stayed hidden because the OS resolves
`.exe` files from `PATH` by itself — only shims that need `PATHEXT` exposed them.

## Limits

Read these before trusting a green result.

- `single` mode does not test interactions between variables. Use `--mode full` when it
  matters, but the case count grows fast.
- Cases run in the same working directory. A command that mutates its own state can leak
  between cases; `--var` runs are sequential for that reason.
- Timeouts kill the direct child only. A command that spawns grandchildren may leave
  them behind.
- `detect` is a regex pass: it finds candidates, not relevance.
- A `pass` on a case only means the exit code matched the baseline. Semantics are the
  command's business.

## Roadmap

- [ ] per-case isolation: fresh temp dir, optional `--clean`
- [ ] `bareenv probe`: discover which variables a command actually reads by running it
      once under an instrumented `env`
- [ ] SARIF output, so findings show up in GitHub code scanning
- [ ] a GitHub Action wrapper with the report as a PR comment

## License

MIT
