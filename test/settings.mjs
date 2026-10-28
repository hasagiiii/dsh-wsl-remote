// Shared test settings: the distribution plus the runtime location deploy.mjs reports.
import { probeDistro, serverDir as defaultServerDir } from '../lib/deploy.js';

export async function settings() {
  const distro = process.env.WSL_DISTRO ?? 'Ubuntu';
  const facts = await probeDistro(distro);
  if (!facts.nodeSupported) throw new Error(`${distro} needs Node.js 22+ on the login PATH`);
  return {
    distro,
    home: facts.home,
    node: process.env.WSL_NODE ?? facts.node,
    serverDir: process.env.WSL_SERVER_DIR ?? defaultServerDir(facts.home),
    facts,
  };
}
