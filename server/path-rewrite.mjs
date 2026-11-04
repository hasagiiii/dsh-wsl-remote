/**
 * Rewrite the paths a copied Session's history names, from where it ran to
 * where its copy runs: the source workspace root (in every spelling it can
 * appear in) becomes the target workspace root, and each file copied from
 * outside the source workspace becomes its place under `.dsh-external/`.
 *
 * Only model- and user-visible text and path fields are rewritten. Provider
 * replay material is left byte-for-byte as recorded: `reasoning` blocks, an
 * assistant message's `source` (replay state), the raw `stream` chunks, request
 * headers and tool declarations. File contents shown in edit diffs are left
 * as they were (they are the files' text, not paths the Session used).
 *
 * Plain JavaScript, no imports: runs in the Windows Host and in a remote dsh.
 */

const BACKSLASH = String.fromCharCode(92);
const isWindowsPath = (path) => typeof path === 'string' && (/^[A-Za-z]:[\\/]/.test(path) || path.startsWith(BACKSLASH + BACKSLASH));
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Event types whose data is replay or protocol material, never rewritten. */
const KEEP_EVENTS = new Set(['request/header', 'request/context', 'developer/message', 'session/end-seed', 'model/selection', 'image/offload', 'agent-preset/selected', 'permission/preset', 'sandbox/mode', 'approval/policy', 'subagent/catalog']);
/** Keys whose values are kept as recorded wherever they appear. */
const KEEP_KEYS = new Set(['stream', 'replayState', 'id', 'callId', 'toolCallId', 'attachment', 'attachmentId', 'sourceEventSeqs']);
/** Keys under a tool result's `meta` that hold file contents rather than paths. */
const CONTENT_KEYS = new Set(['oldText', 'newText', 'lines', 'content', 'preview', 'before', 'after']);

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, (char) => BACKSLASH + char);

/** The parts of an absolute root: Windows drive + segments, UNC, or POSIX segments. */
function segmentsOf(root) {
  const parts = String(root).split(/[\\/]+/).filter(Boolean);
  return parts;
}

/**
 * The spellings one root can appear in, each with its separator style.
 * @param {string} root - absolute root in its host's own spelling.
 * @param {{ distro?: string, ssh?: boolean }} host - where it lives (WSL distribution name, or SSH).
 * @returns {{ prefix: string, style: 'win' | 'winEsc' | 'slash', windows: boolean }[]}
 */
export function spellingsOf(root, host = {}) {
  if (typeof root !== 'string' || root.length === 0) return [];
  const out = [];
  const add = (parts, joiner, style, lead, windows) => {
    if (parts.length === 0) return;
    out.push({ prefix: lead + parts.join(joiner), style, windows });
  };
  if (isWindowsPath(root)) {
    const parts = segmentsOf(root);
    if (/^[A-Za-z]:/.test(root)) {
      const [drive, ...rest] = parts;
      add([drive, ...rest], BACKSLASH, 'win', '', true);
      add([drive, ...rest], BACKSLASH + BACKSLASH, 'winEsc', '', true);
      add([drive, ...rest], '/', 'slash', '', true);
      // The same folder as a WSL session sees it.
      add(['mnt', drive[0].toLowerCase(), ...rest], '/', 'slash', '/', false);
    } else {
      add(parts, BACKSLASH, 'win', BACKSLASH + BACKSLASH, true);
      add(parts, BACKSLASH + BACKSLASH, 'winEsc', BACKSLASH.repeat(4), true);
      add(parts, '/', 'slash', '//', true);
    }
    return out;
  }
  const parts = segmentsOf(root);
  add(parts, '/', 'slash', '/', false);
  if (host.distro !== undefined && !host.ssh) {
    // The same folder as Windows sees it through \\wsl.localhost (and the older \\wsl$).
    for (const server of ['wsl.localhost', 'wsl$']) {
      add([server, host.distro, ...parts], BACKSLASH, 'win', BACKSLASH + BACKSLASH, true);
      add([server, host.distro, ...parts], BACKSLASH + BACKSLASH, 'winEsc', BACKSLASH.repeat(4), true);
      add([server, host.distro, ...parts], '/', 'slash', '//', true);
    }
  }
  return out;
}

/** Characters that end a path segment in running text (quotes, whitespace, brackets, punctuation). */
const SEGMENT = '[^\\\\/\\s"\'`<>|*?\\[\\](){},;]*';
const SEPARATOR = '(?:\\\\\\\\|\\\\|/)';

/**
 * Build the rewriter for one copy.
 * @param {object} options
 * @param {string} options.fromRoot - source workspace root (source host spelling).
 * @param {{ distro?: string, ssh?: boolean }} [options.fromHost] - where the source ran.
 * @param {string} options.toRoot - target workspace root (target host spelling).
 * @param {Record<string, string>} [options.externals] - original absolute path → target absolute path.
 * @returns {(text: string) => string}
 */
