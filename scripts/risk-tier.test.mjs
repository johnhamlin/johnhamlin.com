import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import * as tier from "./risk-tier.mjs";

test("risk tier", () => {
  const low = "low **\n";
  const floor = tier.loadTiers(low);
  const real = tier.loadTiers(fs.readFileSync("risk-tiers", "utf8"));
  const body = (name) => `## Risk tier\n- [x] ${name}\n`;
  const names =
    "AGENTS.md a/REVIEW.md b/CLAUDE.md .cursor/x .GitHub/z src/.cursor/x pkg/.claude/y .mcp.json a/.cursorrules GEMINI.md";
  for (const file of names.split(" "))
    assert.equal(tier.computeTier([file], floor), "high");
  assert.equal(tier.computeTier(["src/content/posts/a.md"], real), "low");
  assert.equal(tier.computeTier(["src/pages/x.astro"], real), "medium");
  assert.equal(tier.computeTier(["package.json"], real), "high");
  assert.equal(tier.computeTier(["nope.txt"], real), "medium");
  assert.equal(tier.computeTier(["functions/api.js"], real), "medium");
  assert.equal(tier.computeTier(["functions/.env"], real), "high");
  assert.equal(tier.checkClaim(body("high"), ["a"], low).computed, "low");
  assert.equal(tier.checkClaim(body("high."), ["a"], low).claimed, "high");
  assert.throws(() => tier.checkClaim(body("low"), ["REVIEW.md"], low), /low/);
  assert.throws(() => tier.checkClaim("x", ["a"], low), /Risk tier/);
  const twice = body("low") + "- [x] high\n";
  assert.throws(() => tier.checkClaim(twice, ["a"], low), /one/);
  const banana = body("high") + "- [x] banana\n";
  assert.throws(() => tier.checkClaim(banana, ["a"], low), /one/);
  assert.throws(() => tier.checkClaim(body("low-priority"), ["a"], low), /one/);
  assert.throws(() => tier.computeTier(["a\\b"], floor), /unsafe/);
  assert.throws(() => tier.computeTier(["a/../b"], floor), /unsafe/);
  assert.throws(() => tier.loadTiers(null), /unreadable/);
  assert.throws(() => tier.loadTiers("bogus\n"), /risk-tiers:1/);
  assert.deepEqual(tier.pathsFromNameStatus("R100\0a\0b\0"), ["a", "b"]);
  assert.deepEqual(tier.pathsFromNameStatus("M\0café.md\0"), ["café.md"]);
  const yml = fs.readFileSync(".github/workflows/risk-tier.yml", "utf8");
  const src = fs.readFileSync("scripts/risk-tier.mjs", "utf8");
  const job = yml.slice(yml.indexOf("\n  tier:\n"));
  assert.match(job, /base\.sha[\s\S]*npm ci/);
  assert.match(job, /fetch-depth: 0/);
  assert.match(job, /timeout-minutes: 5/);
  assert.match(yml, /cancel-in-progress: true/);
  assert.match(src, /"-z", "--name-status", "-M"/);
  assert.doesNotMatch(yml + src, /api\.github\.com|\/pulls\//);
});
