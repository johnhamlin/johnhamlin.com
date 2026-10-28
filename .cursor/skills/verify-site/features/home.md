# Home

The home page is the only page. A visitor who opens the site root sees John Hamlin's name, a one-sentence placeholder, and a document in English with a title, description, and viewport. The page loads a stylesheet and an icon, and it does not load a script.

## Sub-features

- `home-open` serves the placeholder heading and sentence at `/`.
- `home-metadata` sets the document language, title, description, and viewport.
- `home-styled` serves the stylesheet and favicon the page links to.
- `home-static` does not include a script element.

## How to get to it (user POV)

- Open the site root `/` in a browser.

## Driving it with curl

Preconditions:

- Preview is healthy at `http://127.0.0.1:$VERIFY_PORT/`.
- `.cursor/skills/verify-site/scripts/doctor.sh` reports that listener in this run's process group.
- `$VERIFY_ROOT/evidence` exists.

- **Open the page.** Request the root. Run `.cursor/skills/verify-site/scripts/drive-home.sh`. Exit code `0`. `$VERIFY_ROOT/evidence/home.headers` contains `HTTP/1.1 200` and `$VERIFY_ROOT/evidence/home.html` contains `<h1 class="text-3xl font-semibold tracking-tight">John Hamlin</h1>` and `This placeholder is the start of the blog-first rebuild.`
- **Read the document metadata.** Use the same saved body. It contains `<html lang="en">`, `<title>John Hamlin</title>`, `<meta name="description" content="John Hamlin's personal site. The blog comes first.">`, and `<meta name="viewport" content="width=device-width, initial-scale=1">`.
- **Load the stylesheet.** The script fetches the `href` of `<link rel="stylesheet" ...>`. `$VERIFY_ROOT/evidence/home.css` contains `tailwindcss` and `.text-neutral-950`.
- **Load the icon.** The script fetches `/favicon.svg`. `$VERIFY_ROOT/evidence/favicon.headers` contains `HTTP/1.1 200` and `$VERIFY_ROOT/evidence/favicon.svg` contains `<svg`.
- **Confirm the page is static.** `$VERIFY_ROOT/evidence/home.html` contains no `<script`.

## Gotchas

- `npm run dev` is not the production page. Drive `astro preview` after `npm run build`.
- Preview serves `dist/`. A stale build is a stale page. `launch.sh` builds immediately before it starts preview.
- If port 4173 is taken, Astro prints `Port 4173 is in use, trying another one...` and serves a different port. That is a failed launch. Do not curl the other port and call it this run.
- Killing the `npm` pid and leaving its child running keeps the port busy. Cleanup kills the process group from `setsid`, not the name `node`.
- The HTML is one line. Assert the full attribute strings above, not a reformatted document.
- The blog routes are in `blog.md`. A 404 on a path neither file lists is a missing page, not a skipped check.
