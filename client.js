window.__ModuleLoader__.load({
  id: '@local/dsh-wsl-remote',
  factory(require) {
    const React = require('react');
    const { createPortal } = require('react-dom');
    const h = React.createElement;
    const NS = 'localWslRemote';
    const POLL_MS = 3000;

    const dictionaries = {
      zh: {
        'models.host': '模型配置位置',
        'models.sync': '同步模型配置',
        'models.preview': '预览同步',
        'models.apply': '确认同步',
        'models.cancel': '取消',
        'models.refresh': '刷新模型',
        'models.busy': '处理中…',
        'models.direction': '同步方向',
        'models.toWsl': 'Windows → WSL',
        'models.toWindows': 'WSL → Windows',
        'models.hint': '点击供应商上的同步按钮，将它的配置同步到另一端。目标端缺少对应插件时可先安装。保留目标端独有项；可以勾选同时复制它的 API Key。',
        'models.copyKeys': '同时复制 API Key：',
        'models.keyUpdate': '目标端的值不同，将被覆盖',
        'models.doneKeys': '模型配置同步完成，已复制 API Key：{refs}。',
        'models.noConfigChanges': '配置已一致，只需复制 API Key。',
        'models.syncToWsl': '同步到 {kind}',
        'models.syncToWindows': '同步到 Windows',
        'models.installProvider': '安装供应商插件',
        'models.enableProvider': '启用供应商插件',
        'models.installHint': '目标端尚未安装此供应商的插件。安装后将预览配置差异，再确认同步。',
        'models.enableHint': '目标端已安装此插件，但尚未启用。启用后可预览配置差异。',
        'models.installStatus': '插件安装：',
        'models.installLog': '查看安装日志',
        'models.cancelInstall': '取消安装',
        'models.installFailed': '插件安装未完成，请查看安装日志。',
        'models.ownerMissing': '无法从插件清单中确认这个供应商所属的安装包。请检查来源端插件状态。',
        'models.ownerAmbiguous': '多个插件声明了这个供应商的设置，无法确定应安装哪一个。',
        'models.providerUnavailable': '供应商尚未可用。请确认插件已加载，并刷新模型列表。',
        'models.incompatible': '目标端的插件不兼容，请先在插件管理中处理版本问题。',
        'models.localPath': '此本地插件的路径无法在另一平台使用。请发布插件，或将其放在两端可访问的 Windows 目录中。',
        'models.sourceMissing': '未找到这个插件的安装来源，无法自动安装。',
        'models.pluginUnavailable': '无法读取或启用供应商插件，请检查两端连接和插件状态。',
        'models.installLost': '未找到安装任务，请刷新供应商状态。',
        'models.restartRequired': '插件已安装，需要按插件提示重新加载目标端后，再次点击供应商同步按钮。',
        'models.connectFirst': '连接所选远程主机后，即可管理和同步它的模型。',
        'models.noChanges': '没有需要同步的配置差异。',
        'models.missing': '目标端需要配置以下 API Key：',
        'models.done': '模型配置同步完成。',
        'models.partial': '同步未全部完成，已写入的配置已保留。请刷新预览后重试。',
        'models.changed': '将更新的配置',
        'title': 'WSL 远程连接',
        'description': '每个 WSL 发行版都是一台远程主机（与 Codex 相同）：连接后在 WSL 中启动你自己安装的 dsh，使用 WSL 的 ~/.dsh、模型、插件和原生 Linux 文件。它的工作区和会话直接显示在这个窗口里，与 Windows 会话并列，无需重启。',
        'loading': '正在检测 WSL…',
        'none': '未检测到可用的 WSL 2 发行版。',
        'discoveryError': '检测 WSL 发行版失败，正在自动重试：{message}',
        'notWindows': '仅在 Windows 上可用。',
        'default': '默认',
        'state.disconnected': '未连接',
        'state.connecting': '连接中…',
        'state.connected': '已连接',
        'state.error': '连接失败',
        'connect': '连接',
        'disconnect': '断开',
        'retry': '重试',
        'open': '在侧边栏打开',
        'openExternal': '在浏览器打开',
        'version': 'dsh {version}',
        'shared': '共享登录',
        'separate': '独立登录',
        'requirement': '需要在发行版中安装 dsh {version} 或更高版本：npm install -g @deepseek-ai/dsh',
        'share.title': '共享登录状态',
        'share.description': '开启后，WSL 中的 dsh 直接使用本机 Windows 的凭据存储：DeepSeek 账号登录、API Key 和令牌刷新只需在一处完成（刷新在 Windows 的文件锁下进行，不会互相作废）。关闭后两边各自登录。修改后对新连接生效。',
        'share.unavailable': '本机未启用凭据存储，无法共享。',
        'profile.title': 'WSL 中的 dsh 配置',
        'profile.description': '连接时启动的 dsh profile（位于 WSL 的 ~/.dsh/profiles）。修改后对新连接生效。',
        'reconnect': '已有连接仍使用旧设置，断开后重新连接即可生效。',
        'migrated': '旧的「运行环境」模式已停用：本机会话恢复为 Windows 执行，WSL 改为在下方单独连接。',
        'req.dsh-missing': '{distro} 中未找到 dsh。请在 WSL 终端中依次运行以下命令安装，然后点「重试」：',
        'req.dsh-outdated': '{distro} 中的 dsh {found} 低于所需的 {minimum}。请在 WSL 终端中运行以下命令更新，然后点「重试」：',
        'req.note.nvm': '安装 nvm（Node.js 版本管理器，装在主目录，无需 sudo）；装完后重新打开终端',
        'req.note.node': '安装 Node.js LTS',
        'req.note.node-after-nvm': '重新打开终端后，安装 Node.js LTS',
        'req.note.install': '安装 dsh',
        'req.note.update': '更新 dsh',
        'req.note.verify': '确认输出 {minimum} 或更高版本',
        'req.terminal': '打开 WSL 终端：在 Windows 中运行 wsl -d {distro}',
        'copy': '复制',
        'copied': '已复制',
        'launcher.ready': '在 WSL 中运行 dsh-harness [路径] 可在这里打开该目录（默认当前目录）。',
        'launcher.notOnPath': '已安装 {path}，但它不在登录 Shell 的 PATH 中；请把 ~/.local/bin 加入 PATH，或直接运行该路径。',
        'launcher.conflict': '{path} 已存在且不是本插件创建的，未覆盖；dsh-harness 命令不可用。',
        'launcher.error': '无法安装 dsh-harness 命令：{message}',
        'ws.title': '添加工作区',
        'ws.type': '工作区类型',
        'ws.local': '本地',
        'ws.localDesc': '在这台 Windows 电脑上选择文件夹',
        'ws.wsl': 'WSL',
        'ws.wslDesc': '在 WSL 发行版的 Linux 文件系统中选择文件夹',
        'ws.wslNone': '未检测到 WSL 2 发行版',
        'ws.distro': '发行版',
        'ws.next': '下一步',
        'ws.cancel': '取消',
        'ws.notConnected': '{distro} 尚未连接。添加后会自动连接，并在 WSL 中你自己的 dsh 里运行该工作区的会话。',
        'picker.title': '选择文件夹 · {distro}',
        'picker.up': '上一级',
        'picker.home': '主目录',
        'picker.path': '文件夹路径',
        'picker.go': '前往',
        'picker.loading': '正在加载…',
        'picker.empty': '此目录下没有文件夹。',
        'picker.truncated': '文件夹过多，仅显示前 {count} 个。',
        'picker.showHidden': '显示隐藏文件夹',
        'picker.newFolder': '新建文件夹',
        'picker.folderName': '新文件夹名称',
        'picker.create': '创建',
        'picker.open': '使用此文件夹',
        'picker.back': '返回',
        'picker.target': '将添加：{path}',
        'picker.absolute': '请输入以 / 开头的绝对路径',
        'badge.title': 'WSL 工作区 · {distro}（{os}）· {state}',
        'badge.titleNoOs': 'WSL 工作区 · {distro} · {state}',
        'open.done': '已从 WSL 打开：{path}',
        'plugins.toggle': 'WSL 插件',
        'plugins.connectFirst': '连接 {distro} 后可查看和管理它的插件。',
        'plugins.refresh': '刷新插件列表',
        'plugins.scope': '安装位置：{distro} · profile {profile}',
        'plugins.title': '{distro} 中的插件',
        'plugins.desc': 'WSL 会话的 Agent 侧（工具、技能、MCP、模型）用这里的插件；界面和这个窗口的插件管理页始终是 Windows 的。插件的侧边栏要在 WSL 会话里可用，两边都要装。',
        'plugins.loading': '正在读取 WSL 中的插件…',
        'plugins.empty': '没有安装插件。',
        'plugins.where.wsl': '仅 WSL',
        'plugins.where.both': 'Windows 也已安装',
        'plugins.where.both-differ': 'Windows 为 {version}',
        'plugins.where.windows': '仅 Windows',
        'plugins.windowsOnly': '仅装在 Windows 的插件（WSL 会话的 Agent 用不到；其侧边栏在 WSL 会话里不可用）：',
        'plugins.enable': '启用',
        'plugins.disable': '停用',
        'plugins.remove': '卸载',
        'plugins.installHere': '装到 WSL',
        'plugins.install': '安装',
        'plugins.spec': '包名或安装地址，例如 dsh-better-sidebar',
        'plugins.removeConfirm': '从 {distro} 卸载 {name}？',
        'plugins.restartNeeded': 'WSL 中的 dsh 需要重启才能应用这些更改。',
        'plugins.restart': '重启 WSL 中的 dsh',
        'plugins.applied': '已应用。',
        'plugins.failed': '操作失败：{message}',
        'plugins.disabled': '已停用',
        'plugins.openUi': '在 WSL dsh 自己的界面中管理',
        'plugins.installing': '安装 {spec}',
        'plugins.phase.starting': '启动中',
        'plugins.phase.installing': '下载安装中',
        'plugins.phase.applying': '应用中',
        'plugins.phase.cancelling': '取消中',
        'plugins.status.done': '已完成',
        'plugins.status.failed': '失败',
        'plugins.status.cancelled': '已取消',
        'plugins.cancel': '取消安装',
        'plugins.cancelling': '正在取消…',
        'plugins.close': '关闭',
        'plugins.stalled': 'pnpm 已经 {seconds} 秒没有输出，可能卡住了。可以取消安装（会还原配置）后重试，或改在 WSL dsh 自己的界面里安装。',
        'plugins.tooLate': '已进入应用阶段，无法取消，请等待完成。',
        'plugins.waitingOutput': '等待 pnpm 输出…',
        'plugins.installed': '已安装 {name}。',
        'plugins.cancelled': '已取消安装，WSL 的配置已还原。',
        'ssh.title': 'SSH 远程主机',
        'ssh.description': '用法与 WSL 相同：连接后在服务器上启动你自己安装的 dsh（npm i -g @deepseek-ai/dsh），它的工作区和会话显示在这个窗口里。通过 Windows 自带的 OpenSSH 连接，使用 ~/.ssh/config 和你的密钥；服务器无需开放额外端口。',
        'ssh.placeholder': 'user@host、host:端口 或 ~/.ssh/config 中的 Host',
        'ssh.add': '添加',
        'ssh.remove': '移除',
        'ssh.removeConfirm': '移除 SSH 主机 {dest}？已有会话仍保留在服务器上。',
        'ssh.fromConfig': '来自 ~/.ssh/config：',
        'ssh.none': '尚未添加 SSH 主机。',
        'ssh.hint.auth': 'SSH 认证失败。连接以非交互方式进行，不能输入密码：请配置密钥登录（ssh-copy-id，或把公钥加入服务器的 ~/.ssh/authorized_keys），必要时先运行 ssh-add。',
        'ssh.hint.host-key': '主机密钥未被信任或已变化。请先在 PowerShell 中运行 ssh {dest} 确认主机密钥，然后点「重试」。',
        'ssh.hint.network': '无法连接到服务器，请检查地址、端口和网络。',
        'req.terminalSsh': '在 Windows 终端中运行 ssh {dest} 登录服务器后执行以上命令',
        'ws.ssh': 'SSH',
        'ws.sshDesc': '在 SSH 远程主机上选择文件夹',
        'ws.sshNone': '请先在 设置 → 通用 中添加 SSH 主机',
        'ws.host': '主机',
        'ws.notConnectedSsh': '{distro} 尚未连接。添加后会自动连接，并在服务器上你自己的 dsh 里运行该工作区的会话。',
        'badge.titleSsh': 'SSH 工作区 · {distro}（{os}）· {state}',
        'badge.titleSshNoOs': 'SSH 工作区 · {distro} · {state}',
        'plugins.hostTab': '远程主机',
        'sync.title': '同步插件',
        'session.heldRemote': '这个会话正在 {host} 上的另一个 dsh 里打开着：{holder}。两边共用 {host} 的 ~/.dsh，同一时间只能有一个写入。请在那边关闭这个会话（或重启那个 dsh）后再发送；历史仍可在这里查看。',
        'session.heldUnknown': '另一个 dsh 进程',
        'sync.desc': '把一台主机上用户安装的插件装到另一台主机（版本与来源一致），用目标主机自己的插件管理器逐个安装。目标主机上多出来的插件不会被删除。',
        'sync.from': '从',
        'sync.to': '到',
        'sync.swap': '交换',
        'sync.load': '比较',
        'sync.loading': '正在比较两台主机的插件…',
        'sync.selectAll': '全选可同步项',
        'sync.oneTitle': '只同步 {name}',
        'sync.run': '同步所选（{count}）',
        'sync.cancel': '停止同步',
        'sync.close': '关闭',
        'sync.nothing': '没有需要同步的插件：两边已一致。',
        'sync.connectFirst': '两台主机都连接后才能同步插件。',
        'sync.same': '两边都要选，且不能是同一台主机。',
        'sync.targetOnly': '仅目标主机有（保留不动）：',
        'sync.state.missing': '目标缺少',
        'sync.state.differ': '目标为 {version}',
        'sync.state.disabled': '目标已安装但停用',
        'sync.state.same': '已一致',
        'sync.state.builtin': '目标内置',
        'sync.state.error': '目标加载出错：{reason}',
        'sync.state.unsupported': '无法自动同步',
        'sync.reason.local-path': '它从本地文件夹安装（{source}），目标主机访问不到这个路径。请发布到 npm / git，或放到两边都能访问的位置。',
        'sync.reason.source-missing': '来源主机没有记录它的安装来源。',
        'sync.reason.git-unpushed': '它从本地文件夹安装（{source}），目标主机访问不到这个路径；这个文件夹是 git 仓库，但当前提交还没有推送到任何远程分支。推送后重新比较即可从 git 安装。',
        'sync.reason.git-remote': '它从本地文件夹安装（{source}），目标主机访问不到这个路径；这个 git 仓库的远程地址不是目标主机能用的网络地址。',
        'sync.reason.git-subfolder': '它从本地文件夹安装（{source}），目标主机访问不到这个路径；这个文件夹位于某个 git 仓库的子目录中，无法直接从 git 安装。',
        'sync.git.from': '将从 git 安装：{remote} @ {commit}。',
        'sync.git.unpushed': '本地还有 {count} 个提交未推送，不包含在内。',
        'sync.git.dirty': '未提交的修改不包含在内。',
        'sync.action.install': '安装',
        'sync.action.update': '更新到 {version}',
        'sync.action.enable': '启用',
        'sync.item.pending': '等待',
        'sync.item.running': '进行中',
        'sync.item.done': '完成',
        'sync.item.failed': '失败',
        'sync.item.cancelled': '已取消',
        'sync.item.skipped': '已跳过',
        'sync.item.confirming': '确认安装结果…',
        'sync.done': '插件同步完成。',
        'sync.failed': '部分插件同步失败，详见上方。',
        'sync.restartRemote': '目标主机上的 dsh 需要重启才能加载这些插件。',
        'sync.restartWindows': '需要重启 DeepSeek Harness 才能加载这些插件。',
      },
      en: {
        'models.host': 'Model configuration host',
        'models.sync': 'Sync model configuration',
        'models.preview': 'Preview sync',
        'models.apply': 'Confirm sync',
        'models.cancel': 'Cancel',
        'models.refresh': 'Refresh models',
        'models.busy': 'Working…',
        'models.direction': 'Sync direction',
        'models.toWsl': 'Windows → WSL',
        'models.toWindows': 'WSL → Windows',
        'models.hint': 'Use each provider’s sync button to copy its configuration to the other host. Install its plugin first if needed. Target-only entries are preserved; you can choose to copy its API keys too.',
        'models.copyKeys': 'Also copy API keys:',
        'models.keyUpdate': 'the target has a different value, which will be replaced',
        'models.doneKeys': 'Model configuration synced; API keys copied: {refs}.',
        'models.noConfigChanges': 'The configuration already matches; only API keys need copying.',
        'models.syncToWsl': 'Sync to {kind}',
        'models.syncToWindows': 'Sync to Windows',
        'models.installProvider': 'Install provider plugin',
        'models.enableProvider': 'Enable provider plugin',
        'models.installHint': 'This provider’s plugin is missing on the target. Install it, then preview and confirm the configuration sync.',
        'models.enableHint': 'The target has this plugin installed but disabled. Enable it to preview the configuration sync.',
        'models.installStatus': 'Plugin installation:',
        'models.installLog': 'View installation log',
        'models.cancelInstall': 'Cancel installation',
        'models.installFailed': 'Plugin installation did not finish. Check the installation log.',
        'models.ownerMissing': 'The plugin inventory does not identify the bundle that owns this provider. Check the source plugin status.',
        'models.ownerAmbiguous': 'Multiple plugins declare these provider settings. The bundle to install cannot be determined.',
        'models.providerUnavailable': 'The provider is not available yet. Check that its plugin has loaded, then refresh the model list.',
        'models.incompatible': 'The target plugin is incompatible. Resolve its version issue in the plugin manager first.',
        'models.localPath': 'This local plugin path cannot be used on the other platform. Publish it or place it on a Windows drive accessible to both hosts.',
        'models.sourceMissing': 'No installation source was recorded for this plugin, so it cannot be installed automatically.',
        'models.pluginUnavailable': 'The provider plugin could not be read or enabled. Check both hosts’ connections and plugin status.',
        'models.installLost': 'Installation job not found. Refresh the provider status.',
        'models.restartRequired': 'The plugin is installed but needs the target to reload. Follow the plugin’s instructions, then sync this provider again.',
        'models.connectFirst': 'Connect the selected remote host to manage and sync its models.',
        'models.noChanges': 'No configuration differences to sync.',
        'models.missing': 'Configure these API keys on the target:',
        'models.done': 'Model configuration synced.',
        'models.partial': 'Sync did not finish. Completed writes were kept. Refresh the preview before retrying.',
        'models.changed': 'Configuration to update',
        'title': 'WSL remote connections',
        'description': 'Each WSL distribution is a remote host (as in Codex): connecting starts your own dsh inside WSL, with the WSL ~/.dsh, models, plugins and native Linux files. Its workspaces and sessions appear right in this window, beside the Windows ones. No restart needed.',
        'loading': 'Detecting WSL…',
        'none': 'No WSL 2 distribution found.',
        'discoveryError': 'Could not list WSL distributions; retrying automatically: {message}',
        'notWindows': 'Available on Windows only.',
        'default': 'default',
        'state.disconnected': 'Not connected',
        'state.connecting': 'Connecting…',
        'state.connected': 'Connected',
        'state.error': 'Connection failed',
        'connect': 'Connect',
        'disconnect': 'Disconnect',
        'retry': 'Retry',
        'open': 'Open in sidebar',
        'openExternal': 'Open in browser',
        'version': 'dsh {version}',
        'shared': 'shared sign-in',
        'separate': 'separate sign-in',
        'requirement': 'Requires dsh {version} or newer in the distribution: npm install -g @deepseek-ai/dsh',
        'share.title': 'Share sign-in',
        'share.description': 'When on, the dsh in WSL uses this Windows credential store directly: DeepSeek sign-in, API keys and token refreshes happen once (refreshes run under the Windows file lock, so neither side invalidates the other). When off, each side signs in on its own. Applies to new connections.',
        'share.unavailable': 'No credential store is mounted on this Host, so sign-in cannot be shared.',
        'profile.title': 'dsh profile in WSL',
        'profile.description': 'The dsh profile started on connect (under ~/.dsh/profiles in WSL). Applies to new connections.',
        'reconnect': 'Existing connections keep their settings until you disconnect and connect again.',
        'migrated': 'The old "execution environment" mode is retired: sessions here run on Windows again, and WSL connects separately below.',
        'req.dsh-missing': 'dsh was not found in {distro}. Run these commands in a WSL terminal, then select Retry:',
        'req.dsh-outdated': 'dsh {found} in {distro} is older than the required {minimum}. Run these commands in a WSL terminal, then select Retry:',
        'req.note.nvm': 'Install nvm (Node.js version manager; installs in your home directory, no sudo), then reopen the terminal',
        'req.note.node': 'Install Node.js LTS',
        'req.note.node-after-nvm': 'After reopening the terminal, install Node.js LTS',
        'req.note.install': 'Install dsh',
        'req.note.update': 'Update dsh',
        'req.note.verify': 'Check that it prints {minimum} or newer',
        'req.terminal': 'To open a WSL terminal, run wsl -d {distro} in Windows',
        'copy': 'Copy',
        'copied': 'Copied',
        'launcher.ready': 'Run dsh-harness [path] in WSL to open that directory here (default: the current directory).',
        'launcher.notOnPath': '{path} is installed but not on your login shell PATH; add ~/.local/bin to PATH or run it by its full path.',
        'launcher.conflict': '{path} already exists and was not created by this plugin, so it was left alone; the dsh-harness command is unavailable.',
        'launcher.error': 'Could not install the dsh-harness command: {message}',
        'ws.title': 'Add workspace',
        'ws.type': 'Workspace type',
        'ws.local': 'Local',
        'ws.localDesc': 'Choose a folder on this Windows PC',
        'ws.wsl': 'WSL',
        'ws.wslDesc': 'Choose a folder in the Linux file system of a WSL distribution',
        'ws.wslNone': 'No WSL 2 distribution found',
        'ws.distro': 'Distribution',
        'ws.next': 'Next',
        'ws.cancel': 'Cancel',
        'ws.notConnected': '{distro} is not connected. It connects when you add the folder; the workspace’s sessions run in your own dsh inside WSL.',
        'picker.title': 'Choose a folder · {distro}',
        'picker.up': 'Parent folder',
        'picker.home': 'Home',
        'picker.path': 'Folder path',
        'picker.go': 'Go',
        'picker.loading': 'Loading…',
        'picker.empty': 'No folders in this directory.',
        'picker.truncated': 'Too many folders; only the first {count} are shown.',
        'picker.showHidden': 'Show hidden folders',
        'picker.newFolder': 'New folder',
        'picker.folderName': 'New folder name',
        'picker.create': 'Create',
        'picker.open': 'Use this folder',
        'picker.back': 'Back',
        'picker.target': 'Will add: {path}',
        'picker.absolute': 'Enter an absolute path starting with /',
        'badge.title': 'WSL workspace · {distro} ({os}) · {state}',
        'badge.titleNoOs': 'WSL workspace · {distro} · {state}',
        'open.done': 'Opened from WSL: {path}',
        'plugins.toggle': 'WSL plugins',
        'plugins.connectFirst': 'Connect to {distro} to view and manage its plugins.',
        'plugins.refresh': 'Refresh plugins',
        'plugins.scope': 'Installed in {distro} · profile {profile}',
        'plugins.title': 'Plugins in {distro}',
        'plugins.desc': 'The agent side of WSL sessions (tools, skills, MCP, models) uses these plugins; the interface and this window’s plugin page are always the Windows ones. For a plugin’s sidebar to work in WSL sessions, install it on both sides.',
        'plugins.loading': 'Reading the plugins in WSL…',
        'plugins.empty': 'No plugins installed.',
        'plugins.where.wsl': 'WSL only',
        'plugins.where.both': 'also on Windows',
        'plugins.where.both-differ': 'Windows has {version}',
        'plugins.where.windows': 'Windows only',
        'plugins.windowsOnly': 'Installed on Windows only (WSL sessions’ agents do not have them; their sidebars do not work in WSL sessions):',
        'plugins.enable': 'Enable',
        'plugins.disable': 'Disable',
        'plugins.remove': 'Remove',
        'plugins.installHere': 'Install in WSL',
        'plugins.install': 'Install',
        'plugins.spec': 'Package name or install spec, e.g. dsh-better-sidebar',
        'plugins.removeConfirm': 'Remove {name} from {distro}?',
        'plugins.restartNeeded': 'The dsh in WSL needs a restart to apply these changes.',
        'plugins.restart': 'Restart the dsh in WSL',
        'plugins.applied': 'Applied.',
        'plugins.failed': 'Failed: {message}',
        'plugins.disabled': 'disabled',
        'plugins.openUi': 'Manage in the WSL dsh’s own UI',
        'plugins.installing': 'Installing {spec}',
        'plugins.phase.starting': 'starting',
        'plugins.phase.installing': 'installing',
        'plugins.phase.applying': 'applying',
        'plugins.phase.cancelling': 'cancelling',
        'plugins.status.done': 'done',
        'plugins.status.failed': 'failed',
        'plugins.status.cancelled': 'cancelled',
        'plugins.cancel': 'Cancel install',
        'plugins.cancelling': 'Cancelling…',
        'plugins.close': 'Close',
        'plugins.stalled': 'pnpm has printed nothing for {seconds} s and may be stuck. Cancel the install (the profile is restored) and retry, or install from the WSL dsh’s own UI.',
        'plugins.tooLate': 'The install is being applied and can no longer be cancelled; wait for it to finish.',
        'plugins.waitingOutput': 'Waiting for pnpm output…',
        'plugins.installed': 'Installed {name}.',
        'plugins.cancelled': 'Install cancelled; the WSL profile was restored.',
        'ssh.title': 'SSH remote hosts',
        'ssh.description': 'Used exactly like WSL: connecting starts your own dsh on the server (npm i -g @deepseek-ai/dsh), and its workspaces and sessions appear in this window. Connects with Windows’ OpenSSH, using ~/.ssh/config and your keys; the server opens no extra port.',
        'ssh.placeholder': 'user@host, host:port or a Host from ~/.ssh/config',
        'ssh.add': 'Add',
        'ssh.remove': 'Remove',
        'ssh.removeConfirm': 'Remove the SSH host {dest}? Its sessions stay on the server.',
        'ssh.fromConfig': 'From ~/.ssh/config:',
        'ssh.none': 'No SSH hosts added yet.',
        'ssh.hint.auth': 'SSH authentication failed. The connection is non-interactive and cannot ask for a password: set up key-based login (ssh-copy-id, or add your public key to ~/.ssh/authorized_keys on the server), and run ssh-add if your key has a passphrase.',
        'ssh.hint.host-key': 'The host key is not trusted or has changed. Run ssh {dest} in PowerShell once to confirm it, then select Retry.',
        'ssh.hint.network': 'The server could not be reached. Check the address, port and network.',
        'req.terminalSsh': 'Run ssh {dest} in a Windows terminal and enter these commands on the server',
        'ws.ssh': 'SSH',
        'ws.sshDesc': 'Choose a folder on an SSH remote host',
        'ws.sshNone': 'Add an SSH host in Settings → General first',
        'ws.host': 'Host',
        'ws.notConnectedSsh': '{distro} is not connected. It connects when you add the folder; the workspace’s sessions run in your own dsh on the server.',
        'badge.titleSsh': 'SSH workspace · {distro} ({os}) · {state}',
        'badge.titleSshNoOs': 'SSH workspace · {distro} · {state}',
        'plugins.hostTab': 'Remote',
        'sync.title': 'Sync plugins',
        'session.heldRemote': 'This session is open in another dsh on {host}: {holder}. Both share the ~/.dsh of {host}, and only one can write to a session at a time. Close it there (or restart that dsh), then send again; its history stays readable here.',
        'session.heldUnknown': 'another dsh process',
        'sync.desc': 'Install the plugins you added on one host on another host, at the same version and from the same source, one by one through the target’s own plugin manager. Plugins only the target has are left alone.',
        'sync.from': 'From',
        'sync.to': 'To',
        'sync.swap': 'Swap',
        'sync.load': 'Compare',
        'sync.loading': 'Comparing the two hosts’ plugins…',
        'sync.selectAll': 'Select all syncable',
        'sync.oneTitle': 'Sync only {name}',
        'sync.run': 'Sync selected ({count})',
        'sync.cancel': 'Stop sync',
        'sync.close': 'Close',
        'sync.nothing': 'Nothing to sync: both hosts already match.',
        'sync.connectFirst': 'Connect both hosts to sync plugins.',
        'sync.same': 'Choose two different hosts.',
        'sync.targetOnly': 'Only on the target (left alone):',
        'sync.state.missing': 'missing on target',
        'sync.state.differ': 'target has {version}',
        'sync.state.disabled': 'disabled on target',
        'sync.state.same': 'in sync',
        'sync.state.builtin': 'built into target',
        'sync.state.error': 'fails to load on target: {reason}',
        'sync.state.unsupported': 'cannot sync automatically',
        'sync.reason.local-path': 'It is installed from a local folder ({source}) the target cannot reach. Publish it to npm or git, or put it where both hosts can reach it.',
        'sync.reason.source-missing': 'The source host recorded no install source for it.',
        'sync.reason.git-unpushed': 'It is installed from a local folder ({source}) the target cannot reach. The folder is a git repository, but its commit is on no remote branch yet; push it and compare again to install it from git.',
        'sync.reason.git-remote': 'It is installed from a local folder ({source}) the target cannot reach, and its git remote is not a network address the target can use.',
        'sync.reason.git-subfolder': 'It is installed from a local folder ({source}) the target cannot reach, and the folder is a subfolder of a git repository, which cannot be installed from git directly.',
        'sync.git.from': 'Installs from git: {remote} @ {commit}.',
        'sync.git.unpushed': '{count} local commits are not pushed and are not included.',
        'sync.git.dirty': 'Uncommitted changes are not included.',
        'sync.action.install': 'Install',
        'sync.action.update': 'Update to {version}',
        'sync.action.enable': 'Enable',
        'sync.item.pending': 'waiting',
        'sync.item.running': 'running',
        'sync.item.done': 'done',
        'sync.item.failed': 'failed',
        'sync.item.cancelled': 'cancelled',
        'sync.item.skipped': 'skipped',
        'sync.item.confirming': 'confirming result…',
        'sync.done': 'Plugins synced.',
        'sync.failed': 'Some plugins did not sync; see above.',
        'sync.restartRemote': 'The dsh on the target needs a restart to load these plugins.',
        'sync.restartWindows': 'Restart DeepSeek Harness to load these plugins.',
      },
    };

    const css = `
      .lwr-model-page{display:flex;flex-direction:column;gap:20px;min-width:0}
      .lwr-model-tabs{display:flex;gap:6px;border-bottom:1px solid var(--dsw-alias-border-l3);padding-bottom:10px}
      .lwr-model-tabs [aria-selected=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-weight:600}
      .lwr-model-sync{display:flex;flex-direction:column;gap:12px;border:1px solid var(--dsw-alias-border-l3);border-radius:12px;padding:16px}
      .lwr-model-sync p{margin:0;line-height:1.6}
      .lwr-provider-sync{display:flex;flex-direction:column;align-items:stretch;gap:12px;margin-top:10px}
      .lwr-provider-sync:not(:has(.lwr-button,.lwr-model-preview)){display:none}
      .lwr-provider-action{display:contents}
      .lwr-model-page [class$="_rowActions"]>.lwr-button{flex:none;white-space:nowrap}
      .lwr-provider-sync p{margin:0;line-height:1.6}
      .lwr-provider-sync pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow:auto;font-size:12px}
      .lwr-model-preview{display:flex;flex-direction:column;gap:12px;border-top:1px solid var(--dsw-alias-border-l3);padding-top:14px;overflow-wrap:anywhere}
      .lwr-model-preview ul{margin:0;padding-left:20px;max-height:220px;overflow:auto;font-size:13px;line-height:1.6}
      .lwr-model-refresh{margin-bottom:16px}
      .lwr-row{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
      .lwr-block{padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
      .lwr-text{min-width:0;flex:1}
      .lwr-title{font-size:14px;line-height:20px;color:var(--dsw-alias-label-primary)}
      .lwr-desc,.lwr-note{margin-top:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
      .lwr-info{margin-top:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-brand-primary)}
      .lwr-alert{margin-top:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary, var(--dsw-alias-label-primary));overflow-wrap:anywhere;white-space:pre-wrap}
      .lwr-list{margin-top:12px;display:flex;flex-direction:column;gap:8px}
      .lwr-host{display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
      .lwr-dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-tertiary, #9ca3af)}
      .lwr-dot[data-state=connected]{background:#22c55e}
      .lwr-dot[data-state=connecting]{background:#f59e0b}
      .lwr-dot[data-state=error]{background:#ef4444}
      .lwr-name{font-size:13px;line-height:18px;color:var(--dsw-alias-label-primary)}
      .lwr-badge{margin-left:6px;font-size:11px;color:var(--dsw-alias-label-secondary)}
      .lwr-actions{display:flex;gap:6px;flex:none}
      .lwr-button{height:28px;padding:0 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
      .lwr-button[data-primary]{border-color:transparent;background:var(--dsw-alias-brand-primary);color:#fff}
      .lwr-button:disabled{opacity:.6;cursor:default}
      .lwr-button:focus-visible,.lwr-input:focus-visible,.lwr-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
      .lwr-switch{flex:none;position:relative;width:36px;height:20px;border:none;border-radius:10px;background:var(--dsw-alias-border-l1);cursor:pointer;padding:0}
      .lwr-switch[aria-checked=true]{background:var(--dsw-alias-brand-primary)}
      .lwr-switch::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .15s}
      .lwr-switch[aria-checked=true]::after{transform:translateX(16px)}
      .lwr-switch:disabled{opacity:.5;cursor:default}
      .lwr-input{flex:none;width:140px;height:28px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
      .lwr-os{margin-left:6px;display:inline-flex;align-items:center;height:18px;padding:0 6px;border-radius:9px;background:var(--dsw-alias-bg-layer-2, rgba(127,127,127,.12));font-size:11px;line-height:18px;color:var(--dsw-alias-label-secondary);vertical-align:middle}
      .lwr-req{margin-top:8px;display:flex;flex-direction:column;gap:6px}
      .lwr-step{display:flex;flex-direction:column;gap:3px}
      .lwr-step-note{font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary)}
      .lwr-cmd{display:flex;align-items:center;gap:6px;padding:4px 4px 4px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08))}
      .lwr-cmd code{flex:1;min-width:0;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere;user-select:all}
      .lwr-copy{height:22px;padding:0 8px;font-size:11px}
      .lwr-host-wrap{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
      .lwr-host-wrap>.lwr-host{border:none;background:transparent}
      .lwr-plugins{margin:0 12px 12px;padding-top:10px;border-top:.5px solid var(--dsw-alias-border-l2);display:flex;flex-direction:column;gap:6px}
      .lwr-plugin{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:30px}
      .lwr-plugin-name{font-size:13px;color:var(--dsw-alias-label-primary);white-space:nowrap}
      .lwr-plugin-version{margin-left:6px;font-size:11px;color:var(--dsw-alias-label-secondary)}
      .lwr-plugin .lwr-text{min-width:0;flex:1}
      .lwr-tag{display:inline-flex;align-items:center;height:18px;margin-left:6px;padding:0 6px;border-radius:9px;font-size:11px;line-height:18px;white-space:nowrap;vertical-align:middle;background:var(--dsw-alias-bg-layer-2, rgba(127,127,127,.12));color:var(--dsw-alias-label-secondary)}
      .lwr-tag[data-where=wsl]{background:rgba(34,197,94,.14);color:#15803d}
      .lwr-tag[data-where=both-differ],.lwr-tag[data-where=windows]{background:rgba(245,158,11,.16);color:#b45309}
      .lwr-plugin-page{display:flex;flex-direction:column;gap:20px;min-width:0}
      .lwr-plugin-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
      .lwr-plugin-toolbar .lwr-title{margin:0 0 6px;font-size:15px}
      .lwr-plugin-toolbar select{min-width:200px;max-width:100%}
      .lwr-plugin-page>.lwr-plugins{margin:0;border:0;padding:0;gap:12px}
      .lwr-plugin-page .lwr-plugin{padding:16px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2));border-radius:12px;flex-wrap:wrap;gap:12px}
      .lwr-plugin-page .lwr-plugin-name{font-size:14px;font-weight:500;white-space:normal;overflow-wrap:anywhere}
      .lwr-plugin-page .lwr-text{flex:1;min-width:180px}
      .lwr-plugin-disconnected{padding:24px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2));border-radius:12px}
      .lwr-plugin-install{display:flex;gap:6px;margin-top:4px}
      .lwr-job{display:flex;flex-direction:column;gap:6px;margin-top:6px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px}
      .lwr-job-head{display:flex;align-items:center;gap:8px}
      .lwr-job-log{margin:0;max-height:160px;overflow:auto;padding:6px 8px;border-radius:6px;background:var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08));font:11px/1.45 var(--ds-font-family-code, ui-monospace, monospace);white-space:pre-wrap;word-break:break-all;color:var(--dsw-alias-label-secondary)}
      .lwr-plugin-install .lwr-input{flex:1;width:auto}`;

    function format(text, values) {
      return text.replace(/\{(\w+)\}/g, (_m, key) => (values && key in values ? String(values[key]) : `{${key}}`));
    }

    async function call(path, init) {
      const response = await fetch(path, { credentials: 'same-origin', headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}) }, ...init });
      const value = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`);
      return value;
    }

    // ---------------------------------------------------------------------
    // Workspaces: "Add workspace" offers Local and WSL; WSL opens a Linux
    // folder dialog; WSL workspaces get a "WSL · <OS>" badge in the sidebar.
    // A WSL workspace is a workspace of the dsh inside that distribution and
    // keeps its Linux path; the Host's merge says which distribution owns it.
    // The picker hands `\\wsl.localhost\<distro>\<path>` to workspace/create
    // only to name the distribution; the workspace is stored with the Linux path.
    // ---------------------------------------------------------------------
    const UNC = /^\\\\(?:wsl\.localhost|wsl\$)\\([^\\]+)(\\.*)?$/i;
    const toUnc = (distro, linux) => `\\\\wsl.localhost\\${distro}${linux === '/' ? '\\' : linux.replace(/\//g, '\\')}`;
    /** Remote host ids: a WSL distribution name, or `ssh:<dest>`. */
    const isSsh = (id) => typeof id === 'string' && id.startsWith('ssh:');
    const destOf = (id) => (isSsh(id) ? id.slice(4) : id);
    /** `WSL: Ubuntu` / `SSH: dev`. */
    const hostTitle = (id) => (isSsh(id) ? `SSH: ${destOf(id)}` : `WSL: ${id}`);
    /** What the remote folder picker hands to workspace/create: it names the host; the workspace keeps the Linux path. */
    const toAddress = (id, linux) => (isSsh(id) ? `ssh://${destOf(id)}${linux}` : toUnc(id, linux));
    /** Tab label for the remote side: `WSL`, `SSH` or `WSL / SSH`, by which kinds of hosts exist. */
    const remoteKindsLabel = (hosts) => {
      const ssh = hosts.some((item) => isSsh(item.name));
      const wsl = hosts.some((item) => !isSsh(item.name));
      return ssh && wsl ? 'WSL / SSH' : ssh ? 'SSH' : 'WSL';
    };
    const isLinuxPath = (path) => typeof path === 'string' && path.startsWith('/') && !path.startsWith('//');
    /** Which distribution owns a WSL workspace: from the Host's merge, or a legacy `\\wsl.localhost` path. */
    const wslInfo = (item, hosts) => {
      const distro = hosts[item?.workspaceId];
      if (distro !== undefined) return { distro, linux: item.path };
      const match = UNC.exec(String(item?.path ?? ''));
      return match ? { distro: match[1], linux: (match[2] ?? '\\').replace(/\\/g, '/') || '/' } : undefined;
    };
    const osLabelOf = (os) => (os ? [os.name, os.version].filter(Boolean).join(' ') || os.pretty || '' : '');

    const workspaceCss = `
      .lwr-wsl-tag{flex:none;display:inline-flex;align-items:center;gap:4px;max-width:150px;height:18px;margin-left:6px;padding:0 6px;border-radius:9px;background:var(--dsw-alias-bg-layer-2, rgba(127,127,127,.12));color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:500;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;vertical-align:middle}
      .lwr-wsl-tag b{font-weight:600;color:var(--dsw-alias-label-primary)}
      .lwr-wsl-dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-tertiary, #9ca3af)}
      .lwr-wsl-dot[data-state=connected]{background:#22c55e}
      .lwr-wsl-dot[data-state=connecting]{background:#f59e0b}
      .lwr-wsl-dot[data-state=error]{background:#ef4444}
      [class$="_projectText"][data-lwr-titled]{display:flex;flex-direction:row;flex-wrap:nowrap;align-items:center;gap:0;min-width:0}
      [class$="_projectText"][data-lwr-titled]>[class$="_title"]{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      [class$="_projectText"][data-lwr-titled]>.lwr-wsl-tag{flex:0 0 auto;max-width:60%}
      .lwr-choice{display:grid;grid-template-columns:1fr 1fr;gap:12px}
      .lwr-card{display:flex;flex-direction:column;align-items:flex-start;gap:6px;min-height:104px;padding:14px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer}
      .lwr-card:hover{background:var(--dsw-alias-interactive-bg-hover)}
      .lwr-card[aria-checked=true]{border-color:transparent;background:var(--dsw-alias-interactive-bg-hover)}
      .lwr-card:disabled{opacity:.55;cursor:default}
      .lwr-card:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
      .lwr-card-head{display:flex;align-items:center;justify-content:space-between;width:100%}
      .lwr-radio{flex:none;width:16px;height:16px;border:1px solid var(--dsw-alias-border-l1);border-radius:50%;display:inline-flex;align-items:center;justify-content:center}
      .lwr-card[aria-checked=true] .lwr-radio::after{content:"";width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-brand-primary)}
      .lwr-card-title{font-size:14px;font-weight:510;line-height:20px}
      .lwr-card-desc{font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary)}
      .lwr-field{margin-top:14px;display:flex;flex-direction:column;gap:6px}
      .lwr-field label{font-size:12px;color:var(--dsw-alias-label-secondary)}
      .lwr-select{height:30px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
      .lwr-picker{display:flex;flex-direction:column;gap:8px;min-height:340px}
      .lwr-picker-bar{display:flex;align-items:center;gap:6px}
      .lwr-picker-path{flex:1;min-width:0;height:30px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px}
      .lwr-picker-path:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}
      .lwr-icon-btn{flex:none;width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;font-size:14px}
      .lwr-icon-btn:disabled{opacity:.5;cursor:default}
      .lwr-crumbs{display:flex;flex-wrap:wrap;align-items:center;gap:2px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
      .lwr-crumb{border:none;background:none;padding:1px 3px;border-radius:4px;color:inherit;font:inherit;cursor:pointer}
      .lwr-crumb:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
      .lwr-dirs{flex:1;min-height:220px;max-height:300px;overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:4px}
      .lwr-dir{display:flex;align-items:center;gap:8px;width:100%;padding:5px 10px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;text-align:left;cursor:pointer}
      .lwr-dir:hover{background:var(--dsw-alias-interactive-bg-hover)}
      .lwr-dir[data-hidden]{color:var(--dsw-alias-label-secondary)}
      .lwr-dir-icon{flex:none;color:var(--dsw-alias-label-tertiary)}
      .lwr-dir-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .lwr-dirs-status{padding:16px;font-size:12px;color:var(--dsw-alias-label-secondary);text-align:center}
      .lwr-picker-foot{display:flex;align-items:center;gap:8px}
      .lwr-picker-foot .lwr-gap{flex:1}
      .lwr-check{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer}
      .lwr-target{font-size:12px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
      .lwr-target code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--dsw-alias-label-primary)}
    `;

    /** Keep the native Models editor and its child-slot bindings, adding a host selector. */
    function applyModels(ctx, { useT, useStatus, store }) {
      const post = (path, data) => call(`api/local-wsl-remote/models/${path}`, { method: 'POST', body: JSON.stringify(data) });
      const rpc = (distro, endpoint, args = {}) => post('rpc', { distro, endpoint, args })
        .catch((error) => ({ ok: false, error: { code: 'wsl/unavailable', message: error.message } }));

      // The native provider slot is below the header; keep React ownership while
      // placing its action beside the native Edit and Delete controls.
      function ProviderAction({ children }) {
        const anchor = React.useRef(null);
        const [actions, setActions] = React.useState(null);
        React.useLayoutEffect(() => {
          setActions(anchor.current?.closest('li')?.querySelector('[class$="_rowActions"]') ?? null);
        }, []);
        return h('span', { ref: anchor, className: 'lwr-provider-action' },
          actions ? createPortal(children, actions) : children);
      }

      function RemoteModels({ native: Native, nativeProps, distro, refresh, wrapSlot }) {
        const adapter = React.useMemo(() => {
          const invoke = (endpoint, args) => rpc(distro, endpoint, args);
          let snapshot = { view: undefined, error: null };
          const describe = {
            ensure: async () => {
              const result = await invoke('settings/describe', {});
              snapshot = result.ok ? { view: result.value, error: null } : { view: undefined, error: result.error.message };
            },
            getSnapshot: () => snapshot,
          };
          const remote = {
            llm: {
              listProviders: () => invoke('llm/listProviders', {}),
              listConfigurableProviders: () => invoke('llm/listConfigurableProviders', {}),
            },
            session: { modelCatalog: () => invoke('session/modelCatalog', {}) },
            credentials: { describe: (refs) => invoke('credentials/describe', { refs }) },
          };
          const controller = new nativeProps.controller.constructor({ remote }, nativeProps.schema, describe);
          const operations = {
            storeCredential: async (ref, value) => {
              const result = await invoke('credentials/set', { ref, value });
              return result.ok ? undefined : result.error.message;
            },
            removeCredential: async (ref) => {
              const result = await invoke('credentials/unset', { ref });
              return result.ok ? undefined : result.error.message;
            },
            writeSettings: async (ns, ops, expectedRevision) => {
              const result = await invoke('settings/mutate', { ns, ops, expectedRevision });
              return result.ok ? { kind: 'written', view: result.value }
                : { kind: result.error.code === 'settings/conflict' ? 'conflict' : 'refused', message: result.error.message };
            },
            discoverModels: async (settingsNs, request) => {
              const result = await invoke('llm/discoverModels', { settingsNs, request });
              return result.ok ? { kind: 'found', models: result.value } : { kind: 'refused', message: result.error.message };
            },
          };
          return { controller, operations };
        }, [distro, nativeProps.controller, nativeProps.schema]);
        const useSnapshot = React.useCallback((select) => select(React.useSyncExternalStore(
          adapter.controller.store.subscribe, adapter.controller.store.getSnapshot, adapter.controller.store.getSnapshot)), [adapter]);
        React.useEffect(() => {
          const reload = () => Promise.resolve(adapter.controller.load()).catch((error) => {
            adapter.controller.failLoad?.(error.message ?? String(error));
          });
          reload();
          window.addEventListener('focus', reload);
          return () => window.removeEventListener('focus', reload);
        }, [adapter, refresh]);
        // Provider-specific Windows login widgets close over Windows services.
        // On WSL use the native generic editor fallback, whose operations are host-bound.
        return h(Native, { ...nativeProps, ...adapter, useSnapshot,
          renderSlot: wrapSlot((_key, _props, options) => options?.fallback ?? null) });
      }

      function HostModels({ native: Native, nativeProps }) {
        const tr = useT();
        const status = useStatus();
        const [tab, setTab] = React.useState('windows');
        const [selected, setSelected] = React.useState('');
        const direction = tab === 'windows' ? 'windows-to-wsl' : 'wsl-to-windows';
        const [selection, setSelection] = React.useState(null);
        const [savedPlugin, setPlugin] = React.useState(null);
        const [job, setJob] = React.useState(null);
        const [savedPreview, setPreview] = React.useState(null);
        const [working, setBusy] = React.useState(false);
        const busy = working || job?.status === 'running';
        const [failure, setFailure] = React.useState('');
        const [notice, setNotice] = React.useState('');
        const [refresh, setRefresh] = React.useState(0);
        const hosts = status.value?.distros ?? [];
        const host = hosts.find((item) => item.name === selected) ?? hosts.find((item) => item.state === 'connected') ?? hosts[0];
        const hostName = host?.name;
        const remoteTabLabel = remoteKindsLabel(hosts);
        const preview = savedPreview?.host === hostName && savedPreview?.direction === direction ? savedPreview : null;
        const plugin = savedPlugin?.host === hostName && savedPlugin?.direction === direction ? savedPlugin : null;
        React.useEffect(() => { setSelection(null); setPlugin(null); setPreview(null); setJob(null); setFailure(''); setNotice(''); }, [hostName, direction]);
        const run = async (action) => {
          setBusy(true); setFailure(''); setNotice('');
          try { await action(); } catch (error) { setFailure(error.message); }
          finally { setBusy(false); }
        };
        const reload = () => {
          Promise.resolve(nativeProps.controller.load()).catch((error) => setFailure(error.message ?? String(error)));
          setRefresh((value) => value + 1);
        };
        const connect = () => run(async () => {
          store.accept(await call('api/local-wsl-remote/connect', { method: 'POST', body: JSON.stringify({ distro: hostName }) }));
        });
        const selector = (entry) => ({ distro: hostName, direction, provider: entry.provider, settingsNs: entry.settingsNs });
        const pluginReason = (reason) => tr(`models.${({
          'source-owner-unavailable': 'ownerMissing',
          'source-owner-ambiguous': 'ownerAmbiguous', 'target-owner-ambiguous': 'ownerAmbiguous',
          'source-provider-unavailable': 'providerUnavailable', 'target-provider-unavailable': 'providerUnavailable',
          'source-provider-ambiguous': 'ownerAmbiguous', 'target-provider-ambiguous': 'ownerAmbiguous',
          'target-incompatible': 'incompatible', 'unsupported-source-platform': 'localPath',
          'source-install-spec-missing': 'sourceMissing',
        })[reason] ?? 'pluginUnavailable'}`);
        const prepare = async (entry) => {
          setSelection(entry); setPreview(null); setPlugin(null);
          const plan = await post('provider-plugin', selector(entry));
          setPlugin({ ...plan, host: hostName, direction });
          if (plan.status !== 'available') return;
          const result = await post('preview', selector(entry));
          setPreview({ ...result, host: hostName, direction });
        };
        const showPreview = (entry) => run(async () => { setJob(null); await prepare(entry); });
        const installProvider = () => run(async () => {
          const result = await post('install-provider', { ...selector(selection), expected: { status: plugin.status, name: plugin.name, spec: plugin.spec } });
          if (result.job) setJob(result.job);
          else {
            reload();
            if (result.result?.application === 'restart-required') setNotice(tr('models.restartRequired'));
            else await prepare(selection);
          }
        });
        const installCall = (path, data) => call(`api/local-wsl-remote/plugins/${path}`, { method: 'POST', body: JSON.stringify(data) });
        React.useEffect(() => {
          if (job?.status !== 'running') return;
          let disposed = false, polling = false;
          const poll = async () => {
            if (polling) return;
            polling = true;
            try {
              const result = await installCall('install-status', { id: job.id });
              if (disposed) return;
              if (!result.job) throw new Error(tr('models.installLost'));
              setJob(result.job);
              if (result.job.status === 'done') {
                await run(async () => {
                  reload();
                  if (result.job.result?.application === 'restart-required') setNotice(tr('models.restartRequired'));
                  else await prepare(selection);
                });
              } else if (['failed', 'cancelled'].includes(result.job.status)) {
                setFailure(result.job.error || result.job.result?.message || tr('models.installFailed'));
              }
            } catch (error) { if (!disposed) setFailure(error.message); }
            finally { polling = false; }
          };
          const timer = setInterval(poll, 1500);
          poll();
          return () => { disposed = true; clearInterval(timer); };
        }, [job?.id, job?.status]);
        const cancelInstall = () => run(async () => { setJob((await installCall('install-cancel', { id: job.id })).job); });
        const copyKeys = preview?.credentials?.length > 0 && preview.copyKeys !== false;
        const apply = () => run(async () => {
          const token = preview.token;
          const credentials = copyKeys;
          setPreview(null);
          const result = await post('apply', { token, credentials });
          reload();
          if (result.error) {
            const detail = [
              ...(result.failed ?? []).map((item) => `${item.ns}: ${item.error}`),
              ...(result.credentialsFailed ?? []).map((item) => `${item.ref}: ${item.error}`),
            ].join('; ') || result.error;
            setFailure(`${tr('models.partial')} ${detail}`);
          }
          else setNotice(result.credentialsApplied?.length > 0 ? tr('models.doneKeys', { refs: result.credentialsApplied.join(', ') }) : tr('models.done'));
        });
        const renderPreview = () => preview && h('div', { className: 'lwr-model-preview' },
          h('strong', null, `${preview.source} → ${preview.target}`),
          preview.changes.length ? h('div', null, h('p', null, tr('models.changed')),
            h('ul', null, preview.changes.map((change, index) => h('li', { key: index },
              h('details', null,
                h('summary', null, `${change.ns}${change.path?.length ? ': ' + change.path.join(' / ') : ''}`),
                h('pre', null, `− ${JSON.stringify(change.before ?? null, null, 2)}\n+ ${JSON.stringify(change.after ?? null, null, 2)}`))))))
            : h('p', null, tr(preview.credentials?.length ? 'models.noConfigChanges' : 'models.noChanges')),
          preview.warnings?.length > 0 && h('ul', { className: 'lwr-note' }, preview.warnings.map((warning, index) => h('li', { key: index }, warning))),
          preview.missingCredentials?.length > 0 && h('p', { className: 'lwr-note' }, `${tr('models.missing')} ${preview.missingCredentials.join(', ')}`),
          preview.credentials?.length > 0 && h('label', { className: 'lwr-check', 'data-lwr-copy-keys': '' },
            h('input', { type: 'checkbox', checked: copyKeys, disabled: busy, onChange: (event) => setPreview({ ...preview, copyKeys: event.target.checked }) }),
            `${tr('models.copyKeys')} ${preview.credentials.map((item) => `${item.ref}${item.action === 'update' ? ` (${tr('models.keyUpdate')})` : ''}`).join(', ')}`),
          h('div', { className: 'lwr-actions' },
            h('button', { type: 'button', className: 'lwr-button', disabled: busy || (!preview.changes.length && !copyKeys), onClick: apply }, tr('models.apply')),
            h('button', { type: 'button', className: 'lwr-button', disabled: busy, onClick: () => { setSelection(null); setPreview(null); setPlugin(null); } }, tr('models.cancel'))));
        const wrapSlot = (render) => (key, props, options) => {
          const content = render?.(key, props, options) ?? options?.fallback ?? null;
          const entry = props?.provider;
          if (key !== 'settings.models.provider-card' || !props.configured || !entry?.settingsNs) return content;
          const active = selection?.provider === entry.provider && selection?.settingsNs === entry.settingsNs;
          return h('div', null, content,
            h('div', { className: 'lwr-provider-sync', 'data-provider-sync': entry.provider },
              h(ProviderAction, null,
                h('button', { type: 'button', className: 'lwr-button', disabled: busy || host?.state !== 'connected',
                  onClick: () => showPreview(entry) }, tr(tab === 'windows' ? 'models.syncToWsl' : 'models.syncToWindows', { kind: isSsh(hostName) ? 'SSH' : 'WSL' }))),
              active && plugin && plugin.status !== 'available' && h('div', { className: 'lwr-model-preview' },
                h('strong', null, plugin.name || entry.displayName || entry.provider),
                h('p', { className: 'lwr-note' }, plugin.reason ? pluginReason(plugin.reason) : tr(plugin.status === 'enable' ? 'models.enableHint' : 'models.installHint')),
                plugin.spec && h('code', null, plugin.spec),
                ['install', 'enable'].includes(plugin.status) && h('button', { type: 'button', className: 'lwr-button', disabled: busy,
                  onClick: installProvider }, tr(plugin.status === 'enable' ? 'models.enableProvider' : 'models.installProvider'))),
              active && job && h('div', { className: 'lwr-model-preview', role: 'status' },
                h('p', null, `${tr('models.installStatus')} ${job.phase || job.status}`),
                job.lines?.length > 0 && h('details', null, h('summary', null, tr('models.installLog')), h('pre', null, job.lines.join('\n'))),
                job.status === 'running' && h('button', { type: 'button', className: 'lwr-button', disabled: working || Boolean(job.cancelRequested), onClick: cancelInstall }, tr('models.cancelInstall'))),
              active && renderPreview()));
        };
        const id = React.useId();
        return h('div', { className: 'lwr-model-page', 'data-wsl-model-page': '' },
          h('style', null, css),
          h('div', { className: 'lwr-model-tabs', role: 'tablist', 'aria-label': tr('models.host') },
            ['windows', 'wsl'].map((name) => h('button', { key: name, type: 'button', role: 'tab', id: `${id}-${name}`,
              'aria-controls': `${id}-panel`, 'aria-selected': tab === name, tabIndex: tab === name ? 0 : -1,
              className: 'lwr-button', disabled: busy, onClick: () => setTab(name),
              onKeyDown: (event) => {
                if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                  event.preventDefault(); const next = event.key === 'Home' ? 'windows' : event.key === 'End' ? 'wsl' : tab === 'windows' ? 'wsl' : 'windows';
                  setTab(next); document.getElementById(`${id}-${next}`)?.focus();
                }
              } }, name === 'windows' ? 'Windows' : remoteTabLabel))),
          h('div', { className: 'lwr-model-sync' },
            h('div', { className: 'lwr-plugin-toolbar' },
              h('label', { className: 'lwr-check' }, tr('ws.host'),
                h('select', { className: 'lwr-input', value: hostName ?? '', disabled: busy || hosts.length === 0,
                  onChange: (event) => setSelected(event.target.value) },
                  hosts.map((item) => h('option', { key: item.name, value: item.name }, hostTitle(item.name))))),
              host && h('span', { className: 'lwr-note' }, tr(`state.${host.state}`)),
              host && host.state !== 'connected' && h('button', { type: 'button', className: 'lwr-button', disabled: busy || host.state === 'connecting', onClick: connect }, tr(host.state === 'connecting' ? 'state.connecting' : 'connect'))),
            h('p', { className: 'lwr-note' }, tr('models.hint')),
            failure && h('p', { role: 'alert', className: 'lwr-alert' }, failure),
            notice && h('p', { role: 'status', className: 'lwr-note' }, notice),
            status.status === 'error' && h('p', { role: 'alert', className: 'lwr-alert' }, status.message)),
          h('div', { role: 'tabpanel', id: `${id}-panel`, 'aria-labelledby': `${id}-${tab}` },
            h('button', { type: 'button', className: 'lwr-button lwr-model-refresh', onClick: reload, disabled: busy }, tr('models.refresh')),
            tab === 'windows' ? h(Native, { ...nativeProps, renderSlot: wrapSlot(nativeProps.renderSlot) })
              : host?.state === 'connected' ? h(RemoteModels, { key: hostName, native: Native, nativeProps, distro: hostName, refresh, wrapSlot })
                : h('p', { className: 'lwr-note' }, tr(host ? 'models.connectFirst' : 'none'))));
      }

      // Models currently declares provider/footer children but no tab extension.
      // Wrap its component in place so the renderer retains the original entry's
      // child-slot authorization and injected editor store. Restore only our wrapper.
      ctx.slots.inject('settings.section', () => {
        const patched = new Map();
        const attach = () => {
          for (const entry of ctx.slots.entries('settings.section')) {
            if (entry.options.id !== 'models' || patched.has(entry)) continue;
            const Native = entry.component;
            const wrapper = (props) => h(HostModels, { native: Native, nativeProps: props });
            patched.set(entry, { Native, wrapper });
            entry.component = wrapper;
          }
        };
        attach();
        const unsubscribe = ctx.slots.subscribe('settings.section', attach);
        return () => {
          unsubscribe();
          for (const [entry, { Native, wrapper }] of patched) if (entry.component === wrapper) entry.component = Native;
        };
      });
    }

    /**
     * Workspace integration. Services are optional: a host without the
     * workspace UI (or with a different picker) still gets the settings rows.
     */
    function applyWorkspaces(ctx, { t, useT, call, store: connectionStore }) {
      const primitives = (() => {
        try {
          return require('@deepseek-ai/dsh-client-ui-primitives');
        } catch {
          return {};
        }
      })();
      const { Modal, Button } = primitives;
      if (Modal === undefined || Button === undefined) return;
      const FolderIcon = primitives.IconFolderCloseRegular;
      const UpIcon = primitives.IconChevronUpOutlineRegular;
      const HomeIcon = undefined; // the primitives ship no home glyph; the button shows "~"

      ctx.effect(() => {
        const style = document.createElement('style');
        style.dataset.lwr = 'workspaces';
        style.textContent = workspaceCss;
        document.head.appendChild(style);
        return () => style.remove();
      }, 'wsl-remote: workspace styles');

      /** Distribution facts (name, OS, state, home) shared by the badge, the chooser and the picker. */
      const distros = (() => {
        let state = { distros: [], workspaces: {}, loaded: false };
        const listeners = new Set();
        let inflight;
        let timer;
        const refresh = () => (inflight ??= call('api/local-wsl-remote/distros')
          .then((value) => {
            state = { distros: value.distros ?? [], workspaces: value.workspaces ?? {}, loaded: true };
            for (const listener of listeners) listener();
          })
          .catch(() => {})
          .finally(() => {
            inflight = undefined;
          }));
        return {
          refresh,
          subscribe(listener) {
            listeners.add(listener);
            if (listeners.size === 1) {
              refresh();
              timer = setInterval(refresh, 15000);
            }
            return () => {
              listeners.delete(listener);
              if (listeners.size === 0) clearInterval(timer);
            };
          },
          getSnapshot: () => state,
        };
      })();
      const useDistros = () => React.useSyncExternalStore(distros.subscribe, distros.getSnapshot, distros.getSnapshot);

      /**
       * The distribution a session belongs to, from what this window already
       * knows: its workspace (the Host's merge reports which distribution owns
       * each WSL workspace), else a Linux working directory with exactly one
       * connected distribution. Windows sessions have drive or UNC paths.
       */
      const hostOfSession = (sessionId) => {
        const state = distros.getSnapshot();
        const items = ctx.get('workspaces')?.list?.getSnapshot?.().items ?? [];
        const workspace = items.find((item) => item.sessionIds.includes(sessionId));
        if (workspace !== undefined && state.workspaces[workspace.workspaceId] !== undefined) return state.workspaces[workspace.workspaceId];
        const cwd = ctx.get('sessions')?.list?.getSnapshot?.().byId?.[sessionId]?.cwd ?? workspace?.path;
        if (!isLinuxPath(cwd)) return undefined;
        const connected = state.distros.filter((entry) => entry.state === 'connected').map((entry) => entry.name);
        return connected.length === 1 ? connected[0] : undefined;
      };
      /** Whether a session runs in WSL: its workspace belongs to a distribution, or its directory is a Linux path. */
      const isWslSession = (sessionId) => {
        if (hostOfSession(sessionId) !== undefined) return true;
        const items = ctx.get('workspaces')?.list?.getSnapshot?.().items ?? [];
        const workspace = items.find((item) => item.sessionIds.includes(sessionId));
        const cwd = ctx.get('sessions')?.list?.getSnapshot?.().byId?.[sessionId]?.cwd ?? workspace?.path;
        return isLinuxPath(cwd);
      };

      // ---- Model picker: a WSL session offers its own dsh's models. ----
      // The shipped picker loads one catalog per window (`session/modelCatalog`
      // names no session), which is the Windows one. For a WSL session the
      // per-session directory is built on that distribution's catalog instead,
      // so it lists, defaults to and validates against what the WSL dsh routes.
      const wslCatalogs = new Map();
      /**
       * A catalog in the shape the shipped picker reads (store, load,
       * reasoningFor), loaded from one distribution. `resolve` names the
       * distribution at load time: a session may be known to be WSL (Linux
       * path) before this window knows which distribution owns it.
       */
      const makeCatalog = (resolve, base) => {
        const listeners = new Set();
        let state = { value: null, status: 'idle', error: null };
        let inflight;
        let loadedAt = 0;
        const reasoning = new Map();
        const set = (next) => {
          state = next;
          for (const listener of [...listeners]) listener();
        };
        const catalog = {
          store: {
            getSnapshot: () => state,
            subscribe: (listener) => {
              listeners.add(listener);
              return () => listeners.delete(listener);
            },
          },
          reasoningFor: (selection) => reasoning.get(JSON.stringify([selection.provider, selection.model])) ?? base.reasoningFor?.(selection),
          load() {
            if (state.status === 'ready' && state.value !== null && Date.now() - loadedAt < 30000) return Promise.resolve(state.value);
            inflight ??= (async () => {
              if (state.value === null) set({ ...state, status: 'loading', error: null });
              try {
                const distro = await resolve();
                if (distro === undefined) throw new Error('this WSL session’s distribution is not known yet');
                const { catalog: value } = await call('api/local-wsl-remote/model-catalog', { method: 'POST', body: JSON.stringify({ distro }) });
                for (const group of value.groups ?? []) for (const model of group.models ?? []) reasoning.set(JSON.stringify([group.id, model.id]), model.reasoning);
                loadedAt = Date.now();
                set({ value, status: 'ready', error: null });
                return value;
              } catch (error) {
                set({ ...state, status: 'error', error: error instanceof Error ? error.message : String(error) });
                throw error;
              } finally {
                inflight = undefined;
              }
            })();
            return inflight;
          },
          refresh() {
            loadedAt = 0;
            catalog.load().catch(() => {});
          },
        };
        return catalog;
      };
      const catalogOf = (sessionId, base) => {
        const known = hostOfSession(sessionId);
        if (known !== undefined) {
          let catalog = wslCatalogs.get(known);
          if (catalog === undefined) {
            catalog = makeCatalog(async () => known, base);
            wslCatalogs.set(known, catalog);
          }
          return catalog;
        }
        // Not known yet: settle the distribution list once, then ask again.
        const catalog = makeCatalog(async () => {
          await distros.refresh();
          return hostOfSession(sessionId);
        }, base);
        wslCatalogs.set(`session:${sessionId}`, catalog);
        return catalog;
      };
      ctx.effect(() => {
        let restore;
        let timer;
        const install = () => {
          const proxy = ctx.get('modelDirectories');
          if (proxy === undefined) return false;
          const service = Reflect.get(proxy, Symbol.for('cordis.original')) ?? proxy;
          if (typeof service.directoryFor !== 'function' || service.catalog === undefined) return false;
          const original = service.directoryFor;
          const own = Object.prototype.hasOwnProperty.call(service, 'directoryFor');
          service.directoryFor = function directoryFor(sessionId) {
            if (!isWslSession(sessionId)) return original.call(service, sessionId);
            // The shipped resolver builds a new directory on `service.catalog`; give it the distribution's for that one call.
            const shared = service.catalog;
            const catalog = catalogOf(sessionId, shared);
            service.catalog = catalog;
            try {
              return original.call(service, sessionId);
            } finally {
              service.catalog = shared;
              catalog.load().catch(() => {});
            }
          };
          restore = () => {
            if (own) service.directoryFor = original;
            else delete service.directoryFor;
          };
          return true;
        };
        const attempt = () => {
          if (!install()) timer = setTimeout(attempt, 1000);
        };
        attempt();
        // A WSL dsh's models change with its own settings or a reconnect: reload on focus.
        const onFocus = () => {
          for (const catalog of wslCatalogs.values()) catalog.refresh();
        };
        window.addEventListener('focus', onFocus);
        return () => {
          clearTimeout(timer);
          window.removeEventListener('focus', onFocus);
          restore?.();
        };
      }, 'wsl-remote: per-host model catalogs');

      // ---- Add workspace: Local / WSL chooser, then the matching picker. ----

      const pickLocal = async () => {
        const desktop = globalThis.__DSH_DIRECTORY_PICKER__;
        if (desktop !== undefined) return desktop.pick();
        const uiWorkspace = ctx.get('uiWorkspace');
        if (uiWorkspace?.pickDirectory) return uiWorkspace.pickDirectory();
        throw new Error('No local folder picker is available in this window');
      };

      function Chooser({ onLocal, onWsl, onCancel }) {
        const tr = useT();
        const { distros: all, loaded } = useDistros();
        const [kind, setKind] = React.useState('local');
        const [distro, setDistro] = React.useState(undefined);
        // WSL and SSH hosts are picked the same way; each card lists its own kind.
        const list = all.filter((entry) => (kind === 'ssh') === isSsh(entry.name));
        React.useEffect(() => {
          if ((distro === undefined || !list.some((entry) => entry.name === distro)) && list.length > 0) setDistro((list.find((entry) => entry.isDefault) ?? list[0]).name);
        }, [list.map((entry) => entry.name).join('|'), distro]);
        const selected = list.find((entry) => entry.name === distro);
        const wslAvailable = all.some((entry) => !isSsh(entry.name));
        const sshAvailable = all.some((entry) => isSsh(entry.name));
        const card = (id, title, desc, disabled) => h('button', {
          type: 'button',
          role: 'radio',
          className: 'lwr-card',
          'aria-checked': kind === id,
          disabled,
          onClick: () => setKind(id),
        },
        h('span', { className: 'lwr-card-head' }, FolderIcon ? h(FolderIcon, { size: 18 }) : h('span', null, '📁'), h('span', { className: 'lwr-radio', 'aria-hidden': true })),
        h('span', { className: 'lwr-card-title' }, title),
        h('span', { className: 'lwr-card-desc' }, desc));
        const next = () => (kind === 'local' ? onLocal() : selected && onWsl(selected.name));
        const remote = kind !== 'local';
        return h(Modal, {
          open: true,
          onClose: onCancel,
          title: tr('ws.title'),
          closeLabel: tr('ws.cancel'),
          footer: h(React.Fragment, null,
            h(Button, { variant: 'outline', onClick: onCancel }, tr('ws.cancel')),
            h(Button, { variant: 'primary', disabled: remote && selected === undefined, onClick: next }, tr('ws.next'))),
        },
        h('div', { className: 'lwr-field', style: { marginTop: 0 } }, h('label', null, tr('ws.type'))),
        h('div', { className: 'lwr-choice', role: 'radiogroup', 'aria-label': tr('ws.type'), style: { marginTop: 6, gridTemplateColumns: '1fr 1fr 1fr' } },
          card('local', tr('ws.local'), tr('ws.localDesc'), false),
          card('wsl', tr('ws.wsl'), loaded && !wslAvailable ? tr('ws.wslNone') : tr('ws.wslDesc'), loaded && !wslAvailable),
          card('ssh', tr('ws.ssh'), loaded && !sshAvailable ? tr('ws.sshNone') : tr('ws.sshDesc'), loaded && !sshAvailable)),
        remote && list.length > 0 && h('div', { className: 'lwr-field' },
          h('label', { htmlFor: 'lwr-distro' }, tr(kind === 'ssh' ? 'ws.host' : 'ws.distro')),
          h('select', { id: 'lwr-distro', className: 'lwr-select', value: distro ?? '', onChange: (event) => setDistro(event.target.value) },
            list.map((entry) => h('option', { key: entry.name, value: entry.name }, `${hostTitle(entry.name)}${entry.os ? ` · ${osLabelOf(entry.os)}` : ''}`))),
          selected && selected.state !== 'connected' && h('div', { className: 'lwr-note' }, tr(isSsh(selected.name) ? 'ws.notConnectedSsh' : 'ws.notConnected', { distro: destOf(selected.name) }))));
      }

      /** In-app Linux folder browser for one distribution (paths are Linux paths). */
      function LinuxPicker({ distro, busy, onOpen, onBack, onCancel }) {
        const tr = useT();
        const [listing, setListing] = React.useState(null);
        const [loading, setLoading] = React.useState(true);
        const [error, setError] = React.useState(null);
        const [draft, setDraft] = React.useState('');
        const [showHidden, setShowHidden] = React.useState(false);
        const [folderName, setFolderName] = React.useState(null);
        const request = React.useRef(0);
        const navigate = React.useCallback(async (path) => {
          const id = ++request.current;
          setLoading(true);
          setError(null);
          try {
            const value = await call('api/local-wsl-remote/linux/list', { method: 'POST', body: JSON.stringify({ distro, ...(path === undefined ? {} : { path }) }) });
            if (id !== request.current) return;
            setListing(value);
            setDraft(value.path);
          } catch (reason) {
            if (id !== request.current) return;
            setError(reason.message);
          } finally {
            if (id === request.current) setLoading(false);
          }
        }, [distro]);
        React.useEffect(() => {
          navigate(undefined);
        }, [navigate]);
        const go = () => {
          const value = draft.trim();
          if (!value.startsWith('/') && !value.startsWith('~')) {
            setError(tr('picker.absolute'));
            return;
          }
          navigate(value);
        };
        const parentOf = (path) => (path === '/' ? '/' : path.replace(/\/[^/]+$/, '') || '/');
        const createFolder = async () => {
          const name = (folderName ?? '').trim();
          if (!name || listing === null) return;
          try {
            const created = await call('api/local-wsl-remote/linux/mkdir', { method: 'POST', body: JSON.stringify({ distro, parent: listing.path, name }) });
            setFolderName(null);
            navigate(created.path);
          } catch (reason) {
            setError(reason.message);
          }
        };
        const entries = (listing?.entries ?? []).filter((entry) => showHidden || !entry.hidden);
        const inert = busy || loading;
        return h(Modal, {
          open: true,
          onClose: () => {
            if (!busy) onCancel();
          },
          title: tr('picker.title', { distro: hostTitle(distro) }),
          closeLabel: tr('ws.cancel'),
          footer: h('div', { className: 'lwr-picker-foot', style: { width: '100%' } },
            h(Button, { variant: 'outline', disabled: busy, onClick: onBack }, tr('picker.back')),
            h('span', { className: 'lwr-gap' }),
            h(Button, { variant: 'outline', disabled: busy, onClick: onCancel }, tr('ws.cancel')),
            h(Button, { variant: 'primary', disabled: inert || listing === null || error !== null, onClick: () => onOpen(listing.path) }, tr('picker.open'))),
        },
        h('div', { className: 'lwr-picker' },
          h('div', { className: 'lwr-picker-bar' },
            h('button', { type: 'button', className: 'lwr-icon-btn', title: tr('picker.up'), 'aria-label': tr('picker.up'), disabled: inert || listing === null || listing.path === '/', onClick: () => navigate(parentOf(listing.path)) }, UpIcon ? h(UpIcon, { size: 14 }) : '↑'),
            h('button', { type: 'button', className: 'lwr-icon-btn', title: tr('picker.home'), 'aria-label': tr('picker.home'), disabled: inert, onClick: () => navigate(undefined) }, HomeIcon ? h(HomeIcon, { size: 14 }) : '~'),
            h('input', {
              className: 'lwr-picker-path',
              value: draft,
              spellCheck: false,
              'aria-label': tr('picker.path'),
              disabled: busy,
              onChange: (event) => setDraft(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  go();
                }
              },
            }),
            h(Button, { variant: 'outline', disabled: busy, onClick: go }, tr('picker.go'))),
          listing && h('div', { className: 'lwr-crumbs', role: 'navigation' },
            listing.crumbs.map((crumb, index) => h(React.Fragment, { key: crumb.path },
              index > 1 && h('span', { 'aria-hidden': true }, '/'),
              h('button', { type: 'button', className: 'lwr-crumb', disabled: inert, onClick: () => navigate(crumb.path) }, crumb.name)))),
          h('div', { className: 'lwr-dirs', role: 'listbox', 'aria-label': listing?.path ?? '', 'aria-busy': loading },
            loading && h('div', { className: 'lwr-dirs-status', role: 'status' }, tr('picker.loading')),
            !loading && error && h('div', { className: 'lwr-dirs-status lwr-alert', role: 'alert' }, error),
            !loading && !error && entries.length === 0 && h('div', { className: 'lwr-dirs-status' }, tr('picker.empty')),
            !loading && !error && entries.map((entry) => h('button', {
              key: entry.path,
              type: 'button',
              role: 'option',
              className: 'lwr-dir',
              'data-hidden': entry.hidden ? '' : undefined,
              disabled: busy,
              onClick: () => navigate(entry.path),
              title: entry.path,
            }, h('span', { className: 'lwr-dir-icon' }, FolderIcon ? h(FolderIcon, { size: 16 }) : '📁'), h('span', { className: 'lwr-dir-name' }, entry.name)))),
          !loading && listing?.truncated && h('div', { className: 'lwr-note' }, tr('picker.truncated', { count: listing.entries.length })),
          folderName !== null && h('div', { className: 'lwr-picker-bar' },
            h('input', {
              className: 'lwr-picker-path',
              autoFocus: true,
              value: folderName,
              placeholder: tr('picker.folderName'),
              'aria-label': tr('picker.folderName'),
              onChange: (event) => setFolderName(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) createFolder();
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  setFolderName(null);
                }
              },
            }),
            h(Button, { variant: 'primary', disabled: !folderName.trim(), onClick: createFolder }, tr('picker.create')),
            h(Button, { variant: 'outline', onClick: () => setFolderName(null) }, tr('ws.cancel'))),
          h('div', { className: 'lwr-picker-foot' },
            folderName === null && h(Button, { variant: 'outline', disabled: inert || listing === null, onClick: () => setFolderName('') }, tr('picker.newFolder')),
            h('label', { className: 'lwr-check' },
              h('input', { type: 'checkbox', checked: showHidden, onChange: (event) => setShowHidden(event.target.checked) }),
              tr('picker.showHidden'))),
          listing && h('div', { className: 'lwr-target' }, tr('picker.target', { path: '' }), h('code', null, `${destOf(distro)}:${listing.path}`))));
      }

      /**
       * Occupant of the add-workspace holes. Registered one priority below the
       * shipped picker (lowest renders), it asks Local or WSL first; Local
       * delegates to the Desktop's native folder dialog, WSL opens LinuxPicker.
       * The owner adopts the picked path exactly as for the native picker.
       */
      function AddWorkspaceFlow({ open, busy, onPicked, onCancel, onError }) {
        const [stage, setStage] = React.useState('closed');
        const [distro, setDistro] = React.useState(undefined);
        const wasOpen = React.useRef(false);
        React.useEffect(() => {
          if (open && !wasOpen.current) {
            distros.refresh();
            setStage('choose');
          }
          if (!open) setStage('closed');
          wasOpen.current = open;
        }, [open]);
        const local = async () => {
          setStage('local');
          try {
            const path = await pickLocal();
            if (path === null || path === undefined) onCancel();
            else onPicked(path);
          } catch (error) {
            onError(error instanceof Error ? error.message : String(error));
          }
        };
        if (!open || stage === 'closed' || stage === 'local') return null;
        if (stage === 'choose') {
          return h(Chooser, {
            onLocal: local,
            onWsl: (name) => {
              setDistro(name);
              setStage('wsl');
            },
            onCancel,
          });
        }
        return h(LinuxPicker, {
          distro,
          busy,
          onOpen: (linux) => onPicked(toAddress(distro, linux)),
          onBack: () => setStage('choose'),
          onCancel,
        });
      }

      // The holes live under `sidebar.workspaces` / the hero picker; inject waits for their declaration.
      const register = (name) => ctx.slots.inject(name, () => ctx.slots.register({ name, priority: -1 }, AddWorkspaceFlow));
      register('sidebar.workspaces.directoryFlow');
      register('conversation.hero.workspace.directoryFlow');

      // ---- Sidebar badge: "WSL · Ubuntu 26.04" right of a WSL workspace name. ----
      // The workspace row has no slot for decorations, so the badge is placed in
      // the DOM next to the row title and kept there across React re-renders.

      ctx.effect(() => {
        let workspaceItems = [];
        let distroState = distros.getSnapshot();
        let frame = 0;
        let lastAsk = 0;
        const schedule = () => {
          if (frame) return;
          frame = requestAnimationFrame(() => {
            frame = 0;
            paint();
          });
        };
        // The workspace client service may mount after this plugin: follow it whenever it appears.
        let workspaces;
        let offWorkspaces;
        const attach = () => {
          const current = ctx.get('workspaces');
          if (current === workspaces) return;
          offWorkspaces?.();
          workspaces = current;
          workspaceItems = workspaces?.list?.getSnapshot?.().items ?? [];
          offWorkspaces = workspaces?.list?.subscribe?.(() => {
            workspaceItems = workspaces.list.getSnapshot().items ?? [];
            schedule();
          });
        };
        attach();
        const offDistros = distros.subscribe(() => {
          distroState = distros.getSnapshot();
          schedule();
        });
        const offLocale = ctx.locale.subscribe(() => schedule());
        const stateText = (state) => t(`state.${state ?? 'disconnected'}`);
        const paint = () => {
          attach();
          const byId = new Map(workspaceItems.map((item) => [item.workspaceId, item]));
          // A WSL workspace the Host has not reported yet (just added): ask again.
          if (workspaceItems.some((item) => isLinuxPath(item.path) && distroState.workspaces[item.workspaceId] === undefined) && Date.now() - lastAsk > 2000) {
            lastAsk = Date.now();
            distros.refresh();
          }
          for (const row of document.querySelectorAll('[data-row-key^="workspace:"]')) {
            const id = row.getAttribute('data-row-key').slice('workspace:'.length);
            const info = wslInfo(byId.get(id), distroState.workspaces);
            const holder = row.querySelector('[class$="_projectText"]');
            if (holder === null) continue;
            let tag = holder.querySelector(':scope > .lwr-wsl-tag');
            if (info === undefined) {
              tag?.remove();
              holder.removeAttribute('data-lwr-titled');
              continue;
            }
            const entry = distroState.distros.find((item) => item.name.toLowerCase() === info.distro.toLowerCase());
            const os = osLabelOf(entry?.os);
            const state = entry?.state ?? 'disconnected';
            const ssh = isSsh(info.distro);
            const shown = destOf(info.distro);
            const title = os ? t(ssh ? 'badge.titleSsh' : 'badge.title', { distro: shown, os, state: stateText(state) }) : t(ssh ? 'badge.titleSshNoOs' : 'badge.titleNoOs', { distro: shown, state: stateText(state) });
            const key = `${info.distro}|${os}|${state}|${title}`;
            if (tag !== null && tag.dataset.key === key) continue;
            if (tag === null) {
              tag = document.createElement('span');
              tag.className = 'lwr-wsl-tag';
              holder.appendChild(tag);
            }
            holder.setAttribute('data-lwr-titled', '');
            tag.dataset.key = key;
            tag.title = `${title}\n${info.linux}`;
            tag.replaceChildren();
            const dot = document.createElement('span');
            dot.className = 'lwr-wsl-dot';
            dot.dataset.state = state;
            const label = document.createElement('b');
            label.textContent = ssh ? 'SSH' : 'WSL';
            // An SSH badge names the server: several hosts often run the same OS.
            tag.append(dot, label, document.createTextNode(ssh ? ` · ${shown}` : os ? ` · ${os}` : ` · ${shown}`));
          }
        };
        // Rows mount, scroll into view (virtualised) and re-render; repaint on any change outside our own badges.
        const observer = new MutationObserver((records) => {
          for (const record of records) {
            if (record.target instanceof Element && record.target.closest('.lwr-wsl-tag')) continue;
            if ([...record.addedNodes].every((node) => node instanceof Element && node.classList.contains('lwr-wsl-tag'))) continue;
            schedule();
            return;
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        schedule();
        return () => {
          observer.disconnect();
          if (frame) cancelAnimationFrame(frame);
          offWorkspaces?.();
          offDistros();
          offLocale?.();
          for (const tag of document.querySelectorAll('.lwr-wsl-tag')) tag.remove();
          for (const holder of document.querySelectorAll('[data-lwr-titled]')) holder.removeAttribute('data-lwr-titled');
        };
      }, 'wsl-remote: WSL workspace badges');

      // ---- `dsh-harness <path>` from WSL: add the folder as a WSL workspace and open it. ----
      ctx.effect(() => {
        let stopped = false;
        let timer;
        const handled = new Set();
        const poll = async () => {
          if (stopped) return;
          try {
            const { requests = [] } = await call('api/local-wsl-remote/open-requests');
            for (const request of requests) {
              if (handled.has(request.id)) continue;
              handled.add(request.id);
              // Several windows may poll; only the one that claims the request acts on it.
              const { claimed } = await call('api/local-wsl-remote/open-requests/claim', { method: 'POST', body: JSON.stringify({ id: request.id }) });
              if (!claimed) continue;
              const workspaces = ctx.get('workspaces');
              if (workspaces?.create === undefined) continue;
              const workspace = await workspaces.create({ path: request.unc });
              ctx.get('uiWorkspace')?.startSession?.(workspace.workspaceId, { clearPreviousDraft: false });
              connectionStore.refresh();
              distros.refresh();
            }
          } catch (error) {
            console.warn('[wsl-remote] dsh-harness request failed:', error);
          } finally {
            if (!stopped) timer = setTimeout(poll, 1500);
          }
        };
        poll();
        return () => {
          stopped = true;
          clearTimeout(timer);
        };
      }, 'wsl-remote: dsh-harness open requests');
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        // Streams opened before the Host merge was installed (including while
        // the plugin was disabled) must reopen through the current bridge.
        ctx.inject(['connection'], (scope) => {
          const abort = new AbortController();
          let timer;
          const refreshBridge = async () => {
            try {
              const status = await call('api/local-wsl-remote/connections', { signal: abort.signal });
              if (abort.signal.aborted) return;
              if (status.bridgeReady) {
                scope.connection.reconnect();
                return;
              }
            } catch {
              if (abort.signal.aborted) return;
            }
            timer = setTimeout(refreshBridge, 1000);
          };
          scope.effect(() => {
            refreshBridge();
            return () => {
              abort.abort();
              clearTimeout(timer);
            };
          }, 'wsl-remote: reopen subscriptions after activation');
        });
        for (const [language, dictionary] of Object.entries(dictionaries)) ctx.effect(() => ctx.locale.register(NS, language, dictionary));
        const raw = ctx.locale.bind(NS);
        const t = (key, values) => format(raw(key), values);
        const localeSub = (notify) => ctx.locale.subscribe(notify);
        const localeSnap = () => ctx.locale.getSnapshot();

        /** Shared status, polled while a settings row is visible. */
        const store = (() => {
          let state = { status: 'loading' };
          const listeners = new Set();
          let timer;
          const set = (next) => {
            state = next;
            for (const listener of listeners) listener();
          };
          const refresh = () => call('api/local-wsl-remote/connections')
            .then((value) => set({ status: 'ready', value }))
            .catch((error) => set({ status: 'error', message: error.message }));
          return {
            subscribe(listener) {
              listeners.add(listener);
              if (listeners.size === 1) {
                refresh();
                timer = setInterval(refresh, POLL_MS);
              }
              return () => {
                listeners.delete(listener);
                if (listeners.size === 0) clearInterval(timer);
              };
            },
            getSnapshot: () => state,
            accept: (value) => set({ status: 'ready', value }),
            refresh: () => {
              if (listeners.size > 0) refresh();
            },
          };
        })();

        const useT = () => {
          React.useSyncExternalStore(localeSub, localeSnap, localeSnap);
          return t;
        };
        const useStatus = () => React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

        const openUrl = async (distro, external) => {
          const { url } = await call('api/local-wsl-remote/open', { method: 'POST', body: JSON.stringify({ distro }) });
          const sidebar = ctx.get('sidebarRight');
          const browserTab = ctx.get('sidebarRightTabs')?.get?.('browser');
          if (!external && sidebar !== undefined && browserTab !== undefined) sidebar.openTab('browser', { params: { url } });
          else window.open(url, '_blank', 'noopener');
        };

        function Command({ command }) {
          const tr = useT();
          const [copied, setCopied] = React.useState(false);
          const copy = async () => {
            try {
              await navigator.clipboard.writeText(command);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {}
          };
          return h('div', { className: 'lwr-cmd' },
            h('code', null, command),
            h('button', { type: 'button', className: 'lwr-button lwr-copy', onClick: copy }, tr(copied ? 'copied' : 'copy')));
        }

        /** Install guidance: why something cannot start on a remote host, and the commands that fix it. */
        function Requirement({ host, requirement = host.requirement }) {
          const tr = useT();
          const ssh = isSsh(host.name);
          return h('div', { className: 'lwr-req', role: 'alert' },
            h('div', { className: 'lwr-alert' }, tr(`req.${requirement.reason}`, { distro: destOf(host.name), found: requirement.found ?? '', minimum: requirement.minimum })),
            requirement.steps.map((step, index) => h('div', { key: index, className: 'lwr-step' },
              h('div', { className: 'lwr-step-note' }, `${index + 1}. ${tr(`req.note.${step.note}`, { minimum: requirement.minimum })}`),
              h(Command, { command: step.command }))),
            ssh ? h('div', { className: 'lwr-note' }, tr('req.terminalSsh', { dest: destOf(host.name) }))
              : h('div', { className: 'lwr-note' }, tr('req.terminal', { distro: host.name })));
        }


        function Launcher({ launcher }) {
          const tr = useT();
          if (launcher.conflict) return h('div', { className: 'lwr-note' }, tr('launcher.conflict', { path: launcher.path }));
          if (launcher.error) return h('div', { className: 'lwr-note' }, tr('launcher.error', { message: launcher.error }));
          if (!launcher.installed) return null;
          return h('div', { className: 'lwr-note' }, tr(launcher.onPath ? 'launcher.ready' : 'launcher.notOnPath', { path: launcher.path }));
        }

        const osLabel = (os) => (os ? [os.name, os.version].filter(Boolean).join(' ') || os.pretty : '');

        const pluginTitle = (plugin) => {
          const title = plugin.meta?.title;
          if (title && typeof title === 'object') {
            const zh = String(document.documentElement.lang || navigator.language || '').toLowerCase().startsWith('zh');
            return (zh ? title.zh : title.en) ?? title.en ?? title.zh ?? plugin.name;
          }
          return plugin.name;
        };

        /** One installation into WSL: phase, elapsed time, live pnpm output, cancel, and a stall notice. */
        function InstallJob({ job, onCancel, onClose }) {
          const tr = useT();
          const logRef = React.useRef(null);
          React.useEffect(() => {
            if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
          }, [job.lines.length]);
          const running = job.status === 'running';
          const seconds = Math.round(job.elapsedMs / 1000);
          const phase = ['starting', 'installing', 'applying', 'cancelling'].includes(job.phase) ? tr(`plugins.phase.${job.phase}`) : job.phase;
          return h('div', { className: 'lwr-job', role: 'status', 'aria-live': 'polite' },
            h('div', { className: 'lwr-job-head' },
              h('span', { className: 'lwr-plugin-name' }, tr('plugins.installing', { spec: job.spec })),
              h('span', { className: 'lwr-tag' }, running ? `${phase} · ${seconds}s` : tr(`plugins.status.${job.status}`)),
              h('span', { style: { flex: 1 } }),
              running && h('button', { type: 'button', className: 'lwr-button', disabled: Boolean(job.cancelRequested), onClick: onCancel }, tr(job.cancelRequested ? 'plugins.cancelling' : 'plugins.cancel')),
              !running && h('button', { type: 'button', className: 'lwr-button', onClick: onClose }, tr('plugins.close'))),
            job.stalled && running && !job.cancelRequested && h('div', { className: 'lwr-alert' }, tr('plugins.stalled', { seconds: Math.round(job.silentMs / 1000) })),
            job.cancelRequested === 'too-late' && h('div', { className: 'lwr-note' }, tr('plugins.tooLate')),
            h('pre', { ref: logRef, className: 'lwr-job-log' }, job.lines.length > 0 ? job.lines.join('\n') : tr('plugins.waitingOutput')));
        }

        /** The plugins of one distribution's dsh, marked against Windows, managed through that dsh's plugin manager. */
        function Plugins({ host }) {
          const tr = useT();
          const [state, setState] = React.useState({ status: 'loading' });
          const [busy, setBusy] = React.useState(undefined);
          const [notice, setNotice] = React.useState(undefined);
          const [spec, setSpec] = React.useState('');
          const [job, setJob] = React.useState(undefined);
          const load = React.useCallback(async () => {
            try {
              setState({ status: 'ready', value: await call('api/local-wsl-remote/plugins', { method: 'POST', body: JSON.stringify({ distro: host.name }) }) });
            } catch (error) {
              setState({ status: 'error', message: error.message });
            }
          }, [host.name]);
          React.useEffect(() => {
            load();
            // An installation started earlier (another window, a reload) is picked up again.
            call('api/local-wsl-remote/plugins/install-status', { method: 'POST', body: JSON.stringify({ distro: host.name }) })
              .then((value) => { if (value.job?.status === 'running') setJob(value.job); })
              .catch(() => {});
          }, [load, host.name]);
          // Poll a running installation; when it ends, reload the list and report its outcome.
          React.useEffect(() => {
            if (job?.status !== 'running') return undefined;
            let stopped = false;
            const timer = setTimeout(async () => {
              try {
                const value = await call('api/local-wsl-remote/plugins/install-status', { method: 'POST', body: JSON.stringify({ id: job.id }) });
                if (stopped || value.job === null) return;
                setJob(value.job);
                if (value.job.status !== 'running') {
                  await load();
                  const result = value.job.result;
                  if (value.job.status === 'cancelled') setNotice({ kind: 'info', text: tr('plugins.cancelled') });
                  else if (value.job.status === 'failed') setNotice({ kind: 'error', text: tr('plugins.failed', { message: value.job.error ?? result?.error?.message ?? result?.reason ?? result?.error?.code ?? 'failed' }) });
                  else if (result?.application === 'restart-required') setNotice({ kind: 'restart' });
                  else setNotice({ kind: 'info', text: tr('plugins.installed', { name: result?.bundle ?? value.job.spec }) });
                }
              } catch (error) {
                if (!stopped) setNotice({ kind: 'error', text: tr('plugins.failed', { message: error.message }) });
              }
            }, 1000);
            return () => {
              stopped = true;
              clearTimeout(timer);
            };
          }, [job, load]);
          const install = async (installSpec) => {
            setNotice(undefined);
            try {
              const value = await call('api/local-wsl-remote/plugins/install', { method: 'POST', body: JSON.stringify({ distro: host.name, spec: installSpec }) });
              setJob(value.job);
              setSpec('');
            } catch (error) {
              setNotice({ kind: 'error', text: tr('plugins.failed', { message: error.message }) });
            }
          };
          const cancel = async () => {
            if (job === undefined) return;
            try {
              setJob((await call('api/local-wsl-remote/plugins/install-cancel', { method: 'POST', body: JSON.stringify({ id: job.id }) })).job);
            } catch (error) {
              setNotice({ kind: 'error', text: tr('plugins.failed', { message: error.message }) });
            }
          };
          const installing = job?.status === 'running';
          const change = async (key, payload) => {
            setBusy(key);
            setNotice(undefined);
            try {
              const value = await call('api/local-wsl-remote/plugins/change', { method: 'POST', body: JSON.stringify({ distro: host.name, ...payload }) });
              setState({ status: 'ready', value });
              const application = value.result?.application;
              if (application === 'failed' || value.result?.status === 'refused') setNotice({ kind: 'error', text: tr('plugins.failed', { message: value.result?.error?.message ?? value.result?.reason ?? value.result?.error?.code ?? application }) });
              else if (application === 'restart-required') setNotice({ kind: 'restart' });
              else setNotice({ kind: 'info', text: tr('plugins.applied') });
            } catch (error) {
              setNotice({ kind: 'error', text: tr('plugins.failed', { message: error.message }) });
            } finally {
              setBusy(undefined);
            }
          };
          const restart = async () => {
            setBusy('restart');
            try {
              await call('api/local-wsl-remote/restart', { method: 'POST', body: JSON.stringify({ distro: host.name }) });
              setNotice(undefined);
              await load();
            } catch (error) {
              setNotice({ kind: 'error', text: tr('plugins.failed', { message: error.message }) });
            } finally {
              setBusy(undefined);
            }
          };
          const value = state.status === 'ready' ? state.value : undefined;
          const tag = (where, version) => h('span', { className: 'lwr-tag', 'data-where': where }, tr(`plugins.where.${where}`, { version: version ?? '?' }));
          return h('div', { className: 'lwr-plugins' },
            h('div', { className: 'lwr-plugin-toolbar' },
              h('div', null,
                h('h2', { className: 'lwr-title' }, tr('plugins.title', { distro: hostTitle(host.name) })),
                h('div', { className: 'lwr-note' }, tr('plugins.scope', { distro: hostTitle(host.name), profile: host.profile ?? 'web' }))),
              h('button', { type: 'button', className: 'lwr-button', disabled: busy !== undefined || installing, onClick: load }, tr('plugins.refresh'))),
            state.status === 'loading' && h('div', { className: 'lwr-note' }, tr('plugins.loading')),
            state.status === 'error' && h('div', { className: 'lwr-alert', role: 'alert' }, state.message),
            value && value.plugins.length === 0 && h('div', { className: 'lwr-note' }, tr('plugins.empty')),
            value && value.plugins.map((plugin) => h('div', { key: plugin.name, className: 'lwr-plugin' },
              h('div', { className: 'lwr-text' },
                h('span', { className: 'lwr-plugin-name', title: plugin.name }, pluginTitle(plugin)),
                plugin.version && h('span', { className: 'lwr-plugin-version' }, plugin.version),
                tag(plugin.where, plugin.windows?.version),
                !plugin.enabled && h('span', { className: 'lwr-tag' }, tr('plugins.disabled')),
                plugin.error && h('div', { className: 'lwr-alert' }, plugin.error)),
              h('div', { className: 'lwr-actions' },
                h('button', { type: 'button', className: 'lwr-button', disabled: busy !== undefined, onClick: () => change(`enable:${plugin.name}`, { action: 'enable', name: plugin.name, enabled: !plugin.enabled }) }, tr(plugin.enabled ? 'plugins.disable' : 'plugins.enable')),
                plugin.removable && h('button', {
                  type: 'button',
                  className: 'lwr-button',
                  disabled: busy !== undefined,
                  onClick: () => {
                    if (window.confirm(tr('plugins.removeConfirm', { name: plugin.name, distro: hostTitle(host.name) }))) change(`remove:${plugin.name}`, { action: 'remove', name: plugin.name });
                  },
                }, tr('plugins.remove'))))),
            value && h('div', { className: 'lwr-plugin-install' },
              h('input', {
                className: 'lwr-input',
                value: spec,
                spellCheck: false,
                placeholder: tr('plugins.spec'),
                'aria-label': tr('plugins.spec'),
                disabled: busy !== undefined || installing,
                onChange: (event) => setSpec(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter' && spec.trim()) install(spec.trim());
                },
              }),
              h('button', { type: 'button', className: 'lwr-button', disabled: busy !== undefined || installing || !spec.trim(), onClick: () => install(spec.trim()) }, tr('plugins.install'))),
            job && h(InstallJob, { job, onCancel: cancel, onClose: () => setJob(undefined) }),
            notice?.kind === 'restart' && h('div', { className: 'lwr-info' }, tr('plugins.restartNeeded'),
              ' ',
              h('button', { type: 'button', className: 'lwr-button', 'data-primary': '', disabled: busy !== undefined, onClick: restart }, tr('plugins.restart'))),
            notice?.kind === 'info' && h('div', { className: 'lwr-note' }, notice.text),
            notice?.kind === 'error' && h('div', { className: 'lwr-alert', role: 'alert' }, notice.text),
            busy !== undefined && h('div', { className: 'lwr-note', role: 'status' }, '…'),
            h('div', null, h('button', { type: 'button', className: 'lwr-button', onClick: () => openUrl(host.name, false).catch(() => {}) }, tr('plugins.openUi'))));
        }

        function Host({ host, onResult }) {
          const tr = useT();
          const [busy, setBusy] = React.useState(false);
          const [failure, setFailure] = React.useState(undefined);
          const run = async (action) => {
            setBusy(true);
            setFailure(undefined);
            try {
              await action();
            } catch (error) {
              setFailure(error.message);
            } finally {
              setBusy(false);
            }
          };
          const post = (path) => run(async () => onResult(await call(`api/local-wsl-remote/${path}`, { method: 'POST', body: JSON.stringify({ distro: host.name }) })));
          const connected = host.state === 'connected';
          const connecting = host.state === 'connecting';
          const ssh = isSsh(host.name);
          const remove = () => {
            if (window.confirm(tr('ssh.removeConfirm', { dest: destOf(host.name) }))) post('ssh/remove');
          };
          const details = [];
          if (host.dsh) details.push(tr('version', { version: host.dsh }));
          if (connected && host.shareLogin !== undefined) details.push(tr(host.shareLogin ? 'shared' : 'separate'));
          if (connected && host.profile) details.push(`profile ${host.profile}`);
          return h('div', { className: 'lwr-host-wrap' }, h('div', { className: 'lwr-host' },
            h('span', { className: 'lwr-dot', 'data-state': host.state, 'aria-hidden': true }),
            h('div', { className: 'lwr-text' },
              h('div', { className: 'lwr-name' }, hostTitle(host.name),
                host.os && h('span', { className: 'lwr-os', title: host.os.pretty || undefined }, osLabel(host.os)),
                host.isDefault && h('span', { className: 'lwr-badge' }, tr('default'))),
              h('div', { className: 'lwr-note' }, [tr(`state.${host.state}`), ...details].join(' · ')),
              host.requirement && h(Requirement, { host }),
              host.state === 'error' && host.error && !host.requirement && h('div', { className: 'lwr-alert', role: 'alert' }, host.error),
              host.state === 'error' && host.hint && h('div', { className: 'lwr-note' }, tr(`ssh.hint.${host.hint}`, { dest: destOf(host.name) })),
              host.launcher && h(Launcher, { launcher: host.launcher }),
              failure && h('div', { className: 'lwr-alert', role: 'alert' }, failure)),
            h('div', { className: 'lwr-actions' },
              connected && h('button', { type: 'button', className: 'lwr-button', 'data-primary': '', disabled: busy, onClick: () => run(() => openUrl(host.name, false)) }, tr('open')),
              connected && h('button', { type: 'button', className: 'lwr-button', disabled: busy, onClick: () => run(() => openUrl(host.name, true)) }, tr('openExternal')),
              (connected || connecting) && h('button', { type: 'button', className: 'lwr-button', disabled: busy, onClick: () => post('disconnect') }, tr('disconnect')),
              !connected && !connecting && h('button', { type: 'button', className: 'lwr-button', 'data-primary': '', disabled: busy, onClick: () => post('connect') }, tr(host.state === 'error' ? 'retry' : 'connect')),
              ssh && !connecting && h('button', { type: 'button', className: 'lwr-button', disabled: busy, onClick: remove }, tr('ssh.remove')))));
        }

        /** SSH hosts: added by destination, then listed with the WSL distributions and used the same way. */
        function SshHosts({ value }) {
          const tr = useT();
          const [draft, setDraft] = React.useState('');
          const [busy, setBusy] = React.useState(false);
          const [failure, setFailure] = React.useState(undefined);
          const add = async (dest) => {
            const target = (dest ?? draft).trim();
            if (!target) return;
            setBusy(true);
            setFailure(undefined);
            try {
              store.accept(await call('api/local-wsl-remote/ssh/add', { method: 'POST', body: JSON.stringify({ dest: target }) }));
              setDraft('');
            } catch (error) {
              setFailure(error.message);
            } finally {
              setBusy(false);
            }
          };
          const hosts = value.distros.filter((host) => isSsh(host.name));
          const suggestions = value.sshConfigHosts ?? [];
          return h('div', { className: 'lwr-block', 'data-lwr-ssh': '' },
            h('div', { className: 'lwr-title' }, tr('ssh.title')),
            h('div', { className: 'lwr-desc' }, tr('ssh.description')),
            hosts.length === 0 && h('div', { className: 'lwr-note' }, tr('ssh.none')),
            hosts.length > 0 && h('div', { className: 'lwr-list' }, hosts.map((host) => h(Host, { key: host.name, host, onResult: store.accept }))),
            h('div', { className: 'lwr-plugin-install', style: { marginTop: 12 } },
              h('input', {
                className: 'lwr-input',
                value: draft,
                spellCheck: false,
                placeholder: tr('ssh.placeholder'),
                'aria-label': tr('ssh.placeholder'),
                disabled: busy,
                onChange: (event) => setDraft(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter' && !event.nativeEvent?.isComposing) add();
                },
              }),
              h('button', { type: 'button', className: 'lwr-button', 'data-primary': '', disabled: busy || !draft.trim(), onClick: () => add() }, tr('ssh.add'))),
            suggestions.length > 0 && h('div', { className: 'lwr-note', style: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' } },
              tr('ssh.fromConfig'),
              suggestions.map((dest) => h('button', { key: dest, type: 'button', className: 'lwr-button lwr-copy', disabled: busy, onClick: () => add(dest) }, `+ ${dest}`))),
            failure && h('div', { className: 'lwr-alert', role: 'alert' }, failure));
        }

        function ConnectionsRow() {
          const tr = useT();
          const status = useStatus();
          const value = status.status === 'ready' ? status.value : undefined;
          const wsl = value ? value.distros.filter((host) => !isSsh(host.name)) : [];
          return h(React.Fragment, null, h('div', { className: 'lwr-block' },
            h('style', null, css),
            h('div', { className: 'lwr-title' }, tr('title')),
            h('div', { className: 'lwr-desc' }, tr('description')),
            value?.migratedFromStartupMode && h('div', { className: 'lwr-info' }, tr('migrated')),
            status.status === 'loading' && h('div', { className: 'lwr-note' }, tr('loading')),
            status.status === 'error' && h('div', { className: 'lwr-alert', role: 'alert' }, status.message),
            value && value.platform !== 'win32' && h('div', { className: 'lwr-note' }, tr('notWindows')),
            value && value.platform === 'win32' && wsl.length === 0 && !value.discoveryError && h('div', { className: 'lwr-note' }, tr('none')),
            value && value.discoveryError && h('div', { className: 'lwr-alert', role: 'alert' }, tr('discoveryError', { message: value.discoveryError })),
            wsl.length > 0 && h('div', { className: 'lwr-list' },
              wsl.map((host) => h(Host, { key: host.name, host, onResult: store.accept }))),
            value && value.distros.length > 0 && h('div', { className: 'lwr-note' }, tr('requirement', { version: value.minimumDsh }))),
          value && h(SshHosts, { value }));
        }

        function ShareRow() {
          const tr = useT();
          const status = useStatus();
          const value = status.status === 'ready' ? status.value : undefined;
          const [failure, setFailure] = React.useState(undefined);
          if (!value || value.distros.length === 0) return null;
          const anyConnected = value.distros.some((host) => host.state === 'connected');
          const save = async (patch) => {
            setFailure(undefined);
            try {
              store.accept(await call('api/local-wsl-remote/settings', { method: 'POST', body: JSON.stringify(patch) }));
            } catch (error) {
              setFailure(error.message);
            }
          };
          return h(React.Fragment, null,
            h('div', { className: 'lwr-row' },
              h('div', { className: 'lwr-text' },
                h('div', { className: 'lwr-title', id: 'lwr-share-title' }, tr('share.title')),
                h('div', { className: 'lwr-desc' }, tr('share.description')),
                !value.credentialsAvailable && h('div', { className: 'lwr-alert' }, tr('share.unavailable')),
                anyConnected && h('div', { className: 'lwr-note' }, tr('reconnect')),
                failure && h('div', { className: 'lwr-alert', role: 'alert' }, failure)),
              h('button', {
                type: 'button',
                role: 'switch',
                className: 'lwr-switch',
                'aria-checked': value.shareLogin && value.credentialsAvailable,
                'aria-labelledby': 'lwr-share-title',
                disabled: !value.credentialsAvailable,
                onClick: () => save({ shareLogin: !value.shareLogin }),
              })),
            h(ProfileRow, { value, save }));
        }

        function ProfileRow({ value, save }) {
          const tr = useT();
          const [draft, setDraft] = React.useState(value.profile);
          React.useEffect(() => setDraft(value.profile), [value.profile]);
          const commit = () => {
            if (draft.trim() && draft.trim() !== value.profile) save({ profile: draft.trim() });
            else setDraft(value.profile);
          };
          return h('div', { className: 'lwr-row' },
            h('div', { className: 'lwr-text' },
              h('div', { className: 'lwr-title', id: 'lwr-profile-title' }, tr('profile.title')),
              h('div', { className: 'lwr-desc' }, tr('profile.description'))),
            h('input', {
              className: 'lwr-input',
              value: draft,
              spellCheck: false,
              'aria-labelledby': 'lwr-profile-title',
              onChange: (event) => setDraft(event.target.value),
              onBlur: commit,
              onKeyDown: (event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              },
            }));
        }

        /**
         * Sync plugins from one host to another (Windows, WSL or SSH). The Host
         * re-plans before starting, so this panel only chooses plugin names.
         */
        function PluginSync({ hosts, initialTarget }) {
          const tr = useT();
          const options = [{ name: 'windows', state: 'connected' }, ...hosts];
          const title = (name) => (name === 'windows' || name === null || name === undefined ? 'Windows' : hostTitle(name));
          const [source, setSource] = React.useState('windows');
          const [target, setTarget] = React.useState(initialTarget ?? hosts[0]?.name ?? '');
          const [plan, setPlan] = React.useState(undefined);
          const [picked, setPicked] = React.useState([]);
          const [busy, setBusy] = React.useState(false);
          const [failure, setFailure] = React.useState('');
          const [run, setRun] = React.useState(undefined);
          const stateOf = (name) => options.find((item) => item.name === name)?.state;
          const ready = source && target && source !== target && stateOf(source) === 'connected' && stateOf(target) === 'connected';
          const post = (path, data) => call(`api/local-wsl-remote/plugins/${path}`, { method: 'POST', body: JSON.stringify(data) });
          const wire = (name) => (name === 'windows' ? null : name);
          const compare = async () => {
            setBusy(true);
            setFailure('');
            setPlan(undefined);
            try {
              const value = await post('sync-plan', { source: wire(source), target: wire(target) });
              setPlan(value);
              setPicked(value.rows.filter((row) => row.action !== undefined).map((row) => row.name));
            } catch (error) {
              setFailure(error.message);
            } finally {
              setBusy(false);
            }
          };
          // A run started earlier (another window, a reload) is picked up again.
          React.useEffect(() => {
            if (!target) return;
            post('sync-status', { target }).then((value) => { if (value.run?.status === 'running') setRun(value.run); }).catch(() => {});
          }, [target]);
          React.useEffect(() => {
            if (run?.status !== 'running') return undefined;
            let stopped = false;
            const timer = setTimeout(async () => {
              try {
                const value = await post('sync-status', { id: run.id });
                if (stopped || !value.run) return;
                setRun(value.run);
              } catch (error) {
                if (!stopped) setFailure(error.message);
              }
            }, 1000);
            return () => {
              stopped = true;
              clearTimeout(timer);
            };
          }, [run]);
          // When a sync ends, compare again so the rows show what the target has now.
          // Its own effect: setRun() above re-renders at once, and the poll's cleanup
          // would otherwise drop this answer (rows stuck on "missing / Install").
          // Until that comparison is back, the plugins of the run show "confirming"
          // instead of falling back to the stale row and its Install button.
          const settled = run !== undefined && run.status !== 'running' ? run.id : undefined;
          const [confirmed, setConfirmed] = React.useState(undefined);
          React.useEffect(() => {
            if (settled === undefined) return undefined;
            let current = true;
            post('sync-plan', { source: run.source, target: run.target })
              .then((next) => { if (current && next) setPlan(next); })
              .catch(() => {})
              .finally(() => { if (current) setConfirmed(settled); });
            return () => {
              current = false;
            };
          }, [settled]);
          const confirming = settled !== undefined && confirmed !== settled;
          // One plugin or several; while a run between the same two hosts is
          // working, the Host queues them at its end.
          const start = async (names) => {
            setBusy(true);
            setFailure('');
            try {
              setRun((await post('sync', { source: wire(source), target: wire(target), names })).run);
            } catch (error) {
              setFailure(error.message);
            } finally {
              setBusy(false);
            }
          };
          const stop = async () => {
            try {
              setRun((await post('sync-cancel', { id: run.id })).run);
            } catch (error) {
              setFailure(error.message);
            }
          };
          const running = run?.status === 'running';
          // A running run between the hosts on screen accepts more plugins; any other blocks syncing.
          const samePair = running && run.source === wire(source) && run.target === wire(target);
          const blocked = busy || confirming || (running && (!samePair || Boolean(run.cancelRequested)));
          // The latest item for a plugin in the running run: waiting, working or already done there.
          // After the run, until the new comparison is back, its items still speak for their rows.
          const itemOf = (name) => (running || confirming ? run.items.findLast((item) => item.name === name) : undefined);
          const queued = (name) => ['pending', 'running', 'done'].includes(itemOf(name)?.status);
          const itemText = (item) => (confirming && item.status === 'done' ? tr('sync.item.confirming') : tr(`sync.item.${item.status}`));
          const syncable = plan ? plan.rows.filter((row) => row.action !== undefined) : [];
          const pickedSyncable = picked.filter((name) => syncable.some((row) => row.name === name) && !queued(name));
          const toggle = (name) => setPicked((list) => (list.includes(name) ? list.filter((item) => item !== name) : [...list, name]));
          const select = (value, onChange) => h('select', { className: 'lwr-input', value, disabled: busy || running, onChange: (event) => { onChange(event.target.value); setPlan(undefined); } },
            options.map((item) => h('option', { key: item.name, value: item.name }, title(item.name))));
          const stateText = (row) => tr(`sync.state.${row.state}`, { version: row.targetVersion ?? '?', reason: row.reason ?? '' });
          return h('div', { className: 'lwr-plugins', 'data-lwr-plugin-sync': '' },
            h('div', null,
              h('h2', { className: 'lwr-title' }, tr('sync.title')),
              h('div', { className: 'lwr-note' }, tr('sync.desc'))),
            h('div', { className: 'lwr-plugin-toolbar', style: { justifyContent: 'flex-start' } },
              h('label', { className: 'lwr-check' }, tr('sync.from'), select(source, setSource)),
              h('button', { type: 'button', className: 'lwr-button', disabled: busy || running, onClick: () => { setSource(target); setTarget(source); setPlan(undefined); } }, tr('sync.swap')),
              h('label', { className: 'lwr-check' }, tr('sync.to'), select(target, setTarget)),
              h('button', { type: 'button', className: 'lwr-button', 'data-primary': '', disabled: busy || running || !ready, onClick: compare }, tr('sync.load'))),
            source === target && h('div', { className: 'lwr-note' }, tr('sync.same')),
            source !== target && !ready && h('div', { className: 'lwr-note' }, tr('sync.connectFirst')),
            busy && !plan && h('div', { className: 'lwr-note', role: 'status' }, tr('sync.loading')),
            plan && syncable.length === 0 && !run && h('div', { className: 'lwr-note' }, tr('sync.nothing')),
            plan && plan.rows.map((row) => h('div', { key: row.name, className: 'lwr-plugin', 'data-lwr-sync-row': row.name },
              h('label', { className: 'lwr-text', style: { display: 'flex', gap: 8, alignItems: 'flex-start', cursor: row.action ? 'pointer' : 'default' } },
                h('input', { type: 'checkbox', checked: picked.includes(row.name), disabled: !row.action || blocked || queued(row.name), onChange: () => toggle(row.name) }),
                h('span', null,
                  h('span', { className: 'lwr-plugin-name', title: row.name }, pluginTitle(row)),
                  row.version && h('span', { className: 'lwr-plugin-version' }, row.version),
                  h('span', { className: 'lwr-tag', 'data-where': row.state === 'same' ? 'both' : row.action ? 'both-differ' : 'windows' }, stateText(row)),
                  row.reason && row.state === 'unsupported' && h('div', { className: 'lwr-note' }, tr(`sync.reason.${row.reason}`, { source: row.source ?? '' })),
                  row.git && h('div', { className: 'lwr-note', 'data-lwr-sync-git': row.name },
                    tr('sync.git.from', { remote: row.git.remote, commit: row.git.commit.slice(0, 7) }),
                    row.git.unpushed ? ` ${tr('sync.git.unpushed', { count: row.git.unpushed })}` : '',
                    row.git.dirty ? ` ${tr('sync.git.dirty')}` : ''))),
              row.action && h('div', { className: 'lwr-actions' },
                queued(row.name)
                  ? h('span', { className: 'lwr-tag', 'data-lwr-sync-status': row.name }, itemText(itemOf(row.name)))
                  : h('button', {
                    type: 'button',
                    className: 'lwr-button',
                    'data-lwr-sync-one': row.name,
                    title: tr('sync.oneTitle', { name: row.name }),
                    disabled: blocked,
                    onClick: () => start([row.name]),
                  }, tr(`sync.action.${row.action}`, { version: row.version ?? '' }))))),
            plan && plan.targetOnly.length > 0 && h('div', { className: 'lwr-note' }, `${tr('sync.targetOnly')} ${plan.targetOnly.map((item) => item.name).join(', ')}`),
            plan && syncable.length > 1 && h('div', { className: 'lwr-actions' },
              h('button', { type: 'button', className: 'lwr-button', disabled: blocked, onClick: () => setPicked(syncable.map((row) => row.name)) }, tr('sync.selectAll')),
              h('button', { type: 'button', className: 'lwr-button', 'data-primary': '', disabled: blocked || pickedSyncable.length === 0, onClick: () => start(pickedSyncable) }, tr('sync.run', { count: pickedSyncable.length }))),
            run && h('div', { className: 'lwr-job', role: 'status', 'aria-live': 'polite' },
              h('div', { className: 'lwr-job-head' },
                h('span', { className: 'lwr-plugin-name' }, `${title(run.source)} → ${title(run.target)}`),
                h('span', { className: 'lwr-tag' }, running ? `${Math.round(run.elapsedMs / 1000)}s` : tr(`plugins.status.${run.status}`)),
                h('span', { style: { flex: 1 } }),
                running && h('button', { type: 'button', className: 'lwr-button', disabled: Boolean(run.cancelRequested), onClick: stop }, tr(run.cancelRequested ? 'plugins.cancelling' : 'sync.cancel')),
                !running && h('button', { type: 'button', className: 'lwr-button', onClick: () => setRun(undefined) }, tr('sync.close'))),
              run.items.map((item) => h('div', { key: item.name, className: 'lwr-note' },
                `${item.name} · ${tr(`sync.action.${item.action}`, { version: '' }).trim()} · ${tr(`sync.item.${item.status}`)}${item.error ? ` — ${item.error}` : ''}`)),
              run.job?.stalled && running && !run.cancelRequested && h('div', { className: 'lwr-alert', 'data-lwr-sync-stalled': '' }, tr('plugins.stalled', { seconds: Math.round(run.job.silentMs / 1000) })),
              run.job && running && h('pre', { className: 'lwr-job-log' }, run.job.lines.length > 0 ? run.job.lines.join('\n') : tr('plugins.waitingOutput')),
              run.status === 'done' && h('div', { className: 'lwr-note' }, tr('sync.done')),
              run.status === 'failed' && h('div', { className: 'lwr-alert' }, tr('sync.failed')),
              run.restartRequired && !running && h('div', { className: 'lwr-info' }, tr(run.target === null ? 'sync.restartWindows' : 'sync.restartRemote'))),
            failure && h('div', { className: 'lwr-alert', role: 'alert' }, failure));
        }

        // Use the plugin page's supported tab extension; host selection stays local
        // to this browser, and every remote operation still carries its host explicitly.
        function WslPluginTab() {
          const tr = useT();
          const status = useStatus();
          const [selected, setSelected] = React.useState('');
          const [connecting, setConnecting] = React.useState(false);
          const [failure, setFailure] = React.useState('');
          const hosts = status.value?.distros ?? [];
          const host = hosts.find((item) => item.name === selected)
            ?? hosts.find((item) => item.state === 'connected') ?? hosts[0];
          const connect = async () => {
            if (!host) return;
            setConnecting(true);
            setFailure('');
            try {
              store.accept(await call('api/local-wsl-remote/connect', { method: 'POST', body: JSON.stringify({ distro: host.name }) }));
            } catch (error) {
              setFailure(error.message);
            } finally {
              setConnecting(false);
            }
          };
          return h('section', { className: 'lwr-plugin-page', 'data-wsl-plugin-page': '' },
            h('style', null, css),
            h('div', { className: 'lwr-plugin-toolbar' },
              h('label', { className: 'lwr-check' }, tr('ws.host'),
                h('select', { className: 'lwr-input', value: host?.name ?? '', disabled: connecting || hosts.length === 0, onChange: (event) => { setSelected(event.target.value); setFailure(''); } },
                  hosts.map((item) => h('option', { key: item.name, value: item.name }, hostTitle(item.name))))),
              host && h('span', { className: 'lwr-note' }, tr(`state.${host.state}`))),
            status.status === 'loading' && h('div', { role: 'status' }, tr('loading')),
            status.status === 'error' && h('div', { role: 'alert', className: 'lwr-alert' }, status.message),
            status.status === 'ready' && hosts.length === 0 && h('div', { className: 'lwr-note' }, tr('none')),
            failure && h('div', { role: 'alert', className: 'lwr-alert' }, failure),
            host?.state === 'connected' ? h(Plugins, { key: host.name, host })
              : host && h('div', { className: 'lwr-plugin-disconnected' },
                h('p', { className: 'lwr-note' }, tr('plugins.connectFirst', { distro: hostTitle(host.name) })),
                host.requirement && h(Requirement, { host }),
                h('button', { type: 'button', className: 'lwr-button', disabled: connecting || host.state === 'connecting', onClick: connect }, tr(connecting || host.state === 'connecting' ? 'state.connecting' : 'connect'))),
            hosts.length > 0 && h(PluginSync, { key: `sync:${host?.name ?? ''}`, hosts, initialTarget: host?.name }));
        }
        ctx.slots.inject('plugins.tab', () => {
          // There is no separate label slot for the built-in Installed tab.
          // Adapt only that one translation; leave every Windows operation and
          // all other locale lookups unchanged, and restore it on disposal.
          const locale = Reflect.get(ctx.locale, Symbol.for('cordis.original')) ?? ctx.locale;
          const original = locale.translate;
          if (typeof original === 'function') ctx.effect(() => {
            const own = Object.prototype.hasOwnProperty.call(locale, 'translate');
            const translate = function (ns, key, params) {
              return ns === 'pluginManager' && key === 'installedTab' ? 'Windows' : original.call(this, ns, key, params);
            };
            locale.translate = translate;
            return () => {
              if (locale.translate !== translate) return;
              if (own) locale.translate = original;
              else delete locale.translate;
            };
          }, 'wsl-remote: Windows plugin tab label');
          return ctx.slots.register({ name: 'plugins.tab', id: 'wsl-plugins', label: 'WSL / SSH', order: -100 }, WslPluginTab);
        });

        ctx.slots.inject('settings.general.item', () => ctx.slots.register({ name: 'settings.general.item', id: 'local-wsl-remote-connections', order: 30 }, ConnectionsRow));
        ctx.slots.inject('settings.general.item', () => ctx.slots.register({ name: 'settings.general.item', id: 'local-wsl-remote-share', order: 31 }, ShareRow));

        // "Session in use" on a remote host: the chat page shows only its own
        // fixed words for `session/writer-held`. When the Host found who holds
        // the lock (another dsh on that host sharing its ~/.dsh), say so, the way
        // Codex says "active elsewhere". Every other lookup is left unchanged.
        let writerHolder;
        const watchHolder = async () => {
          try {
            const value = await call('api/local-wsl-remote/session-holder', { method: 'POST', body: JSON.stringify({}) });
            writerHolder = value?.holder ?? undefined;
          } catch {
            writerHolder = undefined;
          }
        };
        {
          const locale = Reflect.get(ctx.locale, Symbol.for('cordis.original')) ?? ctx.locale;
          const original = locale.translate;
          if (typeof original === 'function') ctx.effect(() => {
            const own = Object.prototype.hasOwnProperty.call(locale, 'translate');
            const previous = locale.translate;
            const translate = function (ns, key, params) {
              if (key === 'error.sessionInUse' && (ns === 'conversation' || ns === 'model')) {
                // Look again for the next time; this one answers from what is known now.
                watchHolder();
                if (writerHolder !== undefined) return t('session.heldRemote', { host: writerHolder.hostLabel, holder: writerHolder.holder ?? t('session.heldUnknown') });
              }
              return previous.call(this, ns, key, params);
            };
            locale.translate = translate;
            return () => {
              if (locale.translate !== translate) return;
              if (own) locale.translate = previous;
              else delete locale.translate;
            };
          }, 'wsl-remote: remote session-in-use message');
        }

        applyModels(ctx, { useT, useStatus, store });
        applyWorkspaces(ctx, { t, useT, call, store });
      },
    };
  },
});
