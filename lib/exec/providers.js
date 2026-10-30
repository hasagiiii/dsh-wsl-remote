/**
 * Execution providers for a DeepSeek Harness process whose environment is WSL.
 *
 * DeepSeek Harness's own SSH providers already implement `ctx.fs`,
 * `ctx.subprocess` and `ctx.sandbox` over its POSIX helper. These subclasses
 * keep them unchanged and translate the Windows spellings that Host-side
 * services (Session working directories, sandbox policy, packaged binaries)
 * still use, so Windows paths of the distribution keep working everywhere.
 */
import { SandboxBashExecutor } from '@deepseek-ai/dsh-bash-sandbox';
import { SshFileSystem } from './vendor/fs-ssh.js';
import { SshSubprocessRuntime } from './vendor/subprocess-ssh.js';
import { SshSandboxProvider } from './vendor/sandbox-ssh.js';
import { isRipgrep } from './ripgrep.js';

const paths = (ctx) => ctx.ssh.paths;

export class WslFileSystem extends SshFileSystem {
  resolve(path, opts) {
    const map = paths(this.ctx);
    return super.resolve(map.toLinux(path), opts === undefined ? opts : { ...opts, cwd: opts.cwd === undefined ? undefined : map.toLinux(opts.cwd) });
  }

  lstat(path, opts, signal) {
    const map = paths(this.ctx);
    return super.lstat(map.toLinux(path), opts === undefined ? opts : { ...opts, cwd: opts.cwd === undefined ? undefined : map.toLinux(opts.cwd) }, signal);
  }

  writeText(target, content, expected, signal, sandboxPolicy) {
    return super.writeText(target, content, expected, signal, paths(this.ctx).policy(sandboxPolicy ?? this.ctx.sandboxPolicy.resolve()));
  }

  editText(target, edit, expected, signal, sandboxPolicy) {
    return super.editText(target, edit, expected, signal, paths(this.ctx).policy(sandboxPolicy ?? this.ctx.sandboxPolicy.resolve()));
  }

  /** Windows UNC/drive paths of this distribution name the same Linux file. */
  processPathFromHostPath(hostPath) {
    const map = paths(this.ctx);
    return map.isWindowsAbsolute(hostPath) ? map.toLinux(hostPath) : undefined;
  }
}

export class WslSubprocessRuntime extends SshSubprocessRuntime {
  translate(spec) {
    const map = paths(this.ctx);
    let argv = spec.argv;
    if (Array.isArray(argv) && argv.length > 0) {
      const first = isRipgrep(argv[0]) ? 'rg' : map.toLinux(argv[0]);
      argv = [first, ...argv.slice(1).map((value) => (map.isWindowsAbsolute(value) ? map.toLinux(value) : value))];
    }
    // Host services pass Windows paths in variables too (git index files, temp roots).
    const env = spec.env === undefined
      ? undefined
      : Object.fromEntries(Object.entries(spec.env).map(([key, value]) => [key, map.isWindowsAbsolute(value) ? map.toLinux(value) : value]));
    return { ...spec, argv, ...(env === undefined ? {} : { env }), ...(spec.cwd === undefined ? {} : { cwd: map.toLinux(spec.cwd) }) };
  }

  resolveExecutable(command, env, signal) {
    return super.resolveExecutable(isRipgrep(command) ? 'rg' : paths(this.ctx).toLinux(command), env, signal);
  }

  spawn(spec) {
    return super.spawn(this.translate(spec));
  }

  spawnTerminal(spec) {
    return super.spawnTerminal(this.translate(spec));
  }
}

export class WslSandboxProvider extends SshSandboxProvider {
  confine(argv, policy, signal) {
    return super.confine(argv, paths(this.ctx).policy(policy), signal);
  }
}

/**
 * The Agent shell executor in WSL mode. The PowerShell tool keeps its name and
 * schema (presets are unchanged); its command runs here with `<shell> -c` in
 * Linux, using the default shell chosen at startup. Sandbox, deadline and
 * escalation semantics are the shipped `dsh-bash-sandbox` ones.
 */
export class WslShellExecutor extends SandboxBashExecutor {
  static inject = ['subprocess', 'sandbox', 'sandboxPolicy', 'ssh'];

  shellFor() {
    return this.ctx.ssh.agentShell;
  }

  resolve(request) {
    const resolved = super.resolve(request);
    return { ...resolved, workdir: this.ctx.ssh.paths.toLinux(resolved.workdir) };
  }

  confine(command, policy, signal) {
    return this.ctx.sandbox.confine([this.shellFor(), '-c', command], policy, signal);
  }

  executeArgv(spec, argvOrPrepare, onStarted) {
    if (Array.isArray(argvOrPrepare) && argvOrPrepare[0] === 'bash' && argvOrPrepare[1] === '-c') {
      argvOrPrepare = [this.shellFor(), ...argvOrPrepare.slice(1)];
    }
    return super.executeArgv(spec, argvOrPrepare, onStarted);
  }
}
