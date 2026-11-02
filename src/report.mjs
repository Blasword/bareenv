import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const DEFAULT_REPORT = '.bareenv/report.json';

export function writeReport(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

export function readReport(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

const keyOf = (finding) => `${finding.type}|${finding.label}`;

/**
 * The CI story: a PR that adds an environment dependency should show up as a new key.
 */
export function newFindings(previous, findings) {
  if (!previous || !Array.isArray(previous.findings)) return [];
  const known = new Set(previous.findings.map(keyOf));
  return findings.filter((finding) => !known.has(keyOf(finding)));
}
