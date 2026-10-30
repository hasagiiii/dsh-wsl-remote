# @local/dsh-wsl-remote

[English](README.md) | 简体中文

让 DeepSeek Harness 像 Codex 桌面版一样使用 WSL。**只需在 Windows 上安装一次**，WSL 里需要的东西由插件自动部署。

- **WSL 工作区**：添加工作区时选择「WSL」，从 Linux 文件系统里挑一个文件夹。这个工作区里的会话，命令（bash）、文件读写编辑、搜索都在该发行版的 Linux 中执行，使用 Linux 路径和 bubblewrap 沙箱；其他工作区照常在 Windows 上执行。两种会话可以同时进行，不需要切换模式。
- **WSL 远程连接**：在 WSL 中启动你自己安装的 `dsh`，使用 WSL 自己的 `~/.dsh` 配置、会话和插件，界面显示在侧边栏或浏览器里；可与 Windows 共享登录状态。
- **`dsh-harness` 命令**：在 WSL 终端里运行 `dsh-harness .`，把当前目录作为 WSL 工作区在 DeepSeek Harness 中打开，用法与 `code .` 相同。

| | Windows 工作区 | WSL 工作区 | WSL 远程连接 |
|---|---|---|---|
| 会话在哪个 dsh 里 | Windows 上的 DeepSeek Harness | Windows 上的 DeepSeek Harness | WSL 里你自己的 `dsh` |
| 命令、文件、搜索在哪里执行 | Windows（PowerShell） | WSL（bash + bubblewrap） | WSL |
| 模型、插件、会话列表 | Windows 这一套 | Windows 这一套 | WSL 的 `~/.dsh` |
| 发行版里需要什么 | — | Node.js 22+ | `dsh` 0.2.1-rc.2+ |

## 安装

### 1. 准备 WSL 发行版

发行版必须是 WSL 2（在 Windows 上运行 `wsl -l -v` 查看）。

- **WSL 工作区**只需要 Node.js 22 或更高版本（支持 nvm）。沙箱需要 `bwrap`（bubblewrap），没有的话用 `sudo apt install bubblewrap` 安装。
- **WSL 远程连接**还需要 `dsh`：

```bash
npm i -g @deepseek-ai/dsh
bash -lc 'dsh --version'   # 需要 0.2.1-rc.2 或更高版本；登录 Shell 不是 bash 时换成你自己的
```

缺少这些时插件会在设置页给出可以复制的安装命令，见下文。

### 2. 在 Windows 上安装插件

在 PowerShell 中运行以下命令。`dsh` 命令随 DeepSeek Harness 桌面版一起安装。

```powershell
git clone https://github.com/hasagiiii/dsh-wsl-remote.git
cd dsh-wsl-remote
dsh plugin --profile desktop add .
```

`add .` 会把该目录链接到桌面版配置（`%USERPROFILE%\.dsh\profiles\desktop`），并把 `@local/dsh-wsl-remote` 加入它的 bundle 列表。运行前请至少打开过一次 DeepSeek Harness 桌面版，确保该配置已经存在。

pnpm 可能会警告：链接进来的包不会从配置目录解析 peer 依赖（`@deepseek-ai/cordis` 等）。这个警告可以忽略，DeepSeek Harness 加载插件时会提供这些包。不要按提示改用 `file:`：那样安装的是一份副本，之后 `git pull` 的更新不会生效。

**不要在 WSL 里的 dsh 中安装本插件。** 它只为 Windows 主机设计；即使误装，执行相关的部分在非 Windows 系统上也会自动停用。

### 3. 重启 DeepSeek Harness

完全退出 DeepSeek Harness 后重新打开。

### 更新

```powershell
cd dsh-wsl-remote
git pull
```

然后重启 DeepSeek Harness。插件是链接安装的，不需要再运行 `add`。WSL 中的文件会在下次使用时按新版本自动重新部署。

### 卸载

```powershell
dsh plugin --profile desktop remove @local/dsh-wsl-remote
```

然后重启 DeepSeek Harness，Windows 原有的执行组件会恢复。如果还想清理各发行版里留下的文件，在发行版中运行 `rm -rf ~/.dsh-wsl-remote ~/.local/bin/dsh-harness`。WSL 中的 `dsh` 及其 `~/.dsh` 属于你自己，不会被改动。

## WSL 工作区

### 添加

侧边栏的「添加工作区」和新会话页的「添加工作区…」会先询问类型：

- **本地**：打开 Windows 的文件夹对话框，与原来一样。
- **WSL**：选择发行版后打开一个基于 Linux 的文件夹选择器，从 Linux 主目录开始，可以输入路径（支持 `~`）、返回上一级、点面包屑跳转、显示隐藏文件夹、新建文件夹。目录由 `wsl.exe` 在发行版内列出，看到的权限和符号链接与 Linux 用户一致。

