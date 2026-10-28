# Blog

A visitor opens `/blog/` and sees every published post, newest first, each linked to its own page. A post page is an article with the title, a machine-readable date, the description in the document metadata, and the tags. Drafts are on neither page. No page loads a script.

## Sub-features

- `blog-index` lists published posts at `/blog/` with a link, a `<time datetime>`, and the description.
- `blog-post` serves `/blog/<id>/` as an `<article>` with the title, the date, and the tags.
- `blog-metadata` sets the post title and description in the document head.
- `blog-drafts` leaves a `draft: true` post off the index and builds no page for it.
- `blog-static` does not include a script element.

## How to get to it (user POV)

- Open `/blog/` in a browser.
- Follow a post link from `/blog/`, or open `/blog/<id>/` directly. The id is the post's file name under `src/content/posts/` without `.md`.

## Driving it with curl

Preconditions:

- Preview is healthy at `http://127.0.0.1:$VERIFY_PORT/`.
- `.cursor/skills/verify-site/scripts/doctor.sh` reports that listener in this run's process group.
- `$VERIFY_ROOT/evidence` exists.

- **Open the index and a post.** Run `.cursor/skills/verify-site/scripts/drive-blog.sh`. Exit code `0`. `$VERIFY_ROOT/evidence/blog.html` contains `<title>Blog | John Hamlin</title>` and `<a href="/blog/hello-world/"`. `$VERIFY_ROOT/evidence/blog-post.html` contains `<title>Hello, world | John Hamlin</title>`, `<article`, `<time datetime="2026-10-27"`, and the description meta. Neither body contains `<script`.
- **Leave drafts out.** Before launch, add `src/content/posts/zz-draft-probe.md` with `draft: true` and the title `DRAFTPROBE`. After launch, `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$VERIFY_PORT/blog/zz-draft-probe/` prints `404`, and `grep -rl DRAFTPROBE dist` prints nothing. Delete the probe file and never commit it.

## Gotchas

- Post ids come from file names, so renaming a post file moves its URL.
- Frontmatter dates parse as UTC midnight. The page formats them in UTC, so a local-time check can read a day early.
- The draft probe only proves anything if the build ran after the probe file was added. `launch.sh` builds, so add the file first.
