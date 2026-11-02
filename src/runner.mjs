import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, isAbsolute, join, resolve } from 'node:path';

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

export function stripAnsi(text) {
  return text.replace(ANSI, '');
}

export function toCommandLine(argv) {
  return argv
    .map((arg) => (/[\s"'$`\\]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg))
    .join(' ');
}

const INTERESTING =
  /error|fail|fatal|missing|required|requires|refus|denied|exception|unable|cannot|not found/i;

export function pickDetail(result) {
  const lines = [...result.stderr.split(/\r?\n/), ...result.stdout.split(/\r?\n/)]
    .map((line) => stripAnsi(line).trim())
    .filter(Boolean);
  if (lines.length === 0) return '';
  const interesting = lines.filter((line) => INTERESTING.test(line));
  return (interesting.at(-1) ?? lines.at(-1) ?? '').slice(0, 120);
}

function readIfPresent(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Pin the command to an absolute path before any case runs.
 *
 * Without this, varying PATH would make the shell fail to find `node`/`npm` and every
 * PATH case would look like a finding. Resolving once means PATH cases test what the
 * command does with a crippled PATH, not whether our own spawn still works.
 */
export function resolveExecutable(name, cwd, env) {
  if (isAbsolute(name) || /[\\/]/.test(name)) return resolve(cwd, name);

  const extensions =
    process.platform === 'win32'
      ? [''].concat((env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';')).filter(Boolean)
      : [''];

  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    for (const extension of extensions) {
      const candidate = join(dir, name + extension);
      if (existsSync(candidate)) return candidate;
    }
  }
  return name;
}

const UNRESOLVABLE = /is not recognized as an internal or external command|operable program or batch file|command not found/i;

/** The command never started, so its exit code says nothing about the environment. */
export function unresolvable(result) {
  if (result.spawnError) return true;
  if (result.exitCode === 127) return true;
  return result.exitCode !== 0 && UNRESOLVABLE.test(result.stderr);
}

/**
 * Runs one case.
 *
 * Output goes to files rather than pipes: no buffer limits on large logs, and it keeps
 * working in restricted sandboxes where creating a pipe for a child is denied.
 *
 * The command is spawned directly. A shell is only used on Windows for `.cmd`/`.bat`
 * shims, because going through cmd.exe makes argument quoting and PATH cases fragile.
 */
export function runCase({ argv, cwd, env, timeoutMs }) {
  const startedAt = Date.now();
  const [file, ...args] = argv;
  const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(file);
  const command = needsShell ? toCommandLine(argv) : file;
  const spawnArgs = needsShell ? [] : args;

  const scratch = mkdtempSync(join(tmpdir(), 'bareenv-run-'));
  const outPath = join(scratch, 'stdout.log');
  const errPath = join(scratch, 'stderr.log');
  const outFd = openSync(outPath, 'w');
  const errFd = openSync(errPath, 'w');

  return new Promise((resolve) => {
    let timedOut = false;
    let spawnError = null;
    let settled = false;

    const child = spawn(command, spawnArgs, {
      cwd,
      env,
      shell: needsShell,
      windowsHide: true,
      stdio: ['ignore', outFd, errFd],
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    const finish = (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      closeSync(outFd);
      closeSync(errFd);
      const stdout = readIfPresent(outPath);
      const stderr = readIfPresent(errPath);
      rmSync(scratch, { recursive: true, force: true });
      resolve({
        exitCode: code,
        signal,
        timedOut,
        spawnError,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
      });
    };

    child.on('error', (error) => {
      spawnError = error.message;
      finish(null, null);
    });
    child.on('close', finish);
  });
}
