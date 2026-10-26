#!/usr/bin/env bash
# Build the site and start astro preview on VERIFY_PORT inside one process group.
set -euo pipefail

: "${VERIFY_ROOT:?Set VERIFY_ROOT to an empty run directory}"
: "${VERIFY_PORT:?Set VERIFY_PORT to a free TCP port}"

repo=$(git rev-parse --show-toplevel)
cd "$repo"

mkdir -p "$VERIFY_ROOT/evidence"

if lsof -nP -iTCP:"$VERIFY_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port ${VERIFY_PORT} is already in use. Refusing to launch."
  exit 1
fi

npm run build

setsid stdbuf -oL -eL npm run preview -- --host 127.0.0.1 --port "$VERIFY_PORT" \
  >"$VERIFY_ROOT/evidence/preview.log" 2>&1 &
echo $! >"$VERIFY_ROOT/preview.pid"

url="http://127.0.0.1:${VERIFY_PORT}/"
pid=$(cat "$VERIFY_ROOT/preview.pid")

for _ in $(seq 1 50); do
  if grep -q "Port ${VERIFY_PORT} is in use" "$VERIFY_ROOT/evidence/preview.log"; then
    echo "Astro left port ${VERIFY_PORT}. Killing process group ${pid}."
    kill -- -"$pid" 2>/dev/null || true
    exit 1
  fi
  if grep -q "$url" "$VERIFY_ROOT/evidence/preview.log"; then
    echo "ready ${url}"
    exit 0
  fi
  sleep 0.2
done

echo "Preview did not become ready on ${url}."
cat "$VERIFY_ROOT/evidence/preview.log"
kill -- -"$pid" 2>/dev/null || true
exit 1
