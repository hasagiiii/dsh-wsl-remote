// Per-agent tool switch: a WSL-workspace Agent sees `bash` (not `pwsh`) and the environment
// section; a Windows Agent next to it is unchanged. Uses the installed DSH packages.
//   ELECTRON_RUN_AS_NODE=1 "DeepSeek Harness.exe" --import ./test/resolve-dsh.mjs test/agent-tools.mjs
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { createScope } from '@deepseek-ai/dsh-scope';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { installWslAgentTools } from '../lib/exec/agent-tools.js';

const keepAlive = setInterval(() => {}, 1000);
const root = new Context();
await root.plugin(SystemPrompt, {});
await root.plugin(ToolRuntime, {});
await root.inject(['tools', 'systemPrompt'], async () => {});

// Stand-ins for the shipped preset tools: same names, registered globally like a preset row.
const fakeTool = (name) => ({ name, description: name, parameters: { type: 'object', properties: {} }, output: { schema: { type: 'string' }, render: () => [] }, execute: async () => name });
root.tools.register(fakeTool('pwsh'));
root.tools.register(fakeTool('read'));
const bashPlugin = { name: 'fake-tool-bash', inject: ['tools'], apply: (ctx) => ctx.tools.register(fakeTool('bash')) };

const created = [];
installWslAgentTools(root, {
  facts: async () => ({ os: { name: 'Ubuntu', version: '26.04' }, shell: '/usr/bin/zsh' }),
  logger: { warn: (m) => console.warn(m) },
  bashTool: async () => bashPlugin,
});

async function agent(id, cwd) {
  // DSH keys an Agent's scope by the Agent object itself (tools.get(name, agent)).
  const a = { id, session: { header: { id, cwd } } };
  a.ctx = createScope(root, a).ctx;
  created.push(a);
  await root.serial('agent/created', { agent: a, source: 'startup' });
  return a;
}

const wsl = await agent('wsl', '\\\\wsl.localhost\\Ubuntu-26.04\\home\\me\\repo');
const win = await agent('win', 'E:\\proj\\x');
const visible = (a) => ['bash', 'pwsh', 'read'].filter((n) => a_has(a, n));
console.log('wsl agent sees:', visible(wsl), '| windows agent sees:', visible(win));
assert.ok(a_has(wsl, 'bash'), 'wsl agent has bash');
assert.ok(!a_has(wsl, 'pwsh'), 'wsl agent has no pwsh');
assert.ok(a_has(win, 'pwsh'), 'windows agent keeps pwsh');
assert.ok(!a_has(win, 'bash'), 'windows agent gets no bash');
const sections = (a) => root.systemPrompt.layers?.merge?.(a, (layer) => layer.sections) ?? new Map();
console.log('wsl section present:', sections(wsl).has?.('wsl-remote:environment'), '| windows:', sections(win).has?.('wsl-remote:environment'));

function a_has(a, name) {
  return root.tools.get(name, a) !== undefined;
}
const section = (a) => root.systemPrompt.inspect?.(a) ?? undefined;
console.log('AGENT TOOLS PASSED');
clearInterval(keepAlive);
setTimeout(() => process.exit(), 100);
