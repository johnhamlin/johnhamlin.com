import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  applyLabelPlan,
  changedPaths,
  claimFailure,
  computeTier,
  defaultTiersPath,
  failClosedReason,
  finishGate,
  globToRegExp,
  loadTiers,
  loadTiersFile,
  parseClaimedTier,
  planLabelUpdates,
  repoRoot,
} from "./risk-tier.mjs";

const rules = loadTiersFile();

test("a REVIEW.md-only change is high", () => {
  assert.equal(computeTier(["REVIEW.md"], rules), "high");
});

test("an unmatched path is medium", () => {
  assert.equal(computeTier(["public/favicon.svg"], rules), "medium");
  assert.equal(computeTier(["LICENSE"], rules), "medium");
});

test("a post or copy-only change is low", () => {
  assert.equal(computeTier(["src/content/posts/hello.md"], rules), "low");
  assert.equal(computeTier(["README.md"], rules), "low");
  assert.equal(computeTier(["docs/context.md"], rules), "low");
  assert.equal(computeTier(["src/content/resume.md"], rules), "low");
});

test("a low claim on a high change fails", () => {
  const claimed = parseClaimedTier(
    ["- [x] low — posts, copy, and docs", "- [ ] medium — components", "- [ ] high — ci"].join("\n"),
  );
  assert.equal(claimed.ok, true);
  assert.equal(claimed.tier, "low");
  assert.equal(
    claimFailure(claimed.tier, computeTier(["REVIEW.md"], rules)),
    "Claimed risk tier low is lower than computed tier high.",
  );
});

test("mixed files take the max tier", () => {
  assert.equal(computeTier(["README.md", "src/pages/index.astro"], rules), "medium");
  assert.equal(computeTier(["docs/context.md", "REVIEW.md"], rules), "high");
  assert.equal(computeTier(["src/content/posts/hello.md", "src/styles/global.css"], rules), "medium");
  assert.equal(computeTier(["src/pages/index.astro", "astro.config.mjs"], rules), "high");
});

test("stale labels are replaced", () => {
  const plan = planLabelUpdates(["risk:low", "risk:medium", "bug"], "high");
  assert.deepEqual(plan.remove, ["risk:low", "risk:medium"]);
  assert.deepEqual(plan.add, ["risk:high"]);
  assert.equal(plan.label, "risk:high");
  assert.deepEqual(applyLabelPlan(["risk:low", "risk:medium", "bug"], plan), ["bug", "risk:high"]);

  const already = planLabelUpdates(["risk:high", "bug"], "high");
  assert.deepEqual(already.remove, []);
  assert.deepEqual(already.add, []);
  assert.deepEqual(applyLabelPlan(["risk:high", "bug"], already), ["risk:high", "bug"]);
});

test("no checked tier fails", () => {
  const claimed = parseClaimedTier("- [ ] low — posts\n- [ ] medium — pages\n- [ ] high — ci\n");
  assert.equal(claimed.ok, false);
  assert.equal(claimed.message, "No risk tier is checked in the pull request body.");
});

test("always-high paths stay high", () => {
  const samples = [
    "AGENTS.md",
    "CLAUDE.md",
    "REVIEW.md",
    ".cursor/skills/verify-site/SKILL.md",
    ".claude/settings.json",
    ".github/workflows/risk-tier.yml",
    ".github/pull_request_template.md",
    ".github/CODEOWNERS",
    "risk-tiers",
    "scripts/risk-tier.mjs",
    "scripts/risk-tier.test.mjs",
  ];
  for (const sample of samples) {
    assert.equal(computeTier([sample], rules), "high", sample);
  }
});

test("hardcoded high paths stay high when the tiers file disagrees", () => {
  const lowered = loadTiers("low REVIEW.md\nlow scripts/risk-tier.mjs\nlow .github/**\n");
  assert.equal(computeTier(["REVIEW.md"], lowered), "high");
  assert.equal(computeTier(["scripts/risk-tier.mjs"], lowered), "high");
  assert.equal(computeTier([".github/workflows/ci.yml"], lowered), "high");
});

