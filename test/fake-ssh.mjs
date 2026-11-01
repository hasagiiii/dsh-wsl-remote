/**
 * A stand-in for `ssh` in tests: takes ssh's argv (options, `--`, host, one
 * command string) and hands the command string to a WSL distribution's shell
 * the way sshd hands it to the user's shell, after printing a login banner
 * on stdout (rc files that echo) to prove the preamble is skipped.
 *   DSH_FAKE_SSH_DISTRO  the distribution standing in for the server
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const args = process.argv.slice(2);
const separator = args.indexOf('--');
if (separator < 0 || args.length !== separator + 3) {
  process.stderr.write(`fake-ssh: unexpected argv ${JSON.stringify(args)}\n`);
  process.exit(255);
}
for (const required of ['-T', 'BatchMode=yes']) {
  if (!args.slice(0, separator).includes(required)) {
    process.stderr.write(`fake-ssh: missing ${required}\n`);
    process.exit(255);
  }
}
const host = args[separator + 1];
const command = args[separator + 2];
if (host === 'unreachable') {
  process.stderr.write('ssh: Could not resolve hostname unreachable: No such host is known.\n');
  process.exit(255);
}
const wsl = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'wsl.exe');
const distro = process.env.DSH_FAKE_SSH_DISTRO ?? 'Ubuntu';
const child = spawn(wsl, ['-d', distro, '--cd', '~', '-e', 'sh', '-c', 'echo "Welcome to the fake server ($1)"; eval "$2"', 'sh', host, command], { stdio: 'inherit', windowsHide: true });
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 255 : 0)));
