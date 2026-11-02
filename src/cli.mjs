import { parseArgs } from 'node:util';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildMatrix, envFor, statesFor } from './matrix.mjs';
import { runCase, resolveExecutable } from './runner.mjs';
import { analyze } from './analyze.mjs';
import { reproFor } from './repro.mjs';
import { renderTable, renderFindings, renderSummary } from './render.mjs';
import { detectEnvVars } from './detect.mjs';
import { DEFAULT_REPORT, newFindings, readReport, writeReport } from './report.mjs';

const USAGE = `
bareenv — find the environment combinations your CLI never tested

  bareenv run [options] -- <command...>
  bareenv detect [--cwd <dir>]
  bareenv init [--cwd <dir>]

run options
  --var <NAME[,NAME...]>   environment variable to vary (repeatable)
  --mode <single|full>     single: one variable at a time (default)
                           full:   every combination of every state
  --timeout <ms>           per-case timeout (default 120000)
  --cwd <dir>              working directory for the command (default: current)
  --json <path>            report path (default ${DEFAULT_REPORT})
  --compare <path>         compare against a previous report and flag new findings
  --fail-on-findings       exit 1 when anything is environment-dependent
  --strict-fallback        count accepted-invalid values as findings too
  --no-color               disable color
  --verbose                print the tail of failing case output
  --quiet                  only print findings

Each variable is tested unset, empty, and (for path-like names) invalid.

examples
  bareenv run --var JAVA_HOME -- npm run verify:ghidra
  bareenv run --var JAVA_HOME,PATH --mode full -- ./scripts/doctor.sh
  bareenv detect
`;

const SUBCOMMANDS = new Set(['run', 'detect', 'init', 'help', 'version']);

function version() {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

function readConfig(cwd) {
  const path = resolve(cwd, 'bareenv.json');
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`cannot parse ${path}: ${error.message}`);
  }
}

function collectVars(value) {
  const names = (value ?? [])
    .flatMap((entry) => entry.split(','))
    .map((name) => name.trim())
    .filter(Boolean);
  return [...new Set(names)];
}

export async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        var: { type: 'string', multiple: true },
        mode: { type: 'string' },
        timeout: { type: 'string' },
        cwd: { type: 'string' },
        json: { type: 'string' },
        compare: { type: 'string' },
        'fail-on-findings': { type: 'boolean', default: false },
        'strict-fallback': { type: 'boolean', default: false },
        'no-color': { type: 'boolean', default: false },
        verbose: { type: 'boolean', default: false },
        quiet: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
        version: { type: 'boolean', default: false },
      },
    });
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.stderr.write(`${USAGE}\n`);
    return 3;
  }

  const { values, positionals } = parsed;

  if (values.version || positionals[0] === 'version') {
    process.stdout.write(`${version()}\n`);
    return 0;
  }

  if (values.help || positionals.length === 0 || positionals[0] === 'help') {
    process.stdout.write(`${USAGE}\n`);
    return positionals.length === 0 && !values.help ? 3 : 0;
  }

  const subcommand = SUBCOMMANDS.has(positionals[0]) ? positionals[0] : null;
  if (!subcommand) {
    process.stderr.write(`unknown subcommand: ${positionals[0]}\n${USAGE}\n`);
    return 3;
  }

  const cwd = values.cwd ? resolve(values.cwd) : process.cwd();
  if (subcommand === 'detect') return detect(cwd);
  if (subcommand === 'init') return init(cwd);
  return run(values, positionals.slice(1), cwd);
}

function detect(cwd) {
  const found = detectEnvVars(cwd);
  if (found.length === 0) {
    process.stdout.write('no environment variable reads found in this directory\n');
    return 0;
  }

  const top = found.slice(0, 25);
  const width = Math.max(...top.map((entry) => entry.name.length));
  process.stdout.write(`${found.length} environment variable(s) read here:\n\n`);
  for (const entry of top) {
    const files = entry.files.length === 1 ? entry.files[0].replace(`${cwd}/`, '') : `${entry.files.length} files`;
    process.stdout.write(`  ${entry.name.padEnd(width)}  ${String(entry.count).padStart(4)}x  ${files}\n`);
  }

  const pathLike = top.filter((entry) => /(HOME|PATH|DIR|ROOT|BIN|JDK|JAVA|PYTHON|NODE|SDK)/i.test(entry.name));
  const suggested = (pathLike.length > 0 ? pathLike : top).slice(0, 3).map((entry) => entry.name);
  process.stdout.write(`\nnext:\n  bareenv run --var ${suggested.join(',')} -- <your command>\n`);
  return 0;
}

