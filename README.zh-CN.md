# @local/dsh-wsl-remote

[English](README.md) | 简体中文

DeepSeek Harness 的 WSL 远程连接，方案与 Codex 桌面版的「WSL remote connections」相同：每个 WSL 2 发行版是一台独立的远程主机，与本机 Windows 并存。连接时在 WSL 中启动**你自己安装的 `dsh`**，它使用 WSL 自己的 `~/.dsh` 配置、会话、插件和原生 ext4 文件。无需重启，也不替换 Windows Host 的任何部分。

| | 本机 Windows | `WSL: <发行版>` 连接 |
|---|---|---|
| 程序 | DeepSeek Harness 桌面版 | 你在 WSL 中安装的 `dsh`（`npm i -g @deepseek-ai/dsh`） |
| 主目录、会话、插件、`AGENTS.md` | `%USERPROFILE%\.dsh` | WSL 的 `~/.dsh` |
| 文件和 Shell | Windows、PowerShell | Linux、你的登录 Shell |
| 登录 | Windows 凭据存储 | **与 Windows 共享**（默认），或独立登录 |
| 打开位置 | 应用本身 | 右侧边栏浏览器标签页，或系统浏览器 |

## 安装

### 1. 准备 WSL 发行版

在每个要连接的发行版中安装 Node.js（支持 nvm）和 `dsh`，并确认登录 Shell 能找到它：

```bash
npm i -g @deepseek-ai/dsh
bash -lc 'dsh --version'   # 需要 0.2.1-rc.2 或更高版本；登录 Shell 不是 bash 时换成你自己的
```

发行版必须是 WSL 2（在 Windows 上运行 `wsl -l -v` 查看版本）。

### 2. 在 Windows 上安装插件

在 PowerShell 中运行以下命令。`dsh` 命令随 DeepSeek Harness 桌面版一起安装。

```powershell
git clone https://github.com/hasagiiii/dsh-wsl-remote.git
cd dsh-wsl-remote
dsh plugin --profile desktop add .
```

`add .` 会把该目录链接到桌面版配置（`%USERPROFILE%\.dsh\profiles\desktop`），并把 `@local/dsh-wsl-remote` 加入它的 bundle 列表。运行前请至少打开过一次 DeepSeek Harness 桌面版，确保该配置已经存在。

pnpm 可能会警告：链接进来的包不会从配置目录解析 `@deepseek-ai/cordis` 和 `@deepseek-ai/schemastery`。这个警告可以忽略，DeepSeek Harness 加载插件时会提供这两个包。不要按提示改用 `file:`：那样安装的是一份副本，之后 `git pull` 的更新不会生效。

### 3. 重启 DeepSeek Harness

完全退出 DeepSeek Harness 后重新打开，然后进入 设置 → 通用 → **WSL 远程连接**。

### 更新

```powershell
cd dsh-wsl-remote
git pull
```

然后重启 DeepSeek Harness。插件是链接安装的，不需要再运行 `add`。下次连接时，新的 agent 会自动部署到各个发行版。

### 卸载

```powershell
dsh plugin --profile desktop remove @local/dsh-wsl-remote
```

然后重启 DeepSeek Harness。如果还想清理各发行版里留下的文件，在发行版中运行 `rm -rf ~/.dsh-wsl-remote`。WSL 中的 `dsh` 及其 `~/.dsh` 属于你自己，不会被改动。

## 使用

打开 设置 → 通用 → **WSL 远程连接**：

1. 在 `WSL: <发行版>` 旁点**连接**。首次连接会把一个小型 agent 复制到 `~/.dsh-wsl-remote/agent/<version>`，在登录 PATH 上检查 `dsh --version`（与 Codex 的版本检查相同），然后通过 `wsl.exe` 启动 `dsh --profile web`。
2. 点**在侧边栏打开**或**在浏览器打开**。WSL 中 dsh 的界面通过 Windows 本机回环中继加载，地址为 `http://127.0.0.1:<端口>`。每个发行版的端口固定不变，所以重连后 WSL dsh 的浏览器 Cookie 仍然有效。
3. 已连接的发行版会在 DeepSeek Harness 启动时自动重连。点**断开**会停止 WSL 中的 dsh。

