/** Recognize the Windows packaged ripgrep binary that `dsh-tool-fs-search` spawns. */
export function isRipgrep(command) {
  if (typeof command !== 'string') return false;
  const normalized = command.replace(/\\/g, '/').toLowerCase();
  return /\/@vscode\/ripgrep[^/]*\/bin\/rg(\.exe)?$/.test(normalized) || /(^|\/)[^/]*-rg(\.exe)?$/.test(normalized);
}
