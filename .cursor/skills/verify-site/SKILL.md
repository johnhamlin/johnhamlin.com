---
name: verify-site
description: Drive the built johnhamlin.com site over HTTP the way a visitor does. Use after a change to pages, document metadata, styles, or the production build, and whenever a task needs proof that the static site serves the expected document.
---

# Verify johnhamlin.com

The site is a static Astro build. A visitor opens a URL. The harness builds `dist/`, serves it with `astro preview` on a port this run owns, and drives it with curl. There is no login, no database, and no seed data.

Run every command from the repository root. The helpers are executable and live next to this file.

## Launch

Pick an empty run directory and a free port. Two runs must use two ports. The default port is 4173. Do not point a second run at a preview you did not start.

```bash
export VERIFY_PORT=4173
export VERIFY_ROOT=/tmp/verify-site/$(date +%Y%m%d%H%M%S)-$$
.cursor/skills/verify-site/scripts/launch.sh
```

`launch.sh` runs `npm run build`, refuses the port if anything is already listening, then starts preview with `setsid` so the npm process and the Astro server share one process group:

```bash
npm run preview -- --host 127.0.0.1 --port "$VERIFY_PORT"
```

Ready means the log at `$VERIFY_ROOT/evidence/preview.log` contains `http://127.0.0.1:$VERIFY_PORT/` and curl to that origin returns the placeholder page. The script exits 0 only after that URL is in the log. A listening socket is not enough: Astro prints `Port 4173 is in use, trying another one...` and serves a different port. That launch is a failure. The script kills the process group and exits non-zero. Do not follow Astro to the other port.

There is no data directory and no migration. `npm run build` writes `dist/` from the current source, and preview serves that directory.

## Doctor

Run this before driving, and again whenever a response looks stale.

```bash
.cursor/skills/verify-site/scripts/doctor.sh
```

Doctor is read-only. It passes only when all of these are true:

- `$VERIFY_ROOT/preview.pid` is alive.
- `lsof` shows a listener on `127.0.0.1:$VERIFY_PORT`, and that listener's process group is the recorded pid's group.
- `GET /` returns HTTP 200 and the body contains `<title>John Hamlin</title>`.

A listener in any other process group is not this run. Do not drive it.

## Drive

Drive the mapped features, the home page and the blog. Follow `.cursor/skills/verify-site/features/home.md` and `.cursor/skills/verify-site/features/blog.md`. One command runs each journey:

```bash
.cursor/skills/verify-site/scripts/drive-home.sh
.cursor/skills/verify-site/scripts/drive-blog.sh
```

Each script saves the responses and fails if any assertion in its feature file fails. No page has a form. Do not invent a path that the map does not list.

`npm run dev` is a different server. It is not this harness.

## Evidence

Proof artifacts go in `$VERIFY_ROOT/evidence/` and stay there after cleanup.

- `preview.log` is the preview process output, including the ready URL.
- `doctor.txt` and `doctor.html` are the doctor check.
- `home.headers`, `home.html`, `home.css`, `favicon.headers`, and `favicon.svg` are the home journey.
- `blog.headers`, `blog.html`, `blog-post.headers`, and `blog-post.html` are the blog journey.

Standards for this site:

- Drive the preview of the production build. Do not assert against source files or against `dist/` on disk as a substitute for the HTTP response.
- Save the request's response, not only a final summary. Headers and body are both evidence.
- No page writes anything or calls an external service. There is no side effect to confirm beyond the responses themselves.
- The stylesheet and favicon responses are part of the page load. Fetch the URLs the HTML points at.
- A run that served a different port, or a port this run does not own, is not proof.

## Cleanup

```bash
.cursor/skills/verify-site/scripts/cleanup.sh
```

Cleanup sends `SIGTERM` to the process group recorded in `$VERIFY_ROOT/preview.pid`, then removes the pid file. It does not delete `$VERIFY_ROOT/evidence/`. It does not kill by process name. After cleanup, confirm the port is no longer listed by `lsof` and that `home.html` is still in the evidence directory.

## Helpers

| Script | Invocation |
| --- | --- |
| Launch | `.cursor/skills/verify-site/scripts/launch.sh` |
| Doctor | `.cursor/skills/verify-site/scripts/doctor.sh` |
| Drive home | `.cursor/skills/verify-site/scripts/drive-home.sh` |
| Cleanup | `.cursor/skills/verify-site/scripts/cleanup.sh` |

`VERIFY_PORT` and `VERIFY_ROOT` must be set. The scripts resolve the repository from `git rev-parse --show-toplevel` for launch, and they otherwise use the two variables.

When pages or routes change, update the feature map with `/maintain-verification-skill`.
