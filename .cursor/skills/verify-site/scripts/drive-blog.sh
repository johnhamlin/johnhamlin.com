#!/usr/bin/env bash
# Drive the blog index and the sample post. Assertions match .cursor/skills/verify-site/features/blog.md.
set -euo pipefail

: "${VERIFY_ROOT:?Set VERIFY_ROOT}"
: "${VERIFY_PORT:?Set VERIFY_PORT}"

origin="http://127.0.0.1:${VERIFY_PORT}"
evidence="$VERIFY_ROOT/evidence"
mkdir -p "$evidence"

curl -fsS -D "$evidence/blog.headers" -o "$evidence/blog.html" "${origin}/blog/"
grep -q 'HTTP/1.1 200' "$evidence/blog.headers"
grep -F -q '<title>Blog | John Hamlin</title>' "$evidence/blog.html"
grep -F -q '<a href="/blog/hello-world/"' "$evidence/blog.html"
grep -F -q '<time datetime="2026-10-27"' "$evidence/blog.html"
grep -F -q 'The site is being rebuilt in public, with the blog first.</p>' "$evidence/blog.html"

curl -fsS -D "$evidence/blog-post.headers" -o "$evidence/blog-post.html" "${origin}/blog/hello-world/"
grep -q 'HTTP/1.1 200' "$evidence/blog-post.headers"
grep -F -q '<title>Hello, world | John Hamlin</title>' "$evidence/blog-post.html"
grep -F -q '<meta name="description" content="The site is being rebuilt in public, with the blog first.">' "$evidence/blog-post.html"
grep -F -q '<article' "$evidence/blog-post.html"
grep -F -q '<time datetime="2026-10-27"' "$evidence/blog-post.html"
grep -F -q '<ul class="mt-3 flex flex-wrap gap-2 text-sm" aria-label="Tags"> <li class="rounded bg-neutral-100 px-2 py-0.5">meta</li>' "$evidence/blog-post.html"

if grep -q '<script' "$evidence/blog.html" "$evidence/blog-post.html"; then
  echo "Blog document includes a script element."
  exit 1
fi

echo "blog ok ${origin}/blog/"
