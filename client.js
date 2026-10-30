window.__ModuleLoader__.load({
  id: '@local/dsh-wsl-remote',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'localWslRemote';
    const POLL_MS = 3000;

    const dictionaries = {
      zh: {
        'title': 'WSL 远程连接',
        'description': '每个 WSL 发行版都是独立的远程主机（与 Codex 相同）：连接后在 WSL 中启动你自己安装的 dsh，使用 WSL 的 ~/.dsh、插件和原生 Linux 文件，与本机 Windows 会话并存，无需重启。',
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
        'req.node-missing': '{distro} 中的 WSL 工作区需要 Node.js {minimum} 或更高版本（当前：{found}）。请在 WSL 终端中依次运行以下命令安装，之后在该工作区重新发起会话：',
        'req.note.verify-node': '确认输出 v{minimum} 或更高版本',
        'exec.problem': 'WSL 工作区无法在该发行版中执行：{message}',
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
        'ws.notConnected': '{distro} 尚未连接。WSL 工作区里的会话仍由本机 Windows 执行；连接后可在侧边栏打开 WSL 中的 dsh。',
        'picker.title': '选择文件夹 · WSL: {distro}',
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
      },
      en: {
        'title': 'WSL remote connections',
        'description': 'Each WSL distribution is a separate remote host (as in Codex): connecting starts your own dsh inside WSL, with the WSL ~/.dsh, plugins and native Linux files, beside the Windows sessions here. No restart needed.',
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
        'req.node-missing': 'WSL workspaces in {distro} need Node.js {minimum} or newer (found: {found}). Run these commands in a WSL terminal, then start a new session in the workspace:',
        'req.note.verify-node': 'Check that it prints v{minimum} or newer',
        'exec.problem': 'WSL workspaces cannot run in this distribution: {message}',
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
        'ws.notConnected': '{distro} is not connected. Sessions in a WSL workspace still run on this Windows Host; connect it to open the WSL dsh in the sidebar.',
        'picker.title': 'Choose a folder · WSL: {distro}',
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
      },
    };

    const css = `
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
    `;

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
    // A WSL workspace is an ordinary DSH workspace whose path is the
    // \\wsl.localhost\<distro>\… UNC of the Linux folder (DSH has no host
    // field on workspaces); the distribution is read back from that path.
    // ---------------------------------------------------------------------
    const UNC = /^\\\\(?:wsl\.localhost|wsl\$)\\([^\\]+)(\\.*)?$/i;
    const uncInfo = (path) => {
      const match = UNC.exec(String(path ?? ''));
      return match ? { distro: match[1], linux: (match[2] ?? '\\').replace(/\\/g, '/') || '/' } : undefined;
    };
    const toUnc = (distro, linux) => `\\\\wsl.localhost\\${distro}${linux === '/' ? '\\' : linux.replace(/\//g, '\\')}`;
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
        let state = { distros: [], loaded: false };
        const listeners = new Set();
        let inflight;
        let timer;
        const refresh = () => (inflight ??= call('api/local-wsl-remote/distros')
          .then((value) => {
            state = { distros: value.distros ?? [], loaded: true };
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
        const { distros: list, loaded } = useDistros();
        const [kind, setKind] = React.useState('local');
        const [distro, setDistro] = React.useState(undefined);
        React.useEffect(() => {
          if (distro === undefined && list.length > 0) setDistro((list.find((entry) => entry.isDefault) ?? list[0]).name);
        }, [list, distro]);
        const selected = list.find((entry) => entry.name === distro);
        const wslAvailable = list.length > 0;
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
        return h(Modal, {
          open: true,
          onClose: onCancel,
          title: tr('ws.title'),
          closeLabel: tr('ws.cancel'),
          footer: h(React.Fragment, null,
            h(Button, { variant: 'outline', onClick: onCancel }, tr('ws.cancel')),
            h(Button, { variant: 'primary', disabled: kind === 'wsl' && selected === undefined, onClick: next }, tr('ws.next'))),
        },
        h('div', { className: 'lwr-field', style: { marginTop: 0 } }, h('label', null, tr('ws.type'))),
        h('div', { className: 'lwr-choice', role: 'radiogroup', 'aria-label': tr('ws.type'), style: { marginTop: 6 } },
          card('local', tr('ws.local'), tr('ws.localDesc'), false),
          card('wsl', tr('ws.wsl'), loaded && !wslAvailable ? tr('ws.wslNone') : tr('ws.wslDesc'), loaded && !wslAvailable)),
        kind === 'wsl' && wslAvailable && h('div', { className: 'lwr-field' },
          h('label', { htmlFor: 'lwr-distro' }, tr('ws.distro')),
          h('select', { id: 'lwr-distro', className: 'lwr-select', value: distro ?? '', onChange: (event) => setDistro(event.target.value) },
            list.map((entry) => h('option', { key: entry.name, value: entry.name }, `WSL: ${entry.name}${entry.os ? ` · ${osLabelOf(entry.os)}` : ''}`))),
          selected && selected.state !== 'connected' && h('div', { className: 'lwr-note' }, tr('ws.notConnected', { distro: selected.name }))));
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
          title: tr('picker.title', { distro }),
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
          listing && h('div', { className: 'lwr-target' }, tr('picker.target', { path: '' }), h('code', null, listing.unc))));
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
          onOpen: (linux) => onPicked(toUnc(distro, linux)),
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
        const schedule = () => {
          if (frame) return;
          frame = requestAnimationFrame(() => {
            frame = 0;
            paint();
          });
        };
        const workspaces = ctx.get('workspaces');
        workspaceItems = workspaces?.list?.getSnapshot?.().items ?? [];
        const offWorkspaces = workspaces?.list?.subscribe?.(() => {
          workspaceItems = workspaces.list.getSnapshot().items ?? [];
          schedule();
        });
        const offDistros = distros.subscribe(() => {
          distroState = distros.getSnapshot();
          schedule();
        });
        const offLocale = ctx.locale.subscribe(() => schedule());
        const stateText = (state) => t(`state.${state ?? 'disconnected'}`);
        const paint = () => {
          const byId = new Map(workspaceItems.map((item) => [item.workspaceId, item]));
          for (const row of document.querySelectorAll('[data-row-key^="workspace:"]')) {
            const id = row.getAttribute('data-row-key').slice('workspace:'.length);
            const info = uncInfo(byId.get(id)?.path);
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
            const title = os ? t('badge.title', { distro: info.distro, os, state: stateText(state) }) : t('badge.titleNoOs', { distro: info.distro, state: stateText(state) });
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
            label.textContent = 'WSL';
            tag.append(dot, label, document.createTextNode(os ? ` · ${os}` : ` · ${info.distro}`));
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

        /** Install guidance: why something cannot start in WSL, and the commands that fix it. */
        function Requirement({ host, requirement = host.requirement }) {
          const tr = useT();
          return h('div', { className: 'lwr-req', role: 'alert' },
            h('div', { className: 'lwr-alert' }, tr(`req.${requirement.reason}`, { distro: host.name, found: requirement.found ?? '', minimum: requirement.minimum })),
            requirement.steps.map((step, index) => h('div', { key: index, className: 'lwr-step' },
              h('div', { className: 'lwr-step-note' }, `${index + 1}. ${tr(`req.note.${step.note}`, { minimum: requirement.minimum })}`),
              h(Command, { command: step.command }))),
            h('div', { className: 'lwr-note' }, tr('req.terminal', { distro: host.name })));
        }

        /** WSL workspaces could not start their Linux runtime in this distribution. */
        function ExecProblem({ host }) {
          const tr = useT();
          const problem = host.execProblem;
          if (problem.requirement) return h(Requirement, { host, requirement: problem.requirement });
          return h('div', { className: 'lwr-alert', role: 'alert' }, tr('exec.problem', { message: problem.message }));
        }

        function Launcher({ launcher }) {
          const tr = useT();
          if (launcher.conflict) return h('div', { className: 'lwr-note' }, tr('launcher.conflict', { path: launcher.path }));
          if (launcher.error) return h('div', { className: 'lwr-note' }, tr('launcher.error', { message: launcher.error }));
          if (!launcher.installed) return null;
          return h('div', { className: 'lwr-note' }, tr(launcher.onPath ? 'launcher.ready' : 'launcher.notOnPath', { path: launcher.path }));
        }

        const osLabel = (os) => (os ? [os.name, os.version].filter(Boolean).join(' ') || os.pretty : '');

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
          const details = [];
          if (host.dsh) details.push(tr('version', { version: host.dsh }));
          if (connected && host.shareLogin !== undefined) details.push(tr(host.shareLogin ? 'shared' : 'separate'));
          if (connected && host.profile) details.push(`profile ${host.profile}`);
          return h('div', { className: 'lwr-host' },
            h('span', { className: 'lwr-dot', 'data-state': host.state, 'aria-hidden': true }),
            h('div', { className: 'lwr-text' },
              h('div', { className: 'lwr-name' }, `WSL: ${host.name}`,
                host.os && h('span', { className: 'lwr-os', title: host.os.pretty || undefined }, osLabel(host.os)),
                host.isDefault && h('span', { className: 'lwr-badge' }, tr('default'))),
              h('div', { className: 'lwr-note' }, [tr(`state.${host.state}`), ...details].join(' · ')),
              host.requirement && h(Requirement, { host }),
              host.state === 'error' && host.error && !host.requirement && h('div', { className: 'lwr-alert', role: 'alert' }, host.error),
              host.execProblem && h(ExecProblem, { host }),
              host.launcher && h(Launcher, { launcher: host.launcher }),
              failure && h('div', { className: 'lwr-alert', role: 'alert' }, failure)),
            h('div', { className: 'lwr-actions' },
              connected && h('button', { type: 'button', className: 'lwr-button', 'data-primary': '', disabled: busy, onClick: () => run(() => openUrl(host.name, false)) }, tr('open')),
              connected && h('button', { type: 'button', className: 'lwr-button', disabled: busy, onClick: () => run(() => openUrl(host.name, true)) }, tr('openExternal')),
              (connected || connecting) && h('button', { type: 'button', className: 'lwr-button', disabled: busy, onClick: () => post('disconnect') }, tr('disconnect')),
              !connected && !connecting && h('button', { type: 'button', className: 'lwr-button', 'data-primary': '', disabled: busy, onClick: () => post('connect') }, tr(host.state === 'error' ? 'retry' : 'connect'))));
        }

        function ConnectionsRow() {
          const tr = useT();
          const status = useStatus();
          const value = status.status === 'ready' ? status.value : undefined;
          return h('div', { className: 'lwr-block' },
            h('style', null, css),
            h('div', { className: 'lwr-title' }, tr('title')),
            h('div', { className: 'lwr-desc' }, tr('description')),
            value?.migratedFromStartupMode && h('div', { className: 'lwr-info' }, tr('migrated')),
            status.status === 'loading' && h('div', { className: 'lwr-note' }, tr('loading')),
            status.status === 'error' && h('div', { className: 'lwr-alert', role: 'alert' }, status.message),
            value && value.platform !== 'win32' && h('div', { className: 'lwr-note' }, tr('notWindows')),
            value && value.platform === 'win32' && value.distros.length === 0 && !value.discoveryError && h('div', { className: 'lwr-note' }, tr('none')),
            value && value.discoveryError && h('div', { className: 'lwr-alert', role: 'alert' }, tr('discoveryError', { message: value.discoveryError })),
            value && value.distros.length > 0 && h('div', { className: 'lwr-list' },
              value.distros.map((host) => h(Host, { key: host.name, host, onResult: store.accept }))),
            value && value.distros.length > 0 && h('div', { className: 'lwr-note' }, tr('requirement', { version: value.minimumDsh })));
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

        ctx.slots.inject('settings.general.item', () => ctx.slots.register({ name: 'settings.general.item', id: 'local-wsl-remote-connections', order: 30 }, ConnectionsRow));
        ctx.slots.inject('settings.general.item', () => ctx.slots.register({ name: 'settings.general.item', id: 'local-wsl-remote-share', order: 31 }, ShareRow));

        applyWorkspaces(ctx, { t, useT, call, store });
      },
    };
  },
});