也可以在 WSL 终端里用 `dsh-harness` 打开，见下文。

WSL 工作区在 DSH 中保存为 `\\wsl.localhost\<发行版>\<Linux 路径>`。侧边栏中它的名字右侧会显示 **WSL · <系统版本>** 标记（例如 `WSL · Ubuntu 26.04`，取自发行版的 `/etc/os-release`），圆点颜色表示该发行版的远程连接状态，悬停可看到发行版名和 Linux 路径。

### 在 WSL 工作区里的会话

会话在 Windows 上的 DeepSeek Harness 中运行，用的是 Windows 这边的模型、插件和会话列表；工具调用则在 WSL 中执行：

- **命令**：模型拿到的是 `bash` 工具（不再有 `pwsh`），命令在发行版里用你的登录 Shell 执行（`$SHELL -c`），工作目录是 Linux 路径，环境变量来自登录 Shell（nvm、`~/.profile`、`~/.zshrc` 都会生效）。
- **沙箱**：受限权限模式下由 bubblewrap 把写入限制在工作区和 `/tmp`；读写超出范围时会走 DSH 原有的提权确认流程。
- **文件读写编辑**：在 Linux 中执行，保留 DSH 的版本校验和读后才能改的规则。路径可以写 Linux 形式（`/home/me/x`）、相对路径或 `\\wsl.localhost\…` 形式，三者指向同一个文件；结果中显示 `\\wsl.localhost\…` 形式。
- **搜索**（grep/glob）：由发行版内的 ripgrep 执行。
- 模型会收到一段提示，说明本会话在哪个发行版（含系统版本）中执行，以及两种路径写法的对应关系。

第一次在某个发行版里执行时，插件会把 Linux 运行时部署到 `~/.dsh-wsl-remote/server/<版本>`（执行一次 `npm install`，需要能访问 npm 源），之后约 1 秒内即可连上，单次文件操作在 10 毫秒左右。连接空闲 15 分钟后自动关闭，下次使用时自动重连。如果发行版里没有 Node.js 22+，设置 → 通用 → **WSL 远程连接** 中该发行版下方会列出安装命令。

## WSL 远程连接

打开 设置 → 通用 → **WSL 远程连接**：

1. 在 `WSL: <发行版>` 旁点**连接**。首次连接会把一个小型 agent 复制到 `~/.dsh-wsl-remote/agent/<版本>`，在登录 PATH 上检查 `dsh --version`（与 Codex 的版本检查相同），然后通过 `wsl.exe` 启动 `dsh --profile web`。这个 agent 只在 Windows 启动 WSL dsh 时通过 `--patch` 临时加载，不改动 WSL 的 `~/.dsh` 配置。
2. 点**在侧边栏打开**或**在浏览器打开**。WSL 中 dsh 的界面通过 Windows 本机回环中继加载，地址为 `http://127.0.0.1:<端口>`。每个发行版的端口固定不变，所以重连后 WSL dsh 的浏览器 Cookie 仍然有效。
3. 已连接的发行版会在 DeepSeek Harness 启动时自动重连。点**断开**会停止 WSL 中的 dsh。

另外两项设置对新连接生效：

- **共享登录状态**（默认开启）：见下文。
- **WSL 中的 dsh 配置**：要启动的 profile（默认 `web`）。

WSL 中的 dsh 是独立的一套，Windows 上装的其他插件不会出现在那里；需要的话在 WSL 里用 `dsh plugin --profile web add …` 单独安装。

### 缺少 dsh 时的安装指引

连接时插件会在发行版的登录 Shell 中检测 `dsh`、`node`、`npm` 和 nvm。没有找到 `dsh` 或版本过低时，连接会停下（不再自动重试），并在该发行版下方列出需要在 WSL 终端里依次运行的命令，每条都可一键复制：

- 已有 Node.js：`npm install -g @deepseek-ai/dsh`
- 没有 Node.js 但有 nvm：先 `nvm install --lts`
- 两者都没有：先用官方脚本安装 nvm（装在主目录，无需 sudo），重新打开终端后再 `nvm install --lts`

装好后点**重试**即可。

### 共享登录状态

Codex 没有内置在 Windows 和 WSL 之间共享登录的办法，两边都要登录一次。这里可以共享，因为两边用的是同一个凭据接口（`ctx.credentials`）。

开启共享后，WSL dsh 内的 agent 会通过 `wsl.exe` 管道，把每一次凭据读写都交给 Windows 的凭据存储处理：

- API Key（`DEEPSEEK_API_KEY` 等）
- DeepSeek 账号登录（`deepseek-account-platform/*`）
- 其他插件的凭据记录

