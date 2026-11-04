/**
 * Copy one Session into another workspace, on the same host or another one.
 *
 * Both halves run inside a dsh Host with only its `ctx` services, no package
 * imports, so the same file serves the Windows Host (lib/) and a remote dsh
 * (deployed next to server/agent.mjs).
 *
 *  - `exportSession` reads the source Session the way the shipped fork does
 *    (`sessionQuery.observeSession`, the latest completed-turn prefix) plus
 *    the attachments its events name.
 *  - `importSession` stores those attachments, then creates a new ordinary
 *    Session seeded with the copied events, exactly like a fork
 *    (`agents.create({ seed, inheritedEventCount, meta: { isSeeded } })`), but
 *    with the target workspace's directory as its cwd, a working-directory
 *    change recorded after the inherited prefix, and the notice the model
 *    gets for any other `cd`.
 *
 * The copied history keeps its own paths (it is history); the model is told
 * where it now works. The source Session is not touched. Workspace files the
 * Session created or changed can come along (`workspace-files.mjs`), placed at
 * the same path relative to the target workspace.
 */
import { existingFiles, planFiles, readFiles, targetPath, writeFiles } from './workspace-files.mjs';
import { copyRewriter, rewriteEvents } from './path-rewrite.mjs';

/** Wire format version of an exported Session. */
export const SESSION_COPY_FORMAT = 1;

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The latest completed-turn prefix, as the shipped `session/fork` picks it. */
export function latestCompletedPrefixBoundary(events) {
  const lastTurnEnd = events.findLast((event) => event.type === 'turn/end');
  if (lastTurnEnd === undefined) return undefined;
  let boundary = lastTurnEnd.seq;
  for (const next of events.slice(boundary + 1)) {
    if (next.type === 'turn/start' || (next.type === 'user/message' && next.surfaceOp === 'append') || next.type === 'agent/inbox/spliced') break;
    boundary = next.seq;
  }
  return boundary;
}

/** Attachment references in one content array (images and verbatim files). */
function collectContent(content, images, files) {
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (!isRecord(block) || !isRecord(block.attachment)) continue;
    const ref = block.attachment;
    if (block.type === 'image') images.set(String(ref.attachmentId), ref);
    if (block.type === 'file') files.set(`${String(ref.attachmentId)}\u0000${ref.name}`, ref);
  }
}

/** Attachment references an event names (the fields the shipped log export reads). */
export function collectAttachmentRefs(events) {
  const images = new Map();
  const files = new Map();
  for (const event of events) {
    const data = event?.data;
    if (!isRecord(data)) continue;
    switch (event.type) {
      case 'user/message':
      case 'tool/ptc-dispatch':
        collectContent(data.content, images, files);
        break;
      case 'system/message':
      case 'developer/message':
      case 'tool/result':
      case 'team/message/queued':
        collectContent(data.message?.content, images, files);
        break;
      case 'agent/inbox/spliced':
        for (const message of Array.isArray(data.inserted) ? data.inserted : []) collectContent(message?.content, images, files);
        break;
      case 'compaction/summary':
        collectContent(data.summary, images, files);
        collectContent(data.rawOutput, images, files);
        break;
      case 'assistant/message':
        collectContent(data.message?.content, images, files);
        for (const record of Array.isArray(data.stream) ? data.stream : []) {
          if (record?.type === 'chunk' && record.chunk?.type === 'block-end') collectContent([record.chunk.block], images, files);
        }
        break;
      default:
        break;
    }
  }
  return { images: [...images.values()], files: [...files.values()] };
}

/**
 * The events a copy inherits: the source prefix exactly, as the shipped fork
 * inherits it. Later records refer to earlier ones by seq (surface
 * replacements, tool-addition headers, goal rounds), so nothing is removed or
 * renumbered. Process-local domains already ignore an inherited prefix
 * (scheduled tasks fold only a Session's own events, after its cut).
 */
export function copyableEvents(events) {
  return events.map((event) => structuredClone(event));
}

/** One Session's title from its projection snapshot, when it has one. */
function titleOf(observation) {
  const value = observation?.projections?.values?.title;
  if (typeof value === 'string') return value;
  if (isRecord(value) && typeof value.title === 'string') return value.title;
  return undefined;
}

/** Collect an async iterable of byte chunks. */
async function readAll(chunks) {
  const parts = [];
  for await (const chunk of chunks) parts.push(Buffer.from(chunk));
  return Buffer.concat(parts);
}

