// Create (or refresh) a throwaway DSH home for boot rehearsals and print its path.
//   ELECTRON_RUN_AS_NODE=1 "DeepSeek Harness.exe" test/boot-home.mjs
// It holds a copy of the Desktop profile's manifests and a junction to that
// profile's node_modules, so a rehearsal loads exactly the installed plugins
// without touching ~/.dsh. WSL settings start without a relay port (the live
// app owns its port) and without auto-connect.
//
// Removing it: delete the node_modules junction first (`cmd /c rmdir <path>`),
// never recursively through it — it points at the live profile's packages.
import { copyFileSync, existsSync, lstatSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const home = join(repo, '.scratch', 'boot-home');
const profile = join(home, 'profiles', 'desktop');
const live = join(homedir(), '.dsh', 'profiles', 'desktop');

if (!existsSync(join(live, 'package.json'))) throw new Error(`no Desktop profile at ${live}; open DeepSeek Harness Desktop once first`);
mkdirSync(profile, { recursive: true });
for (const file of ['package.json', 'cordis.yml', 'cordis.patch.yml', 'pnpm-workspace.yaml']) {
  if (existsSync(join(live, file))) copyFileSync(join(live, file), join(profile, file));
}
const modules = join(profile, 'node_modules');
let linked = false;
try {
  linked = lstatSync(modules).isSymbolicLink();
} catch {}
if (!linked) {
  if (existsSync(modules)) throw new Error(`${modules} exists and is not a link; remove it by hand`);
  symlinkSync(join(live, 'node_modules'), modules, 'junction');
}
writeFileSync(join(home, 'wsl-remote.json'), `${JSON.stringify({ version: 2, shareLogin: true, profile: 'web', autoConnect: [], ports: {} })}\n`);
console.log(home);
