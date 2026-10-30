# @local/dsh-wsl-remote

[English](README.md) | 简体中文

让 DeepSeek Harness 像 Codex 桌面版一样使用 WSL。**只需在 Windows 上安装一次。** 每个 WSL 发行版都是一台远程主机，运行你自己用 `npm i -g @deepseek-ai/dsh` 装好的 `dsh`；它的工作区和会话直接合并到 Windows 的窗口里。

- **WSL 工作区**：添加工作区时选「WSL」，从 Linux 文件系统里挑一个文件夹。这个工作区的会话在 WSL 里你自己的 `dsh` 中运行：用 WSL 的 `~/.dsh` 配置、模型和插件，命令、文件读写和搜索都在 Linux 里执行，并使用你在 WSL 里配置的沙箱。会话列表、聊天视图、历史、实时输出、提问和授权确认都在 Windows 的同一个窗口里，和 Windows 会话并列。
- **在 WSL dsh 自己的界面里打开**：也可以通过本机回环中继，在侧边栏或浏览器里打开 WSL dsh 的原生界面。
- **共享登录状态**（可选）：WSL 的 dsh 直接使用 Windows 的凭据存储。
- **`dsh-harness` 命令**：在 WSL 终端里运行 `dsh-harness .`，把当前目录作为 WSL 工作区在 DeepSeek Harness 中打开，用法与 `code .` 相同。

| | Windows 工作区 | WSL 工作区 |
|---|---|---|
| 会话在哪个 dsh 里 | Windows 上的 DeepSeek Harness | WSL 里你自己的 `dsh` |
| 命令、文件、搜索在哪里执行 | Windows（PowerShell） | WSL |
| 模型、插件、Agent 配置 | Windows 的 `%USERPROFILE%\.dsh` | WSL 的 `~/.dsh` |
| 显示在哪里 | 同一个窗口、同一个会话列表 | 同一个窗口、同一个会话列表 |

## 安装

### 1. 在 WSL 里安装 dsh

发行版必须是 WSL 2（在 Windows 上运行 `wsl -l -v` 查看）。在 WSL 终端里：

```bash
npm i -g @deepseek-ai/dsh
bash -lc 'dsh --version'   # 必须与 Windows 上的 DeepSeek Harness 是同一版本（0.2.1-rc.5）
```

缺少 dsh 或版本过低时，设置页会列出可以复制的安装命令，见下文。

### 2. 在 Windows 上安装插件

在 PowerShell 中运行以下命令。`dsh` 命令随 DeepSeek Harness 桌面版一起安装。

```powershell
git clone https://github.com/hasagiiii/dsh-wsl-remote.git
cd dsh-wsl-remote
dsh plugin --profile desktop add .
```

`add .` 会把该目录链接到桌面版配置（`%USERPROFILE%\.dsh\profiles\desktop`），并把 `@local/dsh-wsl-remote` 加入它的 bundle 列表。运行前请至少打开过一次 DeepSeek Harness 桌面版，确保该配置已经存在。

pnpm 可能会警告：链接进来的包不会从配置目录解析 peer 依赖（`@deepseek-ai/cordis` 等）。这个警告可以忽略，DeepSeek Harness 加载插件时会提供这些包。不要按提示改用 `file:`：那样安装的是一份副本，之后 `git pull` 的更新不会生效。

**不要在 WSL 里的 dsh 中安装本插件。** 它只为 Windows 主机设计。

### 3. 启用

插件不替换 DeepSeek Harness 的任何内置组件，在插件管理里启用或停用后立即生效，不需要重启。

### 更新与卸载

```powershell
cd dsh-wsl-remote; git pull                                # 更新；插件是链接安装的，不需要再运行 add
dsh plugin --profile desktop remove @local/dsh-wsl-remote  # 卸载
```

WSL 中只会留下 `~/.dsh-wsl-remote` 和 `~/.local/bin/dsh-harness`，可以用 `rm -rf ~/.dsh-wsl-remote ~/.local/bin/dsh-harness` 清理。WSL 中的 `dsh` 及其 `~/.dsh` 属于你自己，不会被改动。

## 使用

### 连接发行版

打开 设置 → 通用 → **WSL 远程连接**，在 `WSL: <发行版>` 旁点**连接**。首次连接会把一个小型 agent 复制到 `~/.dsh-wsl-remote/agent/<版本>`，在登录 Shell 的 PATH 上检查 `dsh --version`（与 Codex 的版本检查相同），然后通过 `wsl.exe` 启动 `dsh --profile web`。已连接的发行版会在 DeepSeek Harness 启动时自动重连；打开一个尚未连接的发行版里的 WSL 会话时，也会自动连接。

### WSL 工作区

侧边栏的「添加工作区」和新会话页的「添加工作区…」会先询问类型：