另外两项设置对新连接生效：

- **共享登录状态**（默认开启）：见下文。
- **WSL 中的 dsh 配置**：要启动的 profile（默认 `web`）。

发行版内的要求：WSL 2，以及登录 Shell 的 PATH 上有 0.2.1-rc.2 或更高版本的 `dsh`（支持 nvm）。

## 共享登录状态

Codex 没有内置在 Windows 和 WSL 之间共享登录的办法，两边都要登录一次。这里可以共享，因为两边用的是同一个凭据接口（`ctx.credentials`）。

开启共享后，WSL dsh 内的 agent 会通过 `wsl.exe` 管道，把每一次凭据读写都交给 Windows 的凭据存储处理：

- API Key（`DEEPSEEK_API_KEY` 等）
- DeepSeek 账号登录（`deepseek-account-platform/*`）
- 其他插件的凭据记录

WSL 中的每次 `modifyRecord` 都在 Windows 凭据存储的 `modifyRecord` 内部执行，处于它的跨进程写锁之下。因此 WSL 里的令牌刷新和 Windows 上的刷新不会互相覆盖或作废，而复制凭据文件正是会出这个问题。在任意一边登录、退出或修改 Key，两边同时生效。Windows 上的变更事件会转发给 WSL。

只有一条记录 WSL dsh 自己保留：`client-connection/browser-session`，它是签发 WSL dsh 自身浏览器 Cookie 的密钥。关闭共享后，WSL dsh 使用自己的 `~/.dsh/.credentials.yaml`，需要在那里单独登录。

## 工作原理

```text
Windows Host（本插件）                          WSL 发行版
  RemoteConnection ── wsl.exe 标准输入输出 ───▶ launch.sh → $SHELL -ilc 'dsh --patch overlay.yml --profile web'
    mux 通道 0：JSON（hello、credentials/*） ◀──▶  agent.mjs（Cordis 插件，fd 3/4）
    mux 通道 n：中继的 TCP  ◀── 127.0.0.1:端口    ──▶ 127.0.0.1:<dsh web 端口>
```

- `lib/remote.js`：一个连接，负责部署、版本检查、启动、本机回环中继、应答凭据请求，以及带退避的自动重连。
- `server/launch.sh`：通过登录 Shell 找到 `dsh`，并把管道移到 fd 3/4，dsh 自己的 stdout 不会碰到它。
- `server/agent.mjs`：不需要任何 import 的 Cordis 插件，通过 `dsh --patch` 加载，只有被 Windows Host 启动时才会运行。
- `lib/mux.js`：带流量窗口的多路复用器，两边共用。

WSL 一侧不打开任何非回环端口，中继只监听 Windows 本机回环地址，WSL dsh 仍然要求它自己的启动令牌和 Cookie。

## 从 2.x 迁移

2.x 是启动时生效的「运行环境」模式，会把本机 Host 的执行组件换成 WSL 的。3.0 首次启动时会把 `wsl-remote.json` 改写为新格式，Windows 的执行组件随之恢复，这与 Codex 迁移后把 `runCodexInWsl` 改回 false 的做法相同。2.x 期间创建的会话仍保留在 Windows 的会话列表中。

## 限制

- WSL 连接是一个独立的 dsh，有自己的界面。它的会话不会出现在 Windows 的会话列表里，这与 Codex 中独立主机的表现一致。
- 右侧边栏浏览器是受沙箱限制的 iframe 或 webview。如果 WSL 界面需要它不提供的能力，请改用**在浏览器打开**。
- 面向模型的工具在会话所在的一侧运行。Windows 会话不能通过本插件在 WSL 中执行命令。

## 开发

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
$dsh = 'D:\dsh\DeepSeek Harness.exe'
& $dsh test/unit.mjs                                           # 协议、迁移、共享凭据的加锁行为
$env:WSL_DISTRO = 'Ubuntu-26.04'
& $dsh --import ./test/stub-cordis.mjs test/remote.mjs        # 真实 WSL：部署、启动、中继、共享读取
```

每当 `server/` 或 `lib/mux.js` 发生变化时，请递增 `lib/remote.js` 中的 `AGENT_VERSION`，以便各发行版获取新的 agent。
