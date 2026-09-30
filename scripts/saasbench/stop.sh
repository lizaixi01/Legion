#!/bin/sh
# SaaSBench container freeze helper.
#
# Terminates the worker (Codex) process tree inside the task container and reports what
# was removed. The process that answers on the task business port is protected: it must
# stay alive so the external evaluator can reach the frozen application.
#
# Emits one JSON line on stdout. Never fails hard: the caller decides what to do with
# "remaining" entries. Read-only with respect to the workspace.
set -u

PORT="${SAASBENCH_APP_PORT:-8024}"
MARK="${SAASBENCH_WORKER_MARK:-/opt/agent-bin/codex}"

# Every pid whose command line matches the worker marker.
workers() {
  pgrep -f "$MARK" 2>/dev/null || true
}

# Full process tree (breadth first, bounded) rooted at the given pids.
expand() {
  queue="$*"
  seen=""
  while [ -n "$queue" ]; do
    next=""
    for pid in $queue; do
      case " $seen " in *" $pid "*) continue ;; esac
      [ -d "/proc/$pid" ] || continue
      seen="$seen $pid"
      next="$next $(pgrep -P "$pid" 2>/dev/null || true)"
    done
    queue="$next"
  done
  echo "$seen"
}

# pids holding a listening socket on PORT, resolved through /proc/net/tcp so that the
# container image does not need `ss`, `netstat` or `lsof`.
listeners() {
  hexport=$(awk -v p="$PORT" 'BEGIN { printf "%04X", p + 0 }')
  inodes=$(awk -v h="$hexport" 'NR > 1 && $4 == "0A" { n = split($2, a, ":"); if (toupper(a[n]) == h) print $10 }' \
    /proc/net/tcp /proc/net/tcp6 2>/dev/null | sort -u | tr '\n' ' ')
  [ -n "$inodes" ] || return 0
  found=""
  for pid in $(ls /proc 2>/dev/null | grep -E '^[0-9]+$'); do
    for fd in /proc/"$pid"/fd/*; do
      target=$(readlink "$fd" 2>/dev/null) || continue
      inode=${target#socket:[}
      [ "$inode" = "$target" ] && continue
      inode=${inode%]}
      case " $inodes " in *" $inode "*) found="$found $pid" ;; esac
    done
  done
  echo "$found"
}

protected=$(expand $(listeners))
protected=$(echo $protected)

terminated=$(expand $(workers))
list=""
for pid in $terminated; do
  case " $protected " in *" $pid "*) continue ;; esac
  list="$list $pid"
done

[ -n "$list" ] && kill -15 $list 2>/dev/null
[ -n "$list" ] && sleep 2

forced=""
for pid in $(expand $(workers)); do
  case " $protected " in *" $pid "*) continue ;; esac
  forced="$forced $pid"
done
[ -n "$forced" ] && kill -9 $forced 2>/dev/null
[ -n "$forced" ] && sleep 1

remaining=$(echo $(workers))

printf '{"port":%s,"protected":"%s","terminated":"%s","forced":"%s","remaining":"%s"}\n' \
  "$PORT" "$protected" "$list" "$forced" "$remaining"
