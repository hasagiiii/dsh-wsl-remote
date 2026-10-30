#!/bin/sh
# dsh-harness — open the Windows DeepSeek Harness from WSL, like `code .`.
#   dsh-harness            open the current directory as a WSL workspace
#   dsh-harness <path>     open <path> (a directory) as a WSL workspace
#   dsh-harness --focus    only bring the app window to the front
# Installed into ~/.local/bin by @local/dsh-wsl-remote when the Windows app
# connects to this distribution. It talks to the Windows app through a loopback
# request file, never a network port opened by WSL.
set -eu

# Filled in at deploy time; see lib/remote.js.
WINDOWS_EXE='@@WINDOWS_EXE@@'
REQUEST_DIR='@@REQUEST_DIR@@'

usage() {
  cat <<'EOF'
Usage: dsh-harness [path]    Open path (default: current directory) as a WSL workspace
       dsh-harness --focus   Bring the DeepSeek Harness window to the front
       dsh-harness --help    Show this help
EOF
}

focus_only=0
target=
case "${1:-}" in
  -h | --help) usage; exit 0 ;;
  --focus) focus_only=1 ;;
  -*) echo "dsh-harness: unknown option $1" >&2; usage >&2; exit 2 ;;
  '') target=. ;;
  *) target=$1 ;;
esac
[ "$#" -le 1 ] || { echo "dsh-harness: expected at most one path" >&2; usage >&2; exit 2; }

if [ ! -r /proc/sys/fs/binfmt_misc/WSLInterop ] && [ ! -r /proc/sys/fs/binfmt_misc/WSLInterop-late ]; then
  echo "dsh-harness: Windows interop is disabled in this distribution ([interop] enabled=false in /etc/wsl.conf)." >&2
  exit 1
fi

exe=$(wslpath -u "$WINDOWS_EXE" 2>/dev/null || true)
if [ -z "$exe" ] || [ ! -f "$exe" ]; then
  echo "dsh-harness: DeepSeek Harness was not found at $WINDOWS_EXE." >&2
  echo "Reconnect this distribution from Settings → General → WSL remote connections to refresh it." >&2
  exit 1
fi

if [ "$focus_only" -eq 0 ]; then
  if [ ! -d "$target" ]; then
    echo "dsh-harness: not a directory: $target" >&2
    exit 1
  fi
  dir=$(cd "$target" && pwd -P)
  # Hand the path over in a request file: the Windows app picks it up and adds
  # the folder as a WSL workspace. Paths can hold any byte, so no argv quoting.
  requests=$(wslpath -u "$REQUEST_DIR" 2>/dev/null || true)
  if [ -z "$requests" ]; then
    echo "dsh-harness: cannot reach the Windows request directory $REQUEST_DIR." >&2
    exit 1
  fi
  mkdir -p "$requests"
  id="$(date +%s)-$$"
  tmp="$requests/.$id.tmp"
  # NUL-separated fields: a Linux path can hold any byte except NUL.
  printf 'dsh-harness/1\000%s\000%s\000' "${WSL_DISTRO_NAME:-}" "$dir" > "$tmp"
  mv "$tmp" "$requests/$id.req"
fi

# The registered dsh:// handler starts the app or focuses its running window.
# Run it from a Windows directory so cmd/Electron do not warn about a UNC cwd.
(cd /mnt/c 2>/dev/null || true; "$exe" "dsh://open" >/dev/null 2>&1 &)

if [ "$focus_only" -eq 0 ]; then
  echo "Opening ${dir} in DeepSeek Harness (WSL: ${WSL_DISTRO_NAME:-?})"
fi