WSL 中的每次 `modifyRecord` 都在 Windows 凭据存储的 `modifyRecord` 内部执行，处于它的跨进程写锁之下。因此 WSL 里的令牌刷新和 Windows 上的刷新不会互相覆盖或作废，而复制凭据文件正是会出这个问题。在任意一边登录、退出或修改 Key，两边同时生效。Windows 上的变更事件会转发给 WSL。

只有一条记录 WSL dsh 自己保留：`client-connection/browser-session`，它是签发 WSL dsh 自身浏览器 Cookie 的密钥。关闭共享后，WSL dsh 使用自己的 `~/.dsh/.credentials.yaml`，需要在那里单独登录。

## 在 WSL 中打开 DeepSeek Harness：`dsh-harness`

连接发行版时，插件会安装 `~/.local/bin/dsh-harness`（不需要 sudo；如果同名文件不是本插件创建的，则不会覆盖）。像 `code .` 一样使用：

```bash
dsh-harness            # 把当前目录作为 WSL 工作区在 DeepSeek Harness 中打开
dsh-harness ~/proj     # 打开指定目录
dsh-harness --focus    # 只把 DeepSeek Harness 窗口切到前台
```

它通过 WSL 互操作启动 Windows 上的 DeepSeek Harness（已在运行则切到前台），并把目录交给插件：插件把它加为 WSL 工作区、开始新会话，如果该发行版尚未连接也会顺便连接。目录通过 `<DSH 主目录>\wsl-remote\requests` 中的请求文件传递，WSL 一侧不打开任何端口。需要在发行版中保持 Windows 互操作开启（`/etc/wsl.conf` 中不要设 `[interop] enabled=false`）。

## 工作原理

### WSL 工作区

DeepSeek Harness 每个组合只挂载一个 `ctx.subprocess` / `ctx.sandbox` / `ctx.fs` / `ctx.shell`。本插件在 Windows 上用**分发实现**替换这四个，但每次工具调用都带着会话的工作目录，分发层据此决定交给谁：

```text
工具调用（bash / read / write / edit / grep / glob）
  └─ 路径或工作目录是 \\wsl.localhost\<发行版>\… ？
       ├─ 否 → 原版 Windows 实现（dsh-subprocess-local、dsh-sandbox-local、dsh-fs-sandbox、dsh-pwsh-sandbox，配置不变）
       └─ 是 → 该发行版的 Linux 实现：
                 wsl.exe 标准输入输出 ⇄ server/exec/bridge.mjs ⇄ DeepSeek Harness 的 POSIX 执行辅助进程（bubblewrap 沙箱）
```

- `lib/exec/dispatch.js`：四个分发实现，以及在各自隔离域中挂载的 Windows / WSL 两套实现（`ctx.wslExec`）。
- `lib/exec/route.js`：按路径判断发行版。
- `lib/exec/connection.js`、`lib/exec/providers.js`、`lib/exec/vendor/*`：经 `wsl.exe` 连接发行版的 `ctx.ssh` 兼容层，以及 DeepSeek Harness 自带的 `dsh-fs-ssh`、`dsh-subprocess-ssh`、`dsh-sandbox-ssh`（MIT，除导入路径外未修改）加上 Windows/Linux 路径转换。
- `lib/exec/deploy.js`、`lib/exec/locator.js`：检测发行版并按版本部署 Linux 运行时。
- `lib/exec/agent-tools.js`：WSL 工作区的会话创建时，为该 Agent 挂上 `bash` 工具、隐藏 `pwsh`，并加上执行环境提示。
- `server/exec/*`：部署到发行版中的运行时（`@deepseek-ai/dsh-ssh` 的 POSIX 辅助进程，未修改，和桥接进程）。

### WSL 远程连接

```text
Windows Host（本插件）                          WSL 发行版
  RemoteConnection ── wsl.exe 标准输入输出 ───▶ launch.sh → $SHELL -ilc 'dsh --patch overlay.yml --profile web'
    mux 通道 0：JSON（hello、credentials/*） ◀──▶  agent.mjs（Cordis 插件，fd 3/4）
    mux 通道 n：中继的 TCP  ◀── 127.0.0.1:端口    ──▶ 127.0.0.1:<dsh web 端口>
```

