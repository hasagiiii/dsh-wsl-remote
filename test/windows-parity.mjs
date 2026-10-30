// Windows sandbox parity: the same pwsh command under workspace-write through
// (a) the shipped classes mounted directly and (b) the dispatcher.
import { Context } from '@deepseek-ai/cordis';
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection';
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy';
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local';
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local';
import { SandboxPwshExecutor } from '@deepseek-ai/dsh-pwsh-sandbox';
import { DispatchSandbox, DispatchShell, DispatchSubprocess, WslExecWorlds } from '../lib/exec/dispatch.js';

const ws = 'E:\\proj\\dsh-wsl-remote';
const command = 'Write-Output "ok:$((Get-Location).Path)"';
async function trial(label, mount) {
  const ctx = new Context();
  await ctx.plugin(SessionProjectionRegistry);
  await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: ws });
  await mount(ctx);
  await ctx.inject(['shell'], async () => {});
  const spec = ctx.shell.resolve({ command, workdir: ws, sandboxPolicy: ctx.sandboxPolicy.resolve() });
  const r = await (await ctx.shell.execute(spec)).result().catch((e) => ({ error: e.message }));
  console.log(label.padEnd(10), JSON.stringify({ out: r.stdout?.text?.trim(), exit: r.exitCode, sandbox: r.sandbox, error: r.error }));
  await ctx.registry?.dispose?.();
}
await trial('shipped', async (ctx) => {
  await ctx.plugin(LocalSubprocessRuntime);
  await ctx.plugin(LocalSandboxProvider, {});
  await ctx.plugin(SandboxPwshExecutor, {});
});
await trial('dispatch', async (ctx) => {
  await ctx.plugin(WslExecWorlds, {});
  await ctx.plugin(DispatchSubprocess);
  await ctx.plugin(DispatchSandbox);
  await ctx.plugin(DispatchShell);
  await ctx.inject(['wslExec'], async () => {});
  await ctx.wslExec.world(undefined);
});
setTimeout(() => process.exit(), 300);
