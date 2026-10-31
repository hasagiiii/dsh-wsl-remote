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

The folder is registered as **a workspace of that distribution's dsh**: it appears in the WSL dsh's own UI, and in the Windows window. It keeps its Linux path (for example `/home/me/repo`) everywhere, in the Windows window too, and a **WSL · <OS>** badge (for example `WSL · Ubuntu 26.04`) sits next to its name; the dot shows the connection state. Workspaces and sessions that already exist in the WSL dsh appear as well.

A `\\wsl.localhost\…` workspace added by an earlier version is merged with the WSL workspace of the same folder into one row, shown with the Linux path. New sessions in it run in the WSL dsh; old sessions that ran on Windows stay where they are.

### Plugins: which side has what

A WSL session's agent (tools, skills, MCP servers, model providers) runs on the plugins installed in the WSL dsh; the interface of this window, and its own plugin page, are always the Windows ones. **WSL plugins** next to a connected distribution in Settings → General lists that dsh's plugins, each marked:

- **WSL only**: WSL sessions have it, Windows sessions do not;
- **Windows has x.y.z**: installed on both sides, in different versions;
- **also on Windows**: installed on both sides, same version.

Below them, **Installed on Windows only** lists the plugins WSL sessions do not have. From the panel you can enable, disable and remove WSL plugins, install one by name or spec, or **Install in WSL** a Windows-only one (a plugin linked from a Windows folder is linked through `/mnt/<drive>/…`). The changes run through the WSL dsh's own plugin manager; when one waits for a restart, the panel offers to restart the dsh in WSL. **Manage in the WSL dsh's own UI** opens its full plugin page.

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
  └─ session list, search, workspaces, control stream, event stream: merged across hosts
  Web server ── plugin routes (e.g. /sidebar/*) of WSL sessions → the same plugin in the WSL dsh
```

### Which host a call belongs to

Codex's window sends a `hostId` with every request. The DeepSeek Harness client has no such field: it talks to one Host and names sessions, agents and workspaces by id. The merge therefore works out the owner of each call from those ids, in this order:

1. **The call names a workspace** (`session/create`, `workspace/rename`, `workspace/delete` and the other `workspace/*` calls that carry `workspaceId` but no `sessionId`). The merge keeps one workspace table built from every host's `workspace/follow` stream; each row records which host it came from (`owners`: merged id → `{ host, id on that host }`). The call goes to that host, with the id rewritten to the host's own.
2. **The call creates a workspace** (`workspace/create`). The WSL folder picker sends `\\wsl.localhost\<distro>\<path>` only as an address: the distribution is read from it, and the workspace is created in that distribution's dsh with the Linux path. Any other path is a Windows folder.
3. **The call names a session, agent or child**. Ids are read from the wire arguments: `agentId`, `workspaceFileScopeId`, `sessionId`, `parentSessionId`, `childSessionId`, `rootSessionId`, the same fields in `request`, and `request.address`. The first id with a known owner decides. Owners are learned from:
   - each host's session list (`session/list` is merged from all hosts, and each row records where it came from);
   - each host's workspace rows (`sessionIds`);
   - `session/control` projections and `$events` (`api-session/added`, status, activity) of each distribution;
   - the replies of `session/create` and `session/fork`, recorded the moment they return.
4. **The id is unknown** (a session created elsewhere and not listed yet): Windows is asked first (its live sessions, then its persisted session store), then each connected distribution through `session/projections`. The first host that knows the id owns it, and the answer is remembered.
5. **Nothing names a host** (`session/list`, `session/search`, the window's model catalog, settings, plugin manager, account): the call goes to Windows; the collections among them are merged with every distribution's.

Plugin HTTP routes and WebSockets apply the same rule to the request: `?sessionId=` (and the other id parameters), a path segment that is a session id (`/sidebar/html/<sessionId>/…`), or an id field in a JSON body. A bare Linux path (a Markdown file link, `/api/file?path=`) goes to the distribution whose WSL workspace contains it (the deepest one), or to the only connected distribution.

Results are remembered, so each id is resolved once. A workspace or session a distribution returns is recorded immediately, before its follow stream echoes it: the window creates a session in a WSL workspace in the same breath as adding it.

- **Routing**: see above. The call itself is handed unchanged to its host, apart from merged workspace ids and the picker's `\\wsl.localhost` address.
- **Paths**: WSL workspaces, session directories and history headers keep their Linux paths in the Windows window; the owning distribution is known from the workspace or session, never from the path. Only "Open in app" turns a Linux path into `\\wsl.localhost\<distro>\…`, because Windows opens the file.
- **Merged streams**: `workspace/follow` sends the complete merged state on every change (`replace` frames); `session/control` puts each distribution's projections into the opening baseline and then forwards every host's increments; `$events` forwards the WSL sessions' events (status, activity, questions, approvals and more) and sends the Windows window's answers to questions and approvals back to the WSL dsh that asked.
- **Files, terminal, git**: DSH's own file preview (`workspaceFiles/*`), terminal (`terminal/*`), jobs, goals and file upload name their session, so they run in WSL like Codex's `fs/*` and `command/exec`. Plugin routes do too: a plugin installed in both dsh instances (for example dsh-better-sidebar's file tree, editor, git view and terminal under `/sidebar/*`) answers a WSL session's requests from inside WSL, through the same plugin there. Exact routes (session log export, raw upload, `/api/file`, change comparisons) are forwarded by `sessionId` or path.
- **Models**: the window's catalog is the Windows one. The model picker of a WSL session is built on that distribution's own catalog, so it lists, defaults to and checks the models the WSL dsh can route; a Windows session lists only Windows models.
- **Shutdown**: the WSL dsh is started as the leader of its own process group and reports its pid and start time. When a connection ends, the group is ended too (TERM, then KILL), after checking the start time so a reused pid is never touched, so tools, MCP servers and terminals do not outlive it.
- **Authentication**: the WSL dsh's documented API admission, `GET /connect?token=<launch token>&interactions=answer`, returns a signed API cookie that every HTTP request and the mux WebSocket then carry. WSL opens no non-loopback port.

### Source

- `index.js`: the Host plugin: discovery, connections, settings routes, the folder picker, and installing the merge.
- `lib/bridge/bridge.js`: the merge: ownership, routing, merged streams, and the Gateway and Fetch-route wrappers.
- `lib/bridge/routes.js`: plugin HTTP routes and WebSocket upgrades of WSL sessions, answered by the WSL dsh.
- `lib/bridge/merge.js`: the pure parts: ids a call or request names, workspace merging, the distribution of a Linux path.
- `lib/bridge/host-client.js`: the WSL dsh client, assembled from DeepSeek Harness's own Client packages.
- `lib/remote.js`: one remote connection: deploy, version gate, launch, loopback relay, credential answers, reconnect with backoff.
- `server/launch.sh`, `server/agent.mjs`: start `dsh` through the login shell; the agent is a Cordis plugin loaded with `dsh --patch` that runs only when the Windows Host started it.
- `server/dsh-harness.sh`, `lib/requests.js`: the `dsh-harness` command.
- `lib/linux-fs.js`: the WSL folder picker, and reading the distribution and Linux path out of a `\\wsl.localhost` path.

## Limitations

- The WSL dsh must be the same release as DeepSeek Harness on Windows: merged sessions speak the Windows side's Remote API.
- The merge wraps DeepSeek Harness's internal Gateway dispatch (`dispatchRpc`, `openWireStream`), the Connection's exact route table, the web server's route tables and the model picker's per-session directory, so a DSH upgrade may need a plugin update (`engines.dsh`). Ownership is inferred from ids (see above), not declared by the window as Codex's `hostId` is.
- While a distribution is disconnected, its sessions stay listed with their last known state, and opening one reconnects it. Running streams break and the DSH client reconnects them as usual.
- Only session-related events are merged. The WSL dsh's settings and account pages do not appear in the Windows window; its plugins are managed from the WSL plugins panel (see above) or its own UI.
- Known issue: installing a plugin from the panel can hang. The WSL dsh's plugin manager has written the dependency (its pnpm log ends with `Done`), but its pnpm process does not exit, so the install stays pending until the plugin manager's 10-minute idle timeout ends it and restores the profile. The same `pnpm add` run in a WSL terminal exits at once. Until this is solved, install from the WSL dsh's own UI or with `dsh plugin --profile web add <spec>` in WSL; listing, enabling, disabling and removing are not affected.
- A plugin's sidebar works for WSL sessions only when the same plugin is installed in the WSL dsh too; otherwise its WSL requests fail. A plugin route that names no session (shared assets, global settings) is always answered by Windows.
- "Open in app" opens a WSL file on Windows through `\\wsl.localhost` (9P).
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
# a throwaway DSH home in .scratch/boot-home: the Desktop profile's manifests, its node_modules by junction
$h = & $dsh test/boot-home.mjs
$env:DSH_HOME = $h; $env:DSH_TELEMETRY_DISABLED = '1'; $env:DSH_CLIENT_VERSION = '0.2.1-rc.5'
& $dsh --expose-internals --import ./test/resolve-boot.mjs test/boot-desktop.mjs "$h\profiles\desktop" (Get-Location).Path Ubuntu-26.04
# a WSL session's plugin routes, its distribution's model catalog, process-group cleanup on disconnect
& $dsh --expose-internals --import ./test/resolve-boot.mjs test/boot-wsl-session.mjs "$h\profiles\desktop" Ubuntu-26.04
# a distribution's plugins listed against Windows; disable and re-enable one through the panel's routes
& $dsh --expose-internals --import ./test/resolve-boot.mjs test/boot-wsl-plugins.mjs "$h\profiles\desktop" Ubuntu-26.04 dsh-vscode-mode
# keep the composition running with its web UI, to drive the real client in a browser
& $dsh --expose-internals --import ./test/resolve-boot.mjs test/serve-desktop.mjs "$h\profiles\desktop" Ubuntu-26.04
# then, with a headless Chrome on --remote-debugging-port=9333, run steps against the page
& $dsh test/cdp.mjs 9333 <steps.mjs>
```

Bump `AGENT_VERSION` in `lib/remote.js` when `server/agent.mjs`, `server/launch.sh`, `server/dsh-harness.sh` or `lib/mux.js` change.
