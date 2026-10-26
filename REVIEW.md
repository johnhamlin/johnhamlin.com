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

The risk tier is set by the changed paths, not the author and not the pull request body. The check fails when the `## Risk tier` section does not check exactly one tier, or when that tier is lower than the computed tier. A path that matches nothing is medium. When a path matches more than one glob, the highest tier wins. In `risk-tiers`, the glob is the rest of the line and may contain spaces.

`.github/workflows/risk-tier.yml` is a `pull_request` workflow, not `pull_request_target`. The workflow file GitHub runs is the one on the merge commit, so a pull request that edits `.github/workflows/risk-tier.yml` can skip the check. Branch protection on `main` requires a pull request, 1 approval, and review from code owners. Repository admins can still bypass this protection, so an admin can merge without code-owner review. The backstop is CODEOWNERS `@johnhamlin` plus required code-owner review on `main`.

The check runs on `ubuntu-slim` and checks out only `github.event.pull_request.base.sha`, with `persist-credentials: false`. It does not check out the pull request head or the merge commit, so pull request files are never on disk in that job. It installs dependencies with `npm ci` from that base lockfile, so `minimatch` is the copy the base lockfile records, and it does not run `actions/setup-node`. It fetches the base and head SHAs (and unshallows a shallow checkout first, so the merge base is present), then reads changed paths from `git diff --name-status -M base...head`. A rename contributes both the old and the new path. It does not call the pulls files API. Paths are matched with `minimatch`. The check does not rewrite `\` to `/` and does not resolve `..`. A path that contains `\` or a `..` segment fails the check. `minimatch` is case-insensitive and matches dotfiles. `AGENTS.md`, `CLAUDE.md`, and `REVIEW.md` match at any depth, and `.cursor/**`, `.claude/**`, and `.github/**` are always high. A missing, unreadable, or invalid `risk-tiers` file, an unsafe path, or any other error fails the job. The job does not write labels. If the base commit is missing `scripts/risk-tier.mjs` or `risk-tiers`, the job does not run pull request code and requires the high box. The body claim is read only from the `## Risk tier` section. A suffix such as `low-priority` is not a tier. Punctuation after the tier word, such as `high.`, still counts. Tests run in a separate job that checks out the pull request, has no token, and does not check out the base.

Use the highest tier the diff touches. Scale that tier by blast radius and by how easy a rollback is. A revert of one content file is easier than a config change that affects every request.

These paths are always high, including when `risk-tiers` says otherwise: `**/AGENTS.md`, `**/CLAUDE.md`, `**/REVIEW.md`, `.cursor/**`, `.claude/**`, and `.github/**` (the pull request template and the workflows). `.github/CODEOWNERS` lists `@johnhamlin` on every high path. CODEOWNERS patterns are case-sensitive, while tiering is case-insensitive.

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