function init(cwd) {
  const path = resolve(cwd, 'bareenv.json');
  if (existsSync(path)) {
    process.stderr.write(`${path} already exists\n`);
    return 1;
  }
  const found = detectEnvVars(cwd).filter((entry) => statesFor(entry.name).includes('invalid'));
  const config = {
    vars: found.slice(0, 3).map((entry) => entry.name),
    mode: 'single',
    timeout: 120000,
  };
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  process.stdout.write(`wrote ${path}\n${JSON.stringify(config, null, 2)}\n`);
  return 0;
}

async function run(values, command, cwd) {
  const config = readConfig(cwd);
  const vars = collectVars(values.var).length > 0 ? collectVars(values.var) : (config.vars ?? []);
  const argv = command.length > 0 ? command : (config.command ?? []);
  const color = !values['no-color'] && process.stdout.isTTY;
  const timeoutMs = Number(values.timeout ?? config.timeout ?? 120000);
  const mode = values.mode ?? config.mode ?? 'single';
  const reportPath = resolve(cwd, values.json ?? config.json ?? DEFAULT_REPORT);

  if (argv.length === 0) {
    process.stderr.write(`no command given\n\n  bareenv run --var JAVA_HOME -- <command...>\n`);
    return 3;
  }
  if (vars.length === 0) {
    process.stderr.write(
      `no variables to vary\n\n  bareenv run --var JAVA_HOME -- <command...>\n  bareenv detect   # to find candidates\n`,
    );
    return 3;
  }
  if (vars.length > 8) {
    process.stderr.write(`${vars.length} variables is too many for one matrix; pass at most 8\n`);
    return 3;
  }

  let matrix;
  try {
    matrix = buildMatrix(vars, mode);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 3;
  }

  if (!values.quiet) {
    process.stdout.write(`command  ${argv.join(' ')}\n`);
    process.stdout.write(`vary     ${vars.join(', ')}  (mode ${mode})\n\n`);
  }

  const baseEnv = { ...process.env };
  // Pinned once, so that a PATH case tests the command instead of breaking our own spawn.
  const execArgv = [resolveExecutable(argv[0], cwd, baseEnv), ...argv.slice(1)];
  const startedAt = Date.now();
  const results = [];

  for (const entry of matrix) {
    const result = await runCase({
      argv: execArgv,
      cwd,
      env: envFor(baseEnv, entry.changes),
      timeoutMs,
    });
    results.push({ ...entry, ...result });
  }

  const durationMs = Date.now() - startedAt;
  const { cases, findings, observations, baselineOk } = analyze(results, {
    strictFallback: values['strict-fallback'],
  });

  if (!values.quiet) {
    process.stdout.write(`${renderTable(cases, { color, verbose: values.verbose })}\n\n`);
  }

  const reproByLabel = new Map();
  for (const finding of findings) {
    if (finding.type === 'env-dependent') {
      reproByLabel.set(finding.label, reproFor(argv, finding.changes));
    }
  }

  process.stdout.write(`${renderFindings(findings, reproByLabel, { color, observations })}\n`);
  process.stdout.write(
    `\n${renderSummary({ cases, findings, observations, durationMs }, { color })}\n`,
  );

  const report = {
    tool: 'bareenv',
    version: version(),
    command: argv,
    cwd,
    variables: vars,
    mode,
    startedAt: new Date(startedAt).toISOString(),
    durationMs,
    baselineOk,
    cases: cases.map((entry) => ({
      label: entry.label,
      changes: entry.changes,
      verdict: entry.verdict,
      exitCode: entry.exitCode,
      timedOut: entry.timedOut,
      spawnError: entry.spawnError,
      durationMs: entry.durationMs,
      tail: entry.verdict === 'pass' ? undefined : entry.stderr.trim().split(/\r?\n/).slice(-8).join('\n'),
    })),
    findings,
    observations,
  };
  writeReport(reportPath, report);

  let code = 0;

  if (values.compare) {
    const previousPath = resolve(cwd, values.compare);
    const added = newFindings(readReport(previousPath), findings);
    if (added.length > 0) {
      process.stdout.write(`\n${added.length} new finding(s) vs ${previousPath}\n`);
      for (const finding of added) process.stdout.write(`  + ${finding.label}\n`);
      code = 2;
    }
  }

  if (!baselineOk) {
    process.stdout.write('\nbaseline itself fails; run the command directly first\n');
    return 1;
  }
  if (code === 0 && values['fail-on-findings'] && findings.length > 0) return 1;
  return code;
}
