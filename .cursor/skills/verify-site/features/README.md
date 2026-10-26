# johnhamlin.com verification map

This directory is the maintained source for verifying the user-facing behavior of johnhamlin.com. Read the index before driving the site, then use the matching feature file as the recipe.

The scaffold has one route. Blog, portfolio, and résumé surfaces are not in the product yet, so they are not mapped. Add a feature file when a visitor can actually reach that surface. Do not mark an unmapped route as verified through the home page.

## Baseline preconditions

- Launch preview with `.cursor/skills/verify-site/scripts/launch.sh` so this run owns `http://127.0.0.1:$VERIFY_PORT/`.
- Set `VERIFY_ROOT` to a new directory under `/tmp/verify-site/`. Evidence for the run stays in `$VERIFY_ROOT/evidence`.
- Set `VERIFY_PORT` to a port nothing else is listening on. The usual port is `4173`. A second run uses a different port.
- Run `.cursor/skills/verify-site/scripts/doctor.sh` and require the recorded process group, the port, and `<title>John Hamlin</title>`.
- Never drive a preview this run did not start.

## Driving conventions

- Start every recipe from the baseline state unless its preconditions say otherwise.
- Treat every command as literal. Keep quoted strings and flags unchanged.
- Drive HTTP with `curl` against the preview origin. The home journey is `.cursor/skills/verify-site/scripts/drive-home.sh`.
- Do not remove proof artifacts during cleanup.

## Proof and skip reporting

- Capture the response headers and body, not only a pass/fail line.
- Record `VERIFY_PORT`, `VERIFY_ROOT`, and the feature id with the artifacts. The headers and `preview.log` carry the origin.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with curl` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

## Features

- [Home](./home.md) covers the placeholder at `/`: the document, its metadata, the linked stylesheet, the favicon, and the absence of a script.
