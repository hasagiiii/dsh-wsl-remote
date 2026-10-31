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

选好的文件夹会注册为 **WSL 里那个 dsh 的工作区**（它出现在 WSL dsh 自己的界面里，也出现在 Windows 窗口里）。它在任何地方（包括 Windows 窗口）都保持 Linux 路径（例如 `/home/me/repo`），名字右侧有 **WSL · <系统版本>** 标记（例如 `WSL · Ubuntu 26.04`），圆点颜色表示连接状态。WSL dsh 里原有的工作区和会话也会一并显示。

之前版本添加的 `\\wsl.localhost\…` 工作区会与 WSL 里同一文件夹的工作区合并成一行，并显示为 Linux 路径；之后新建的会话都在 WSL 的 dsh 里运行，以前在 Windows 上运行过的旧会话仍然留在原处。

### 插件：哪边装了什么

WSL 会话的 Agent（工具、技能、MCP 服务、模型提供方）用的是 WSL dsh 里装的插件；这个窗口的界面和它自己的插件管理页始终是 Windows 的。在 设置 → 通用设置 里，已连接发行版旁边的 **WSL 插件** 会列出那个 dsh 的插件，并逐个标注：

- **仅 WSL**：WSL 会话有，Windows 会话没有；
- **Windows 为 x.y.z**：两边都装了，但版本不同；
- **Windows 也已安装**：两边都装了，版本相同。

