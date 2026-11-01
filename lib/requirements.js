/**
 * What the Settings page shows when the WSL side is not ready to connect:
 * which program is missing or too old, and the exact commands to fix it,
 * chosen from what the probe found (node, npm, nvm) in the login shell.
 */
import { MIN_DSH_VERSION, compareVersions } from './version.js';

const INSTALL_DSH = 'npm install -g @deepseek-ai/dsh';
/** nvm installs Node.js into the home directory: no sudo, no distro package conflicts. */
const NVM_INSTALL = 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash';

/**
 * @param {{ dshPath?: string, dsh?: string, node?: string, npm?: string, nvm?: boolean }} facts
 * @returns {undefined | { reason: 'dsh-missing' | 'dsh-outdated', minimum: string, found?: string, steps: { command: string, note: string }[] }}
 */
export function dshRequirement(facts) {
  const outdated = Boolean(facts.dshPath) && compareVersions(facts.dsh, MIN_DSH_VERSION) < 0;
  if (facts.dshPath && !outdated) return undefined;
  const steps = [];
  if (!facts.node || !facts.npm) {
    if (!facts.nvm) steps.push({ command: NVM_INSTALL, note: 'nvm' });
    steps.push({ command: 'nvm install --lts', note: facts.nvm ? 'node' : 'node-after-nvm' });
  }
  steps.push({ command: INSTALL_DSH, note: outdated ? 'update' : 'install' });
  steps.push({ command: 'dsh --version', note: 'verify' });
  return {
    reason: outdated ? 'dsh-outdated' : 'dsh-missing',
    minimum: MIN_DSH_VERSION,
    ...(outdated ? { found: facts.dsh || '(unknown)' } : {}),
    steps,
  };
}

/** The one-line message kept in `error` for the model tool and logs. `host` is a label such as `Ubuntu` or `SSH: dev`. */
export function requirementMessage(host, requirement) {
  const commands = requirement.steps.filter((step) => !String(step.note).startsWith('verify')).map((step) => step.command).join(' && ');
  return requirement.reason === 'dsh-outdated'
    ? `dsh ${requirement.found} in ${host} is older than the required ${requirement.minimum}; update it there with: ${commands}`
    : `dsh was not found on the login PATH of ${host}. Install it there with: ${commands}`;
}

