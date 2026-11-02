import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

// A var whose value is a location gets the `invalid` state: a path that does not exist.
// That is the case that catches "explicit selection silently replaced by a discovered one".
const PATH_LIKE =
  /(HOME|PATH|DIR|ROOT|PREFIX|BIN|JDK|JAVA|PYTHON|NODE|SDK|TOOLCHAIN|GHIDRA|GOPATH|CARGO|RUSTUP)/i;

export const STATES = ['unset', 'empty', 'invalid'];
export const MAX_CASES = 64;

export function isPathLike(name) {
  return PATH_LIKE.test(name);
}

export function statesFor(name) {
  return STATES.filter((state) => state !== 'invalid' || isPathLike(name));
}

export function invalidValueFor(name) {
  const token = randomBytes(4).toString('hex');
  return join(tmpdir(), `bareenv-missing-${token}`, name);
}

export function envFor(baseEnv, changes) {
  const env = { ...baseEnv };
  for (const [name, state] of Object.entries(changes)) {
    if (state === 'unset') delete env[name];
    else if (state === 'empty') env[name] = '';
    else env[name] = invalidValueFor(name);
  }
  return env;
}

function labelFor(changes) {
  const parts = Object.entries(changes).map(([name, state]) => `${state} ${name}`);
  return parts.join(' + ') || 'baseline';
}

/**
 * single: baseline + one variable at a time (the shape maintainers reproduce by hand)
 * full:   every combination of every state
 */
export function buildMatrix(vars, mode = 'single') {
  const baseline = { label: 'baseline', changes: {} };
  if (vars.length === 0) return [baseline];

  if (mode === 'full') {
    let combos = [{}];
    for (const name of vars) {
      const next = [];
      for (const combo of combos) {
        for (const state of statesFor(name)) next.push({ ...combo, [name]: state });
      }
      combos = next;
    }
    if (combos.length + 1 > MAX_CASES) {
      throw new Error(
        `full matrix would run ${combos.length + 1} cases (limit ${MAX_CASES}); use --mode single or fewer --var`,
      );
    }
    return [baseline, ...combos.map((changes) => ({ label: labelFor(changes), changes }))];
  }

  const cases = [baseline];
  for (const name of vars) {
    for (const state of statesFor(name)) {
      const changes = { [name]: state };
      cases.push({ label: labelFor(changes), changes });
    }
  }
  return cases;
}
