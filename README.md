# @local/dsh-wsl-remote

English | [简体中文](README.zh-CN.md)

Use WSL from DeepSeek Harness the way the Codex desktop app does. **Install it once, on Windows.** Each WSL distribution is a remote host running your own `dsh`, installed with `npm i -g @deepseek-ai/dsh`, and its workspaces and sessions are merged into the Windows window.

- **WSL workspaces**: choose "WSL" when adding a workspace and pick a folder in the Linux file system. Sessions in that workspace run in your own `dsh` inside WSL, with WSL's `~/.dsh` profile, models and plugins; commands, file edits and searches run in Linux under the sandbox you configured there. The session list, chat view, history, live output, questions and approvals are all in the same Windows window, beside the Windows sessions.
- **Open the WSL dsh's own UI**: through a Windows loopback relay, in the sidebar or a browser.
- **Shared sign-in** (optional): the WSL dsh uses the Windows credential store directly.
- **`dsh-harness` command**: run `dsh-harness .` in a WSL terminal to open the current directory as a WSL workspace in DeepSeek Harness, like `code .`.
- **SSH remote hosts**: used exactly like WSL. Add `user@host`, `host:port` or a `Host` from `~/.ssh/config` under Settings → General → **SSH remote hosts**; once connected, the workspaces and sessions of your own `dsh` on the server are merged into this window the same way, and "Add workspace" offers **SSH**. See [SSH remote hosts](#ssh-remote-hosts).

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

After a successful connection, sidebar metadata is cached in `wsl-remote-cache.json` under the Windows DSH home. Subsequent launches immediately show the last workspace and session list, preserving workspace expansion while WSL connects and refreshes in the background. Failed connections retain the last list. The first launch after upgrading needs one successful connection to populate the cache; previously lost expansion preferences need to be set once again. Only sidebar metadata is stored, without conversation bodies, pending input or credentials. Items deleted remotely disappear after a successful refresh.

### Plugins: which side has what

Open **Plugins** from the sidebar and switch between the **Windows / WSL** tabs. Windows retains the local plugin list and management actions. WSL lets you select a distribution and lists only its installed plugins, with its profile shown. A disconnected distribution offers Connect instead of showing another host's list. General settings now contains connection settings only.

A WSL session's agent (tools, skills, MCP servers, model providers) uses the WSL dsh's plugins. The WSL tab also compares their installations with Windows:

- **WSL only**: WSL sessions have it, Windows sessions do not;
- **Windows has x.y.z**: installed on both sides, in different versions;
- **also on Windows**: installed on both sides, same version.

The WSL tab supports refresh, enable, disable, remove and installation by package name or WSL install spec. Each operation explicitly names the selected distribution and runs through its own plugin manager; Windows actions still target the Windows profile. When a change waits for a restart, the tab offers to restart the dsh in WSL. You can also open that dsh's full UI.

An install runs in the background: the panel shows its phase, elapsed time and pnpm's output live, and **Cancel install** stops it through the WSL plugin manager, which restores the profile. If pnpm prints nothing for a minute, the panel says it may be stuck and offers the cancel; the window never waits on an install. An install started from one window is picked up again by another window or after a reload.

**Sync plugins** (below the list in the same tab) copies your plugins from any host to any other: Windows, a WSL distribution or an SSH host, in either direction. Choose **From** and **To**, select **Compare**, then sync a single plugin with the **Install** / **Update** / **Enable** button on its row, or tick several and select **Sync selected**. Syncing more plugins between the same two hosts while a sync runs queues them at its end. Each plugin shows what it needs on the target (missing, other version, disabled, in sync) and is installed one at a time through the target's own plugin manager, with live output and **Stop sync**; disabled ones are enabled. Registry installs are pinned to the source's version; git specs are kept as recorded; a plugin installed from a Windows folder installs through `/mnt/<drive>` in WSL, while an SSH host cannot reach that folder. When the target cannot reach a plugin's folder but the folder is the root of a git repository whose commit is on a remote branch, the plugin installs from git instead, pinned to that commit (the newest pushed one if local commits are ahead); the panel names the repository and commit and says when unpushed commits or uncommitted changes are left out. Otherwise the panel says why it cannot sync. Plugins only the target has are listed and left alone; nothing is removed. The Host makes the plan again when a sync starts, so a window only chooses plugin names, never install specs. When a plugin needs a restart, the panel says so.

### Models: switch hosts and sync configuration

Open **Settings → Models** and switch between **Windows / WSL**. Windows retains the local model editor. WSL lets you select a distribution and edit its providers, API keys, base URLs and model lists. Saves go to that distribution; select **Connect** first if it is disconnected.

Each provider has its own sync button: **Sync to WSL** under Windows, or **Sync to Windows** under WSL. Review that provider’s configuration differences, then **Confirm sync**. Other providers remain untouched. Target-only fields and models are preserved; matching fields use source values. Changes to the target after preview invalidate that preview, so review a fresh one.

For plugin-provided providers, select **Install provider plugin** when the target lacks the plugin, or **Enable provider plugin** when it is disabled. Installation uses the source host’s recorded package source, works in both directions, shows progress and logs, and supports cancellation. After installation, review a fresh configuration preview and confirm the sync separately. Ambiguous ownership, incompatible platforms and local paths that cannot be translated are explained. Local plugins in native WSL Linux directories must first be published or placed on a Windows drive accessible to both hosts. Plugins requiring a restart display a notice.

A sync can copy the provider's API keys too. The preview names each key the target lacks or holds with a different value (marked as replaced) under **Also copy API keys**, ticked by default; untick it to sync the configuration only. Keys the target already holds with the same value are left alone. Values are read from the source host's credential store and written with the target's `credentials/set` inside the Windows Host process: no preview, result, log or window ever receives one, and an error names the key, not its value. On a remote host the value is read by the agent inside its dsh, so a connection made before this version must be reconnected first. Keys that cannot be copied stay listed as missing, to be filled in under the target tab. With **Share sign-in** enabled, both hosts already use the Windows credential store; editing a shared key on either host affects both.

After updating this plugin, disable and re-enable `@local/dsh-wsl-remote` in the plugin manager, then refresh the window to load the model page. An application restart is unnecessary.

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

### SSH remote hosts

An SSH host is used exactly like a WSL distribution; you only add it yourself:

1. Install dsh on the server, as in WSL: `npm i -g @deepseek-ai/dsh`, the same release as on Windows.
2. Open Settings → General → **SSH remote hosts**, enter `user@host`, `host:port` or a `Host` alias from `~/.ssh/config`, and select **Add**. Concrete hosts from `~/.ssh/config` are offered as one-click buttons.
3. Select **Connect**. From here on it is the WSL flow: the first connect deploys the agent to `~/.dsh-wsl-remote/agent/<version>` on the server, checks `dsh --version` and starts `dsh --profile web`; workspaces and sessions are merged into this window with an **SSH · <host>** badge; the remote tab of the Plugins and Models pages lists SSH hosts too; sign-in can be shared; connections reconnect and clean up the server-side process group on disconnect.
4. When adding a workspace, choose **SSH**, pick the host, then a folder in the server's Linux file system.

The plugin uses Windows' bundled OpenSSH (`C:\Windows\System32\OpenSSH\ssh.exe`) with your `~/.ssh/config`, keys and ssh-agent. Everything travels over the stdio of one SSH session: the server opens no extra port and no port forwarding is used. Connections are non-interactive (`BatchMode=yes`) and **cannot ask for a password or confirm a host key**: set up key-based login and run `ssh <host>` once in PowerShell to accept the host key. Authentication, host-key and network failures are explained on the Settings page.

Differences from WSL:

- There is no `dsh-harness` command (it relies on WSL interop).
- "Open in app" is not available for files on an SSH host: Windows has no path for them.
- A plugin installed from a Windows folder (`link:F:/…`) cannot be installed from that folder on an SSH host, which cannot see Windows drives; it installs by package name from the registry instead, and the Models page's **Install provider plugin** explains why for such providers.

After removing an SSH host, only `~/.dsh-wsl-remote` remains on the server; remove it with `rm -rf ~/.dsh-wsl-remote`.

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
- `lib/remote.js`: one remote connection (WSL or SSH): deploy, version gate, launch, loopback relay, credential answers, reconnect with backoff.
- `lib/transport.js`: run a Linux argv on a remote host: `wsl.exe -d` for WSL, `ssh -T -o BatchMode=yes` for SSH (each argument single-quoted); `~/.ssh/config` parsing.
- `server/launch.sh`, `server/agent.mjs`: start `dsh` through the login shell; the agent is a Cordis plugin loaded with `dsh --patch` that runs only when the Windows Host started it. A marker line precedes the mux frames on the pipe, so an SSH login banner is discarded.
- `server/dsh-harness.sh`, `lib/requests.js`: the `dsh-harness` command.
- `lib/linux-fs.js`: the WSL / SSH folder picker, and the picker addresses (`\\wsl.localhost\…`, `ssh://<host>/…`) to and from a host and Linux path.

## Limitations

- The WSL dsh must be the same release as DeepSeek Harness on Windows: merged sessions speak the Windows side's Remote API.
- The merge wraps DeepSeek Harness's internal Gateway dispatch (`dispatchRpc`, `openWireStream`), the Connection's exact route table, the web server's route tables and the model picker's per-session directory, so a DSH upgrade may need a plugin update (`engines.dsh`). Ownership is inferred from ids (see above), not declared by the window as Codex's `hostId` is.
- While a distribution is disconnected, its sessions stay listed with their last known state, and opening one reconnects it. Running streams break and the DSH client reconnects them as usual.
- Only session-related events are merged. The WSL dsh's settings and account pages do not appear in the Windows window; its plugins are managed from the WSL plugins panel (see above) or its own UI.
- Seen once, not reproducible since: the WSL plugin manager's pnpm wrote the dependency (log ends with `Done`) but its process did not exit. Repeated installs through the same path finish in a few seconds. Should it happen, the panel reports the install as possibly stuck after a minute and **Cancel install** restores the profile.
- Removing a plugin that was linked from a Windows folder can leave its `node_modules` link behind in the WSL profile (pnpm no longer lists it, so it is not loaded); it is harmless and is replaced on the next install.
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

The SSH path is tested without a real server: `test/fake-ssh.mjs` takes ssh's real argv, prints a login banner on stdout, and hands the command string to a WSL distribution's shell:

```powershell
& $dsh --test --test-isolation=none test/ssh.mjs test/client-ssh.mjs     # argv, addresses, ~/.ssh/config, banner skipping, settings, routing, UI
$env:DSH_FAKE_SSH_DISTRO = 'Ubuntu-26.04'
& $dsh --import ./test/stub-cordis.mjs test/ssh-remote.mjs              # deploy, launch, relay, folder listing and process-group cleanup over the SSH code path
```
