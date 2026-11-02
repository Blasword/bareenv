const NEEDS_QUOTE = /[\s"'$`]/;

/**
 * A failure is only useful if the reader can paste it back into a shell.
 * Both shells are emitted; `preferred` picks the one matching the host.
 */
export function reproFor(argv, changes, platform = process.platform) {
  const command = argv.map((arg) => (NEEDS_QUOTE.test(arg) ? `'${arg}'` : arg)).join(' ');
  const entries = Object.entries(changes);

  const posix = ['env'];
  const powershell = [];

  for (const [name, state] of entries) {
    if (state === 'unset') {
      posix.push('-u', name);
      powershell.push(`Remove-Item Env:\\${name} -ErrorAction SilentlyContinue`);
    } else if (state === 'empty') {
      posix.push(`${name}=`);
      powershell.push(`$env:${name}=""`);
    } else {
      const value = `/path/that/does/not/exist/${name}`;
      posix.push(`${name}="${value}"`);
      powershell.push(`$env:${name}="${value}"`);
    }
  }

  return {
    posix: `${posix.join(' ')} ${command}`,
    powershell: [...powershell, command].join('; '),
    preferred: platform === 'win32' ? 'powershell' : 'posix',
  };
}
