/**
 * One DSH API client for the WSL dsh, built from DeepSeek Harness's own
 * Client packages (their Node faces), not a reimplementation:
 *
 *   @deepseek-ai/dsh-typert-registry/client    ctx.typert
 *   @deepseek-ai/dsh-client-connection/client  installConnection(): unary RPC envelopes,
 *                                              multipart byte attachments
 *   @deepseek-ai/dsh-api-gateway/client        ctx.remote: the Remote stream mux
 *                                              (open/item/end/cancel frames, uplinks)
 *
 * The WSL dsh is reached through the Windows loopback relay of its
 * RemoteConnection. Authentication is the documented API admission:
 * `GET /connect?token=<launch token>&interactions=answer` returns a signed API
 * cookie for one owner Peer; every HTTP request and the mux WebSocket carry it.
 *
 * The client is passive (interactions `none` on this side): this bridge opens
 * the forwarded-event stream itself and answers waterfalls on behalf of the
 * Windows windows, so the official answering loop (which resolves Agents of
 * its own Client tree) is not wanted here.
 */
import { Context } from '@deepseek-ai/cordis';
import * as typertClient from '@deepseek-ai/dsh-typert-registry/client';
import { installConnection } from '@deepseek-ai/dsh-client-connection/client';
import * as gatewayClient from '@deepseek-ai/dsh-api-gateway/client';

const READY_TIMEOUT_MS = 15000;

export class HostClient {
  /**
   * @param {object} options
   * @param {string} options.url - tokenized URL of the WSL dsh UI through the Windows relay.
   * @param {typeof fetch} [options.fetch] - fetch implementation (tests).
   */
  static async open({ url, fetch: doFetch = globalThis.fetch }) {
    const address = new URL(url);
    const token = address.searchParams.get('token');
    if (!token) throw new Error('the WSL dsh URL carries no launch token');
    const base = `${address.protocol}//${address.host}/`;
    const admitted = await doFetch(new URL(`connect?token=${encodeURIComponent(token)}&interactions=answer`, base), { redirect: 'manual' });
    const setCookie = admitted.headers.get('set-cookie');
    if (admitted.status !== 302 || !setCookie) throw new Error(`the WSL dsh refused API admission (HTTP ${admitted.status})`);
    const cookie = setCookie.split(';', 1)[0];
    return new HostClient(base, cookie, doFetch);
  }

  constructor(base, cookie, doFetch) {
    this.base = base;
    this.cookie = cookie;
    this.doFetch = doFetch;
    this.closed = false;
    // A private Cordis root: nothing of the Windows Host composition is visible to it.
    const root = new Context();
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the DSH Remote client did not start')), READY_TIMEOUT_MS);
      timer.unref?.();
      this.fiber = root.plugin({
        name: 'wsl-remote-host-client',
        apply: (ctx) => {
          ctx.plugin(typertClient);
          installConnection(ctx, {
            interactions: 'none',
            transport: {
              streamBaseUrl: base,
              fetch: (input, init) => this.fetch(String(input), init),
              createWebSocket: (href) => new WebSocket(href, { headers: { cookie } }),
            },
          });
          ctx.plugin(gatewayClient);
          ctx.inject(['remote', 'connection'], (scope) => {
            clearTimeout(timer);
            resolve({ remote: scope.remote, connection: scope.connection });
          });
        },
      });
    });
    this.ready.catch(() => {});
  }

  /** Authenticated HTTP to the WSL dsh; `path` is relative to its root (`api/...`). */
  fetch(path, init = {}) {
    const headers = new Headers(init.headers);
    headers.set('cookie', this.cookie);
    return this.doFetch(new URL(path.replace(/^\/+/, ''), this.base), { ...init, headers });
  }

  /**
   * One unary Remote call with the wire payload `{ args }` unchanged.
   * @returns {Promise<{ ok: true, value: unknown } | { ok: false, error: { code: string, message: string, details: object } }>}
   */
  async call(endpoint, payload, signal) {
    const { connection } = await this.ready;
    try {
      return await connection.rpc.call('/api', endpoint, payload, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      return { ok: false, error: { code: 'gateway/internal', message: `WSL dsh: ${error?.message ?? error}`, details: {} } };
    }
  }

  /** One Remote stream (including `$events`) through the official mux client; items are wire values. */
  async *stream(endpoint, payload, signal, uplink) {
    const { remote } = await this.ready;
    yield* remote.openRemoteStream(endpoint, payload, signal, uplink);
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.fiber?.dispose();
    } catch {}
  }
}
