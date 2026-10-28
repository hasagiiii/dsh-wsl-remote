# @local/dsh-wsl-remote

Run Agent commands, file edits and searches inside WSL while DeepSeek Harness stays on Windows — the same split as VS Code Remote - WSL.

| Stays on Windows | Runs inside WSL (in WSL mode) |
|---|---|
| Desktop UI, model calls, credentials | Command tool (`bash`, your selected Linux shell) |
| Session log, approvals, permissions | `read` / `write` / `edit`, `glob` / `grep` |
| Plugins, settings, Agent presets | Workflow / PTC worker, file-effect sandbox (bubblewrap) |

## Use

Settings → General:

1. **Execution environment** — `This Windows PC` or `WSL · <distro>`. Choosing a distribution prepares its Linux runtime first (`~/.dsh-wsl-remote/server/<version>`, one `npm install`), then saves the choice and asks you to **restart DeepSeek Harness**. The environment is fixed for the whole app from startup; every session after the restart uses it.
2. **Default shell** — any shell in that distribution's `/etc/shells` (default `bash`). Also applies after a restart.

Agent presets are not changed. In WSL mode each Agent gets the Linux `bash` tool and its `pwsh` tool is hidden.

Requirements inside the distribution: WSL 2, Node.js 22+ on the login PATH (nvm works), and `bwrap` for the confined permission modes.

## How it works

- `cordis.patch.yml` (generated from `patch.template.yml` by `scripts/build-patch.mjs`) — at startup each row's `!!js` condition reads `<DSH home>/wsl-remote.json` once; in WSL mode the Windows `subprocess`, `sandbox`, `pwsh-sandbox` and `fs-sandbox` rows stand down and the WSL rows provide the same Host services.
- `lib/connection.js` — the `ctx.ssh` contract over `wsl.exe` stdio instead of OpenSSH; starts on first use, reconnects on next use, closes after 15 idle minutes.
- `lib/vendor/*` — DeepSeek Harness's own `dsh-fs-ssh`, `dsh-subprocess-ssh`, `dsh-sandbox-ssh` providers (0.2.1-rc.3, MIT), unchanged except import paths.
- `server/helper/*` — DeepSeek Harness's POSIX execution helper from `@deepseek-ai/dsh-ssh` (unchanged); `server/ptc/process.js` — the `dsh-ptc-runtime-node` worker; `server/bridge.mjs` resolves the login-shell environment once, starts the helper, authenticates its TLS-PSK stream sockets locally and multiplexes everything over the one pipe. Nothing listens on a network port.
- `lib/providers.js` — translates Windows spellings (`\\wsl.localhost\<distro>\…`, `C:\…`, the packaged `rg.exe`) into Linux equivalents.

## Limits

- Interactive terminal tabs and the right-sidebar file views also use the WSL providers in WSL mode; file watching is not available there (same as DSH's SSH provider), so views refresh on demand.
- A lost WSL connection fails the operations it carried; they are not replayed. The next operation reconnects.
- Pinned to DeepSeek Harness 0.2.1-rc.3 (`engines.dsh`); the vendored providers must be refreshed when DSH upgrades.

## Install

```text
git clone https://github.com/hasagiiii/dsh-wsl-remote.git
```

Install the cloned directory as a bundle into your DeepSeek Harness profile (for example, ask the Agent to install it with `plugin_manager install_bundle <absolute path>`), then open Settings → General.

To switch back to Windows without the UI, delete `%USERPROFILE%\.dsh\wsl-remote.json` (or `$DSH_HOME\wsl-remote.json`) and restart.

## Development

`cordis.patch.yml` is generated; edit `patch.template.yml` or `lib/boot.js`, then run:

```text
node scripts/build-patch.mjs
```

Tests run with the DeepSeek Harness Electron binary as Node so the plugin resolves the installed DSH packages (`DSH_ROOT` overrides the default `D:/ds_harness/resources/app.asar/dsh`). `WSL_DISTRO` selects the distribution (default `Ubuntu`).

```powershell
node test/boot.mjs                       # startup selection, no WSL needed
$env:ELECTRON_RUN_AS_NODE = '1'
$dsh = 'D:\ds_harness\DeepSeek Harness.exe'
& $dsh --import ./test/resolve-dsh.mjs test/deploy.mjs   # deploys the Linux runtime
& $dsh --import ./test/resolve-dsh.mjs test/shell.mjs    # shell, sandbox modes, PTC, default shell
& $dsh --import ./test/resolve-dsh.mjs test/e2e.mjs      # files, sandbox, ripgrep, PTY
```

Bump `SERVER_VERSION` in `lib/deploy.js` whenever anything under `server/` or `lib/mux.js` changes, so distributions receive the new runtime.
