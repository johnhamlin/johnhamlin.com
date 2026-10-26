import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkClaim, claimedTier, computeTier, loadTiers } from "./risk-tier.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tiers = fs.readFileSync(path.join(root, "risk-tiers"), "utf8");
const rules = loadTiers(tiers);
const lowFloor = "low **\n";

function body(tier) {
  return `## Ticket\n- [x] low outside\n\n## Risk tier\n- [x] ${tier}\n\n## Review\n- [x] medium outside\n`;
}

test("agent instruction files are high even when risk-tiers says low", () => {
  const lowered = loadTiers(lowFloor);
  for (const filePath of [
    "AGENTS.md",
    "docs/REVIEW.md",
    "notes/CLAUDE.md",
    ".cursor/skills/x",
    ".claude/settings.json",
    ".github/workflows/risk-tier.yml",
    ".GitHub/workflows/x.yml",
    ".github/pull_request_template.md",
  ]) {
    assert.equal(computeTier([filePath], lowered), "high", filePath);
  }
});

test("risk-tiers picks the highest matching tier", () => {
  assert.equal(computeTier(["src/content/posts/hello.md"], rules), "low");
  assert.equal(computeTier(["src/pages/index.astro"], rules), "medium");
  assert.equal(computeTier(["README.md", "src/pages/index.astro"], rules), "medium");
  assert.equal(computeTier(["README.md", "package.json"], rules), "high");
  assert.equal(computeTier(["not-listed.txt"], rules), "medium");
  assert.equal(computeTier([], rules), "medium");
});

test("the body must check one tier at least as high as the computed tier", () => {
  assert.equal(checkClaim(body("high"), ["REVIEW.md"], lowFloor).computed, "high");
  assert.equal(checkClaim(body("high"), ["README.md"], "low README.md\n").computed, "low");
  assert.equal(checkClaim("## Risk tier\n- [x] high.\n", ["REVIEW.md"], lowFloor).claimed, "high");
  assert.throws(() => checkClaim(body("low"), ["REVIEW.md"], lowFloor), /lower than computed tier high/);
  assert.throws(() => checkClaim("no section", ["README.md"], "low README.md\n"), /no Risk tier section/);
  assert.throws(() => checkClaim("## Risk tier\n- [x] low\n- [x] high\n", ["README.md"], "low README.md\n"), /exactly one/);
  assert.throws(() => checkClaim("## Risk tier\n- [x] low-priority\n", ["README.md"], "low README.md\n"), /exactly one/);
  assert.throws(() => claimedTier("## Risk tier\n- [ ] high\n"), /exactly one/);
});

test("an unsafe path fails the check", () => {
  assert.throws(() => computeTier(["src\\secret.md"], rules), /unsafe path/);
  assert.throws(() => computeTier(["docs/../REVIEW.md"], rules), /unsafe path/);
  assert.equal(computeTier(["foo..bar"], rules), "medium");
  assert.throws(() => checkClaim(body("high"), ["a\\b"], tiers), /unsafe path/);
});

test("a missing or invalid risk-tiers file fails", () => {
  assert.throws(() => loadTiers(null), /missing or unreadable/);
  assert.throws(() => loadTiers(undefined), /missing or unreadable/);
  assert.throws(() => checkClaim(body("high"), ["README.md"], null), /missing or unreadable/);
  assert.throws(() => loadTiers("not a tier\n"), /risk-tiers:1/);
});

test("the workflow reads the base and does not call the label API", () => {
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/risk-tier.yml"), "utf8");
  const tier = workflow.slice(workflow.indexOf("\n  tier:\n"));
  assert.match(workflow, /on:\n {2}pull_request:\n/);
  assert.doesNotMatch(workflow, /on:\n {2}pull_request_target:/);
  assert.match(tier, /github\.event\.pull_request\.base\.sha/);
  assert.match(tier, /persist-credentials:\s*false/);
  assert.match(tier, /contents: read/);
  assert.match(tier, /pull-requests: read/);
  assert.doesNotMatch(workflow, /pull-requests: write/);
  assert.doesNotMatch(workflow, /\/labels/);
  assert.doesNotMatch(workflow, /\/issues\//);
  assert.match(tier, /node scripts\/risk-tier\.mjs/);
  assert.doesNotMatch(tier, /setup-node/);
  assert.doesNotMatch(tier, /\bnpm\b/);
  assert.doesNotMatch(tier, /\byarn\b/);
  assert.equal((tier.match(/uses:\s*actions\/checkout@/g) ?? []).length, 1);
});
