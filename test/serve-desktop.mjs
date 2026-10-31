// Boot the Desktop profile composition (throwaway DSH home) with its web UI and
// keep it running, for driving the real Windows client in a browser.
//   ELECTRON_RUN_AS_NODE=1 "DeepSeek Harness.exe" --expose-internals --import ./test/resolve-boot.mjs \
//     test/serve-desktop.mjs <profileDir> <distro>
import { join } from 'node:path';
import { loadLayeredEnv, loadProfileDirectory, reportSkippedBundles } from '@deepseek-ai/dsh-app-boot';
import { runProfile } from '@deepseek-ai/dsh/profile-boot';

const runtimeDir = process.env.DSH_ROOT ?? 'D:\\ds_harness\\resources\\app.asar\\dsh';
const [projectDir, distro = 'Ubuntu-26.04'] = process.argv.slice(2);
const installAnchor = join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json');
const profile = loadProfileDirectory('dsh', projectDir, installAnchor);
reportSkippedBundles('dsh', profile);
const app = await runProfile({
  environment: loadLayeredEnv('dsh'),
  profile: 'desktop',
  resolvedProfile: { profile, installAnchor },
  patchFiles: [],
  args: ['--no-open', '--host', '127.0.0.1', '--port', '0'],
});
const wsl = app.ctx.get('wslRemote');
await wsl.ready;
await wsl.connection(distro).connect();
console.log(`SERVE READY ${distro} ${wsl.connections.get(distro)?.state}`);
// WSLR_LATE=<ms>: simulate enabling the plugin while a window is open — the
// merge is removed, then installed again after that many milliseconds.
if (process.env.WSLR_LATE) {
  const { wrapGateway } = await import(new URL('../lib/bridge/bridge.js', import.meta.url).href);
  const gateway = app.ctx.get('typertGateway');
  const raw = Reflect.get(gateway, Symbol.for('cordis.original')) ?? gateway;
  delete raw.dispatchRpc;
  delete raw.openWireStream;
  console.log(`MERGE REMOVED for ${process.env.WSLR_LATE} ms`);
  setTimeout(() => {
    wrapGateway(gateway, wsl.bridge);
    console.log('MERGE INSTALLED');
  }, Number(process.env.WSLR_LATE));
}
// WSLR_RELOAD=<ms>: simulate the plugin being reloaded while a window stays
// open (enable/disable, a linked-package reload): a second bridge is installed
// over the first, then the first is disposed, in Cordis' order.
if (process.env.WSLR_RELOAD) {
  const { WslBridge, wrapGateway } = await import(new URL('../lib/bridge/bridge.js', import.meta.url).href);
  const gateway = app.ctx.get('typertGateway');
  setTimeout(async () => {
    const old = wsl.bridge;
    const next = new WslBridge({ hosts: old.hosts, windows: old.windows, logger: old.logger });
    next.start();
    wrapGateway(gateway, next);
    wsl.bridge = next;
    await old.stop();
    wsl.unwrapGateway?.();
    console.log('PLUGIN RELOADED');
  }, Number(process.env.WSLR_RELOAD));
}
const shutdown = () => app.shutdown.shutdown(0).finally(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.stdin.on('end', shutdown);
setInterval(() => {}, 1 << 30);
