#!/usr/bin/env bash
# Drive the home page. Assertions match .cursor/skills/verify-site/features/home.md.
set -euo pipefail

: "${VERIFY_ROOT:?Set VERIFY_ROOT}"
: "${VERIFY_PORT:?Set VERIFY_PORT}"

origin="http://127.0.0.1:${VERIFY_PORT}"
evidence="$VERIFY_ROOT/evidence"
mkdir -p "$evidence"

curl -fsS -D "$evidence/home.headers" -o "$evidence/home.html" "${origin}/"

grep -q 'HTTP/1.1 200' "$evidence/home.headers"
grep -F -q '<h1 class="text-3xl font-semibold tracking-tight">John Hamlin</h1>' "$evidence/home.html"
grep -F -q 'This placeholder is the start of the blog-first rebuild.' "$evidence/home.html"
grep -F -q '<html lang="en">' "$evidence/home.html"
grep -F -q '<title>John Hamlin</title>' "$evidence/home.html"
grep -F -q '<meta name="description" content="John Hamlin'"'"'s personal site. The blog comes first.">' "$evidence/home.html"
grep -F -q '<meta name="viewport" content="width=device-width, initial-scale=1">' "$evidence/home.html"

if grep -q '<script' "$evidence/home.html"; then
  echo "Home document includes a script element."
  exit 1
fi

href=$(python3 - "$evidence/home.html" <<'PY'
import re
import sys

html = open(sys.argv[1], encoding="utf-8").read()
match = re.search(r'<link rel="stylesheet" href="([^"]+)">', html)
if match is None:
    raise SystemExit("Home document has no stylesheet link.")
print(match.group(1))
PY
)

curl -fsS -o "$evidence/home.css" "${origin}${href}"
grep -F -q 'tailwindcss' "$evidence/home.css"
grep -F -q '.text-neutral-950' "$evidence/home.css"

curl -fsS -D "$evidence/favicon.headers" -o "$evidence/favicon.svg" "${origin}/favicon.svg"
grep -q 'HTTP/1.1 200' "$evidence/favicon.headers"
grep -F -q '<svg' "$evidence/favicon.svg"

echo "home ok ${origin}/ stylesheet=${href}"
