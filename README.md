# @local/dsh-wsl-remote

English | [简体中文](README.zh-CN.md)

Use WSL from DeepSeek Harness the way the Codex desktop app does. **Install it once, on Windows**; everything it needs inside WSL is deployed automatically.

- **WSL workspaces**: choose "WSL" when adding a workspace and pick a folder in the Linux file system. Sessions in that workspace run commands (bash), file reads and edits, and searches inside the distribution, with Linux paths and bubblewrap confinement. Other workspaces keep running on Windows. Both kinds of session run side by side, with no mode to switch.
- **WSL remote connections**: start your own `dsh` inside WSL, with WSL's own `~/.dsh` profile, sessions and plugins, shown in the sidebar or a browser. Sign-in can be shared with Windows.
- **`dsh-harness` command**: run `dsh-harness .` in a WSL terminal to open the current directory as a WSL workspace in DeepSeek Harness, like `code .`.

| | Windows workspace | WSL workspace | WSL remote connection |
|---|---|---|---|
| Which dsh the session lives in | DeepSeek Harness on Windows | DeepSeek Harness on Windows | your own `dsh` in WSL |
| Where commands, files and searches run | Windows (PowerShell) | WSL (bash + bubblewrap) | WSL |
| Models, plugins, session list | the Windows ones | the Windows ones | WSL `~/.dsh` |
| What the distribution needs | — | Node.js 22+ | `dsh` 0.2.1-rc.2+ |

## Install

### 1. Prepare the WSL distribution

The distribution must run WSL 2 (`wsl -l -v` on Windows shows the version).

- **WSL workspaces** need only Node.js 22 or newer (nvm works). Confinement needs `bwrap` (bubblewrap); install it with `sudo apt install bubblewrap` if it is missing.
- **WSL remote connections** also need `dsh`:

```bash
npm i -g @deepseek-ai/dsh
bash -lc 'dsh --version'   # 0.2.1-rc.2 or newer; use your own login shell if it is not bash
```

When something is missing, the Settings page shows the install commands to copy; see below.

### 2. Install the plugin on Windows

Run these commands in PowerShell. The `dsh` command ships with DeepSeek Harness Desktop.

```powershell
git clone https://github.com/hasagiiii/dsh-wsl-remote.git
cd dsh-wsl-remote
dsh plugin --profile desktop add .
```

`add .` links the directory into the Desktop profile (`%USERPROFILE%\.dsh\profiles\desktop`) and adds `@local/dsh-wsl-remote` to its bundle list. Open DeepSeek Harness Desktop at least once before running it, so the profile exists.

pnpm may warn that the linked package will not resolve its peer dependencies (`@deepseek-ai/cordis` and others) from the profile. You can ignore it: DeepSeek Harness provides those packages when it loads the plugin. Do not switch to `file:`, because that installs a copy and your later `git pull` would no longer reach the app.

**Do not install this plugin into the dsh inside WSL.** It is built for the Windows Host only; even if installed by mistake, its execution parts stand down on any other platform.

### 3. Restart DeepSeek Harness

Quit DeepSeek Harness fully and reopen it.

### Update

```powershell
cd dsh-wsl-remote
git pull
```

Then restart DeepSeek Harness. Because the plugin is linked, you don't need to run `add` again. The files inside WSL are redeployed for the new version the next time they are used.

### Uninstall

```powershell
dsh plugin --profile desktop remove @local/dsh-wsl-remote
```

Restart DeepSeek Harness; the shipped Windows execution providers come back. To also remove the files left in each distribution, run `rm -rf ~/.dsh-wsl-remote ~/.local/bin/dsh-harness` inside it. The WSL `dsh` and its `~/.dsh` are yours and are not touched.

## WSL workspaces

### Adding one

The sidebar's add-workspace button and the new-session page's "Add workspace…" ask for the type first:

- **Local**: the Windows folder dialog, as before.
- **WSL**: pick a distribution, then a Linux folder picker opens at your Linux home. You can type a path (`~` works), go up, jump via breadcrumbs, show hidden folders and create a folder. Folders are listed by `wsl.exe` inside the distribution, so permissions and symlinks match what your Linux user sees.