- `lib/remote.js`：一个连接，负责部署、版本检查、启动、本机回环中继、应答凭据请求，以及带退避的自动重连。
- `server/launch.sh`：通过登录 Shell 找到 `dsh`，并把管道移到 fd 3/4，dsh 自己的 stdout 不会碰到它；`probe` 同时报告系统版本和安装指引所需的信息。
- `server/agent.mjs`：不需要任何 import 的 Cordis 插件，通过 `dsh --patch` 加载，只有被 Windows Host 启动时才会运行。
- `server/dsh-harness.sh`：部署为 WSL 中的 `dsh-harness` 命令；`lib/requests.js` 在 Windows 一侧接收它的请求。
- `lib/linux-fs.js`：WSL 文件夹选择器的目录列表、新建文件夹，以及 Linux 路径与 `\\wsl.localhost` 路径的转换。
- `lib/requirements.js`：根据检测结果生成安装指引。
- `lib/mux.js`：带流量窗口的多路复用器，两边共用。

WSL 一侧不打开任何非回环端口，中继只监听 Windows 本机回环地址，WSL dsh 仍然要求它自己的启动令牌和 Cookie。

## 限制

- WSL 工作区的会话只在工作区本身是 `\\wsl.localhost\…` 路径时切换到 bash；会话进行中用 `cd` 切到另一个环境的目录不会改变工具集（与 Codex 一样，项目绑定主机）。
- 程序化工具调用（PTC）和 workflow 的 Node 工作进程仍在 Windows 上运行；它们调用的工具会按上面的规则在 WSL 中执行。
- WSL 工作区里的文件不能被监视，右侧边栏的文件视图在 WSL 工作区中按需刷新。
- 与发行版的连接断开时，正在进行的操作会失败且不会重放，下一次操作自动重连。
- WSL 远程连接是一个独立的 dsh，有自己的界面。它的会话不会出现在 Windows 的会话列表里，这与 Codex 中独立主机的表现一致。
- 右侧边栏浏览器是受沙箱限制的 iframe 或 webview。如果 WSL 界面需要它不提供的能力，请改用**在浏览器打开**。
- 工作区行没有供插件使用的扩展位，WSL 标记是插入到侧边栏页面中的；DSH 调整侧边栏结构后可能需要更新插件。
- 内置的 SSH 组件对应 DeepSeek Harness 0.2.1（`engines.dsh`），DSH 升级后可能需要同步更新。

## 开发

测试使用 DeepSeek Harness 的 Electron 可执行文件作为 Node 运行，以便解析已安装的 DSH 包（`DSH_ROOT` 可覆盖默认路径 `D:/ds_harness/resources/app.asar/dsh`）。

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
$dsh = 'D:\ds_harness\DeepSeek Harness.exe'
& $dsh --import ./test/resolve-dsh.mjs test/unit.mjs           # 路由、路径、安装指引、协议、迁移、共享凭据加锁
& $dsh --import ./test/stub-cordis.mjs test/smoke-host.mjs     # Host 插件路由与 WSL 文件夹列表
& $dsh --import ./test/resolve-dsh.mjs test/agent-tools.mjs    # WSL 会话换成 bash、隐藏 pwsh
& $dsh --import ./test/resolve-dsh.mjs test/exec-e2e.mjs       # 真实 WSL：文件、沙箱、ripgrep、PTY
& $dsh --import ./test/resolve-dsh.mjs test/dispatch.mjs       # 同一组合中 Windows 与 WSL 按路径分发
$env:WSL_DISTRO = 'Ubuntu-26.04'
& $dsh --import ./test/stub-cordis.mjs test/remote.mjs         # 真实 WSL：远程连接的部署、启动、中继
```

启动演练：在临时 DSH 主目录中按桌面版的方式启动真实的组合，创建 Windows 和 WSL 工作区的会话并调用真实工具，不影响正在运行的应用：

```powershell
$h = "$env:TEMP\wslr-boot-home"; New-Item -ItemType Directory -Force "$h\profiles\desktop" | Out-Null
$p = "$env:USERPROFILE\.dsh\profiles\desktop"
Copy-Item "$p\package.json","$p\cordis.yml","$p\cordis.patch.yml","$p\pnpm-workspace.yaml" "$h\profiles\desktop"
New-Item -ItemType Junction -Path "$h\profiles\desktop\node_modules" -Target "$p\node_modules" | Out-Null
$env:DSH_HOME = $h; $env:DSH_TELEMETRY_DISABLED = '1'; $env:DSH_CLIENT_VERSION = '0.2.1-rc.5'
& $dsh --expose-internals --import ./test/resolve-boot.mjs test/boot-desktop.mjs "$h\profiles\desktop" (Get-Location).Path '\\wsl.localhost\Ubuntu-26.04\home\me\repo'
```

- `server/agent.mjs`、`server/launch.sh`、`server/dsh-harness.sh` 或 `lib/mux.js` 变化时，请递增 `lib/remote.js` 中的 `AGENT_VERSION`。
- `server/exec/` 或 `lib/mux.js` 变化时，请递增 `lib/exec/deploy.js` 中的 `SERVER_VERSION`。
