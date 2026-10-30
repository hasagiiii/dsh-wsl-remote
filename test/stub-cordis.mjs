/** Loader hook for tests run outside DeepSeek Harness: resolves the peer packages to tiny stubs. */
import { registerHooks } from 'node:module';

const STUBS = {
  '@deepseek-ai/cordis': 'export class Service { constructor(ctx, name) { this.ctx = ctx; this.name = name; } } export class Context {}',
  '@deepseek-ai/schemastery': 'const s = new Proxy(function () {}, { get: () => s, apply: () => s }); export default s;',
  // The bridge's DSH client packages; the smoke test never opens a WSL session.
  '@deepseek-ai/dsh-typert-registry/client': 'export const inject = []; export function apply() {}',
  '@deepseek-ai/dsh-client-connection/client': 'export function installConnection() {}',
  '@deepseek-ai/dsh-api-gateway/client': 'export const inject = []; export function apply() {}',
};

registerHooks({
  resolve(specifier, context, next) {
    if (specifier in STUBS) return { url: `data:text/javascript,${encodeURIComponent(STUBS[specifier])}`, shortCircuit: true };
    return next(specifier, context);
  },
});
