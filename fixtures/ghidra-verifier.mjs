#!/usr/bin/env node
/**
 * Minimal reproduction of https://github.com/morluto/rea/issues/8171
 *
 * The verifier discovers and validates a JDK, then the launcher re-derives the Java
 * home from the environment instead of consuming the inspection result. With
 * JAVA_HOME unset but a JDK on PATH the inspection succeeds -- and the launch fails.
 *
 * This is a fixture, not a decompiler. It reproduces the handoff, nothing else.
 */
import { existsSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

const JAVA = process.platform === 'win32' ? 'java.exe' : 'java';

function inspectInstallation() {
  const explicit = process.env.JAVA_HOME;
  if (explicit !== undefined && explicit !== '') {
    if (!existsSync(join(explicit, 'bin', JAVA))) {
      return { ok: false, reason: 'runtime_missing', detail: `JAVA_HOME points at ${explicit}` };
    }
    return { ok: true, javaHome: explicit, source: 'explicit' };
  }
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    if (existsSync(join(dir, JAVA))) {
      return { ok: true, javaHome: dirname(dir), source: 'path' };
    }
  }
  return { ok: false, reason: 'runtime_missing', detail: 'no JDK on PATH and JAVA_HOME unset' };
}

const installation = inspectInstallation();

if (!installation.ok) {
  process.stderr.write(`runtime_missing: ${installation.detail}\n`);
  process.exit(1);
}

// The ordinary provider path uses the inspected value. This is what `rea doctor` does.
if (process.argv.includes('--doctor-only')) {
  process.stdout.write(`doctor: healthy=true jdk=21 source=${installation.source}\n`);
  process.exit(0);
}

process.stdout.write(
  `inspection: javaHome=${installation.javaHome} source=${installation.source}\n`,
);

// The bug: the launcher re-reads the environment instead of taking installation.javaHome.
const launcherJavaHome = process.env.JAVA_HOME;
if (!launcherJavaHome) {
  process.stderr.write('GhidraLaunchError: POSIX Ghidra requires its inspected JDK home\n');
  process.exit(1);
}

process.stdout.write(`analyzer: launched headless with ${launcherJavaHome}\n`);