test("a pull request that edits the script still computes high", () => {
  const lowered = loadTiers("low **\nlow scripts/risk-tier.mjs\n");
  assert.equal(computeTier(["scripts/risk-tier.mjs"], rules), "high");
  assert.equal(computeTier(["scripts/risk-tier.mjs"], lowered), "high");
  assert.equal(computeTier(["scripts/risk-tier.test.mjs", "README.md"], lowered), "high");
});

test("agent instruction files match at any depth", () => {
  assert.equal(computeTier(["docs/AGENTS.md"], rules), "high");
  assert.equal(computeTier(["packages/web/CLAUDE.md"], rules), "high");
  assert.equal(computeTier(["notes/REVIEW.md"], rules), "high");
  assert.equal(computeTier(["src/content/posts/AGENTS.md"], rules), "high");
  assert.equal(computeTier(["src/content/posts/nested/CLAUDE.md"], rules), "high");
  assert.equal(computeTier(["src/content/posts/nested/REVIEW.md"], rules), "high");
  const lowered = loadTiers("low **/AGENTS.md\nlow **/CLAUDE.md\nlow **/REVIEW.md\nlow src/content/posts/**\n");
  assert.equal(computeTier(["notes/REVIEW.md"], lowered), "high");
  assert.equal(computeTier(["docs/AGENTS.md"], lowered), "high");
  assert.equal(computeTier(["src/content/posts/nested/AGENTS.md"], lowered), "high");
  const tiersText = fs.readFileSync(defaultTiersPath(), "utf8");
  const owners = fs.readFileSync(path.join(repoRoot(), ".github/CODEOWNERS"), "utf8");
  for (const glob of ["**/AGENTS.md", "**/CLAUDE.md", "**/REVIEW.md"]) {
    assert.match(tiersText, new RegExp(`^high \\*\\*/${glob.slice(3)}$`, "m"));
    assert.match(owners, new RegExp(`^\\*\\*/${glob.slice(3)} @johnhamlin$`, "m"));
  }
});

test("changedPaths includes renames and deletes", () => {
  const paths = changedPaths([
    { filename: "docs/new name.md", previous_filename: "REVIEW.md", status: "renamed" },
    { filename: "src/content/posts/gone.md", status: "removed" },
  ]);
  assert.deepEqual(paths, ["docs/new name.md", "REVIEW.md", "src/content/posts/gone.md"]);
  assert.equal(computeTier(paths, rules), "high");
  assert.equal(
    computeTier(changedPaths([{ filename: "src/content/posts/gone post.md", status: "removed" }]), rules),
    "low",
  );
});

test("paths with spaces keep their tier", () => {
  assert.equal(computeTier(["src/content/posts/my post.md"], rules), "low");
  assert.equal(computeTier(["src/pages/my page.astro"], rules), "medium");
  assert.equal(computeTier(["docs/my notes/context.md"], rules), "low");
  const spaced = loadTiers("high docs/my notes/**\n");
  assert.equal(spaced[0].glob, "docs/my notes/**");
  assert.equal(computeTier(["docs/my notes/context.md"], spaced), "high");
});

test("dotfiles match their globs", () => {
  assert.equal(computeTier([".env"], rules), "high");
  assert.equal(computeTier([".env.local"], rules), "high");
  assert.equal(computeTier(["subdir/.env"], rules), "high");
  assert.equal(computeTier([".github/CODEOWNERS"], rules), "high");
  assert.equal(computeTier([".cursor/skills/verify-site/SKILL.md"], rules), "high");
  assert.equal(computeTier([".gitignore"], rules), "medium");
  assert.equal(computeTier(["src/content/posts/.draft.md"], rules), "low");
});

