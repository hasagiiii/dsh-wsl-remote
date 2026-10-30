/**
 * Per-session tool switch for WSL workspaces.
 *
 * A Session whose working directory is `\\wsl.localhost\<distro>\…` runs its
 * commands through the WSL world of the shell dispatcher. Its Agent therefore
 * gets the shipped Linux `bash` tool (mounted into that Agent's own scope),
 * loses the PowerShell `pwsh` tool, and receives one prompt section naming the
 * execution world. Every other Agent is left exactly as its preset made it.
 */
import { distroOf } from './route.js';

/** The Agent's Session cwd as recorded at creation, before any `cd`. */
export function sessionDirectory(agent) {
  const workingDirectory = agent?.ctx?.get?.('workingDirectory');
  try {
    const current = workingDirectory?.get?.(agent.session);
    if (typeof current === 'string') return current;
  } catch {}
  return agent?.session?.header?.cwd;
}

export function environmentSection(distro, os, shell) {
  const where = os ? `${distro} (${os})` : distro;
  return [
    `Execution environment: this session's workspace is in the WSL Linux distribution ${where}. Commands, file reads, edits and searches run inside Linux, not on Windows.`,
    `The bash tool runs \`${shell || 'bash'} -c\` there; write Linux commands. Workspace paths are shown in their Windows spelling \\\\wsl.localhost\\${distro}\\…, which names the Linux path /…: for example \\\\wsl.localhost\\${distro}\\home\\me\\repo is /home/me/repo, and C:\\work is /mnt/c/work.`,
    'File tools accept either spelling; inside commands use the Linux one.',
  ].join(' ');
}

/**
 * Install the switch on the Host context.
 * @param {object} ctx - Host plugin context (needs `agent/created`).
 * @param {{ facts: (distro: string) => Promise<{ os?: object, shell?: string } | undefined>, logger: object, bashTool: () => Promise<object> }} options
 */
export function installWslAgentTools(ctx, { facts, logger, bashTool }) {
  ctx.on('agent/created', async ({ agent }) => {
    const distro = distroOf(sessionDirectory(agent));
    if (distro === undefined) return;
    const scope = agent.ctx;
    // Registries key an Agent's layer by the Agent; registrations through agent.ctx stay in that layer.
    const tools = ctx.get('tools');
    if (tools === undefined || scope === undefined) return;
    try {
      if (tools.get('bash', agent) === undefined) {
        const plugin = await bashTool();
        await scope.plugin(plugin, {});
      }
      if (tools.get('pwsh', agent) !== undefined && tools.get('bash', agent) !== undefined) {
        scope.get('tools').restrict({ deny: ['pwsh'] });
      }
    } catch (error) {
      logger.warn(`wsl-remote: could not switch ${agent.id} to the Linux bash tool: ${error.message}`);
    }
    const prompt = scope.get('systemPrompt');
    if (prompt !== undefined) {
      const known = await facts(distro).catch(() => undefined);
      const os = known?.os ? [known.os.name, known.os.version].filter(Boolean).join(' ') || known.os.pretty : undefined;
      try {
        prompt.section({
          name: 'wsl-remote:environment',
          order: prompt.getSectionOrder('TOOL_BASH') - 1,
          text: environmentSection(distro, os, known?.shell),
          interpolate: false,
        });
      } catch (error) {
        logger.warn(`wsl-remote: could not add the WSL environment section for ${agent.id}: ${error.message}`);
      }
    }
  });
}
