window.__ModuleLoader__.load({
  id: '@local/dsh-wsl-remote',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'localWslRemote';
    const LOCAL = '';

    const dictionaries = {
      zh: {
        'env.title': '运行环境',
        'env.description': 'Agent 的命令、文件读写和搜索在哪里执行。启动 DeepSeek Harness 时确定，修改后需重启应用生效。',
        'env.local': '本机 Windows',
        'env.wsl': 'WSL · {name}',
        'env.loading': '正在检测 WSL…',
        'env.none': '未检测到可用的 WSL 2 发行版',
        'env.deploying': '正在 {name} 中准备运行环境（首次约需数秒）…',
        'env.current': '当前运行于：{name}',
        'env.error': '无法切换：{message}',
        'restart.title': '需要重启',
        'restart.body': '已保存。重启 DeepSeek Harness 后，所有会话都将使用「{name}」执行命令、读写文件和搜索。',
        'restart.note': '请完全退出应用后重新打开。重启前，当前会话仍在「{current}」中执行。',
        'restart.ok': '知道了',
        'restart.pending': '重启后生效：{name}',
        'shell.title': '默认 Shell',
        'shell.description': 'Agent 在 WSL 中执行命令使用的 Shell。修改后需重启应用生效。',
        'shell.localNote': '本机 Windows 环境下，Agent 命令由 PowerShell 执行。',
        'shell.default': 'bash（默认）',
        'shell.loading': '正在读取 {name} 中可用的 Shell…',
        'shell.error': '无法读取 Shell 列表：{message}',
        'shell.saveError': '保存失败：{message}',
        'shell.node': 'Node.js {version}',
        'shell.nodeMissing': '未找到 Node.js 22 或更高版本，需要先在该发行版安装后才能使用。',
        'shell.noBwrap': '未找到 bubblewrap（bwrap），受限权限模式下的命令将无法执行。',
      },
      en: {
        'env.title': 'Execution environment',
        'env.description': 'Where Agent commands, file edits and searches run. It is fixed when DeepSeek Harness starts; changes apply after a restart.',
        'env.local': 'This Windows PC',
        'env.wsl': 'WSL · {name}',
        'env.loading': 'Detecting WSL…',
        'env.none': 'No WSL 2 distribution found',
        'env.deploying': 'Preparing the runtime in {name} (a few seconds the first time)…',
        'env.current': 'Running in: {name}',
        'env.error': 'Could not switch: {message}',
        'restart.title': 'Restart required',
        'restart.body': 'Saved. After DeepSeek Harness restarts, every session runs commands, file edits and searches in "{name}".',
        'restart.note': 'Quit the app completely and open it again. Until then, sessions keep running in "{current}".',
        'restart.ok': 'OK',
        'restart.pending': 'After restart: {name}',
        'shell.title': 'Default shell',
        'shell.description': 'Shell the Agent uses for commands in WSL. Changes apply after a restart.',
        'shell.localNote': 'On this Windows PC, Agent commands run in PowerShell.',
        'shell.default': 'bash (default)',
        'shell.loading': 'Reading shells available in {name}…',
        'shell.error': 'Could not read shells: {message}',
        'shell.saveError': 'Could not save: {message}',
        'shell.node': 'Node.js {version}',
        'shell.nodeMissing': 'Node.js 22 or newer was not found; install it in this distribution first.',
        'shell.noBwrap': 'bubblewrap (bwrap) was not found; commands in confined permission modes cannot run.',
      },
    };

    const css = `
      .lwr-row{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
      .lwr-text{min-width:0;flex:1}
      .lwr-title{font-size:14px;line-height:20px;color:var(--dsw-alias-label-primary)}
      .lwr-desc,.lwr-note{margin-top:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
      .lwr-pending{margin-top:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-brand-primary)}
      .lwr-warn{margin-top:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-warning-primary, var(--dsw-alias-label-secondary))}
      .lwr-alert{margin-top:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary, var(--dsw-alias-label-primary))}
      .lwr-select{flex:none;min-width:180px;max-width:280px;height:32px;padding:0 28px 0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background-color:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}
      .lwr-select:disabled{opacity:.6;cursor:default}
      .lwr-select:focus-visible,.lwr-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
      .lwr-backdrop{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.4)}
      .lwr-dialog{box-sizing:border-box;width:min(420px,calc(100vw - 32px));padding:20px 24px;border-radius:12px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:0 12px 32px rgba(0,0,0,.2)}
      .lwr-dialog h2{margin:0 0 12px;font-size:16px;line-height:24px}
      .lwr-dialog p{margin:0 0 8px;font-size:14px;line-height:22px}
      .lwr-dialog .lwr-note{margin:0 0 16px}
      .lwr-actions{display:flex;justify-content:flex-end}
      .lwr-button{height:32px;padding:0 16px;border:none;border-radius:8px;background:var(--dsw-alias-brand-primary);color:#fff;font:inherit;font-size:14px;cursor:pointer}
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

        /** Shared environment state, fetched once per page and replaced by write responses. */
        const store = (() => {
          let state = { status: 'loading' };
          const listeners = new Set();
          let started = false;
          const set = (next) => {
            state = next;
            for (const listener of listeners) listener();
          };
          return {
            subscribe(listener) {
              listeners.add(listener);
              if (!started) {
                started = true;
                call('api/local-wsl-remote/environments')
                  .then((value) => set({ status: 'ready', value }))
                  .catch((error) => set({ status: 'error', message: error.message }));
              }
              return () => listeners.delete(listener);
            },
            getSnapshot: () => state,
            accept: (value) => set({ status: 'ready', value }),
          };
        })();

        const useT = () => {
          React.useSyncExternalStore(localeSub, localeSnap, localeSnap);
          return t;
        };
        const useEnv = () => React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
        const label = (tr, name) => (name ? tr('env.wsl', { name }) : tr('env.local'));

        function RestartDialog({ name, current, onClose }) {
          const tr = useT();
          const button = React.useRef(null);
          React.useEffect(() => {
            button.current?.focus();
            const onKey = (event) => {
              if (event.key === 'Escape') onClose();
            };
            window.addEventListener('keydown', onKey);
            return () => window.removeEventListener('keydown', onKey);
          }, [onClose]);
          return h('div', { className: 'lwr-backdrop', onClick: onClose },
            h('div', { className: 'lwr-dialog', role: 'alertdialog', 'aria-modal': true, 'aria-labelledby': 'lwr-restart-title', onClick: (event) => event.stopPropagation() },
              h('h2', { id: 'lwr-restart-title' }, tr('restart.title')),
              h('p', null, tr('restart.body', { name })),
              h('div', { className: 'lwr-note' }, tr('restart.note', { current })),
              h('div', { className: 'lwr-actions' }, h('button', { type: 'button', className: 'lwr-button', ref: button, onClick: onClose }, tr('restart.ok')))));
        }

        function EnvironmentRow() {
          const tr = useT();
          const env = useEnv();
          const [busy, setBusy] = React.useState(undefined);
          const [failure, setFailure] = React.useState(undefined);
          const [dialog, setDialog] = React.useState(undefined);
          const value = env.status === 'ready' ? env.value : undefined;
          const onChange = async (event) => {
            const next = event.target.value;
            setBusy(next || LOCAL);
            setFailure(undefined);
            try {
              const result = await call('api/local-wsl-remote/select', { method: 'POST', body: JSON.stringify({ environment: next }) });
              store.accept(result);
              if (result.restartRequired) setDialog({ name: label(tr, result.next), current: label(tr, result.active) });
            } catch (error) {
              setFailure(error.message);
            } finally {
              setBusy(undefined);
            }
          };
          const close = React.useCallback(() => setDialog(undefined), []);
          return h('div', { className: 'lwr-row' },
            h('style', null, css),
            h('div', { className: 'lwr-text' },
              h('div', { className: 'lwr-title', id: 'lwr-env-title' }, tr('env.title')),
              h('div', { className: 'lwr-desc' }, tr('env.description')),
              env.status === 'loading' && h('div', { className: 'lwr-note' }, tr('env.loading')),
              env.status === 'error' && h('div', { className: 'lwr-alert', role: 'alert' }, env.message),
              value && value.distros.length === 0 && h('div', { className: 'lwr-note' }, tr('env.none')),
              value && h('div', { className: 'lwr-note' }, tr('env.current', { name: label(tr, value.active) })),
              value && value.next !== value.active && h('div', { className: 'lwr-pending' }, tr('restart.pending', { name: label(tr, value.next) })),
              busy && h('div', { className: 'lwr-note', role: 'status' }, tr('env.deploying', { name: busy })),
              failure && h('div', { className: 'lwr-alert', role: 'alert' }, tr('env.error', { message: failure }))),
            h('select', {
              className: 'lwr-select',
              value: value ? value.next : LOCAL,
              disabled: !value || busy !== undefined || value.platform !== 'win32',
              onChange,
              'aria-labelledby': 'lwr-env-title',
            },
            h('option', { value: LOCAL }, tr('env.local')),
            (value?.distros ?? []).map((entry) => h('option', { key: entry.name, value: entry.name }, tr('env.wsl', { name: entry.name })))),
            dialog && h(RestartDialog, { ...dialog, onClose: close }));
        }

        function ShellRow() {
          const tr = useT();
          const env = useEnv();
          const value = env.status === 'ready' ? env.value : undefined;
          const distro = value?.next ?? LOCAL;
          const [state, setState] = React.useState({ status: 'idle' });
          const [busy, setBusy] = React.useState(false);
          const [failure, setFailure] = React.useState(undefined);
          const [dialog, setDialog] = React.useState(undefined);
          const close = React.useCallback(() => setDialog(undefined), []);
          React.useEffect(() => {
            if (!distro) return undefined;
            const controller = new AbortController();
            setState({ status: 'loading' });
            call(`api/local-wsl-remote/shells?distro=${encodeURIComponent(distro)}`, { signal: controller.signal })
              .then((facts) => setState({ status: 'ready', facts }))
              .catch((error) => {
                if (!controller.signal.aborted) setState({ status: 'error', message: error.message });
              });
            return () => controller.abort();
          }, [distro]);
          if (!distro) {
            return h('div', { className: 'lwr-row' },
              h('div', { className: 'lwr-text' },
                h('div', { className: 'lwr-title' }, tr('shell.title')),
                h('div', { className: 'lwr-desc' }, tr('shell.localNote'))));
          }
          const current = value.shells?.[distro] ?? '';
          const facts = state.status === 'ready' ? state.facts : undefined;
          const shells = facts?.shells ?? [];
          const onChange = async (event) => {
            setBusy(true);
            setFailure(undefined);
            try {
              const result = await call('api/local-wsl-remote/shell', { method: 'POST', body: JSON.stringify({ distro, shell: event.target.value }) });
              store.accept(result);
              if (result.restartRequired) setDialog({ name: label(tr, result.next), current: label(tr, result.active) });
            } catch (error) {
              setFailure(error.message);
            } finally {
              setBusy(false);
            }
          };
          return h('div', { className: 'lwr-row' },
            h('div', { className: 'lwr-text' },
              h('div', { className: 'lwr-title', id: 'lwr-shell-title' }, tr('shell.title')),
              h('div', { className: 'lwr-desc' }, tr('shell.description')),
              state.status === 'loading' && h('div', { className: 'lwr-note' }, tr('shell.loading', { name: distro })),
              state.status === 'error' && h('div', { className: 'lwr-alert', role: 'alert' }, tr('shell.error', { message: state.message })),
              facts && facts.nodeSupported && h('div', { className: 'lwr-note' }, tr('shell.node', { version: facts.node })),
              facts && !facts.nodeSupported && h('div', { className: 'lwr-warn' }, tr('shell.nodeMissing')),
              facts && !facts.bwrap && h('div', { className: 'lwr-warn' }, tr('shell.noBwrap')),
              failure && h('div', { className: 'lwr-alert', role: 'alert' }, tr('shell.saveError', { message: failure }))),
            h('select', { className: 'lwr-select', value: current, disabled: busy || !facts, onChange, 'aria-labelledby': 'lwr-shell-title' },
              h('option', { value: '' }, tr('shell.default')),
              shells.map((shell) => h('option', { key: shell.path, value: shell.path }, `${shell.name}  ${shell.path}`)),
              current !== '' && !shells.some((shell) => shell.path === current) && h('option', { value: current }, current)),
            dialog && h(RestartDialog, { ...dialog, onClose: close }));
        }

        ctx.slots.inject('settings.general.item', () => ctx.slots.register({ name: 'settings.general.item', id: 'local-wsl-remote-environment', order: 30 }, EnvironmentRow));
        ctx.slots.inject('settings.general.item', () => ctx.slots.register({ name: 'settings.general.item', id: 'local-wsl-remote-shell', order: 31 }, ShellRow));
      },
    };
  },
});
