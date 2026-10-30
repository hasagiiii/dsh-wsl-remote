# @local/dsh-wsl-remote

English | [简体中文](README.zh-CN.md)

Use WSL from DeepSeek Harness the way the Codex desktop app does. **Install it once, on Windows.** Each WSL distribution is a remote host running your own `dsh`, installed with `npm i -g @deepseek-ai/dsh`, and its workspaces and sessions are merged into the Windows window.

- **WSL workspaces**: choose "WSL" when adding a workspace and pick a folder in the Linux file system. Sessions in that workspace run in your own `dsh` inside WSL, with WSL's `~/.dsh` profile, models and plugins; commands, file edits and searches run in Linux under the sandbox you configured there. The session list, chat view, history, live output, questions and approvals are all in the same Windows window, beside the Windows sessions.
- **Open the WSL dsh's own UI**: through a Windows loopback relay, in the sidebar or a browser.
- **Shared sign-in** (optional): the WSL dsh uses the Windows credential store directly.
- **`dsh-harness` command**: run `dsh-harness .` in a WSL terminal to open the current directory as a WSL workspace in DeepSeek Harness, like `code .`.

| | Windows workspace | WSL workspace |
|---|---|---|
| Which dsh the session lives in | DeepSeek Harness on Windows | your own `dsh` in WSL |
| Where commands, files and searches run | Windows (PowerShell) | WSL |
| Models, plugins, agent settings | Windows `%USERPROFILE%\.dsh` | WSL `~/.dsh` |
| Where it is shown | the same window and session list | the same window and session list |

## Install

### 1. Install dsh in WSL

The distribution must run WSL 2 (`wsl -l -v` on Windows shows the version). In a WSL terminal:

```bash
npm i -g @deepseek-ai/dsh
bash -lc 'dsh --version'   # must be the same release as DeepSeek Harness on Windows (0.2.1-rc.5)
```

When dsh is missing or too old, the Settings page shows the install commands to copy; see below.

### 2. Install the plugin on Windows

Run these commands in PowerShell. The `dsh` command ships with DeepSeek Harness Desktop.

```powershell
git clone https://github.com/hasagiiii/dsh-wsl-remote.git
cd dsh-wsl-remote
dsh plugin --profile desktop add .
```

`add .` links this directory into the Desktop profile (`%USERPROFILE%\.dsh\profiles\desktop`) and adds `@local/dsh-wsl-remote` to its bundles. Open DeepSeek Harness Desktop at least once beforehand, so that the profile exists.

pnpm may warn that a linked package does not resolve its peer dependencies (`@deepseek-ai/cordis` and others) from the profile. Ignore the warning: DeepSeek Harness provides them when it loads the plugin. Do not switch to `file:` as suggested; that installs a copy, and later `git pull` updates would not take effect.

**Do not install this plugin into the dsh inside WSL.** It is made for the Windows Host only.

### 3. Enable

The plugin replaces none of DeepSeek Harness's built-in components, so enabling or disabling it in the plugin manager takes effect right away, without a restart.

### Update and uninstall

```powershell
cd dsh-wsl-remote; git pull                                # update; the plugin is linked, so no new add is needed
dsh plugin --profile desktop remove @local/dsh-wsl-remote  # uninstall
```

The only files left inside WSL are `~/.dsh-wsl-remote` and `~/.local/bin/dsh-harness`; remove them with `rm -rf ~/.dsh-wsl-remote ~/.local/bin/dsh-harness`. The WSL `dsh` and its `~/.dsh` are yours and are not touched.

## Use

### Connect a distribution

