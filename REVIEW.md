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

`.github/workflows/risk-tier.yml` is a `pull_request` workflow, not `pull_request_target`. The workflow file GitHub runs is the one on the merge commit, so a pull request that edits `.github/workflows/risk-tier.yml` can skip the check. CODEOWNERS only asks `@johnhamlin` for review until John turns on branch protection that requires code-owner review on `main`. That protection becomes the backstop once it is on.

TODO: `main` is unprotected and has no rulesets. When John enables branch protection on `main` that requires a pull request and review from code owners (repository Settings → Branches → branch protection rule for `main`, or a ruleset on `main` with the same requirement), update the sentence above so it names that setting as the backstop.

The label job runs on `ubuntu-slim` and checks out only `github.event.pull_request.base.sha`, with `persist-credentials: false`. It does not check out the pull request head or the merge commit, so pull request files are never on disk in that job. It has its own concurrency group with `cancel-in-progress: false`, so a new run does not kill a label update halfway. It reads the changed-file list from the GitHub API (`pulls/{n}/files`, paginated, including a rename's `previous_filename`), not from `git diff`. Paths are matched literally. The check does not rewrite `\` to `/` and does not resolve `..`. A path that contains `\` or a `..` segment is high. It runs the image's preinstalled `node` (Node 24 on `ubuntu-slim`) on `scripts/risk-tier.mjs` and `risk-tiers` from that base checkout. It does not run `actions/setup-node`, and it does not run `npm` or `yarn`, so a pull request `.yarnrc` that sets `yarn-path` is not on disk and cannot execute. A diff that touches `scripts/risk-tier.mjs` is high. Each changed path is lowercased once, before any rule is checked, so every tier is case-insensitive. `AGENTS.md`, `CLAUDE.md`, and `REVIEW.md` match at any depth. If the base commit has no `scripts/risk-tier.mjs` or no `risk-tiers`, or `risk-tiers` is invalid, or the files API returns fewer files than `pull_request.changed_files`, or the 3000-file page cap is hit, the job does not trust a lower tier. It fails closed: the tier is high, the `risk:high` label is still applied, and the high box is required. After a label write, the job re-reads the pull request labels. The check fails when any `risk:*` label is lower than the computed tier, or when more than one `risk:*` label remains. A pull request with no `risk:*` label does not fail that check. The body claim is read only from the `## Risk tier` section. A suffix such as `low-priority` is not a tier. Punctuation after the tier word, such as `high.`, still counts. Tests run in a separate job that checks out the pull request, has no token, and does not check out the base. A label write that returns 403 and leaves no `risk:*` label, which is what a fork or Dependabot pull request gets, is a warning. The body check still runs. A 403 that leaves a lower `risk:*` label, or more than one, fails the job, and the body check still runs.

Use the highest tier the diff touches. Scale that tier by blast radius and by how easy a rollback is. A revert of one content file is easier than a config change that affects every request.

These paths are always high, including when `risk-tiers` says otherwise: `**/AGENTS.md`, `**/CLAUDE.md`, `**/REVIEW.md`, `.cursor/**`, `.claude/**`, `.github/**` (the pull request template and the workflows), `risk-tiers`, `scripts/risk-tier.mjs`, and `scripts/risk-tier.test.mjs`. `.github/CODEOWNERS` lists `@johnhamlin` on every high path. CODEOWNERS patterns are case-sensitive, while tiering is case-insensitive.

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
