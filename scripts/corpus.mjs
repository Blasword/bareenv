#!/usr/bin/env node
/**
 * Runs bareenv across the corpus in corpus.json and writes a paste-ready report.
 *
 *   node scripts/corpus.mjs            # probe every installed tool
 *   node scripts/corpus.mjs --only mvn,gradle
 *
 * Tools that are not installed are listed as skipped rather than as passes: a corpus
 * that silently drops what it could not find reads as a clean sweep when it is not.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveExecutable } from '../src/runner.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const corpus = JSON.parse(readFileSync(join(root, 'corpus.json'), 'utf8'));
const only = readFlag('--only');
const timeout = String(corpus.timeout ?? 60000);

function readFlag(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return new Set((process.argv[index + 1] ?? '').split(',').map((value) => value.trim()).filter(Boolean));
}

const selected = (corpus.cases ?? []).filter((entry) => !only || only.has(entry.name));
const scratch = mkdtempSync(join(tmpdir(), 'bareenv-corpus-'));

const probed = [];
const skipped = [];

for (const entry of selected) {
  const resolved = resolveExecutable(entry.command[0], root, process.env);
  if (resolved === entry.command[0]) {
    skipped.push({ name: entry.name, reason: 'not installed' });
    continue;
  }

  const reportPath = join(scratch, `${entry.name}.json`);
  const result = spawnSync(
    process.execPath,
    [
      join(root, 'bin', 'bareenv.mjs'),
      'run',
      '--quiet',
      '--var',
      entry.vars.join(','),
      '--timeout',
      timeout,
      '--json',
      reportPath,
      '--',
      ...entry.command,
    ],
    { cwd: root, stdio: 'ignore' },
  );

  let report = null;
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'));
  } catch {
    skipped.push({ name: entry.name, reason: `no report (exit ${result.status})` });
    continue;
  }

  probed.push({
    name: entry.name,
    command: entry.command.join(' '),
    vars: entry.vars,
    baselineOk: report.baselineOk,
    findings: report.findings ?? [],
    cases: (report.cases ?? []).length,
  });
}

const withFindings = probed.filter((entry) => entry.findings.length > 0);
const broken = probed.filter((entry) => !entry.baselineOk);

const lines = [];
lines.push('# bareenv corpus');
lines.push('');
lines.push(`Probed ${probed.length} installed tool(s): ${withFindings.length} with findings, ${broken.length} with a failing baseline, ${skipped.length} skipped.`);
lines.push('');

if (withFindings.length > 0) {
  lines.push('| Tool | Command | Findings | First failure |');
  lines.push('| --- | --- | --- | --- |');
  for (const entry of withFindings) {
    const first = entry.findings[0];
    const detail = first.detail.replace(/\|/g, '\\|').slice(0, 90);
    lines.push(`| ${entry.name} | \`${entry.command}\` | ${entry.findings.length} | ${first.var} ${first.state} — ${detail} |`);
  }
  lines.push('');
}

const clean = probed.filter((entry) => entry.findings.length === 0 && entry.baselineOk);
if (clean.length > 0) {
  lines.push(`No findings: ${clean.map((entry) => entry.name).join(', ')}`);
  lines.push('');
}

if (broken.length > 0) {
  lines.push(`Baseline fails on its own (not attributable to the environment): ${broken.map((entry) => entry.name).join(', ')}`);
  lines.push('');
}

if (skipped.length > 0) {
  lines.push(`Skipped: ${skipped.map((entry) => `${entry.name} (${entry.reason})`).join(', ')}`);
  lines.push('');
}

const markdown = `${lines.join('\n').trimEnd()}\n`;
writeFileSync(join(root, 'corpus-report.md'), markdown, 'utf8');
writeFileSync(
  join(root, 'corpus-report.json'),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), probed, skipped }, null, 2)}\n`,
  'utf8',
);

process.stdout.write(markdown);
rmSync(scratch, { recursive: true, force: true });

if (probed.length < 5) {
  process.stdout.write(
    `\nOnly ${probed.length} tool(s) probed. Install more of corpus.json before drawing conclusions.\n`,
  );
}
if (withFindings.length === 0) {
  process.stdout.write('\nNo findings. Before publishing, widen the corpus or vary more variables.\n');
}

process.exitCode = 0;