You can also open one from a WSL terminal with `dsh-harness`; see below.

A WSL workspace is stored in DSH as `\\wsl.localhost\<distro>\<Linux path>`. In the sidebar its name gets a **WSL · <OS version>** badge (for example `WSL · Ubuntu 26.04`, read from the distribution's `/etc/os-release`). The dot shows the distribution's remote-connection state, and the tooltip shows the distribution and the Linux path.

### Sessions in a WSL workspace

The session runs in DeepSeek Harness on Windows, with the Windows models, plugins and session list; its tool calls run inside WSL:

- **Commands**: the model gets the `bash` tool (and no `pwsh`). Commands run in the distribution through your login shell (`$SHELL -c`), with the Linux working directory and the login-shell environment (nvm, `~/.profile` and `~/.zshrc` apply).
- **Sandbox**: in the confined permission modes, bubblewrap limits writes to the workspace and `/tmp`; anything outside goes through DSH's usual escalation approval.
- **File reads, writes and edits** run in Linux, keeping DSH's version checks and its read-before-edit rule. Paths can be Linux paths (`/home/me/x`), relative paths or `\\wsl.localhost\…` paths; all three name the same file. Results show the `\\wsl.localhost\…` spelling.
- **Searches** (grep/glob) run with ripgrep inside the distribution.
- The model gets one prompt section naming the distribution (with its OS version) and how the two path spellings map.

The first time something runs in a distribution, the plugin deploys the Linux runtime to `~/.dsh-wsl-remote/server/<version>` (one `npm install`, which needs access to the npm registry). After that it connects in about a second, and a file operation takes around 10 ms. The connection closes after 15 idle minutes and reconnects on next use. If the distribution has no Node.js 22+, Settings → General → **WSL remote connections** lists the install commands under it.

## WSL remote connections

Go to Settings → General → **WSL remote connections**:

1. Select **Connect** next to `WSL: <distro>`. The first connect copies a small agent to `~/.dsh-wsl-remote/agent/<version>`. It checks `dsh --version` on your login PATH (like Codex's version gate), then starts `dsh --profile web` through `wsl.exe`. The agent is loaded with `--patch` only when the Windows Host starts the WSL dsh; your WSL `~/.dsh` profile is not changed.
2. Select **Open in sidebar** or **Open in browser**. The WSL dsh UI loads through a Windows loopback relay at `http://127.0.0.1:<port>`. The port stays fixed per distribution, so the WSL dsh browser cookie survives reconnects.
3. Connected distributions reconnect automatically when DeepSeek Harness starts. Select **Disconnect** to stop the WSL dsh.

The two other settings apply to new connections:

- **Share sign-in** (on by default): see below.
- **dsh profile in WSL**: the profile to start (default `web`).

The WSL dsh is a separate installation: plugins installed on Windows do not appear there. Install the ones you need inside WSL with `dsh plugin --profile web add …`.

### Install guidance when dsh is missing

On connect, the plugin checks your login shell for `dsh`, `node`, `npm` and nvm. If `dsh` is missing or too old, the connection stops (it does not keep retrying), and the distribution row lists the commands to run in a WSL terminal, each with a Copy button:

- Node.js present: `npm install -g @deepseek-ai/dsh`
- No Node.js, but nvm: `nvm install --lts` first
- Neither: install nvm with its official script first (into your home directory, no sudo), reopen the terminal, then `nvm install --lts`

Select **Retry** when done.

### Shared sign-in

Codex has no built-in way to share sign-in between Windows and WSL; you sign in on each side. Here sharing is possible, because both sides use the same credential seam (`ctx.credentials`).

When sharing is on, the agent inside the WSL dsh answers every credential read and write from the Windows store, over the `wsl.exe` pipe:

- API keys (`DEEPSEEK_API_KEY` and others)
- DeepSeek account sign-in (`deepseek-account-platform/*`)
- other plugins' records

Each `modifyRecord` in WSL runs inside the Windows store's `modifyRecord`, under its cross-process writer lock. So a token refresh in WSL and one on Windows cannot overwrite or invalidate each other. That is the problem with copying credential files. Sign-in, sign-out and key changes made on either side take effect on both. Windows change events are forwarded to WSL.

The WSL dsh keeps one record to itself: `client-connection/browser-session`, the secret that signs its own browser cookie. When sharing is off, the WSL dsh uses its own `~/.dsh/.credentials.yaml`, and you sign in there separately.

## Opening DeepSeek Harness from WSL: `dsh-harness`

When a distribution connects, the plugin installs `~/.local/bin/dsh-harness` (no sudo; a file of the same name that this plugin did not create is left alone). Use it like `code .`:

```bash
dsh-harness            # open the current directory as a WSL workspace in DeepSeek Harness
dsh-harness ~/proj     # open a given directory
dsh-harness --focus    # only bring the DeepSeek Harness window to the front
```

It starts the Windows DeepSeek Harness through WSL interop, or focuses it if it is already running, and hands the folder to the plugin. The plugin adds it as a WSL workspace, starts a session in it, and connects the distribution if it is not connected yet. The folder travels in a request file under `<DSH home>\wsl-remote\requests`, so nothing in WSL opens a port. Windows interop must stay enabled in the distribution (no `[interop] enabled=false` in `/etc/wsl.conf`).

## How it works

### WSL workspaces

DeepSeek Harness mounts exactly one `ctx.subprocess` / `ctx.sandbox` / `ctx.fs` / `ctx.shell` per composition. On Windows this plugin replaces all four with **dispatchers**. Every tool call carries its Session's working directory, and the dispatcher routes on it:

```text
tool call (bash / read / write / edit / grep / glob)
  └─ is the path or working directory under \\wsl.localhost\<distro>\ ?
       ├─ no  → the shipped Windows providers (dsh-subprocess-local, dsh-sandbox-local, dsh-fs-sandbox, dsh-pwsh-sandbox, same configuration)
       └─ yes → that distribution's Linux providers:
                  wsl.exe stdio ⇄ server/exec/bridge.mjs ⇄ DeepSeek Harness's POSIX execution helper (bubblewrap)
```

- `lib/exec/dispatch.js`: the four dispatchers, and the Windows and WSL provider sets each mounted in its own isolation realm (`ctx.wslExec`).
- `lib/exec/route.js`: which distribution a path belongs to.
- `lib/exec/connection.js`, `lib/exec/providers.js`, `lib/exec/vendor/*`: the `ctx.ssh` contract over `wsl.exe`, DeepSeek Harness's own `dsh-fs-ssh`, `dsh-subprocess-ssh` and `dsh-sandbox-ssh` providers (MIT, unchanged except import paths), and Windows/Linux path translation.
- `lib/exec/deploy.js`, `lib/exec/locator.js`: probe the distribution and deploy the versioned Linux runtime.
- `lib/exec/agent-tools.js`: when a session in a WSL workspace starts, give that Agent the `bash` tool, hide `pwsh`, and add the environment prompt section.
- `server/exec/*`: the runtime deployed into the distribution (the unchanged POSIX helper from `@deepseek-ai/dsh-ssh`, and the stdio bridge).

### WSL remote connections

```text
Windows Host (this plugin)                      WSL distribution
  RemoteConnection ── wsl.exe stdio ──────────▶ launch.sh → $SHELL -ilc 'dsh --patch overlay.yml --profile web'
    mux ch 0: JSON (hello, credentials/*)  ◀──▶   agent.mjs (Cordis plugin, fds 3/4)
    mux ch n: relayed TCP  ◀── 127.0.0.1:port     ──▶ 127.0.0.1:<dsh web port>
```

- `lib/remote.js`: one connection, covering deploy, version gate, launch, the loopback relay, credential answering, and reconnect with backoff.
- `server/launch.sh`: finds `dsh` through your login shell and moves the pipe to fds 3 and 4, so dsh's own stdout never touches it. Its `probe` mode also reports the OS version and the facts the install guidance needs.
- `server/agent.mjs`: a zero-import Cordis plugin loaded through `dsh --patch`. It only runs when started by the Windows Host.
- `server/dsh-harness.sh`: deployed as the `dsh-harness` command in WSL; `lib/requests.js` receives its requests on Windows.
- `lib/linux-fs.js`: directory listing and folder creation for the WSL folder picker, and conversion between Linux paths and `\\wsl.localhost` paths.
- `lib/requirements.js`: turns probe results into install guidance.
- `lib/mux.js`: a credit-windowed stream multiplexer shared by both sides.

The WSL side opens no non-loopback port. The relay listens on Windows loopback only. The WSL dsh still requires its launch token and cookie.

## Limits

- A session switches to bash only when its workspace itself is a `\\wsl.localhost\…` path. Using `cd` mid-session to move into the other environment does not change its tools (as in Codex, a project belongs to one host).
- The Node worker for programmatic tool calls (PTC) and workflows still runs on Windows; the tools it calls run in WSL by the rules above.
- Files in a WSL workspace cannot be watched, so the right-sidebar file views refresh on demand there.
- If the connection to a distribution drops, the operations it carried fail and are not replayed. The next operation reconnects.
- A WSL remote connection is a separate dsh with its own UI. Its sessions do not appear in the Windows session list, the same as separate hosts in Codex.
- The right-sidebar browser is a sandboxed iframe or webview. If the WSL UI needs something it withholds, use **Open in browser**.
- DSH has no plugin slot on workspace rows, so the WSL badge is inserted into the sidebar page. A DSH update that restructures the sidebar may need a plugin update.
- The bundled SSH providers match DeepSeek Harness 0.2.1 (`engines.dsh`) and may need refreshing when DSH upgrades.

## Development

Tests run with the DeepSeek Harness Electron binary as Node, so they resolve the installed DSH packages (`DSH_ROOT` overrides the default `D:/ds_harness/resources/app.asar/dsh`).

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
$dsh = 'D:\ds_harness\DeepSeek Harness.exe'
& $dsh --import ./test/resolve-dsh.mjs test/unit.mjs           # routing, paths, install guidance, protocol, migration, shared-credential locking
& $dsh --import ./test/stub-cordis.mjs test/smoke-host.mjs     # Host routes and the WSL folder listing
& $dsh --import ./test/resolve-dsh.mjs test/agent-tools.mjs    # WSL sessions get bash, lose pwsh
& $dsh --import ./test/resolve-dsh.mjs test/exec-e2e.mjs       # real WSL: files, sandbox, ripgrep, PTY
& $dsh --import ./test/resolve-dsh.mjs test/dispatch.mjs       # Windows and WSL routed by path in one composition
$env:WSL_DISTRO = 'Ubuntu-26.04'
& $dsh --import ./test/stub-cordis.mjs test/remote.mjs         # real WSL: remote connection deploy, launch, relay
```

Boot rehearsal: boot the real composition the way the Desktop does, in a throwaway DSH home, create sessions in a Windows and a WSL workspace and call the real tools, without touching the running app:

```powershell
$h = "$env:TEMP\wslr-boot-home"; New-Item -ItemType Directory -Force "$h\profiles\desktop" | Out-Null
$p = "$env:USERPROFILE\.dsh\profiles\desktop"
Copy-Item "$p\package.json","$p\cordis.yml","$p\cordis.patch.yml","$p\pnpm-workspace.yaml" "$h\profiles\desktop"
New-Item -ItemType Junction -Path "$h\profiles\desktop\node_modules" -Target "$p\node_modules" | Out-Null
$env:DSH_HOME = $h; $env:DSH_TELEMETRY_DISABLED = '1'; $env:DSH_CLIENT_VERSION = '0.2.1-rc.5'
& $dsh --expose-internals --import ./test/resolve-boot.mjs test/boot-desktop.mjs "$h\profiles\desktop" (Get-Location).Path '\\wsl.localhost\Ubuntu-26.04\home\me\repo'
```

- Bump `AGENT_VERSION` in `lib/remote.js` whenever `server/agent.mjs`, `server/launch.sh`, `server/dsh-harness.sh` or `lib/mux.js` changes.
- Bump `SERVER_VERSION` in `lib/exec/deploy.js` whenever `server/exec/` or `lib/mux.js` changes.
