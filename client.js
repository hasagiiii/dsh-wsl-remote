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
      },
      en: {
        'title': 'WSL remote connections',
        'description': 'Each WSL distribution is a separate remote host (as in Codex): connecting starts your own dsh inside WSL, with the WSL ~/.dsh, plugins and native Linux files, beside the Windows sessions here. No restart needed.',
        'loading': 'Detecting WSL…',
        'none': 'No WSL 2 distribution found.',
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
              h('div', { className: 'lwr-name' }, `WSL: ${host.name}`, host.isDefault && h('span', { className: 'lwr-badge' }, tr('default'))),
              h('div', { className: 'lwr-note' }, [tr(`state.${host.state}`), ...details].join(' · ')),
              host.state === 'error' && host.error && h('div', { className: 'lwr-alert', role: 'alert' }, host.error),
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
            value && value.platform === 'win32' && value.distros.length === 0 && h('div', { className: 'lwr-note' }, tr('none')),
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
      },
    };
  },
});
