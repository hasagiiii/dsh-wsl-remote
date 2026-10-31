/**
 * Plugin HTTP routes and WebSocket upgrades of WSL sessions.
 *
 * Plugins installed in both dsh instances (for example dsh-better-sidebar's
 * file tree, editor, git view and side chat under `/sidebar/*`) register
 * their own web-server routes. They read the session's files with the
 * Windows file APIs, which cannot open a Linux path. When such a request
 * names a WSL session — `?sessionId=…`, a session-id path segment, or a
 * `sessionId` field of its JSON body — it is answered by the same plugin
 * running inside that distribution's dsh, like Codex's remote hosts serving
 * their own `fs/*` and `command/exec`. Everything else goes to the Windows
 * route unchanged.
 *
 * Only plugin routes are wrapped: DSH's own `/api`, the Remote mux, static
 * assets and the index page are never forwarded.
 */
import { requestSessionHints, WINDOWS } from './merge.js';

const WRAPPED = Symbol.for('wsl-remote.wrapped-route');
/** Request bodies read to find a `sessionId` field are buffered up to this size; larger ones go to Windows unread. */
const MAX_SNIFF_BYTES = 4 * 1024 * 1024;
/** Paths of the DSH shell itself, never forwarded. */
const OWN = [/^\/api(?:\/|$)/, /^\/plugins(?:\/|$)/, /^\/assets(?:\/|$)/, /^\/connect$/, /^\/$/];

const isOwn = (path) => OWN.some((pattern) => pattern.test(path));
const isJson = (req) => /\bjson\b/i.test(String(req.headers['content-type'] ?? ''));

/** Read a request body into a Buffer (bounded); the request stream is consumed. */
async function readBody(req, limit) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) return undefined;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Let the Windows handler read a body this forwarder already consumed: the
 * request's own async iterator yields the buffered bytes again. Handlers read
 * bodies with `for await (const chunk of req)` (Node's IncomingMessage
 * iteration), so the request object, socket and response stay the originals.
 */
function replay(req, body) {
  req[Symbol.asyncIterator] = async function* replayed() {
    if (body.length > 0) yield body;
  };
  return req;
}

/** Headers safe to pass to the WSL dsh: no cookies, host or hop-by-hop fields of the Windows window. */
function forwardHeaders(req) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    const lower = name.toLowerCase();
    if (['cookie', 'host', 'origin', 'referer', 'connection', 'upgrade', 'keep-alive', 'transfer-encoding', 'content-length', 'accept-encoding', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest'].includes(lower)) continue;
    headers.set(lower, Array.isArray(value) ? value.join(', ') : String(value));
  }
  return headers;
}

export class RouteForwarder {
  /**
   * @param {object} options
   * @param {object} options.bridge - WslBridge (ownerOf, client, hostOfPath).
   * @param {object} options.connection - Windows ctx.connection (request admission).
   * @param {object} options.logger
   */
  constructor({ bridge, connection, logger }) {
    this.bridge = bridge;
    this.connection = connection;
    this.logger = logger;
  }

  /** The distribution owning the session a request names, or undefined for Windows. */
  async owner(url, body) {
    const hints = requestSessionHints(url, body);
    if (hints.length === 0) return undefined;
    const host = await this.bridge.ownerOf(hints);
    return host === WINDOWS ? undefined : host;
  }

