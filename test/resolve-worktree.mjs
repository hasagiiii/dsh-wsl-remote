// Test-only: boot rehearsals load THIS working tree as @local/dsh-wsl-remote, not the copy the live
// Desktop profile has installed (the throwaway home's node_modules is a junction to that profile).
// Use after resolve-boot.mjs:  --import ./test/resolve-boot.mjs --import ./test/resolve-worktree.mjs
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

const root = pathToFileURL(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')).href;
register(`data:text/javascript,${encodeURIComponent(`
  const root = ${JSON.stringify(root)};
  export async function resolve(specifier, context, next) {
    if (specifier === '@local/dsh-wsl-remote') return next(new URL('index.js', root).href, context);
    if (specifier.startsWith('@local/dsh-wsl-remote/')) {
      const sub = specifier.slice('@local/dsh-wsl-remote/'.length);
      const files = { client: 'client.js', 'package.json': 'package.json' };
      return next(new URL(files[sub] ?? sub, root).href, context);
    }
    return next(specifier, context);
  }
`)}`);
