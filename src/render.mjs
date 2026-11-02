const ESC = '\u001b[';

const PAINT = {
  pass: ['32', ''],
  'expected-fail': ['2', ''],
  'env-dependent': ['31', ''],
  'silent-fallback': ['35', ''],
  'baseline-broken': ['33', ''],
  'case-invalid': ['2', ''],
  dim: ['2', ''],
  bold: ['1', ''],
  red: ['31', ''],
  yellow: ['33', ''],
  cyan: ['36', ''],
};

function paint(text, style, enabled) {
  if (!enabled || !PAINT[style]) return text;
  const [code] = PAINT[style];
  return `${ESC}${code}m${text}${ESC}0m`;
}

function pad(text, width) {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

export function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function shortDuration(ms) {
  return ms >= 10000 ? `${(ms / 1000).toFixed(0)}s` : `${(ms / 1000).toFixed(1)}s`;
}

export function renderTable(cases, { color = false, verbose = false } = {}) {
  const rows = cases.map((entry) => ({
    case: entry.label,
    exit: entry.timedOut ? 'timeout' : entry.exitCode === null ? '-' : String(entry.exitCode),
    time: shortDuration(entry.durationMs),
    verdict: entry.verdict,
  }));

  const header = ['CASE', 'EXIT', 'TIME', 'VERDICT'];
  const widths = header.map((text, index) => {
    const values = rows.map((row) => Object.values(row)[index].length);
    return Math.max(text.length, ...values);
  });

  const lines = [];
  lines.push(
    header
      .map((text, index) => pad(text, widths[index]))
      .join('  ')
      .trimEnd(),
  );
  lines.push(widths.map((width) => '-'.repeat(width)).join('  '));

  for (const row of rows) {
    const cells = [row.case, row.exit, row.time];
    const line = cells.map((text, index) => pad(text, widths[index])).join('  ');
    lines.push(`${line}  ${paint(row.verdict, row.verdict, color)}`);
  }

  if (verbose) {
    lines.push('');
    for (const entry of cases) {
      if (entry.verdict === 'pass') continue;
      lines.push(paint(`${entry.label}`, 'bold', color));
      if (entry.spawnError) lines.push(indent(`spawn failed: ${entry.spawnError}`));
      const out = `${entry.stdout}${entry.stderr}`.trim();
      if (out) lines.push(indent(out.split(/\r?\n/).slice(-6).join('\n')));
      lines.push('');
    }
  }

  return lines.join('\n');
}

function indent(text) {
  return text
    .split(/\r?\n/)
    .map((line) => `    ${line}`)
    .join('\n');
}

export function renderFindings(findings, reproByLabel, { color = false } = {}) {
  if (findings.length === 0) {
    return paint('no environment-dependent failures found', 'dim', color);
  }

  const lines = [];
  const dependent = findings.filter((finding) => finding.type === 'env-dependent');
  const fallback = findings.filter((finding) => finding.type === 'silent-fallback');

  if (dependent.length > 0) {
    lines.push(paint(`${dependent.length} environment-dependent failure(s)`, 'red', color));
    lines.push('');
    for (const finding of dependent) {
      lines.push(`  ${paint(finding.label, 'bold', color)}`);
      if (finding.detail) lines.push(`    ${finding.detail}`);
      const repro = reproByLabel.get(finding.label);
      if (repro) lines.push(`    ${paint('repro:', 'dim', color)} ${repro[repro.preferred]}`);
      lines.push('');
    }
  }

  if (fallback.length > 0) {
    lines.push(paint(`${fallback.length} silent fallback(s)`, 'silent-fallback', color));
    lines.push('');
    for (const finding of fallback) {
      lines.push(`  ${paint(finding.label, 'bold', color)}`);
      lines.push(`    ${finding.detail}`);
      lines.push('');
    }
  }

  return lines.join('\n').trimEnd();
}

export function renderSummary({ cases, findings, durationMs }, { color = false } = {}) {
  const broken = cases.filter((entry) => entry.verdict === 'baseline-broken').length;
  const skipped = cases.filter((entry) => entry.verdict === 'case-invalid').length;
  const parts = [
    `${cases.length} case(s)`,
    `${formatDuration(durationMs)}`,
    `${findings.length} finding(s)`,
  ];
  if (skipped > 0) {
    parts.push(`${skipped} case(s) could not start, so nothing is attributed to them`);
  }
  if (broken > 0) parts.push('baseline itself fails, so nothing is attributable to env');
  return paint(parts.join('  ·  '), 'dim', color);
}
