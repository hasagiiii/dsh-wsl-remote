#!/bin/sh
# Started by the Windows DeepSeek Harness through
#   wsl.exe -d <distro> --cd ~ -e /bin/sh launch.sh probe
#   wsl.exe -d <distro> --cd ~ -e /bin/sh launch.sh run <profile> <share-login 0|1> <marker>
#   wsl.exe -d <distro> -e /bin/sh launch.sh kill <pid> <start time>
# Like Codex's WSL remote connection, the user's own CLI is found on the PATH of
# their login shell, so nvm, ~/.profile and ~/.zshrc setups all apply.
here=$(dirname "$0")
s=$(getent passwd "$(id -un)" 2>/dev/null | cut -d: -f7)
[ -x "$s" ] || s=/bin/sh

# Field 22 of /proc/<pid>/stat: the process start time in clock ticks since boot.
# Read after the ") " that ends the command name, which may contain spaces.
start_time() {
  stat=$(cat "/proc/$1/stat" 2>/dev/null) || return 1
  set -- ${stat##*) }
  printf '%s' "${20}"
}

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
  marker=$4
  case "$marker" in '' | *[!A-Za-z0-9-]*) echo "invalid marker" >&2; exit 2 ;; esac
  export DSH_WSL_REMOTE_SHARE_LOGIN="$3"
  export DSH_WSL_REMOTE_OVERLAY="$here/overlay.yml"
  export DSH_WSL_REMOTE_PROFILE="$profile"
  # Make this process the leader of its own process group (wsl.exe normally
  # already does). Every exec below keeps the pid, so dsh is that leader and
  # its tools, MCP servers and terminals start in its group unless they make
  # their own. Report pid and start time on stderr: Windows kills the whole
  # group with them when wsl.exe alone would leave Linux processes behind.
  stat=$(cat /proc/$$/stat); set -- ${stat##*) }; pgrp=$3; set -- run "$profile" "$DSH_WSL_REMOTE_SHARE_LOGIN" "$marker"
  [ "$pgrp" = "$$" ] || exec setsid -w /bin/sh "$0" "$@"
  printf '%s:%s:%s\n' "$marker" "$$" "$(start_time $$)" >&2
  # fd 3 -> Windows, fd 4 <- Windows; dsh's own stdout and stdin stay off the pipe.
  exec 3>&1 4<&0 1>&2 0</dev/null
  exec "$s" -ilc 'exec dsh --patch "$DSH_WSL_REMOTE_OVERLAY" --profile "$DSH_WSL_REMOTE_PROFILE" --no-open --port 0'
  ;;
kill)
  # Kill the process group of a dsh this plugin started. The pid is checked
  # against its start time first, so a reused pid is never touched.
  pid=$2
  started=$3
  case "$pid$started" in '' | *[!0-9]*) echo "invalid pid" >&2; exit 2 ;; esac
  # Members of group <pid> (the leader may already have exited).
  members() {
    for f in /proc/[0-9]*/stat; do
      stat=$(cat "$f" 2>/dev/null) || continue
      set -- ${stat##*) }
      [ "$3" = "$pid" ] && printf '%s\n' "${f#/proc/}" | cut -d/ -f1
    done
  }
  now=$(start_time "$pid")
  if [ -n "$now" ] && [ "$now" != "$started" ]; then echo reused; exit 0; fi
  # Leader alive and verified, or gone with its group orphaned (no other
  # process can lead a group with that id while the old one has members).
  [ -z "$(members)" ] && { echo gone; exit 0; }
  kill -TERM -- "-$pid" 2>/dev/null
  i=0
  while [ $i -lt 20 ] && [ -n "$(members)" ]; do sleep 0.25; i=$((i + 1)); done
  kill -KILL -- "-$pid" 2>/dev/null
  echo killed
  ;;
*)
  echo "usage: launch.sh probe | run <profile> <0|1> <marker> | kill <pid> <start>" >&2
  exit 2
  ;;
esac
