import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createFakeJdk } from '../fixtures/fake-jdk.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function runBareenv(args, env) {
  const scratch = mkdtempSync(join(tmpdir(), 'bareenv-test-'));
  const log = join(scratch, 'out.log');
  const fd = openSync(log, 'w');
  const result = spawnSync(process.execPath, [join(root, 'bin', 'bareenv.mjs'), ...args], {
    cwd: root,
    env,
    stdio: ['ignore', fd, fd],
  });
  closeSync(fd);
  const output = readFileSync(log, 'utf8');
  rmSync(scratch, { recursive: true, force: true });
  return { status: result.status, output };
}

const jdk = createFakeJdk();
const env = {
  ...process.env,
  JAVA_HOME: jdk.home,
  PATH: [jdk.bin, dirname(process.execPath), process.env.PATH ?? ''].join(delimiter),
};

const checks = [];

// 1. The reported bug: discovery succeeds, the launcher re-reads the environment.
const reported = runBareenv(
  ['run', '--var', 'JAVA_HOME', '--json', join(jdk.root, 'a.json'), '--', 'node', 'fixtures/ghidra-verifier.mjs'],
  env,
);
assert.equal(reported.status, 0, 'a run with findings still exits 0 by default');
assert.match(reported.output, /unset JAVA_HOME\s+1\s+\S+\s+env-dependent/);
assert.match(reported.output, /invalid JAVA_HOME\s+1\s+\S+\s+expected-fail/);
assert.doesNotMatch(reported.output, /silent-fallback/);
assert.match(reported.output, /GhidraLaunchError/);
assert.match(reported.output, /repro:/);
checks.push('reported bug is classified as env-dependent');

// 2. The other bug class: an explicit invalid selection is quietly replaced.
const fallback = runBareenv(
  ['run', '--var', 'JAVA_HOME', '--json', join(jdk.root, 'b.json'), '--', 'node', 'fixtures/fallback-verifier.mjs'],
  env,
);
assert.match(fallback.output, /invalid JAVA_HOME\s+0\s+\S+\s+silent-fallback/);
checks.push('silent fallback is classified separately');

// 3. A command that fails on its own must not produce environment findings.
const broken = runBareenv(
  ['run', '--var', 'JAVA_HOME', '--json', join(jdk.root, 'c.json'), '--', 'node', '-e', 'process.exit(3)'],
  env,
);
assert.equal(broken.status, 1);
assert.match(broken.output, /baseline-broken/);
assert.doesNotMatch(broken.output, /env-dependent/);
checks.push('a broken baseline is reported as broken, not as env-dependent');

for (const check of checks) process.stdout.write(`ok  ${check}\n`);
process.stdout.write(`\n${checks.length} checks passed\n`);
