#!/usr/bin/env bash
# Read-only check that this run's preview is the process listening on VERIFY_PORT.
set -euo pipefail

: "${VERIFY_ROOT:?Set VERIFY_ROOT}"
: "${VERIFY_PORT:?Set VERIFY_PORT}"

pid=$(cat "$VERIFY_ROOT/preview.pid")
if ! kill -0 "$pid" 2>/dev/null; then
  echo "Recorded pid ${pid} is not running."
  exit 1
fi

pgid=$(ps -o pgid= -p "$pid" | tr -d ' ')
listener=$(lsof -nP -iTCP:"$VERIFY_PORT" -sTCP:LISTEN -t | head -n 1)
if [ -z "${listener}" ]; then
  echo "Nothing is listening on 127.0.0.1:${VERIFY_PORT}."
  exit 1
fi

listener_pgid=$(ps -o pgid= -p "$listener" | tr -d ' ')
if [ "$pgid" != "$listener_pgid" ]; then
  echo "Listener ${listener} (group ${listener_pgid}) is not this run (group ${pgid})."
  exit 1
fi

url="http://127.0.0.1:${VERIFY_PORT}/"
code=$(curl -sS -o "$VERIFY_ROOT/evidence/doctor.html" -w "%{http_code}" "$url")
if [ "$code" != "200" ]; then
  echo "GET ${url} returned ${code}, expected 200."
  exit 1
fi

if ! grep -q '<title>John Hamlin</title>' "$VERIFY_ROOT/evidence/doctor.html"; then
  echo "Response body is missing the document title."
  exit 1
fi

{
  echo "doctor ok"
  echo "url=${url}"
  echo "pid=${pid}"
  echo "listener=${listener}"
  echo "pgid=${pgid}"
} | tee "$VERIFY_ROOT/evidence/doctor.txt"
