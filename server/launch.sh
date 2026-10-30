#!/bin/sh
# Started by the Windows DeepSeek Harness through
#   wsl.exe -d <distro> --cd ~ -e /bin/sh launch.sh probe
#   wsl.exe -d <distro> --cd ~ -e /bin/sh launch.sh run <profile> <share-login 0|1>
# Like Codex's WSL remote connection, the user's own CLI is found on the PATH of
# their login shell, so nvm, ~/.profile and ~/.zshrc setups all apply.
here=$(dirname "$0")
s=$(getent passwd "$(id -un)" 2>/dev/null | cut -d: -f7)
[ -x "$s" ] || s=/bin/sh

case "$1" in
probe)
  printf '__WSLR__ shell=%s\n' "$s"
  if [ -r /etc/os-release ]; then
    # Subshell so os-release variables cannot leak into the probe below.
    ( . /etc/os-release; printf '__WSLR__ osName=%s\n__WSLR__ osVersion=%s\n__WSLR__ osPretty=%s\n' "${NAME:-}" "${VERSION_ID:-}" "${PRETTY_NAME:-}" )
  fi
  printf '__WSLR__ home=%s\n' "$HOME"
  # Everything the install guidance needs: dsh, and whether node/npm/nvm exist to install it with.
  "$s" -ilc '
    p=$(command -v dsh 2>/dev/null); printf "\n__WSLR__ path=%s\n" "$p"
    [ -n "$p" ] && printf "__WSLR__ dsh=%s\n" "$(dsh --version 2>/dev/null)"
    n=$(command -v node 2>/dev/null); printf "__WSLR__ node=%s\n" "$n"
    [ -n "$n" ] && printf "__WSLR__ nodeVersion=%s\n" "$(node --version 2>/dev/null)"
    printf "__WSLR__ npm=%s\n" "$(command -v npm 2>/dev/null)"
    [ -n "${NVM_DIR:-}" ] && [ -s "$NVM_DIR/nvm.sh" ] && printf "__WSLR__ nvm=1\n"
    case ":$PATH:" in *":$HOME/.local/bin:"*) printf "__WSLR__ localBinOnPath=1\n" ;; esac
  ' </dev/null 2>/dev/null
  ;;
run)
  profile=$2
  case "$profile" in '' | *[!A-Za-z0-9._-]*) echo "invalid profile" >&2; exit 2 ;; esac
  export DSH_WSL_REMOTE_SHARE_LOGIN="$3"
  export DSH_WSL_REMOTE_OVERLAY="$here/overlay.yml"
  export DSH_WSL_REMOTE_PROFILE="$profile"
  # fd 3 -> Windows, fd 4 <- Windows; dsh's own stdout and stdin stay off the pipe.
  exec 3>&1 4<&0 1>&2 0</dev/null
  exec "$s" -ilc 'exec dsh --patch "$DSH_WSL_REMOTE_OVERLAY" --profile "$DSH_WSL_REMOTE_PROFILE" --no-open --port 0'
  ;;
*)
  echo "usage: launch.sh probe | run <profile> <0|1>" >&2
  exit 2
  ;;
esac
