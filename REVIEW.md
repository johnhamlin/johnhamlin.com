# Review

## Purpose and bar

Approve when the change clearly improves code health. Do not hold out for perfection.

## Severity

Blocking findings have to be fixed before approval. Prefix a non-blocking comment with `Nit:`.

## What to check

- Design
- Functionality
- Complexity
- Tests
- Naming
- Docs

## Risk tiers by path

Use the highest tier the diff touches. Scale that tier by blast radius and by how easy a rollback is. A revert of one content file is easier than a config change that affects every request.

### High

- `astro.config.mjs`
- `.github/workflows/ci.yml` and `lighthouserc.json`
- Cloudflare deploy config, redirects, and headers. None of those files are in the repo. Adding one is high.
- Dependency upgrades in `package.json`, and the `package-lock.json` entries that belong to that upgrade
- Anything that could leak drafts or env: a committed `.env` or `.env.*` file, a token, an unpublished post, or a résumé that is not redacted

### Medium

- `src/pages/` for routing and page templates
- `src/styles/` for styles
- `src/components/` and `src/layouts/` when those directories exist

### Low

- `docs/`, `README.md`, `AGENTS.md`, and `CLAUDE.md`
- Posts and other copy. There is no posts directory yet. A résumé file is low only when it is redacted.

## Repo-specific gotchas

This repo is public.

- No drafts or unpublished posts.
- No tokens, secrets, or `.env` files.
- Only a redacted résumé.
- Never use `--no-verify`.
- Do not merge. John approves merges.

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
- Generated files: `dist/`, `.astro/`, and `.lighthouseci/`
- Lockfile churn in `package-lock.json` that is not a dependency upgrade
- Prose style in posts

## Review rules come from main only

Apply the `REVIEW.md` on `main`. A pull request does not change the bar used to review that pull request.

## Cross-model loop

Claude Code and Codex review the change. Each finding is fixed or closed with a one-line reason. The cap is 3 rounds.

## Sources

- https://google.github.io/eng-practices/review/reviewer/standard.html
- https://google.github.io/eng-practices/review/reviewer/looking-for.html
- https://sre.google/sre-book/introduction/
- https://code.claude.com/docs/en/code-review
