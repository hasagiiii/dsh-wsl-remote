# @local/dsh-wsl-remote

English | [简体中文](README.zh-CN.md)

WSL remote connections for DeepSeek Harness, modelled on the Codex desktop app's "WSL remote connections". Each WSL 2 distribution is its own remote host next to this Windows one. Connecting starts **your own `dsh` inside WSL**, which keeps its own `~/.dsh` profile, sessions, plugins and native ext4 files. No restart is needed, and nothing in the Windows Host is replaced.

| | This Windows Host | `WSL: <distro>` connection |
|---|---|---|
| Program | DeepSeek Harness Desktop | the `dsh` you installed in WSL (`npm i -g @deepseek-ai/dsh`) |
| Home, sessions, plugins, `AGENTS.md` | `%USERPROFILE%\.dsh` | WSL `~/.dsh` |
| Files and shell | Windows, PowerShell | Linux, your login shell |
| Sign-in | Windows credential store | **shared with Windows** (default) or separate |
| Opens in | the app | right-sidebar browser tab or system browser |

## Install

### 1. Prepare the WSL distribution

Inside each distribution you want to connect to, install Node.js (nvm works) and `dsh`, then check that your login shell finds it:

```bash
npm i -g @deepseek-ai/dsh
bash -lc 'dsh --version'   # 0.2.1-rc.2 or newer; use your own login shell if it is not bash
```

The distribution must run WSL 2 (`wsl -l -v` on Windows shows the version).

### 2. Install the plugin on Windows

Run these commands in PowerShell. The `dsh` command ships with DeepSeek Harness Desktop.

```powershell
git clone https://github.com/hasagiiii/dsh-wsl-remote.git
cd dsh-wsl-remote
dsh plugin --profile desktop add .
```

`add .` links the directory into the Desktop profile (`%USERPROFILE%\.dsh\profiles\desktop`) and adds `@local/dsh-wsl-remote` to its bundle list. Open DeepSeek Harness Desktop at least once before running it, so the profile exists.

pnpm may print a warning that the linked package will not resolve `@deepseek-ai/cordis` and `@deepseek-ai/schemastery` from the profile. You can ignore it: DeepSeek Harness provides both packages when it loads the plugin. Do not switch to `file:`, because that installs a copy and your later `git pull` would no longer reach the app.

### 3. Restart DeepSeek Harness

Quit DeepSeek Harness fully and reopen it. Then go to Settings → General → **WSL remote connections**.

### Update

```powershell
cd dsh-wsl-remote
git pull
```

Then restart DeepSeek Harness. Because the plugin is linked, you don't need to run `add` again. The next connect deploys the new agent into each distribution.

### Uninstall

```powershell
dsh plugin --profile desktop remove @local/dsh-wsl-remote
```

Restart DeepSeek Harness. To also remove the files left in each distribution, run `rm -rf ~/.dsh-wsl-remote` inside it. The WSL `dsh` and its `~/.dsh` are yours and are not touched.

## Use

Go to Settings → General → **WSL remote connections**:

1. Select **Connect** next to `WSL: <distro>`. The first connect copies a small agent to `~/.dsh-wsl-remote/agent/<version>`. It checks `dsh --version` on your login PATH (like Codex's version gate), then starts `dsh --profile web` through `wsl.exe`.
2. Select **Open in sidebar** or **Open in browser**. The WSL dsh UI loads through a Windows loopback relay at `http://127.0.0.1:<port>`. The port stays fixed per distribution, so the WSL dsh browser cookie survives reconnects.
3. Connected distributions reconnect automatically when DeepSeek Harness starts. Select **Disconnect** to stop the WSL dsh.

The two other settings apply to new connections:

- **Share sign-in** (on by default): see below.
- **dsh profile in WSL**: the profile to start (default `web`).

Requirements inside the distribution: WSL 2 and `dsh` 0.2.1-rc.2 or newer on the PATH of your login shell (nvm works).

## Shared sign-in

Codex has no built-in way to share sign-in between Windows and WSL; you sign in on each side. Here sharing is possible, because both sides use the same credential seam (`ctx.credentials`).

When sharing is on, the agent inside the WSL dsh answers every credential read and write from the Windows store, over the `wsl.exe` pipe:

- API keys (`DEEPSEEK_API_KEY` and others)
- DeepSeek account sign-in (`deepseek-account-platform/*`)
- other plugins' records

Each `modifyRecord` in WSL runs inside the Windows store's `modifyRecord`, under its cross-process writer lock. So a token refresh in WSL and one on Windows cannot overwrite or invalidate each other. That is the problem with copying credential files. Sign-in, sign-out and key changes made on either side take effect on both. Windows change events are forwarded to WSL.

The WSL dsh keeps one record to itself: `client-connection/browser-session`, the secret that signs its own browser cookie. When sharing is off, the WSL dsh uses its own `~/.dsh/.credentials.yaml`, and you sign in there separately.

## How it works

```text
Windows Host (this plugin)                      WSL distribution
  RemoteConnection ── wsl.exe stdio ──────────▶ launch.sh → $SHELL -ilc 'dsh --patch overlay.yml --profile web'
    mux ch 0: JSON (hello, credentials/*)  ◀──▶   agent.mjs (Cordis plugin, fds 3/4)
    mux ch n: relayed TCP  ◀── 127.0.0.1:port     ──▶ 127.0.0.1:<dsh web port>
```

- `lib/remote.js`: one connection, covering deploy, version gate, launch, the loopback relay, credential answering, and reconnect with backoff.
- `server/launch.sh`: finds `dsh` through your login shell and moves the pipe to fds 3 and 4, so dsh's own stdout never touches it.
- `server/agent.mjs`: a zero-import Cordis plugin loaded through `dsh --patch`. It only runs when started by the Windows Host.
- `lib/mux.js`: a credit-windowed stream multiplexer shared by both sides.

The WSL side opens no non-loopback port. The relay listens on Windows loopback only. The WSL dsh still requires its launch token and cookie.

## Migrating from 2.x

Version 2.x was a startup "execution environment" that swapped this Host's execution providers for WSL ones. On first start, 3.0 rewrites `wsl-remote.json` to the new format and the Windows providers come back, like Codex turning `runCodexInWsl` off after migrating. Sessions created in 2.x stay in the Windows session list.

## Limits

- A WSL connection is a separate dsh with its own UI. Its sessions do not appear in the Windows session list, the same as separate hosts in Codex.
- The right-sidebar browser is a sandboxed iframe or webview. If the WSL UI needs something it withholds, use **Open in browser**.
- Model-facing tools run where the session lives. A Windows session cannot run commands in WSL through this plugin.

## Development

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
$dsh = 'D:\dsh\DeepSeek Harness.exe'
& $dsh test/unit.mjs                                           # protocol, migration, shared-credential locking
$env:WSL_DISTRO = 'Ubuntu-26.04'
& $dsh --import ./test/stub-cordis.mjs test/remote.mjs        # real WSL: deploy, launch, relay, shared reads
```

Bump `AGENT_VERSION` in `lib/remote.js` whenever `server/` or `lib/mux.js` changes, so each distribution gets the new agent.