- **本地**：打开 Windows 的文件夹对话框，与原来一样。
- **WSL**：选择发行版后打开一个基于 Linux 的文件夹选择器，从 Linux 主目录开始，可以输入路径（支持 `~`）、返回上一级、点面包屑跳转、显示隐藏文件夹、新建文件夹。

选好的文件夹会注册为 **WSL 里那个 dsh 的工作区**（它出现在 WSL dsh 自己的界面里，也出现在 Windows 窗口里）。在 Windows 窗口中，它的路径显示为 `\\wsl.localhost\<发行版>\<Linux 路径>`，名字右侧有 **WSL · <系统版本>** 标记（例如 `WSL · Ubuntu 26.04`），圆点颜色表示连接状态。WSL dsh 里原有的工作区和会话也会一并显示。

之前版本添加的 `\\wsl.localhost\…` 工作区会与 WSL 里同一文件夹的工作区合并成一行；之后新建的会话都在 WSL 的 dsh 里运行，以前在 Windows 上运行过的旧会话仍然留在原处。

### 共享登录状态

开启「共享登录状态」（默认开启）后，WSL dsh 内的 agent 会通过 `wsl.exe` 管道，把每一次凭据读写都交给 Windows 的凭据存储处理：API Key、DeepSeek 账号登录和其他插件的凭据记录。WSL 中的每次 `modifyRecord` 都在 Windows 凭据存储的 `modifyRecord` 内部执行，处于它的跨进程写锁之下，所以两边的令牌刷新不会互相覆盖或作废。只有 WSL dsh 签发自己浏览器 Cookie 的密钥（`client-connection/browser-session`）留在 WSL。关闭共享后，WSL dsh 使用自己的 `~/.dsh/.credentials.yaml`。

设置项「WSL 中的 dsh 配置」决定连接时启动哪个 profile（默认 `web`）。这两项设置对新连接生效。

### 缺少 dsh 时的安装指引

连接时插件会在发行版的登录 Shell 中检测 `dsh`、`node`、`npm` 和 nvm。没有找到 `dsh` 或版本低于 0.2.1-rc.5 时，连接会停下，并在该发行版下方列出需要在 WSL 终端里依次运行的命令，每条都可一键复制。装好后点**重试**即可。

### `dsh-harness`

连接发行版时，插件会安装 `~/.local/bin/dsh-harness`（不需要 sudo；如果同名文件不是本插件创建的，则不会覆盖）：

```bash
dsh-harness            # 把当前目录作为 WSL 工作区在 DeepSeek Harness 中打开
dsh-harness ~/proj     # 打开指定目录
dsh-harness --focus    # 只把 DeepSeek Harness 窗口切到前台
```

它通过 WSL 互操作启动 Windows 上的 DeepSeek Harness（已在运行则切到前台），并把目录交给插件。目录通过 `<DSH 主目录>\wsl-remote\requests` 中的请求文件传递，WSL 一侧不打开任何端口。

## 工作原理

```text
Windows 窗口（浏览器端，原样不改）
  │  /api（HTTP）、/api/remote.mux（WebSocket）
  ▼
Windows DeepSeek Harness Host
  Gateway ── 本插件的合并层（lib/bridge）
  │   ├─ Windows 会话、Windows 工作区 → 原样交给 Windows 的服务
  │   └─ WSL 会话、WSL 工作区 → DeepSeek Harness 官方客户端包
  │        （dsh-client-connection、dsh-api-gateway/client、dsh-typert-registry）
  │          └─ Windows 本机回环中继 ⇄ wsl.exe 标准输入输出 ⇄ WSL 里你的 dsh
  └─ 会话列表、搜索、模型目录、工作区、会话控制流、事件流：多台主机合并
```

- **调用路由**：每次 Remote 调用都带着它的会话、Agent 或工作区标识。合并层记下每个会话属于哪台主机（来自各主机的会话列表、工作区和事件），把调用原样交给那台主机；未知的标识依次问 Windows 和已连接的发行版。`session/create` 和 `workspace/create` 按工作区或路径（`\\wsl.localhost\<发行版>\…`）决定主机。
- **路径**：WSL 返回的 Linux 路径（会话目录、工作区路径、历史快照头）在 Windows 窗口里显示为 `\\wsl.localhost\<发行版>\…`，发回 WSL 前再转回 Linux 路径。
- **合并的流**：`workspace/follow` 每次变化都下发完整的合并状态（`replace` 帧）；`session/control` 在开场基线里带上各发行版的投影，之后转发各主机的增量；`$events` 转发 WSL 会话的事件（会话状态、活动、提问、授权确认等），并把 Windows 窗口对提问和确认的回答送回对应的 WSL dsh。
- **精确路由**：会话日志导出、原始文件上传、`/api/file`、变更对比等按 `sessionId` 或路径转发。
- **认证**：使用 WSL dsh 文档化的 API 接入方式：`GET /connect?token=<启动令牌>&interactions=answer` 换取签名的 API Cookie，之后 HTTP 和 mux WebSocket 都带这个 Cookie。WSL 一侧不打开任何非回环端口。

