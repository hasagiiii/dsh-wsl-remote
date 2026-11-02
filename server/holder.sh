#!/bin/sh
# Deployed with the agent. Read-only: name the dsh process that holds one
# session's write lock (`session.lock`, flock) on this host.
#   holder.sh <sessionId> <own pid>
# Prints one line `pid<TAB>args` for the holder, or nothing.
id=$1
own=$2
case "$id" in '' | */* | .*) exit 2 ;; esac
case "$own" in *[!0-9]*) own= ;; esac
lock=
for f in "$HOME"/.dsh/sessions/*/"$id"/session.lock; do
  [ -f "$f" ] && lock=$f && break
done
[ -n "$lock" ] || exit 0
ino=$(stat -c %i "$lock" 2>/dev/null) || exit 0
# /proc/locks: "N: FLOCK ADVISORY WRITE <pid> <maj>:<min>:<inode> 0 EOF"
pids=$(awk -v ino="$ino" '{ split($6, a, ":"); if (a[3] == ino) print $5 }' /proc/locks 2>/dev/null | sort -u)
for pid in $pids; do
  [ "$pid" = "$own" ] && continue
  [ -r "/proc/$pid/cmdline" ] || continue
  printf '%s\t%s\n' "$pid" "$(tr '\0' ' ' < "/proc/$pid/cmdline" | cut -c1-300)"
  exit 0
done
