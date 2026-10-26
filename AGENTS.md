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
- **Risk tier.** Check one box in the template. The tier follows the change. Any file under `.github/workflows/` is high. `REVIEW.md`, `AGENTS.md`, `CLAUDE.md`, `.cursor/**`, and `.github/pull_request_template.md` are high.
- **Review.** Rounds to pass, and the count of findings tagged Important, Nit, and Pre-existing.
- **How to revert.** How to undo the change safely.

Risk tiers, the review checklist, and the cross-model loop are in `REVIEW.md`.

## pstack

Model choice is per user. Do not commit a user rule. Set models in your own Cursor config with `/setup-pstack`.

- Non-trivial tasks start with `/poteto-mode`.
- Prove the built site with `/verify-site` (`.cursor/skills/verify-site`). When routes change, keep that map current with `/maintain-verification-skill`.
- Cross-model review uses `/interrogate`.