export function pathRewriter({ fromRoot, fromHost = {}, toRoot, externals = {} }) {
  const targetWindows = isWindowsPath(toRoot);
  // The separator a rewritten occurrence uses: the target's own, keeping how the occurrence was written
  // when both sides are Windows (an escaped JSON `\\`, or forward slashes); a POSIX occurrence becomes native.
  const separatorFor = (rule) => {
    if (!targetWindows) return '/';
    if (rule.style === 'winEsc') return BACKSLASH + BACKSLASH;
    if (rule.style === 'slash' && rule.windows) return '/';
    return BACKSLASH;
  };
  const render = (target, sep) => (targetWindows ? target.replaceAll(BACKSLASH, sep).replaceAll('/', sep) : target);
  const rules = [];
  for (const spelling of spellingsOf(fromRoot, fromHost)) rules.push({ ...spelling, target: toRoot });
  for (const [original, target] of Object.entries(externals)) {
    for (const spelling of spellingsOf(original, fromHost)) rules.push({ ...spelling, target, exact: true });
  }
  if (rules.length === 0) return (text) => text;
  // Longest spelling first, so a nested or escaped form wins over a shorter one.
  rules.sort((a, b) => b.prefix.length - a.prefix.length);
  const alternation = rules.map((rule) => `(${escapeRegExp(rule.prefix)})`).join('|');
  // Not glued to a longer path before it; a whole segment at the end (or a separator next).
  const pattern = new RegExp(`(?<![A-Za-z0-9._\\-/\\\\])(?:${alternation})(?=$|[\\\\/]|[^A-Za-z0-9._\\-])((?:${SEPARATOR}${SEGMENT})*)`, 'g');
  const windowsRules = rules.some((rule) => rule.windows);
  const ignoreCase = windowsRules ? new RegExp(pattern.source, 'gi') : pattern;
  return (text) => {
    if (typeof text !== 'string' || text.length === 0) return text;
    return text.replace(ignoreCase, (match, ...groups) => {
      const index = groups.findIndex((group, position) => position < rules.length && group !== undefined);
      if (index < 0) return match;
      const rule = rules[index];
      // Windows prefixes compare without case; POSIX ones must match exactly.
      if (!rule.windows && groups[index] !== rule.prefix) return match;
      const rest = groups[rules.length] ?? '';
      if (rule.exact && rest.length > 0) return match; // an external file is one path, not a folder
      const sep = separatorFor(rule);
      const tail = rest.replace(/\\\\|\\|\//g, sep);
      return render(rule.target, sep) + tail;
    });
  };
}

/** Rewrite a tool call's JSON `arguments` string as JSON (so a Windows path is escaped), else as text. */
function rewriteArguments(text, rewrite, context) {
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null) {
      const rewritten = walk(parsed, rewrite, context);
      return JSON.stringify(rewritten) === JSON.stringify(parsed) ? text : JSON.stringify(rewritten);
    }
  } catch {}
  return rewrite(text);
}

/** Rewrite every rewritable string under one value. */
function walk(value, rewrite, context) {
  if (typeof value === 'string') return rewrite(value);
  if (Array.isArray(value)) return value.map((item) => walk(item, rewrite, context));
  if (!isRecord(value)) return value;
  if (value.type === 'reasoning') return value; // provider reasoning (and any signature beside it) stays as recorded
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (KEEP_KEYS.has(key)) out[key] = item;
    else if (key === 'source' && context.assistant) out[key] = item;
    else if (context.meta && CONTENT_KEYS.has(key)) out[key] = item;
    else if (key === 'arguments' && typeof item === 'string') out[key] = rewriteArguments(item, rewrite, context);
    else out[key] = walk(item, rewrite, { ...context, meta: context.meta || (context.toolResult && key === 'meta') });
  }
  return out;
}

/**
 * Rewrite the paths in a copied history.
 * @param {object[]} events - copied events (not mutated).
 * @param {(text: string) => string} rewrite - from `pathRewriter`.
 * @returns {{ events: object[], changed: number }}
 */
export function rewriteEvents(events, rewrite) {
  let changed = 0;
  const out = events.map((event) => {
    if (KEEP_EVENTS.has(event.type) || !isRecord(event.data)) return event;
    const data = walk(event.data, rewrite, { assistant: event.type === 'assistant/message', toolResult: event.type === 'tool/result', meta: false });
    if (JSON.stringify(data) === JSON.stringify(event.data)) return event;
    changed += 1;
    return { ...event, data };
  });
  return { events: out, changed };
}

/**
 * The rewriter for a copy whose root and host facts are known, or undefined
 * when nothing would change (same folder, or no source root).
 * @param {{ fromRoot?: string, fromHost?: { distro?: string, ssh?: boolean }, toRoot: string, externals?: Record<string, string> }} options
 */
export function copyRewriter({ fromRoot, fromHost, toRoot, externals = {} }) {
  if (typeof fromRoot !== 'string' || fromRoot.length === 0 || typeof toRoot !== 'string') return undefined;
  if (fromRoot === toRoot && Object.keys(externals).length === 0) return undefined;
  return pathRewriter({ fromRoot, fromHost, toRoot, externals });
}
