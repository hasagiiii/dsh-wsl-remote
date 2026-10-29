# @local/dsh-wsl-remote

[English](README.md) | 简体中文

让 Agent 的命令、文件编辑和搜索在 WSL 中执行，而 DeepSeek Harness 本身仍留在 Windows 上——与 VS Code Remote - WSL 的分工方式相同。

| 留在 Windows | 在 WSL 中运行（WSL 模式下） |
|---|---|
| 桌面界面、模型调用、凭据 | 命令工具（`bash`，即你选择的 Linux Shell） |
| 会话日志、审批、权限 | `read` / `write` / `edit`、`glob` / `grep` |
| 插件、设置、Agent 预设 | Workflow / PTC 工作进程、文件效果沙箱（bubblewrap） |

## 使用

设置 → 通用：

1. **运行环境** —— `本机 Windows` 或 `WSL · <发行版>`。选择发行版时会先准备其 Linux 运行时（`~/.dsh-wsl-remote/server/<version>`，执行一次 `npm install`），然后保存选择并提示你**重启 DeepSeek Harness**。运行环境在应用启动时确定，对整个应用生效；重启后的所有会话都会使用它。
2. **默认 Shell** —— 该发行版 `/etc/shells` 中的任意 Shell（默认 `bash`）。同样在重启后生效。

Agent 预设不会被修改。在 WSL 模式下，每个 Agent 都会获得 Linux `bash` 工具，其 `pwsh` 工具则被隐藏。

发行版内的要求：WSL 2、登录 PATH 中可用的 Node.js 22+（支持 nvm），以及用于受限权限模式的 `bwrap`。

## 工作原理

- `cordis.patch.yml`（由 `scripts/build-patch.mjs` 根据 `patch.template.yml` 生成）—— 启动时，每一行的 `!!js` 条件会读取一次 `<DSH home>/wsl-remote.json`；在 WSL 模式下，Windows 的 `subprocess`、`sandbox`、`pwsh-sandbox` 和 `fs-sandbox` 行停用，由 WSL 行提供相同的 Host 服务。
- `lib/connection.js` —— 通过 `wsl.exe` 的标准输入输出（而非 OpenSSH）实现 `ctx.ssh` 契约；首次使用时启动，下次使用时自动重连，空闲 15 分钟后关闭。
- `lib/vendor/*` —— DeepSeek Harness 自带的 `dsh-fs-ssh`、`dsh-subprocess-ssh`、`dsh-sandbox-ssh` 提供者（0.2.1-rc.3，MIT），除导入路径外未作修改。
- `server/helper/*` —— 来自 `@deepseek-ai/dsh-ssh` 的 DeepSeek Harness POSIX 执行辅助程序（未修改）；`server/ptc/process.js` —— `dsh-ptc-runtime-node` 工作进程；`server/bridge.mjs` 一次性解析登录 Shell 环境，启动辅助程序，在本地对其 TLS-PSK 流套接字进行认证，并将所有流量复用到同一条管道上。不监听任何网络端口。
- `lib/providers.js` —— 将 Windows 写法（`\\wsl.localhost\<distro>\…`、`C:\…`、打包的 `rg.exe`）转换为对应的 Linux 写法。

## 限制

- 在 WSL 模式下，交互式终端标签页和右侧边栏的文件视图也使用 WSL 提供者；其中不支持文件监视（与 DSH 的 SSH 提供者相同），因此视图按需刷新。
- WSL 连接断开时，其承载的操作会失败，且不会重放。下一次操作会自动重连。
- 固定适配 DeepSeek Harness 0.2.1-rc.3（`engines.dsh`）；DSH 升级时需要同步更新内置的提供者。

## 安装

```text
git clone https://github.com/hasagiiii/dsh-wsl-remote.git
```

将克隆下来的目录作为 bundle 安装到你的 DeepSeek Harness 配置中（例如让 Agent 执行 `plugin_manager install_bundle <绝对路径>` 进行安装），然后打开 设置 → 通用。

如需在不使用界面的情况下切换回 Windows，删除 `%USERPROFILE%\.dsh\wsl-remote.json`（或 `$DSH_HOME\wsl-remote.json`）后重启即可。

## 开发

`cordis.patch.yml` 是生成文件；请修改 `patch.template.yml` 或 `lib/boot.js`，然后运行：

```text
node scripts/build-patch.mjs
```

测试使用 DeepSeek Harness 的 Electron 可执行文件作为 Node 运行，以便插件解析已安装的 DSH 包（`DSH_ROOT` 可覆盖默认路径 `D:/ds_harness/resources/app.asar/dsh`）。`WSL_DISTRO` 用于选择发行版（默认 `Ubuntu`）。

```powershell
node test/boot.mjs                       # 启动时的环境选择，无需 WSL
$env:ELECTRON_RUN_AS_NODE = '1'
$dsh = 'D:\ds_harness\DeepSeek Harness.exe'
& $dsh --import ./test/resolve-dsh.mjs test/deploy.mjs   # 部署 Linux 运行时
& $dsh --import ./test/resolve-dsh.mjs test/shell.mjs    # Shell、沙箱模式、PTC、默认 Shell
& $dsh --import ./test/resolve-dsh.mjs test/e2e.mjs      # 文件、沙箱、ripgrep、PTY
```

每当 `server/` 或 `lib/mux.js` 下的任何内容发生变化时，请递增 `lib/deploy.js` 中的 `SERVER_VERSION`，以便各发行版获取新的运行时。