下面的 **仅装在 Windows 的插件** 列出 WSL 会话没有的插件。在这个面板里可以启用、停用、卸载 WSL 的插件，按包名或安装地址安装，也可以把仅 Windows 的插件 **装到 WSL**（从 Windows 文件夹链接安装的插件，会通过 `/mnt/<盘符>/…` 链接到同一份文件）。这些操作都由 WSL dsh 自己的插件管理器执行；需要重启才能生效时，面板会提供"重启 WSL 中的 dsh"。**在 WSL dsh 自己的界面中管理** 会打开它完整的插件页面。

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
  └─ 会话列表、搜索、工作区、会话控制流、事件流：多台主机合并
  Web 服务器 ── WSL 会话的插件路由（如 /sidebar/*）→ WSL dsh 里的同一个插件
```

### 调用属于哪台主机

Codex 的窗口在每个请求里都带 `hostId`。DeepSeek Harness 的客户端没有这个字段：它只连一个 Host，用 ID 指代会话、Agent 和工作区。所以合并层按下面的顺序，从这些 ID 推断每个调用的归属：

1. **调用指明了工作区**（`session/create`，以及带 `workspaceId`、不带 `sessionId` 的其他 `workspace/*` 调用，如重命名、删除）。合并层用各主机的 `workspace/follow` 流拼出一张工作区表，每一行都记着来自哪台主机（`owners`：合并后的 ID → `{ 主机, 该主机上的 ID }`）。调用发给那台主机，ID 换成它自己的。
2. **调用要新建工作区**（`workspace/create`）。WSL 文件夹选择器传来的 `\\wsl.localhost\<发行版>\<路径>` 只当作地址：从中读出发行版，再用 Linux 路径在那个发行版的 dsh 里创建。其他路径都是 Windows 文件夹。
3. **调用指明了会话、Agent 或子会话**。从调用参数里读取 ID：`agentId`、`workspaceFileScopeId`、`sessionId`、`parentSessionId`、`childSessionId`、`rootSessionId`，`request` 里的同名字段，以及 `request.address`。第一个能查到归属的 ID 决定主机。归属来自：
   - 各主机的会话列表（`session/list` 会合并所有主机的列表，每一行都记下来源）；
   - 各主机工作区行里的 `sessionIds`；
   - 各发行版的 `session/control` 投影和 `$events` 事件（`api-session/added`、状态、活动）；
   - `session/create` 和 `session/fork` 的返回结果，在返回的当下就记下。
4. **ID 还不认识**（在别处新建、尚未出现在列表里的会话）：先问 Windows（它的活动会话，再查它保存的会话记录），再依次用 `session/projections` 问每个已连接的发行版。第一个认识这个 ID 的主机就是归属，结果会记下来。
5. **调用不指向任何主机**（`session/list`、`session/search`、窗口的模型目录、设置、插件管理、账号）：发给 Windows；其中的集合类调用会再与各发行版的结果合并。

插件的 HTTP 路由和 WebSocket 用同样的规则，从请求里找 ID：`?sessionId=` 等查询参数、本身就是会话 ID 的路径段（`/sidebar/html/<会话 ID>/…`），或 JSON 请求体里的 ID 字段。单独的 Linux 路径（Markdown 文件链接、`/api/file?path=`）交给包含它的 WSL 工作区所在的发行版（取最深的那个），否则交给唯一已连接的发行版。

结果都会缓存，每个 ID 只解析一次。发行版返回的工作区和会话会立即记入合并层，不等它的 follow 流再推一遍：窗口添加 WSL 工作区后会紧接着在里面新建会话。

- **调用路由**：见上一节。调用原样交给它的主机，只替换合并后的工作区 ID 和选择器传来的 `\\wsl.localhost` 地址。
- **路径**：WSL 的工作区、会话目录和历史快照头在 Windows 窗口里保持 Linux 路径；属于哪个发行版由工作区或会话决定，不靠路径判断。只有「在应用中打开」会把 Linux 路径转成 `\\wsl.localhost\<发行版>\…`，因为那是由 Windows 打开文件。
- **合并的流**：`workspace/follow` 每次变化都下发完整的合并状态（`replace` 帧）；`session/control` 在开场基线里带上各发行版的投影，之后转发各主机的增量；`$events` 转发 WSL 会话的事件（会话状态、活动、提问、授权确认等），并把 Windows 窗口对提问和确认的回答送回对应的 WSL dsh。
- **文件、终端、git**：DSH 自带的文件预览（`workspaceFiles/*`）、终端（`terminal/*`）、后台任务、目标和文件上传都带着会话 ID，所以和 Codex 的 `fs/*`、`command/exec` 一样在 WSL 里执行。插件路由也是如此：两边都装了的插件（例如 dsh-better-sidebar 的文件树、编辑器、git 视图和终端，路径为 `/sidebar/*`），WSL 会话的请求由 WSL 里的同一个插件处理。精确路由（会话日志导出、原始上传、`/api/file`、变更对比）按 `sessionId` 或路径转发。
- **模型**：窗口的模型目录是 Windows 的。WSL 会话的模型选择器使用该发行版自己的模型目录，所以只列出、默认选中并校验 WSL dsh 能路由的模型；Windows 会话只列出 Windows 的模型。
- **退出清理**：WSL 里的 dsh 以独立进程组组长的身份启动，并上报 PID 和启动时间。连接结束时整组一起结束（先 TERM 再 KILL），之前先核对启动时间，绝不会误杀复用了该 PID 的进程，所以工具、MCP 服务和终端不会残留。
- **认证**：使用 WSL dsh 文档化的 API 接入方式：`GET /connect?token=<启动令牌>&interactions=answer` 换取签名的 API Cookie，之后 HTTP 和 mux WebSocket 都带这个 Cookie。WSL 一侧不打开任何非回环端口。

### 源码

- `index.js`：Host 插件，负责发现、连接、设置路由、文件夹选择器，以及安装合并层。
- `lib/bridge/bridge.js`：合并层，包括归属判断、路由、合并流和对 Gateway / Fetch 路由的包装。
- `lib/bridge/routes.js`：WSL 会话的插件 HTTP 路由和 WebSocket，交给 WSL dsh 处理。
- `lib/bridge/merge.js`：纯函数部分，包括从调用和请求中提取 ID、工作区合并、判断 Linux 路径属于哪个发行版。
- `lib/bridge/host-client.js`：用 DeepSeek Harness 官方客户端包组装的 WSL dsh 客户端。
- `lib/remote.js`：一个远程连接，负责部署、版本检查、启动、本机回环中继、应答凭据请求，以及带退避的自动重连。
- `server/launch.sh`、`server/agent.mjs`：通过登录 Shell 启动 `dsh`；agent 是通过 `dsh --patch` 加载的 Cordis 插件，只在被 Windows Host 启动时运行。
- `server/dsh-harness.sh`、`lib/requests.js`：`dsh-harness` 命令。
- `lib/linux-fs.js`：WSL 文件夹选择器，以及从 `\\wsl.localhost` 路径中读出发行版和 Linux 路径。

## 限制

- WSL 的 dsh 必须与 Windows 上的 DeepSeek Harness 是同一版本：合并的会话使用 Windows 端的 Remote API。
- 合并层包装的是 DeepSeek Harness 内部的 Gateway 分发入口（`dispatchRpc`、`openWireStream`）、Connection 的精确路由表、Web 服务器的路由表和模型选择器的会话目录，DSH 升级后可能需要同步更新（`engines.dsh`）。归属是从 ID 推断的（见上文），不像 Codex 那样由窗口通过 `hostId` 声明。
- 发行版断开时，它的会话仍显示在列表里（最后一次的状态），打开时会自动重连。正在进行的流会中断，DSH 客户端会照常重连。
- 只合并与会话相关的事件。WSL dsh 的设置和账号页面不会出现在 Windows 窗口里；它的插件可以在上面的 WSL 插件面板里管理，或者在它自己的界面里管理。
- 已知问题：从面板安装插件可能卡住。WSL dsh 的插件管理器已经写好依赖（pnpm 日志以 `Done` 结束），但它启动的 pnpm 进程不退出，安装会一直等到插件管理器 10 分钟的空闲超时把它结束并还原配置。同样的 `pnpm add` 在 WSL 终端里运行会立即退出。在解决之前，请在 WSL dsh 自己的界面里安装，或在 WSL 中运行 `dsh plugin --profile web add <安装地址>`；列出、启用、停用和卸载不受影响。
- 插件的侧边栏要在 WSL 会话里可用，WSL 的 dsh 里也必须装同一个插件，否则它的 WSL 请求会失败。不指向任何会话的插件路由（共享资源、全局设置）始终由 Windows 处理。
- 「在应用中打开」通过 `\\wsl.localhost`（9P）在 Windows 上打开 WSL 文件。
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
# WSL 会话的插件路由、发行版自己的模型目录、断开时的进程组清理
& $dsh --expose-internals --import ./test/resolve-boot.mjs test/boot-wsl-session.mjs "$h\profiles\desktop" Ubuntu-26.04
# 列出发行版的插件并与 Windows 对比；通过面板的接口停用再启用一个
& $dsh --expose-internals --import ./test/resolve-boot.mjs test/boot-wsl-plugins.mjs "$h\profiles\desktop" Ubuntu-26.04 dsh-vscode-mode
# 保持组合运行并开放网页界面，便于在浏览器里操作真实客户端
& $dsh --expose-internals --import ./test/resolve-boot.mjs test/serve-desktop.mjs "$h\profiles\desktop" Ubuntu-26.04
# 再对开启了 --remote-debugging-port=9333 的无头 Chrome 执行操作步骤
& $dsh test/cdp.mjs 9333 <steps.mjs>
```

`server/agent.mjs`、`server/launch.sh`、`server/dsh-harness.sh` 或 `lib/mux.js` 变化时，请递增 `lib/remote.js` 中的 `AGENT_VERSION`。
