#!/usr/bin/env bash
# Drive the empty blog index. Assertions match .cursor/skills/verify-site/features/blog.md.
set -euo pipefail

: "${VERIFY_ROOT:?Set VERIFY_ROOT}"
: "${VERIFY_PORT:?Set VERIFY_PORT}"

origin="http://127.0.0.1:${VERIFY_PORT}"
evidence="$VERIFY_ROOT/evidence"
mkdir -p "$evidence"

curl -fsS -D "$evidence/blog.headers" -o "$evidence/blog.html" "${origin}/blog/"
grep -q 'HTTP/1.1 200' "$evidence/blog.headers"
grep -F -q '<title>Blog | John Hamlin</title>' "$evidence/blog.html"
grep -F -q '<p class="mt-8 leading-7">No posts yet.</p>' "$evidence/blog.html"

if grep -q '<script' "$evidence/blog.html"; then
  echo "Blog document includes a script element."
  exit 1
fi

echo "blog ok ${origin}/blog/"
