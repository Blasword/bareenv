#!/usr/bin/env node
/**
 * End-to-end demo: reproduce morluto/rea#8171 with a fake JDK on PATH.
 *
 *   JAVA_HOME unset   -> flagged as env-dependent
 *   JAVA_HOME invalid -> rejected at inspection, so expected-fail, not a finding
 */
import { spawnSync } from 'node:child_process';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createFakeJdk } from './fake-jdk.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const jdk = createFakeJdk();

const env = {
  ...process.env,
  JAVA_HOME: jdk.home,
  PATH: [jdk.bin, dirname(process.execPath), process.env.PATH ?? ''].join(delimiter),
};

process.stdout.write(`fake JDK  ${jdk.home}\n\n`);

const result = spawnSync(
  process.execPath,
  [
    join(root, 'bin', 'bareenv.mjs'),
    'run',
    '--var',
    'JAVA_HOME',
    '--json',
    join(jdk.root, 'report.json'),
    '--',
    'node',
    'fixtures/ghidra-verifier.mjs',
  ],
  { cwd: root, env, stdio: 'inherit' },
);

process.exitCode = result.status ?? 1;
