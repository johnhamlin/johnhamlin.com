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

The risk tier is set by the change, not the author. The `risk:low`, `risk:medium`, or `risk:high` label is the source of truth when the workflow can write it. The pull request body does not set the tier. The check fails when no box is checked, or when the checked tier is lower than the computed tier. A path that matches nothing is medium. When a path matches more than one glob, the highest tier wins. In `risk-tiers`, the glob is the rest of the line and may contain spaces.

`.github/workflows/risk-tier.yml` is a `pull_request` workflow, not `pull_request_target`. The workflow file GitHub runs is the one on the merge commit, so a pull request that edits `.github/workflows/risk-tier.yml` can skip the check. CODEOWNERS review by `@johnhamlin` is the backstop.

The tier job checks out only `github.event.pull_request.base.sha` and then runs only that tree. It runs `scripts/risk-tier.mjs` and `risk-tiers` from the base commit, against this pull request's changed files. It does not check out the pull request, and it does not run `npm test` after that checkout, so a pull request that edits the script or `risk-tiers` does not change the copy that runs. A diff that touches `scripts/risk-tier.mjs` is high. If the base commit has no `scripts/risk-tier.mjs`, the tier job does not run the pull request's script. It fails closed: the tier is high, and the high box is required. Tests run in a separate job that checks out the pull request, has no token, and does not check out the base. A label write that returns 403, which is what a fork pull request gets, is a warning. The body check still runs.

Use the highest tier the diff touches. Scale that tier by blast radius and by how easy a rollback is. A revert of one content file is easier than a config change that affects every request.

These paths are always high, including when `risk-tiers` says otherwise: `**/AGENTS.md`, `**/CLAUDE.md`, `**/REVIEW.md`, `.cursor/**`, `.claude/**`, `.github/**` (the pull request template and the workflows), `risk-tiers`, `scripts/risk-tier.mjs`, and `scripts/risk-tier.test.mjs`. `.github/CODEOWNERS` lists `@johnhamlin` on every high path.

### High

- `astro.config.mjs`
- `.github/**`, including workflows, `CODEOWNERS`, and `.github/pull_request_template.md`
- `lighthouserc.json`
- Cloudflare deploy config, redirects, and headers: `wrangler.toml`, `wrangler.json`, `wrangler.jsonc`, `_headers`, `_redirects`, `public/_headers`, and `public/_redirects`. None of those files are in the repo. Adding one is high.
- `package.json` and `package-lock.json`. A dependency upgrade is not separable from other edits by path.
- Anything that could leak drafts or env: `.env`, `.env.*`, and unpublished posts under `src/content/drafts/**`
- Agent instruction files at any depth: `**/REVIEW.md`, `**/AGENTS.md`, `**/CLAUDE.md`, `.cursor/**`, and `.claude/**`. They steer every future agent, so a wrong line causes real damage.
- `risk-tiers`, `scripts/risk-tier.mjs`, and `scripts/risk-tier.test.mjs`

### Medium

- `src/pages/**` for routing and page templates
- `src/styles/**` for styles
- `src/components/**` and `src/layouts/**` when those directories exist
- Any path `risk-tiers` does not list

### Low

- `docs/**` and `README.md`
- `src/content/posts/**`. There is no posts directory yet.
- `src/content/resume.md`. A résumé file is low only when it is redacted.

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
npm test
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
