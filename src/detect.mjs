import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'coverage',
  'vendor',
  'target',
  '.next',
  '.venv',
  'venv',
  '__pycache__',
  '.turbo',
  '.cache',
]);

const EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.rb',
  '.sh',
]);

const PATTERNS = [
  /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
  /process\.env\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g,
  /os\.environ(?:\.get)?\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g,
  /os\.environ\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g,
  /os\.getenv\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g,
  /env::var\(\s*"([A-Za-z_][A-Za-z0-9_]*)"/g,
  /os\.Getenv\(\s*"([A-Za-z_][A-Za-z0-9_]*)"/g,
  /ENV\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g,
  /\bgetenv\(\s*"([A-Za-z_][A-Za-z0-9_]*)"/g,
];

const MAX_FILE_BYTES = 1_000_000;

function* walk(dir, budget) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (budget.left <= 0) return;
    if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(join(dir, entry.name), budget);
    } else if (entry.isFile() && EXTENSIONS.has(extname(entry.name))) {
      budget.left -= 1;
      yield join(dir, entry.name);
    }
  }
}

/**
 * Cheap static pass: which environment variables does this repository read at all?
 * It cannot tell which ones matter, only which ones exist as candidates.
 */
export function detectEnvVars(root, { maxFiles = 4000 } = {}) {
  const budget = { left: maxFiles };
  const found = new Map();

  for (const file of walk(root, budget)) {
    let text;
    try {
      if (statSync(file).size > MAX_FILE_BYTES) continue;
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const pattern of PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const name = match[1];
        const entry = found.get(name) ?? { name, count: 0, files: new Set() };
        entry.count += 1;
        entry.files.add(file);
        found.set(name, entry);
      }
    }
  }

  return [...found.values()]
    .map((entry) => ({ ...entry, files: [...entry.files] }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