Open Settings → General → **WSL remote connections** and select **Connect** next to `WSL: <distro>`. The first connect copies a small agent to `~/.dsh-wsl-remote/agent/<version>`, checks `dsh --version` on your login PATH (like Codex's version gate), then starts `dsh --profile web` through `wsl.exe`. Connected distributions reconnect when DeepSeek Harness starts. Opening a WSL session of a distribution that is not connected yet connects it.

### WSL workspaces

"Add workspace" in the sidebar and "Add workspace…" on the new-session page first ask for the kind:

- **Local**: the Windows folder dialog, as before.
- **WSL**: choose a distribution, then a Linux folder picker opens in your Linux home. You can type a path (`~` works), go up, use the breadcrumbs, show hidden folders and create folders.

The folder is registered as **a workspace of that distribution's dsh**: it appears in the WSL dsh's own UI, and in the Windows window. In the Windows window its path reads `\\wsl.localhost\<distro>\<Linux path>`, and a **WSL · <OS>** badge (for example `WSL · Ubuntu 26.04`) sits next to its name; the dot shows the connection state. Workspaces and sessions that already exist in the WSL dsh appear as well.

A `\\wsl.localhost\…` workspace added by an earlier version is merged with the WSL workspace of the same folder into one row. New sessions in it run in the WSL dsh; old sessions that ran on Windows stay where they are.

### Shared sign-in

With **Share sign-in** on (the default), the agent inside the WSL dsh hands every credential read and write over the `wsl.exe` pipe to the Windows credential store: API keys, DeepSeek account sign-in, and other plugins' credential records. Each WSL `modifyRecord` runs inside the Windows store's `modifyRecord`, under its cross-process writer lock, so token refreshes on either side never overwrite or invalidate each other. Only the key that signs the WSL dsh's own browser cookies (`client-connection/browser-session`) stays in WSL. With sharing off, the WSL dsh uses its own `~/.dsh/.credentials.yaml`.

**dsh profile in WSL** chooses the profile started on connect (default `web`). Both settings apply to new connections.

### Install guidance when dsh is missing

On connect, the plugin detects `dsh`, `node`, `npm` and nvm in the distribution's login shell. When `dsh` is not found or is older than 0.2.1-rc.5, the connection stops and lists the commands to run in a WSL terminal under the distribution, each with a copy button. Select **Retry** afterwards.

### `dsh-harness`

When a distribution connects, the plugin installs `~/.local/bin/dsh-harness` (no sudo; a file of that name that this plugin did not write is left alone):

```bash
dsh-harness            # open the current directory as a WSL workspace in DeepSeek Harness
dsh-harness ~/proj     # open a given directory
dsh-harness --focus    # only bring the DeepSeek Harness window to the front
```

It starts DeepSeek Harness on Windows through WSL interop (or brings it to the front) and hands the directory to the plugin through a request file in `<DSH home>\wsl-remote\requests`; WSL opens no port.

## How it works

```text
Windows window (the browser side, unchanged)
  │  /api (HTTP), /api/remote.mux (WebSocket)
  ▼
Windows DeepSeek Harness Host
  Gateway ── this plugin's merge (lib/bridge)
  │   ├─ Windows sessions and workspaces → the Windows services, unchanged
  │   └─ WSL sessions and workspaces → DeepSeek Harness's own Client packages
  │        (dsh-client-connection, dsh-api-gateway/client, dsh-typert-registry)
  │          └─ Windows loopback relay ⇄ wsl.exe stdio ⇄ your dsh in WSL
  └─ session list, search, model catalog, workspaces, control stream, event stream: merged across hosts
```

- **Routing**: every Remote call names its session, agent or workspace. The merge remembers which host owns each session (from every host's session list, workspaces and events) and hands the call unchanged to that host; an unknown id is asked of Windows, then of each connected distribution. `session/create` and `workspace/create` pick the host from the workspace or the path (`\\wsl.localhost\<distro>\…`).
- **Paths**: Linux paths returned by WSL (session directories, workspace paths, history snapshot headers) are shown as `\\wsl.localhost\<distro>\…` in the Windows window, and turned back into Linux paths before they go to WSL.
- **Merged streams**: `workspace/follow` sends the complete merged state on every change (`replace` frames); `session/control` puts each distribution's projections into the opening baseline and then forwards every host's increments; `$events` forwards the WSL sessions' events (status, activity, questions, approvals and more) and sends the Windows window's answers to questions and approvals back to the WSL dsh that asked.
- **Exact routes**: session log export, raw file upload, `/api/file` and change comparisons are forwarded by `sessionId` or path.
- **Authentication**: the WSL dsh's documented API admission, `GET /connect?token=<launch token>&interactions=answer`, returns a signed API cookie that every HTTP request and the mux WebSocket then carry. WSL opens no non-loopback port.

### Source

- `index.js`: the Host plugin: discovery, connections, settings routes, the folder picker, and installing the merge.
- `lib/bridge/bridge.js`: the merge: routing, merged streams, and the Gateway and Fetch-route wrappers.
- `lib/bridge/merge.js`: the pure parts: session ids of a call, workspace merging, path spelling, catalog merging.
- `lib/bridge/host-client.js`: the WSL dsh client, assembled from DeepSeek Harness's own Client packages.
- `lib/remote.js`: one remote connection: deploy, version gate, launch, loopback relay, credential answers, reconnect with backoff.
- `server/launch.sh`, `server/agent.mjs`: start `dsh` through the login shell; the agent is a Cordis plugin loaded with `dsh --patch` that runs only when the Windows Host started it.
- `server/dsh-harness.sh`, `lib/requests.js`: the `dsh-harness` command.
- `lib/linux-fs.js`: the WSL folder picker, and the mapping between Linux paths and `\\wsl.localhost` paths.

## Limitations

- The WSL dsh must be the same release as DeepSeek Harness on Windows: merged sessions speak the Windows side's Remote API.
- The merge wraps DeepSeek Harness's internal Gateway dispatch (`dispatchRpc`, `openWireStream`) and the Connection's exact route table, so a DSH upgrade may need a plugin update (`engines.dsh`).
- While a distribution is disconnected, its sessions stay listed with their last known state, and opening one reconnects it. Running streams break and the DSH client reconnects them as usual.
- Only session-related events are merged. The WSL dsh's settings, plugin manager and account pages do not appear in the Windows window; open the WSL dsh's own UI for those.
- The model catalog offers both sides' providers, and the default model stays the Windows one. A WSL session uses the models the WSL dsh can route; choosing a model that only Windows has is refused by WSL.
- Windows-side features that touch the Windows file system directly, such as "Open in app" and the right-sidebar file view, reach WSL paths through `\\wsl.localhost` (9P).
- The workspace row has no extension slot for plugins, so the WSL badge is placed into the sidebar page; a change to the DSH sidebar structure may need a plugin update.

## Development

Tests run with the DeepSeek Harness Electron binary as Node, so they resolve the installed DSH packages (`DSH_ROOT` overrides the default `D:/ds_harness/resources/app.asar/dsh`).

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
$dsh = 'D:\ds_harness\DeepSeek Harness.exe'
& $dsh --import ./test/resolve-dsh.mjs test/unit.mjs           # merge, paths, install guidance, protocol, migration, shared-credential locking
& $dsh --import ./test/stub-cordis.mjs test/smoke-host.mjs     # Host routes and the WSL folder listing
$env:WSL_DISTRO = 'Ubuntu-26.04'
& $dsh --import ./test/stub-cordis.mjs test/remote.mjs         # real WSL: remote connection deploy, launch, relay
```

Boot rehearsal: boot the real composition the way the Desktop does, in a throwaway DSH home, connect a distribution, and through the Windows Gateway create a Windows and a WSL session, prompt the WSL one and read its history, live output and events, without touching the running app:

```powershell
$h = "$env:TEMP\wslr-boot-home"; New-Item -ItemType Directory -Force "$h\profiles\desktop" | Out-Null
$p = "$env:USERPROFILE\.dsh\profiles\desktop"
Copy-Item "$p\package.json","$p\cordis.yml","$p\cordis.patch.yml","$p\pnpm-workspace.yaml" "$h\profiles\desktop"
New-Item -ItemType Junction -Path "$h\profiles\desktop\node_modules" -Target "$p\node_modules" | Out-Null
$env:DSH_HOME = $h; $env:DSH_TELEMETRY_DISABLED = '1'; $env:DSH_CLIENT_VERSION = '0.2.1-rc.5'
& $dsh --expose-internals --import ./test/resolve-boot.mjs test/boot-desktop.mjs "$h\profiles\desktop" (Get-Location).Path Ubuntu-26.04
```

Bump `AGENT_VERSION` in `lib/remote.js` when `server/agent.mjs`, `server/launch.sh`, `server/dsh-harness.sh` or `lib/mux.js` change.