/**
 * The folder a Session's files are taken relative to: the registered
 * workspace that lists it, else its recorded directory.
 */
function sessionRoot(ctx, sessionId, header) {
  const registry = ctx.get('workspaceRegistry');
  try {
    const owner = registry?.list?.().find((workspace) => workspace.sessionIds.includes(sessionId));
    if (owner !== undefined) return owner.path;
  } catch {}
  return header?.cwd;
}

/**
 * The workspace files a Session created or changed, for the copy dialog.
 * @returns {Promise<{ root?: string, files: object[], skipped: object[] }>}
 */
export async function planSessionFiles(ctx, sessionId, signal) {
  const query = ctx.get('sessionQuery');
  if (query === undefined) throw new Error('this dsh cannot read sessions (no sessionQuery)');
  const observation = await query.observeSession(sessionId, signal === undefined ? {} : { signal });
  try {
    const root = sessionRoot(ctx, sessionId, observation.header);
    if (root === undefined) return { files: [], skipped: [] };
    const plan = await planFiles(observation.events, root, observation.header?.cwd);
    return { root, ...plan };
  } finally {
    observation[Symbol.dispose]?.();
  }
}

/**
 * Which of these workspace-relative paths already exist in a workspace of this host.
 * @returns {Promise<{ root: string, existing: string[] }>}
 */
export async function existingInWorkspace(ctx, workspaceId, relatives) {
  const workspace = ctx.get('workspaceRegistry')?.get(workspaceId);
  if (workspace === undefined) throw new Error(`workspace "${workspaceId}" not found`);
  return { root: workspace.path, existing: await existingFiles(workspace.path, relatives) };
}

/**
 * Read one Session for copying.
 * @param {object} ctx - Host context (sessionQuery; attachments when the Session has any).
 * @param {string} sessionId
 * @param {{ files?: string[] }} [options] - workspace-relative paths of changed files to carry along.
 * @returns {Promise<{ format: number, sessionId: string, cwd?: string, title?: string, agentPreset?: string, events: object[], images: object[], files: object[], workspaceFiles: object[] }>}
 */
export async function exportSession(ctx, sessionId, options = {}, signal) {
  const query = ctx.get('sessionQuery');
  if (query === undefined) throw new Error('this dsh cannot read sessions (no sessionQuery)');
  const observation = await query.observeSession(sessionId, signal === undefined ? {} : { signal });
  try {
    if (observation.header?.origin === 'subagent') throw new Error('a subagent session cannot be copied; copy its parent session');
    const events = observation.events;
    const boundary = latestCompletedPrefixBoundary(events);
    if (boundary === undefined) throw Object.assign(new Error('this session has no completed turn to copy yet'), { code: 'session/fork-unavailable' });
    const prefix = events.slice(0, boundary + 1);
    const attachments = ctx.get('attachments');
    const refs = collectAttachmentRefs(prefix);
    const images = [];
    for (const ref of refs.images) {
      if (attachments?.readImage === undefined) throw new Error('this dsh cannot read the images in this session');
      const stored = await attachments.readImage(ref, signal);
      images.push({ ref, data: Buffer.from(stored.data).toString('base64') });
    }
    const files = [];
    for (const ref of refs.files) {
      if (attachments?.readFileStream === undefined) throw new Error('this dsh cannot read the files in this session');
      files.push({ ref, data: (await readAll(attachments.readFileStream(ref, signal))).toString('base64') });
    }
    const chosen = Array.isArray(options.files) ? options.files.filter((item) => typeof item === 'string') : [];
    const root = sessionRoot(ctx, sessionId, observation.header);
    // Files are collected from the whole log (a turn in progress may have written some too).
    // Several files travel as one zip; `origins` maps each target path back to the original path, for the model's note.
    let workspaceFiles;
    let origins;
    if (chosen.length > 0 && root !== undefined) {
      workspaceFiles = await readFiles(events, root, observation.header?.cwd, chosen);
      const planned = await planFiles(events, root, observation.header?.cwd);
      origins = Object.fromEntries(planned.files.filter((file) => file.external && chosen.includes(file.relative)).map((file) => [file.relative, file.path]));
    }
    return {
      format: SESSION_COPY_FORMAT,
      sessionId,
      ...(observation.header.cwd === undefined ? {} : { cwd: observation.header.cwd }),
      ...(root === undefined ? {} : { root }),
      ...(titleOf(observation) === undefined ? {} : { title: titleOf(observation) }),
      ...(typeof observation.projections?.values?.agentPreset === 'string' ? { agentPreset: observation.projections.values.agentPreset } : {}),
      events: structuredClone(prefix),
      images,
      files,
      ...(workspaceFiles === undefined ? {} : { workspaceFiles, origins }),
    };
  } finally {
    observation[Symbol.dispose]?.();
  }
}

