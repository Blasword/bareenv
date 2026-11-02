import { pickDetail, unresolvable } from './runner.mjs';

/**
 * Turns case results into verdicts and findings.
 *
 * Two finding classes:
 *  - env-dependent:   the baseline passes, changing one variable breaks it.
 *  - silent-fallback: an explicitly invalid value is accepted instead of rejected.
 *
 * `invalid` cases that fail are not findings: rejecting a bogus explicit value is the
 * behavior we want, so they are labelled `expected-fail`.
 */
export function analyze(results) {
  const baseline = results[0];
  const baselineOk =
    baseline.exitCode === 0 && !baseline.timedOut && baseline.spawnError === null;
  const findings = [];
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
      verdict = broke ? 'expected-fail' : 'silent-fallback';
    } else {
      verdict = broke ? 'env-dependent' : 'pass';
    }

    cases.push({ ...result, verdict });

    if (verdict === 'env-dependent' || verdict === 'silent-fallback') {
      findings.push({
        type: verdict,
        var: primary[0],
        state,
        changes: result.changes,
        label: result.label,
        exitCode: result.exitCode,
        detail:
          verdict === 'silent-fallback'
            ? 'an explicitly invalid value was accepted; check for a silent fallback'
            : result.timedOut
              ? `timed out after ${result.durationMs}ms`
              : pickDetail(result),
      });
    }
  }

  return { baselineOk, cases, findings };
}
