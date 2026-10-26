# Review

## Purpose and bar

Approve when the change clearly improves code health. Do not hold out for perfection.

## Severity

Tag every finding `Important`, `Nit`, or `Pre-existing`.

- **Important** blocks approval until it is fixed or closed with a reason.
- **Nit** does not block. Cap nits at 3 per review.
- **Pre-existing** does not block. It was already wrong before this change.

Every finding needs `file:line` evidence. Do not guess from a name.

The review summary starts with the count of findings. If there is nothing to fix, say that plainly.

Skip these paths: lockfiles (`package-lock.json`), generated files, `dist/`, and `.astro/`.

## What to check

- Design
- Functionality
- Complexity
- Tests
- Naming
- Docs

What failure looks like here: a post leaks a draft or the unredacted résumé, config misroutes, docs lie, a dependency bump drops Lighthouse below 0.95.

## Risk tiers by path

The risk tier is set by the change, not the author. Use the highest tier the diff touches. Scale that tier by blast radius and by how easy a rollback is. A revert of one content file is easier than a config change that affects every request.

Any file under `.github/workflows/` is always high. Agent instruction files are always high.

### High

- `astro.config.mjs`
- `.github/workflows/` (including `ci.yml`) and `lighthouserc.json`
- Cloudflare deploy config, redirects, and headers. None of those files are in the repo. Adding one is high.
- Dependency upgrades in `package.json`, and the `package-lock.json` entries that belong to that upgrade
- Anything that could leak drafts or env: a committed `.env` or `.env.*` file, a token, an unpublished post, or a résumé that is not redacted
- Agent instruction files: `REVIEW.md`, `AGENTS.md`, `CLAUDE.md`, `.cursor/**`, and `.github/pull_request_template.md`. They steer every future agent, so a wrong line causes real damage.

### Medium

- `src/pages/` for routing and page templates
- `src/styles/` for styles
- `src/components/` and `src/layouts/` when those directories exist

### Low

- `docs/` and `README.md`
- Posts and other copy. There is no posts directory yet. A résumé file is low only when it is redacted.

## Repo-specific gotchas

This repo is public.

- No drafts or unpublished posts.
- No tokens, secrets, or `.env` files.
- Only a redacted résumé.
- Never use `--no-verify`.
- Do not merge. John approves merges.
- If any commit lands after John approves, the pull request goes back to him.

Run these from the repo root. Node is pinned in `.nvmrc` to 22.23.2.

```bash
npm ci
npm run dev
npm run check
npm run build
npm run lint
npm run preview
npx lhci autorun
gitleaks detect --source . --redact --verbose --exit-code 1 --log-opts="--all"
```

`npx lhci autorun` reads `dist/`, so build first. The Lighthouse budget in `lighthouserc.json` is at least 0.95 for performance, accessibility, best-practices, and seo. gitleaks must finish with no leaks over the git history.

## Don't flag

- Formatting
- Generated files, including `dist/`, `.astro/`, and `.lighthouseci/`
- Lockfile churn in `package-lock.json` that is not a dependency upgrade
- Prose style in posts

## Review rules come from main only

Apply the `REVIEW.md` on `main`. A pull request does not change the bar used to review that pull request.

## Cross-model loop

Three passes, in order: Claude Code, Codex, then Claude Code `/security-review`. Each finding is fixed or closed with a one-line reason. The cap is 3 rounds.

Open findings from `/security-review` block until they are fixed or closed with a reason.

## Sources

- https://google.github.io/eng-practices/review/reviewer/standard.html
- https://google.github.io/eng-practices/review/reviewer/looking-for.html
- https://sre.google/sre-book/introduction/
- https://code.claude.com/docs/en/code-review
- https://claude.dev/blog/solving-code-review-at-anthropic/