/**
 * Store a copied Session's attachments on this host. Images are stored with
 * their normalized bytes; the store recomputes the digest, so a reference is
 * only reused when the bytes are exactly the same object.
 */
async function importAttachments(ctx, copy) {
  const attachments = ctx.get('attachments');
  const replaced = new Map();
  if ((copy.images.length > 0 || copy.files.length > 0) && attachments === undefined) throw new Error('this dsh has no attachment store for the copied images and files');
  for (const { ref, data } of copy.images) {
    const bytes = Buffer.from(data, 'base64');
    const stored = await attachments.saveImage({ data: new Uint8Array(bytes), mediaType: ref.mediaType, ...(ref.name === undefined ? {} : { name: ref.name }) });
    if (String(stored.attachmentId) !== String(ref.attachmentId)) replaced.set(String(ref.attachmentId), stored);
  }
  for (const { ref, data } of copy.files) {
    const bytes = Buffer.from(data, 'base64');
    const stored = await attachments.saveFile({ data: new Uint8Array(bytes), name: ref.name });
    if (String(stored.attachmentId) !== String(ref.attachmentId)) throw new Error(`file ${ref.name} changed while it was copied`);
  }
  return replaced;
}

/** Point image blocks at the references this host stored (deep, JSON values only). */
function replaceImageRefs(value, replaced) {
  if (replaced.size === 0) return value;
  if (Array.isArray(value)) return value.map((item) => replaceImageRefs(item, replaced));
  if (!isRecord(value)) return value;
  if (value.type === 'image' && isRecord(value.attachment) && replaced.has(String(value.attachment.attachmentId))) {
    return { ...value, attachment: replaced.get(String(value.attachment.attachmentId)) };
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceImageRefs(item, replaced)]));
}

/**
 * The seed a copy is created from: the copied events, the inherited-cut
 * marker, and a working-directory change to the target directory, so the
 * Session's effective directory (a projection) is the target from its first
 * request. Mirrors `buildForkSeed` for a closed prefix.
 * @returns {{ seed: object[], inheritedEventCount: number }}
 */
export function buildCopySeed(events, cwd) {
  const prefix = copyableEvents(events);
  const time = prefix.at(-1)?.time ?? Date.now();
  const seed = [...prefix];
  seed.push({ type: 'session/end-seed', seq: seed.length, time, data: { inherited: true } });
  seed.push({ type: 'working-directory/change', seq: seed.length, time, data: { cwd } });
  return { seed, inheritedEventCount: prefix.length };
}

/** The notice the copy's model gets before its first request in the new place. */
export function copyNotice({ from, to, fromHost, toHost, files = [], origins = {}, rewritten = false }) {
  const where = (path, host) => (host ? `${JSON.stringify(path)} on ${host}` : JSON.stringify(path));
  const lines = [
    rewritten
      ? `This conversation was copied here from ${where(from, fromHost)}. Paths in the earlier messages and tool results have been changed to point to the new working directory.`
      : `This conversation was copied from another workspace. Earlier messages and tool results refer to ${where(from, fromHost)}.`,
    `The working directory is now ${where(to, toHost)}.`,
  ];
  const inside = files.filter((file) => origins[file] === undefined);
  const outside = files.filter((file) => origins[file] !== undefined);
  const list = (items, show) => `${items.slice(0, 50).map(show).join(', ')}${items.length > 50 ? `, and ${items.length - 50} more` : ''}`;
  if (inside.length > 0) {
    lines.push(`These files this conversation created or changed were copied to the same paths relative to the new working directory: ${list(inside, (file) => file)}.`);
  }
  if (outside.length > 0) {
    lines.push(`These files it created or changed outside its old workspace were copied into the new working directory (original path → new relative path): ${list(outside, (file) => `${origins[file]} → ${file}`)}.`);
  }
  lines.push(files.length > 0
    ? 'Other files, commands and paths from the earlier workspace may not exist here; check before relying on them.'
    : 'Files, commands and paths from the earlier workspace may not exist here; check before relying on them.');
  return lines.join(' ');
}

