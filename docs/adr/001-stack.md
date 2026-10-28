# ADR 001: Stack

## Status

Accepted

## Date

2026-10-26

## Context

johnhamlin.com is being rebuilt in public as a blog-first personal site. The portfolio is demoted. The site should be static, ship almost no client JavaScript, and stay fast and accessible. Hosting is Cloudflare, either Pages or Workers static assets. Deploy configuration is out of scope for the harness.

## Decision

- Astro 5 with static output (`output: "static"`). The scaffold uses Astro 5.18.2.
- No React, and no Vue, Svelte, or other UI-framework islands. Pages are Astro templates plus CSS.
- Tailwind CSS 4, wired through `@tailwindcss/vite` in the Astro Vite config.
- TypeScript, using Astro's strict config (`astro/tsconfigs/strict`).
- Node.js 22.23.2, pinned in `.nvmrc`.
- Cloudflare Pages or Workers static assets for hosting. This repo does not add a deploy config.

## Alternatives considered

- **Astro 6 or 7.** Astro 7.4.2 is the current major and declares `node: >=22.23.4`. This rebuild is specified as Astro 5, so the scaffold stays on 5.18.2.
- **Astro with React or other islands.** An island pulls in a UI framework and client JavaScript. The site is supposed to stay static and nearly script-free.
- **Next.js or another React framework.** A React app is a poor fit for a content site that should ship almost no JavaScript.
- **Eleventy or Hugo.** Both can build a fast static blog. This repo stays on Astro so the page templates, the strict TypeScript check, and the Vite asset pipeline are one toolchain.
- **Tailwind 3 via PostCSS.** Tailwind 4's Vite plugin is the current integration and drops the separate PostCSS config.
- **Vercel or Netlify.** Both can host a static `dist/`. The host for this site is Cloudflare.
- **Node.js 24.18.0.** On 2026-07-30, Workers Builds made Node.js 24.18.0 the default. That image also preinstalls 22.23.2. Pages' v3 image defaults to 22.16.0 and accepts any Node version from `.nvmrc` or `.node-version`. 22.23.2 is the pin because Workers Builds already has that binary, Pages will read `.nvmrc`, and the version sits inside the `engines` range of every direct devDependency. `eslint-plugin-astro` is the narrow one: `^22.22.3 || ^24.16.0 || >=26.3.0`.

## Consequences

- `npm run build` writes a static `dist/` directory. This repo has no server runtime.
- Client JavaScript stays out unless a later ticket adds it on purpose.
- CI installs the `.nvmrc` Node version and runs check, build, lint, tests, a gitleaks scan of the git history, and Lighthouse against `dist/`.
- A later ticket can add Pages or Workers static assets without changing the build output. Deploy config is still absent.
