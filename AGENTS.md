# Agent notes

This is the public repo for johnhamlin.com, the blog-first rebuild of John Hamlin's personal site. Read this file before changing anything.

## Red lines

- Never commit secrets, tokens, or `.env` files.
- No drafts or unpublished posts in this repo.
- Only a redacted résumé.
- Commits use the GitHub noreply email: `295746+johnhamlin@users.noreply.github.com`.
- Never use `--no-verify`.
- Never merge. John approves merges.
- Never push to main.

## Commands

Node is pinned in `.nvmrc` to 22.23.2. Cloudflare Pages and Workers Builds both honor that file. Pages' v3 image accepts any Node version from `.nvmrc`. Workers Builds preinstalls 22.23.2.

Setup:

```bash
npm ci
```

Dev:

```bash
npm run dev
```

Check:

```bash
npm run check
```

Build:

```bash
npm run build
```

Lint:

```bash
npm run lint
```

Risk-tier tests:

```bash
npm test
```

Preview the production build:

```bash
npm run preview
```

Lighthouse audits the built `dist/` directory, so run the build first:

```bash
npx lhci autorun
```

## Pull requests

Use `.github/pull_request_template.md`. Every pull request has these sections:

- **Ticket.** The id and one line on what the change does.
- **Proof.** A command and its real output. Paste the output.
- **Risk tier.** Check one box in the template. The `risk:*` label is the source of truth when the workflow can write it. The label job checks out only the base commit, so pull request files are never on disk there. It reads changed paths from the GitHub API and runs `ubuntu-slim`'s `node` on the base `scripts/risk-tier.mjs` and `risk-tiers`. It does not run `setup-node`, `npm`, or `yarn`. Paths are matched literally. A path containing `\` or a `..` segment is high. Each changed path is lowercased once before tier rules, so every tier is case-insensitive. `AGENTS.md`, `CLAUDE.md`, and `REVIEW.md` match at any depth. A lower `risk:*` label than the computed tier, or more than one `risk:*` label, fails the check. No `risk:*` label does not. If that commit has no script, no `risk-tiers`, or invalid `risk-tiers`, or the file list is incomplete, the tier is high and the label is still applied. A pull request that edits the workflow file can skip the check. CODEOWNERS only asks `@johnhamlin` for review until John turns on branch protection that requires code-owner review on `main`. That protection becomes the backstop once it is on. TODO: `main` is unprotected and has no rulesets. When that branch protection is enabled (repository Settings → Branches → branch protection rule for `main`, or a ruleset on `main` with the same requirement), update this sentence so it names that setting as the backstop. The pull request body does not set the tier. The check reads only the `## Risk tier` section and fails when no box is checked, or when the checked tier is lower than the computed tier. A path that matches nothing is medium. `**/AGENTS.md`, `**/CLAUDE.md`, `**/REVIEW.md`, `.cursor/**`, `.claude/**`, `.github/**`, `risk-tiers`, and `scripts/risk-tier.mjs` are always high. The full guarantee is in `REVIEW.md`.
- **Review.** Rounds to pass, and the count of findings tagged Important, Nit, and Pre-existing.
- **How to revert.** How to undo the change safely.

Risk tiers, the review checklist, and the cross-model loop are in `REVIEW.md`.

## pstack

Model choice is per user. Do not commit a user rule. Set models in your own Cursor config with `/setup-pstack`.

- Non-trivial tasks start with `/poteto-mode`.
- Prove the built site with `/verify-site` (`.cursor/skills/verify-site`). When routes change, keep that map current with `/maintain-verification-skill`.
- Cross-model review uses `/interrogate`.
