// Test-only resolver: bare imports from this package resolve against the installed
// DeepSeek Harness runtime, the same packages the Host's runtime resolution supplies.
// DSH_ROOT overrides the installation directory (default: D:/ds_harness/resources/app.asar/dsh).
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

const root = (process.env.DSH_ROOT ?? 'D:/ds_harness/resources/app.asar/dsh').replace(/\\/g, '/');
const anchor = pathToFileURL(`${root}/package.json`).href;
register(`data:text/javascript,${encodeURIComponent(`
  const anchor = ${JSON.stringify(anchor)};
  export async function resolve(specifier, context, next) {
    const bare = !specifier.startsWith('.') && !specifier.startsWith('/') && !/^[a-z]+:/i.test(specifier);
    if (bare && context.parentURL && !context.parentURL.includes('/app.asar/')) {
      return next(specifier, { ...context, parentURL: anchor });
    }
    return next(specifier, context);
  }
`)}`);