  /** Wrapped HTTP handler of one plugin route. */
  async handle(req, res, original) {
    const url = new URL(req.url ?? '/', 'http://dsh.invalid');
    if (isOwn(url.pathname) || this.connection.requestRejection?.(req) !== undefined) return original(req, res);
    let body;
    let distro = await this.owner(url).catch(() => undefined);
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    if (distro === undefined && hasBody && isJson(req)) {
      // The session may be named in the JSON body (`POST /sidebar/api/<method>`).
      body = await readBody(req, MAX_SNIFF_BYTES);
      if (body === undefined) {
        res.writeHead(413, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('request body too large');
        return undefined;
      }
      let parsed;
      try {
        parsed = body.length === 0 ? undefined : JSON.parse(body.toString('utf8'));
      } catch {}
      distro = await this.owner(url, parsed).catch(() => undefined);
    }
    if (distro === undefined) return original(body === undefined ? req : replay(req, body), res);
    return this.forward(distro, req, res, url, body, hasBody);
  }

  async forward(distro, req, res, url, body, hasBody) {
    let response;
    try {
      const client = await this.bridge.client(distro);
      const controller = new AbortController();
      res.once('close', () => controller.abort());
      response = await client.fetch(`${url.pathname.slice(1)}${url.search}`, {
        method: req.method,
        headers: forwardHeaders(req),
        redirect: 'manual',
        signal: controller.signal,
        ...(hasBody ? (body !== undefined ? { body } : { body: req, duplex: 'half' }) : {}),
      });
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: { code: 'wsl-unavailable', message: `WSL ${distro}: ${error.message}` } }));
      }
      return;
    }
    const headers = {};
    response.headers.forEach((value, name) => {
      if (['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'set-cookie'].includes(name)) return;
      headers[name] = value;
    });
    res.writeHead(response.status, headers);
    if (response.body === null) {
      res.end();
      return;
    }
    try {
      for await (const chunk of response.body) {
        if (!res.write(chunk)) await new Promise((resolve) => res.once('drain', resolve));
      }
      res.end();
    } catch {
      res.destroy();
    }
  }

  /** Wrapped upgrade handler of one plugin WebSocket route. */
  async upgrade(req, socket, head, original) {
    const url = new URL(req.url ?? '/', 'http://dsh.invalid');
    if (isOwn(url.pathname) || this.connection.requestRejection?.(req) !== undefined) return original(req, socket, head);
    const distro = await this.owner(url).catch(() => undefined);
    if (distro === undefined) return original(req, socket, head);
    try {
      const client = await this.bridge.client(distro);
      await client.upgrade(`${url.pathname.slice(1)}${url.search}`, req, socket, head);
    } catch (error) {
      this.logger.warn(`wsl-remote: ${distro}: could not forward ${url.pathname}: ${error.message}`);
      socket.destroy();
    }
    return undefined;
  }

  /**
   * Wrap the web server's plugin routes (present and future) and upgrade routes.
   * @returns disposer restoring the original handlers.
   */
  install(webServer) {
    const wrapRoute = (route) => {
      if (route === null || typeof route !== 'object' || route[WRAPPED] !== undefined || typeof route.handler !== 'function') return;
      if (isOwn(route.path)) return;
      const original = route.handler;
      route[WRAPPED] = original;
      route.handler = (req, res) => this.handle(req, res, original);
    };
    const wrapUpgrade = (route) => {
      if (route === null || typeof route !== 'object' || route[WRAPPED] !== undefined || typeof route.handler !== 'function') return;
      if (isOwn(route.path)) return;
      const original = route.handler;
      route[WRAPPED] = original;
      route.handler = (req, socket, head) => this.upgrade(req, socket, head, original);
    };
    const tables = [
      [webServer.exact, wrapRoute],
      [webServer.prefixes, wrapRoute],
      [webServer.upgrades, wrapUpgrade],
    ].filter(([table]) => table instanceof Map);
    for (const [table, wrap] of tables) {
      for (const route of table.values()) wrap(route);
      const set = table.set;
      Object.defineProperty(table, 'set', {
        configurable: true,
        writable: true,
        value(key, route) {
          wrap(route);
          return set.call(this, key, route);
        },
      });
    }
    return () => {
      for (const [table] of tables) {
        delete table.set;
        for (const route of table.values()) {
          if (route?.[WRAPPED] === undefined) continue;
          route.handler = route[WRAPPED];
          delete route[WRAPPED];
        }
      }
    };
  }
}