/**
 * Create the copy on this host.
 * @param {object} ctx - Host context (agents, workspaceRegistry, sessionController, attachments, agentDefaultModel).
 * @param {object} copy - `exportSession` result.
 * @param {{ workspaceId: string, fromHost?: string, toHost?: string, overwrite?: boolean }} target
 * @returns {Promise<{ sessionId: string, workspaceId: string, cwd: string, files: { written: string[], kept: string[] } }>}
 */
export async function importSession(ctx, copy, target) {
  if (copy?.format !== SESSION_COPY_FORMAT) throw new Error(`unsupported session copy format ${String(copy?.format)}`);
  const registry = ctx.get('workspaceRegistry');
  const workspace = registry?.get(target.workspaceId);
  if (workspace === undefined) throw new Error(`workspace "${target.workspaceId}" not found`);
  const cwd = workspace.path;
  const agents = ctx.get('agents');
  if (agents?.create === undefined) throw new Error('this dsh cannot create sessions');

  // Files first: a failed write leaves no half-made session behind.
  const hasFiles = copy.workspaceFiles !== undefined && (Array.isArray(copy.workspaceFiles) ? copy.workspaceFiles.length > 0 : (copy.workspaceFiles.count ?? 0) > 0);
  const files = hasFiles
    ? await writeFiles(cwd, copy.workspaceFiles, { overwrite: target.overwrite === true })
    : { written: [], kept: [] };
  const replaced = await importAttachments(ctx, copy);
  // Point the history's paths at where the copy now works: the source root (in every spelling it
  // was written: drive, JSON-escaped, /mnt/<drive>, \\wsl.localhost) becomes this workspace's root,
  // and each file copied from outside the source workspace becomes its place under .dsh-external.
  const externals = Object.fromEntries(Object.entries(copy.origins ?? {})
    .filter(([relative]) => files.written.includes(relative) || files.kept.includes(relative))
    .map(([relative, original]) => [original, targetPath(cwd, relative)]));
  const rewrite = copyRewriter({ fromRoot: copy.root ?? copy.cwd, fromHost: copy.host, toRoot: cwd, externals });
  const history = rewrite === undefined ? copy.events : rewriteEvents(copy.events, rewrite).events;
  const { seed, inheritedEventCount } = buildCopySeed(replaceImageRefs(history, replaced), cwd);

  // The same composition the session controller gives a fork: the source's
  // preset when this host has it, else the default; the window's default model.
  const controller = ctx.get('sessionController');
  const presets = ctx.get('agentPresets');
  let agentPreset;
  if (presets !== undefined && typeof copy.agentPreset === 'string') {
    agentPreset = await presets.resolve(copy.agentPreset).then((found) => found.id, () => undefined);
  }
  if (presets !== undefined && agentPreset === undefined) agentPreset = await presets.resolve(undefined).then((found) => found.id, () => undefined);
  const selection = ctx.get('agentDefaultModel')?.currentSelection?.();
  const sessionId = `session-${globalThis.crypto.randomUUID()}`;
  const notice = copyNotice({ from: copy.root ?? copy.cwd ?? '(unknown)', to: cwd, fromHost: target.fromHost, toHost: target.toHost, files: files.written, origins: copy.origins ?? {}, rewritten: rewrite !== undefined });

  const handle = await agents.create({
    sessionId,
    seed,
    inheritedEventCount,
    meta: {
      cwd,
      isSeeded: true,
      ...(agentPreset === undefined ? {} : { agentPreset }),
    },
    ...(selection === undefined ? {} : { agentOptions: { provider: selection.provider, model: selection.model } }),
    setup: async (agentCtx, agent) => {
      controller?.agents?.installSelection?.(agent);
      if (presets !== undefined && agentPreset !== undefined) await presets.mount(agentCtx, agentPreset);
      agent.inject({
        id: globalThis.crypto.randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: notice }],
        source: { kind: 'working-directory' },
      });
    },
  });
  await workspace.attachSession(sessionId);
  if (typeof copy.title === 'string' && copy.title.length > 0) {
    try {
      // The user-pinned title, like a rename: automatic titling does not replace it.
      const session = ctx.get('sessions')?.get?.(sessionId) ?? handle?.agent?.session;
      if (session !== undefined) ctx.get('sessionTitle')?.rename?.(session, copy.title);
    } catch {}
  }
  return { sessionId, workspaceId: workspace.id, cwd, files };
}
