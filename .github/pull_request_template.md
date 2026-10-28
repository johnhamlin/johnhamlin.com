## Ticket

<!-- Id and one line on what this change does. -->

## Proof

<!-- Paste command output and other evidence. -->

## Risk tier

<!-- Check one. The check computes the tier from the changed paths and risk-tiers. A missing tier, a tier it cannot parse, or a tier lower than the computed one fails the job. Definitions are in REVIEW.md. -->

- [ ] low — posts, copy, and docs
- [ ] medium — components, layouts, styles, routing, and any unmatched path
- [ ] high — astro.config, CI and Cloudflare deploy, redirects and headers, dependency upgrades, drafts or env, agent instruction files (`**/REVIEW.md`, `**/AGENTS.md`, `**/CLAUDE.md`, `.cursor/**`, `.claude/**`, `.github/**`, `risk-tiers`, `scripts/risk-tier.mjs`, this template)

Which high-risk trigger applies? (for example CI/deploy or secrets)

## Review

<!-- Rounds to pass is 1, 2, or 3. Counts are findings per tag. See REVIEW.md. -->

Rounds to pass:

Findings:

- Important:
- Nit:
- Pre-existing:

## How to revert

<!-- How to undo this change safely. -->
