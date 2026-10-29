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
  "$s" -ilc 'p=$(command -v dsh 2>/dev/null); printf "\n__WSLR__ path=%s\n" "$p"; [ -n "$p" ] && printf "__WSLR__ dsh=%s\n" "$(dsh --version 2>/dev/null)"' </dev/null 2>/dev/null
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
