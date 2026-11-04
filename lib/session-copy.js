/**
 * Copy a session into another workspace (Codex-style hosts: Windows, WSL, SSH).
 *
 * The source host reads the session (its own `sessionQuery`, attachment store
 * and workspace files); the target host creates the copy (its own `agents`,
 * workspace registry and attachment store) and writes the chosen files into
 * the target workspace. Either side is this Windows Host (`session-copy.mjs`
 * run against the Host ctx) or a remote dsh (the same file, deployed beside
 * the agent, run through the agent pipe).
 */
import { existingInWorkspace, exportSession, importSession, planSessionFiles } from '../server/session-copy.mjs';

/** One control frame carries a whole copy; stay well under the mux's 80 MB frame cap. */
export const MAX_COPY_BYTES = 60 * 1024 * 1024;

/**
 * @param {object} options
 * @param {object} options.ctx - the Windows Host context.
 * @param {(host: string) => object} options.connection - a remote host's RemoteConnection.
 * @param {(host: string) => string} options.label - display name of a host ("WSL: Ubuntu", "SSH: bwg").
 */
export function createSessionCopier({ ctx, connection, label }) {
  const on = (host) => (host === null
    ? {
        exportSession: (sessionId, options) => exportSession(ctx, sessionId, options),
        importSession: (copy, target) => importSession(ctx, copy, target),
        sessionFiles: (sessionId) => planSessionFiles(ctx, sessionId),
        workspaceExisting: (workspaceId, relatives) => existingInWorkspace(ctx, workspaceId, relatives),
      }
    : connection(host));
  const hostName = (host) => (host === null ? 'Windows' : label(host));
  return {
    /**
     * What the copy dialog offers: the workspace files the session created or
     * changed, and which of them the target workspace already has.
     * @returns {Promise<{ root?: string, files: object[], skipped: object[], targetRoot: string, existing: string[] }>}
     */
    async plan({ from, to }) {
      const plan = await on(from.host).sessionFiles(from.sessionId);
      const target = await on(to.host).workspaceExisting(to.workspaceId, plan.files.map((file) => file.relative));
      return { ...plan, targetRoot: target.root, existing: target.existing };
    },
    /**
     * @param {{ from: { host: string | null, sessionId: string }, to: { host: string | null, workspaceId: string }, files?: string[], overwrite?: boolean }} request
     *   host null is this Windows Host; workspace and session ids are the ones that host knows.
     * @returns {Promise<{ sessionId: string, workspaceId: string, cwd: string, files: { written: string[], kept: string[] } }>}
     */
    async copy({ from, to, files = [], overwrite = false }) {
      const copy = await on(from.host).exportSession(from.sessionId, { files });
      const size = JSON.stringify(copy).length;
      if (size > MAX_COPY_BYTES) {
        throw new Error(`this session is too large to copy (${Math.round(size / 1048576)} MB with its attachments and files; the limit is ${MAX_COPY_BYTES / 1048576} MB)`);
      }
      // Which host the history was written on, for the other spellings of its paths
      // (a WSL folder seen from Windows as \\wsl.localhost\<distro>\...).
      if (from.host !== null) copy.host = String(from.host).startsWith('ssh:') ? { ssh: true } : { distro: from.host };
      const sameHost = from.host === to.host;
      return on(to.host).importSession(copy, {
        workspaceId: to.workspaceId,
        overwrite,
        ...(sameHost ? {} : { fromHost: hostName(from.host), toHost: hostName(to.host) }),
      });
    },
  };
}