### 源码

- `index.js`：Host 插件，负责发现、连接、设置路由、文件夹选择器，以及安装合并层。
- `lib/bridge/bridge.js`：合并层，包括路由、合并流和对 Gateway / Fetch 路由的包装。
- `lib/bridge/merge.js`：纯函数部分，包括会话标识提取、工作区合并、路径转换和模型目录合并。
- `lib/bridge/host-client.js`：用 DeepSeek Harness 官方客户端包组装的 WSL dsh 客户端。
- `lib/remote.js`：一个远程连接，负责部署、版本检查、启动、本机回环中继、应答凭据请求，以及带退避的自动重连。
- `server/launch.sh`、`server/agent.mjs`：通过登录 Shell 启动 `dsh`；agent 是通过 `dsh --patch` 加载的 Cordis 插件，只在被 Windows Host 启动时运行。
- `server/dsh-harness.sh`、`lib/requests.js`：`dsh-harness` 命令。
- `lib/linux-fs.js`：WSL 文件夹选择器，以及 Linux 路径与 `\\wsl.localhost` 路径的转换。

## 限制

- WSL 的 dsh 必须与 Windows 上的 DeepSeek Harness 是同一版本：合并的会话使用 Windows 端的 Remote API。
- 合并层包装的是 DeepSeek Harness 内部的 Gateway 分发入口（`dispatchRpc`、`openWireStream`）和 Connection 的精确路由表，DSH 升级后可能需要同步更新（`engines.dsh`）。
- 发行版断开时，它的会话仍显示在列表里（最后一次的状态），打开时会自动重连。正在进行的流会中断，DSH 客户端会照常重连。
- 只合并与会话相关的事件。WSL dsh 的设置、插件管理和账号页面不会出现在 Windows 窗口里，需要时请在 WSL dsh 自己的界面里打开。
- 模型目录合并了两边的提供方，默认模型仍是 Windows 的。WSL 会话使用 WSL dsh 能路由的模型，在会话里切到只有 Windows 才有的模型会被 WSL 拒绝。
- Windows 侧的「在应用中打开」、右侧边栏文件视图等直接访问 Windows 文件系统的功能，对 WSL 路径走 `\\wsl.localhost` 的 9P 访问。
- 工作区行没有供插件使用的扩展位，WSL 标记是插入到侧边栏页面中的；DSH 调整侧边栏结构后可能需要更新插件。

## 开发

测试使用 DeepSeek Harness 的 Electron 可执行文件作为 Node 运行，以便解析已安装的 DSH 包（`DSH_ROOT` 可覆盖默认路径 `D:/ds_harness/resources/app.asar/dsh`）。

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
$dsh = 'D:\ds_harness\DeepSeek Harness.exe'
& $dsh --import ./test/resolve-dsh.mjs test/unit.mjs           # 合并、路径、安装指引、协议、迁移、共享凭据加锁
& $dsh --import ./test/stub-cordis.mjs test/smoke-host.mjs     # Host 插件路由与 WSL 文件夹列表
$env:WSL_DISTRO = 'Ubuntu-26.04'
& $dsh --import ./test/stub-cordis.mjs test/remote.mjs         # 真实 WSL：远程连接的部署、启动、中继
```

启动演练：在临时 DSH 主目录中按桌面版的方式启动真实的组合，连接发行版，经 Windows Gateway 创建 Windows 会话和 WSL 会话、向 WSL 会话发送提示并读取历史、实时输出和事件，不影响正在运行的应用：

```powershell
$h = "$env:TEMP\wslr-boot-home"; New-Item -ItemType Directory -Force "$h\profiles\desktop" | Out-Null
$p = "$env:USERPROFILE\.dsh\profiles\desktop"
Copy-Item "$p\package.json","$p\cordis.yml","$p\cordis.patch.yml","$p\pnpm-workspace.yaml" "$h\profiles\desktop"
New-Item -ItemType Junction -Path "$h\profiles\desktop\node_modules" -Target "$p\node_modules" | Out-Null
$env:DSH_HOME = $h; $env:DSH_TELEMETRY_DISABLED = '1'; $env:DSH_CLIENT_VERSION = '0.2.1-rc.5'
& $dsh --expose-internals --import ./test/resolve-boot.mjs test/boot-desktop.mjs "$h\profiles\desktop" (Get-Location).Path Ubuntu-26.04
```

`server/agent.mjs`、`server/launch.sh`、`server/dsh-harness.sh` 或 `lib/mux.js` 变化时，请递增 `lib/remote.js` 中的 `AGENT_VERSION`。
