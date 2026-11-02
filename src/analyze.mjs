import { pickDetail, stripAnsi, unresolvable } from './runner.mjs';

/**
 * Turns case results into verdicts and findings.
 *
 * There is exactly one finding class:
 *  - env-dependent: the baseline passes and a changed variable breaks the command.
 *
 * Everything else is a verdict that exists to keep the findings precise:
 *  - expected-fail:   an invalid value was rejected. That is the behavior we want.
 *  - not-observed:    identical behavior, so the tool never looked at the variable.
 *                     `java -version` does not read JAVA_HOME; calling that "accepted an
 *                     invalid JAVA_HOME" would be a false positive.
 *  - accepted-invalid: the value was not rejected and behavior changed, but echoing a
 *                     bad path into a diagnostic is not proof of a silent fallback.
 *                     Informational, not counted. `--strict-fallback` promotes it.
 */
export function analyze(results, { strictFallback = false } = {}) {
  const baseline = results[0];
  const baselineOk =
    baseline.exitCode === 0 && !baseline.timedOut && baseline.spawnError === null;
  const findings = [];
  const observations = [];
  const cases = [];

  for (const result of results) {
    const changes = Object.entries(result.changes);
    const primary = changes[0] ?? [];
    const state = primary[1];
    const broke = result.timedOut || result.exitCode !== 0 || result.spawnError !== null;
    let verdict;

    if (result.label === 'baseline' || !baselineOk) {
      verdict = baselineOk ? 'pass' : 'baseline-broken';
    } else if (unresolvable(result)) {
      verdict = 'case-invalid';
    } else if (state === 'invalid') {
      if (broke) verdict = 'expected-fail';
      else if (sameObservable(baseline, result)) verdict = 'not-observed';
      else verdict = strictFallback ? 'silent-fallback' : 'accepted-invalid';
    } else {
      verdict = broke ? 'env-dependent' : 'pass';
    }

    cases.push({ ...result, verdict });

    const detail = result.timedOut
      ? `timed out after ${result.durationMs}ms`
      : verdict === 'silent-fallback' || verdict === 'accepted-invalid'
        ? firstDifference(baseline, result)
        : pickDetail(result);

    const record = {
      type: verdict,
      var: primary[0],
      state,
      changes: result.changes,
      label: result.label,
      exitCode: result.exitCode,
      detail,
    };

    if (verdict === 'env-dependent' || verdict === 'silent-fallback') {
      findings.push(record);
    } else if (verdict === 'accepted-invalid') {
      observations.push(record);
    }
  }

  return { baselineOk, cases, findings, observations };
}

function sameObservable(left, right) {
  return (
    left.exitCode === right.exitCode &&
    stripAnsi(left.stdout).trim() === stripAnsi(right.stdout).trim() &&
    stripAnsi(left.stderr).trim() === stripAnsi(right.stderr).trim()
  );
}

function lines(text) {
  return stripAnsi(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** "stdout gained X" is far more useful than "behavior changed". */
function firstDifference(baseline, result) {
  const before = new Set(lines(baseline.stdout));
  const gained = lines(result.stdout).filter((line) => !before.has(line));
  if (gained.length > 0) return `stdout gained "${gained[0].slice(0, 80)}"`;

  const beforeErr = new Set(lines(baseline.stderr));
  const gainedErr = lines(result.stderr).filter((line) => !beforeErr.has(line));
  if (gainedErr.length > 0) return `stderr gained "${gainedErr[0].slice(0, 80)}"`;

  const after = new Set(lines(result.stdout));
  const lost = lines(baseline.stdout).filter((line) => !after.has(line));
  if (lost.length > 0) return `stdout lost "${lost[0].slice(0, 80)}"`;

  return 'exit code changed';
}
