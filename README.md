# johnhamlin.com

Blog-first personal site for John Hamlin. The portfolio is demoted. The site is static, ships almost no client JavaScript, and is built to stay fast and accessible.

The rebuild is built in public. The factory is Grok Bot agents, pstack, Cursor cloud agents, Claude Code, and Codex review. John approves every merge.

## License

The code in this repository is [MIT licensed](LICENSE).

Post content is all rights reserved. It is not covered by the MIT license.

## Stack

- Astro 5, static output, with no React or other UI-framework islands
- Tailwind CSS 4 via `@tailwindcss/vite`
- TypeScript, strict
- Node.js 22.23.2, pinned in `.nvmrc`, a version Cloudflare Pages and Workers Builds accept
- Hosting on Cloudflare (Pages or Workers static assets)

Deploy configuration is not in this repo yet. The choice and the alternatives are recorded in [docs/adr/001-stack.md](docs/adr/001-stack.md). The short brief is in [docs/context.md](docs/context.md).

## Workflow

1. Read [AGENTS.md](AGENTS.md) before changing the repo. [CLAUDE.md](CLAUDE.md) points there.
2. Branch from `main`. Do not push to `main`, and do not merge your own pull request.
3. Open a pull request with the template: Ticket, Proof, Risk tier, Review, How to revert. Proof is a command and its real output.
4. CI installs from the lockfile, then runs `npm run check`, `npm run build`, `npm run lint`, `npm test`, a gitleaks scan of the git history, and Lighthouse CI against `dist/`. The Lighthouse job asserts a minimum score of 0.95 for performance, accessibility, best-practices, and seo, and uploads the report. On a pull request from this repository, a separate job links the report in a comment. Fork pull requests get no comment because their token is read-only. The report is in the job summary.
5. John merges.

Commands for setup, dev, check, build, lint, and Lighthouse are in [AGENTS.md](AGENTS.md). Non-trivial agent work starts with `/poteto-mode`, proves the built site with `/verify-site`, and uses `/interrogate` for cross-model review.
