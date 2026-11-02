import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const JAVA = process.platform === 'win32' ? 'java.exe' : 'java';

/**
 * A directory shaped like a JDK: <root>/jdk-21.0.12.1/bin/java
 * The demo only needs discovery to succeed, so the binary is an empty marker file.
 */
export function createFakeJdk() {
  const root = mkdtempSync(join(tmpdir(), 'bareenv-jdk-'));
  const home = join(root, 'jdk-21.0.12.1');
  const bin = join(home, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, JAVA), '');
  writeFileSync(join(home, 'release'), 'JAVA_VERSION="21.0.12.1"\n');
  return { root, home, bin };
}
