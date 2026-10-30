/**
 * Where a distribution's Linux execution runtime lives, deploying it on first
 * use (like VS Code installing its WSL server). Results are cached per Host
 * run; a failure is not cached, so fixing the distribution and retrying works.
 */
import { ensureServer, probeDistro } from './deploy.js';
import { nodeRequirement, requirementMessage } from '../requirements.js';

/**
 * @param {{ packageDir: string, logger: object, onProblem?: (distro: string, problem: object | undefined) => void }} options
 */
export function createLocator({ packageDir, logger, onProblem }) {
  const cache = new Map();
  const facts = new Map();
  const locate = (distro) => {
    let pending = cache.get(distro);
    if (pending === undefined) {
      pending = (async () => {
        const probed = await probeDistro(distro);
        facts.set(distro, probed);
        const requirement = nodeRequirement(probed);
        if (requirement !== undefined) throw Object.assign(new Error(requirementMessage(distro, requirement)), { requirement });
        const { dir } = await ensureServer(packageDir, distro, probed, undefined, (message) => logger.info(`wsl-remote: ${message}`));
        onProblem?.(distro, undefined);
        return { node: probed.node, serverDir: dir, home: probed.home };
      })();
      pending.catch((error) => {
        cache.delete(distro);
        onProblem?.(distro, { message: error.message, ...(error.requirement ? { requirement: error.requirement } : {}) });
        logger.warn(`wsl-remote: WSL execution for ${distro} is unavailable: ${error.message}`);
      });
      cache.set(distro, pending);
    }
    return pending;
  };
  return { locate, facts: (distro) => facts.get(distro) };
}