test("more than one ticked tier fails", () => {
  const claimed = parseClaimedTier("- [x] low — posts\n- [x] medium — pages\n- [ ] high — ci\n");
  assert.equal(claimed.ok, false);
  assert.equal(claimed.message, "The pull request body checks more than one risk tier.");
});

test("a ticked tier higher than the computed one passes", () => {
  const claimed = parseClaimedTier("- [ ] low — posts\n- [ ] medium — pages\n- [x] high — ci\n");
  assert.equal(claimed.ok, true);
  assert.equal(claimed.tier, "high");
  assert.equal(claimFailure(claimed.tier, computeTier(["README.md"], rules)), null);
  assert.equal(claimFailure(claimed.tier, "medium"), null);
});

test("double star matches a newline in a path", () => {
  const pattern = globToRegExp("src/content/posts/**");
  assert.equal(pattern.flags.includes("s"), true);
  assert.equal(pattern.test("src/content/posts/line\nbreak.md"), true);
  assert.equal(globToRegExp("README.md").flags.includes("s"), false);
});

test("a 403 on the label write still runs the body check", () => {
  const denied = Object.assign(new Error("Resource not accessible by integration"), { status: 403 });
  const blocked = finishGate({
    labelError: denied,
    failure: "Claimed risk tier low is lower than computed tier high.",
  });
  assert.equal(blocked.rethrow, false);
  assert.equal(blocked.exitCode, 1);
  assert.match(blocked.warning, /403/);
  assert.match(blocked.warning, /Continuing with the body check/);

  const clear = finishGate({ labelError: denied, failure: null });
  assert.equal(clear.exitCode, 0);
  assert.match(clear.warning, /403/);

  const other = finishGate({
    labelError: Object.assign(new Error("boom"), { status: 500 }),
    failure: null,
  });
  assert.equal(other.rethrow, true);
});

