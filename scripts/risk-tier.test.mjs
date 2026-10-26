import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  applyLabelPlan,
  claimFailure,
  computeTier,
  defaultTiersPath,
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
