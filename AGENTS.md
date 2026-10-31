# dsh-wsl-remote — notes for agents

Machine-wide rules are in `~/.dsh/AGENTS.md` (loaded automatically). This file
adds what is specific to this repository.

## Layout

- `index.js` Host plugin; `client.js` browser half; `lib/bridge/*` the Windows/WSL
  merge; `lib/remote.js` one WSL connection; `server/*` files deployed into WSL.
- Bump `AGENT_VERSION` in `lib/remote.js` whenever `server/*` or `lib/mux.js` change.
- The user's live app runs this plugin linked from this folder. Code changes take
  effect only after the user disables and re-enables `@local/dsh-wsl-remote`
  and refreshes the window. Do not restart or kill the live app or its WSL dsh.

## Scratch and DSH sources

- Scratch files: `.scratch/` (gitignored). Extract DSH packages for reading with
  `& 'D:\dsh\DeepSeek Harness.exe' .scratch/extract.cjs <package> ...` (set
  `ELECTRON_RUN_AS_NODE=1`); they land in `.scratch/dsh-src/<package>`.
  If `.scratch/extract.cjs` is missing, recreate it before use.

## Tests

Run with `$env:ELECTRON_RUN_AS_NODE='1'; $env:DSH_ROOT='D:/dsh/resources/app.asar/dsh'`
and `$dsh = 'D:\dsh\DeepSeek Harness.exe'`:

- `& $dsh --import ./test/resolve-dsh.mjs test/unit.mjs`
- `& $dsh --import ./test/stub-cordis.mjs test/smoke-host.mjs`
- Boot rehearsals (`test/boot-*.mjs`, `test/serve-desktop.mjs`) need a throwaway
  DSH home: `& $dsh test/boot-home.mjs` prints its path; set `DSH_HOME` to it.
  Never point `DSH_HOME` at the real `~/.dsh`.
- Browser checks: headless Chrome with `--remote-debugging-port=9333` and
  `--user-data-dir=.scratch/chrome`, then `& $dsh test/cdp.mjs 9333 <steps.mjs>`.
  Dump the DOM first; the settings page opens from the `账号菜单` button → `设置`.
- PowerShell treats any stderr line of a native program as an error, so a
  passing run can still end with `[exit code: 1]`; judge by the test output.

## Committing

- Write the message to `.scratch/commit-msg.txt`, then `git commit -F .scratch/commit-msg.txt`.
