#!/usr/bin/env bash
# Stop the preview process group started by launch.sh. Keep evidence/.
set -euo pipefail

: "${VERIFY_ROOT:?Set VERIFY_ROOT}"

pidfile="$VERIFY_ROOT/preview.pid"
if [ -f "$pidfile" ]; then
  pid=$(cat "$pidfile")
  if kill -0 "$pid" 2>/dev/null; then
    kill -- -"$pid"
    for _ in $(seq 1 25); do
      if ! kill -0 "$pid" 2>/dev/null; then
        break
      fi
      sleep 0.2
    done
    if kill -0 "$pid" 2>/dev/null; then
      echo "Process group ${pid} is still running after SIGTERM."
      exit 1
    fi
  fi
  rm -f "$pidfile"
fi

if [ ! -d "$VERIFY_ROOT/evidence" ]; then
  echo "Evidence directory is missing: $VERIFY_ROOT/evidence"
  exit 1
fi

echo "cleanup done; evidence remains at $VERIFY_ROOT/evidence"
