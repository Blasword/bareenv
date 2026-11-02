# bareenv

**Find the environment combinations your CLI never tested.**

Every "works on my machine" bug is a missing test case in one dimension: the environment.
`bareenv` runs your command once per environment combination and tells you which ones
break, why, and the exact command to reproduce it.

No dependencies. No config to start. Node 18+.

## Where this came from

This tool exists because of a real bug: [morluto/rea#8171](https://github.com/morluto/rea/issues/8171).

A Ghidra verifier discovered and validated a JDK, then its launcher re-read `JAVA_HOME`
instead of using the validated result. With `JAVA_HOME` unset but a JDK on `PATH`, the
inspection succeeded, `rea doctor` reported healthy — and the launch failed at startup.

Finding that took a maintainer several rounds of hand-run environment combinations,
written up by hand in the issue. That is a tool's job. `bareenv` is that tool: it
turns one hand-built matrix into one command.

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
`fixtures/fallback-verifier.mjs` instead and that row becomes `silent-fallback` — the
case where a bad explicit choice is quietly replaced by a discovered one.

## Install

Not on npm yet — run it from a clone:

```sh
git clone https://github.com/Blasword/bareenv
cd bareenv
node bin/bareenv.mjs run --var JAVA_HOME -- npm run verify
```

Once v0.1 is tagged and published as `bareenv`, this becomes:

```sh
npx bareenv run --var JAVA_HOME -- npm run verify
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
| `--verbose` | print the tail of failing output |

Exit codes: `0` ran, `1` baseline fails or `--fail-on-findings` hit, `2` new findings
versus `--compare`, or a usage error.

## What the verdicts mean

| verdict | meaning |
| --- | --- |
| `pass` | same result as the baseline |
| `env-dependent` | baseline passes, this case fails — **a finding** |
| `expected-fail` | an explicitly invalid value was rejected — the behavior you want |
| `silent-fallback` | an explicitly invalid value was accepted — **a finding** |
| `baseline-broken` | the command fails before any variable changes; fix that first |
| `case-invalid` | the case could not start (for example an empty `PATH` on Windows) |

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

## In CI

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 22
- run: npx bareenv run --var JAVA_HOME,PATH --fail-on-findings -- npm test
```

To fail only on *new* environment dependencies, keep the report from the base branch and:

```sh
bareenv run --var JAVA_HOME --compare base.bareenv.json -- npm test
```

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
