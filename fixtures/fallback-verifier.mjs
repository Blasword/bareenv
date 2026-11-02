#!/usr/bin/env node
/**
 * The anti-pattern the `silent-fallback` verdict exists for: an explicitly selected,
 * explicitly invalid JAVA_HOME is quietly replaced by a JDK found on PATH.
 *
 * The issue this project came from requires the opposite: a bad explicit selection must
 * fail instead of being talked around. Compare with fixtures/ghidra-verifier.mjs, which
 * rejects it.
 */
import { existsSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

const JAVA = process.platform === 'win32' ? 'java.exe' : 'java';

function fromPath() {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    if (existsSync(join(dir, JAVA))) return dirname(dir);
  }
  return null;
}

const explicit = process.env.JAVA_HOME;

if (explicit !== undefined && explicit !== '') {
  if (!existsSync(join(explicit, 'bin', JAVA))) {
    const fallback = fromPath();
    if (fallback) {
      // The bug: the caller's explicit choice is discarded without an error.
      process.stdout.write(`inspection: ignoring invalid JAVA_HOME, using ${fallback}\n`);
      process.exit(0);
    }
    process.stderr.write('runtime_missing: no JDK\n');
    process.exit(1);
  }
}

process.stdout.write('analyzer: launched\n');