function extractJob(workflow, name) {
  const match = new RegExp(`\\n  ${name}:\\n`).exec(workflow);
  assert.ok(match, name);
  const start = match.index + 1;
  const rest = workflow.slice(start);
  const next = rest.slice(1).search(/\n  [a-z]/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

test("a missing base script or risk-tiers fails closed to high", () => {
  assert.equal(failClosedReason(["scripts/risk-tier.mjs"]), "base has no scripts/risk-tier.mjs");
  assert.equal(failClosedReason(["risk-tiers"]), "base has no risk-tiers");
  assert.equal(
    failClosedReason(["scripts/risk-tier.mjs", "risk-tiers"]),
    "base has no scripts/risk-tier.mjs and risk-tiers",
  );
  assert.equal(failClosedReason([]), null);

  const workflow = fs.readFileSync(path.join(repoRoot(), ".github/workflows/risk-tier.yml"), "utf8");
  const tier = extractJob(workflow, "tier");
  assert.match(tier, /\[ -f scripts\/risk-tier\.mjs \] && \[ -f risk-tiers \]/);
  assert.match(tier, /existsSync\("scripts\/risk-tier\.mjs"\)/);
  assert.match(tier, /existsSync\("risk-tiers"\)/);
  assert.match(tier, /base has no " \+ missing\.join\(" and "\)/);
  assert.match(tier, /base has no scripts\/risk-tier\.mjs or risk-tiers/);
  assert.match(tier, /computed high/);
});

test("the workflow runs the base script and fails closed when it is missing", () => {
  const workflow = fs.readFileSync(path.join(repoRoot(), ".github/workflows/risk-tier.yml"), "utf8");
  const tier = extractJob(workflow, "tier");
  const testJob = extractJob(workflow, "test");
  const script = fs.readFileSync(path.join(repoRoot(), "scripts/risk-tier.mjs"), "utf8");
  assert.match(workflow, /on:\n {2}pull_request:\n/);
  assert.doesNotMatch(workflow, /on:\n {2}pull_request_target:/);
  assert.match(tier, /github\.event\.pull_request\.base\.sha/);
  assert.match(tier, /node scripts\/risk-tier\.mjs/);
  assert.match(tier, /persist-credentials:\s*false/);
  assert.match(tier, /computed high/);
  assert.match(script, /\/pulls\/\$\{number\}\/files\?per_page=100&page=\$\{page\}/);
  assert.match(script, /previous_filename/);
  assert.doesNotMatch(script, /git diff/);
  assert.doesNotMatch(script, /child_process/);
  assert.match(testJob, /permissions:\s*\{\s*\}/);
  assert.match(testJob, /npm test/);
  assert.doesNotMatch(testJob, /pull_request\.base\.sha/);
  assert.doesNotMatch(testJob, /secrets\.GITHUB_TOKEN/);

  assert.equal((tier.match(/uses:\s*actions\/checkout@/g) ?? []).length, 1);
  assert.doesNotMatch(tier, /setup-node/);
  assert.doesNotMatch(tier, /node-version/);
  assert.doesNotMatch(tier, /\bnpm\b/);
  assert.doesNotMatch(tier, /\byarn\b/);
  assert.doesNotMatch(tier, /pull_request\.head/);
  assert.doesNotMatch(tier, /\bgithub\.sha\b/);

  const steps = tier.split(/\n {6}- /).slice(1);
  const baseAt = steps.findIndex((step) => step.includes("pull_request.base.sha"));
  assert.equal(baseAt, 0, "the base checkout is the first step");
  const after = steps.slice(baseAt + 1);
  assert.ok(after.length > 0);
  for (const step of after) {
    assert.doesNotMatch(step, /\bnpm\b/, step.slice(0, 80));
    assert.doesNotMatch(step, /\byarn\b/, step.slice(0, 80));
    assert.doesNotMatch(step, /risk-tier\.test\.mjs/);
    assert.doesNotMatch(step, /node-version-file:/);
    assert.doesNotMatch(step, /setup-node/);
  }
});

test("a malicious yarnrc in the pull request cannot run in the label job", () => {
  const yarnrc = 'yarn-path "./.yarn/releases/evil.js"\n';
  const evil = "import { writeFileSync } from 'node:fs';\nwriteFileSync('/tmp/yarn-path-executed', 'ran');\n";
  assert.match(yarnrc, /^yarn-path "\.\/\.yarn\/releases\/evil\.js"$/m);
  assert.match(evil, /writeFileSync\('\/tmp\/yarn-path-executed'/);

  const workflow = fs.readFileSync(path.join(repoRoot(), ".github/workflows/risk-tier.yml"), "utf8");
  const tier = extractJob(workflow, "tier");
  assert.doesNotMatch(tier, /setup-node/);
  assert.doesNotMatch(tier, /node-version-file:/);
  assert.doesNotMatch(tier, /\bnpm\b/);
  assert.doesNotMatch(tier, /\byarn\b/);
  assert.doesNotMatch(tier, /pull_request\.head/);
  assert.doesNotMatch(tier, /\bgithub\.sha\b/);
  assert.doesNotMatch(tier, /refs\/pull\//);
  assert.match(tier, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.match(tier, /persist-credentials:\s*false/);
  assert.equal((tier.match(/uses:\s*actions\/checkout@/g) ?? []).length, 1);
});

test("CODEOWNERS lists johnhamlin on every high glob", () => {
  const owners = fs.readFileSync(path.join(repoRoot(), ".github/CODEOWNERS"), "utf8");
  const highGlobs = loadTiers(fs.readFileSync(defaultTiersPath(), "utf8"))
    .filter((rule) => rule.tier === "high")
    .map((rule) => rule.glob);
  assert.ok(highGlobs.length > 0);
  for (const glob of highGlobs) {
    const found = owners.split(/\r?\n/).some((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return false;
      const [pattern, ...names] = trimmed.split(/\s+/);
      return pattern.replace(/^\//, "") === glob && names.includes("@johnhamlin");
    });
    assert.equal(found, true, glob);
  }
});
