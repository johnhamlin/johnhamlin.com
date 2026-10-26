import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyLabelPlan,
  changedFilesFailure,
  changedPaths,
  claimFailure,
  computeTier,
  decideTier,
  defaultTiersPath,
  failClosedReason,
  finishGate,
  globToRegExp,
  loadTiers,
  loadTiersFile,
  parseClaimedTier,
  planLabelUpdates,
  repoRoot,
  riskLabelProblem,
  settleLabelPlan,
  tierForLogLine,
  unsafePathReason,
} from "./risk-tier.mjs";

const rules = loadTiersFile();

function riskBody(lines) {
  return `## Ticket\n- [x] low outside the section\n\n## Risk tier\n${lines}\n\n## Review\n- [x] medium outside the section\n`;
}

function shellSteps(job) {
  const steps = [];
  const lines = job.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const inline = lines[index].match(/^ {8}run: ([^|].*)$/);
    if (inline) {
      steps.push(inline[1]);
      continue;
    }
    if (!/^ {8}run: \|$/.test(lines[index])) continue;
    const body = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const current = lines[cursor];
      if (current.startsWith("          ")) {
        body.push(current.slice(10));
        index = cursor;
        continue;
      }
      if (current.trim() === "") {
        body.push("");
        index = cursor;
        continue;
      }
      break;
    }
    steps.push(body.join("\n"));
  }
  return steps;
}

function bootstrapSource(workflow) {
  const marker = "BOOTSTRAP_SOURCE: |\n";
  const start = workflow.indexOf(marker);
  assert.ok(start !== -1);
  const lines = [];
  for (const line of workflow.slice(start + marker.length).split("\n")) {
    if (line.startsWith("            ")) lines.push(line.slice(12));
    else if (line.trim() === "") lines.push("");
    else break;
  }
  return `${lines.join("\n")}\n`;
}

function bootstrapLabelApi() {
  const workflow = fs.readFileSync(path.join(repoRoot(), ".github/workflows/risk-tier.yml"), "utf8");
  const source = bootstrapSource(workflow);
  const start = source.indexOf("function outcomeAfterLabelWrite");
  const end = source.indexOf("// end applyRiskLabel");
  assert.ok(start !== -1 && end > start);
  return new Function(`${source.slice(start, end)}\nreturn { outcomeAfterLabelWrite, applyRiskLabel };`)();
}

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
    riskBody(["- [x] low — posts, copy, and docs", "- [ ] medium — components", "- [ ] high — ci"].join("\n")),
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
  const claimed = parseClaimedTier(riskBody("- [ ] low — posts\n- [ ] medium — pages\n- [ ] high — ci\n"));
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
  assert.equal(computeTier(["docs/agents.md"], rules), "high");
  assert.equal(computeTier(["src/content/posts/Review.md"], rules), "high");
  assert.equal(computeTier(["packages/web/claude.MD"], rules), "high");
  assert.equal(globToRegExp("**/AGENTS.md").test("docs/agents.md"), true);
  assert.equal(globToRegExp("**/AGENTS.md").flags.includes("i"), false);
  assert.equal(globToRegExp("README.md").flags.includes("i"), false);
  const tiersText = fs.readFileSync(defaultTiersPath(), "utf8");
  const owners = fs.readFileSync(path.join(repoRoot(), ".github/CODEOWNERS"), "utf8");
  for (const glob of ["**/AGENTS.md", "**/CLAUDE.md", "**/REVIEW.md"]) {
    assert.match(tiersText, new RegExp(`^high \\*\\*/${glob.slice(3)}$`, "m"));
    assert.match(owners, new RegExp(`^\\*\\*/${glob.slice(3)} @johnhamlin$`, "m"));
  }
});

test("every tier matches the lowercased path", () => {
  const pairs = [
    [".GitHub/workflows/x.yml", ".github/workflows/x.yml"],
    [".CURSOR/x", ".cursor/x"],
    ["Package.json", "package.json"],
    ["Src/Pages/Index.astro", "src/pages/index.astro"],
    ["Src/Content/Posts/Hello.md", "src/content/posts/hello.md"],
  ];
  for (const [mixed, lower] of pairs) {
    assert.equal(computeTier([mixed], rules), computeTier([lower], rules), mixed);
  }
  assert.equal(computeTier([".GitHub/workflows/x.yml"], rules), "high");
  assert.equal(computeTier([".CURSOR/x"], rules), "high");
  assert.equal(computeTier(["Package.json"], rules), "high");
  assert.equal(computeTier(["Src/Pages/Index.astro"], rules), "medium");
  assert.equal(computeTier(["Src/Content/Posts/Hello.md"], rules), "low");
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
  const claimed = parseClaimedTier(riskBody("- [x] low — posts\n- [x] medium — pages\n- [ ] high — ci\n"));
  assert.equal(claimed.ok, false);
  assert.equal(claimed.message, "The pull request body checks more than one risk tier.");
});

test("a ticked tier higher than the computed one passes", () => {
  const claimed = parseClaimedTier(riskBody("- [ ] low — posts\n- [ ] medium — pages\n- [x] high — ci\n"));
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
  assert.doesNotMatch(blocked.warning, /Continuing with the body check/);

  const clear = finishGate({ labelError: denied, failure: null });
  assert.equal(clear.exitCode, 0);
  assert.match(clear.warning, /403/);
  assert.match(clear.warning, /Continuing with the body check/);

  const other = finishGate({
    labelError: Object.assign(new Error("boom"), { status: 500 }),
    failure: null,
  });
  assert.equal(other.rethrow, true);
});

test("a tier suffix is not a claim in either parser", () => {
  const workflow = fs.readFileSync(path.join(repoRoot(), ".github/workflows/risk-tier.yml"), "utf8");
  const source = bootstrapSource(workflow);
  const start = source.indexOf("function parseChecked");
  const end = source.indexOf("// end parseChecked");
  assert.ok(start !== -1 && end > start);
  const parseChecked = new Function(`${source.slice(start, end)}\nreturn parseChecked;`)();
  const samples = [
    ["- [x] low-priority", false, null],
    ["- [x] high-priority", false, null],
    ["- [x] medium-rare", false, null],
    ["- [x] low", true, "low"],
    ["- [x] high — ci", true, "high"],
    ["- [x] high.", true, "high"],
    ["- [x] medium — pages", true, "medium"],
  ];
  for (const [line, ok, tier] of samples) {
    const body = riskBody(line);
    const claimed = parseClaimedTier(body);
    assert.equal(claimed.ok, ok, line);
    if (ok) assert.equal(claimed.tier, tier, line);
    const checked = parseChecked(body);
    assert.deepEqual(checked, ok ? [tier] : [], line);
  }
  const outside = "## Ticket\n- [x] high\n\n## Review\n- [x] low\n";
  assert.equal(parseClaimedTier(outside).ok, false);
  assert.deepEqual(parseChecked(outside), []);
});

test("changed paths are matched literally", () => {
  assert.equal(unsafePathReason(["src/content/posts/hello.md"]), null);
  assert.equal(computeTier(["src/content/posts/hello.md"], rules), "low");
  assert.match(unsafePathReason(["src/content/posts\\hello.md"]), /\\/);
  assert.equal(computeTier(["src/content/posts\\hello.md"], rules), "high");
  assert.match(String(unsafePathReason(["docs/../REVIEW.md"])), /\.\./);
  assert.equal(computeTier(["docs/../REVIEW.md"], rules), "high");
  assert.equal(computeTier(["README.md", "src/../secret.md"], rules), "high");
  assert.equal(unsafePathReason(["foo..bar"]), null);
  assert.equal(computeTier(["foo..bar"], rules), "medium");
  assert.equal(computeTier(["docs/notes..md"], rules), "low");
});

test("invalid risk-tiers or a files page cap fails closed to high", () => {
  assert.throws(() => loadTiers("not a tier\n"), /risk-tiers:1/);
  assert.equal(
    decideTier({
      tiersFailure: "risk-tiers is invalid. The tier fails closed to high.",
      paths: ["README.md"],
      rules,
    }),
    "high",
  );
  const cap = changedFilesFailure(3000, 3000, true);
  assert.match(cap, /page cap of 3000/);
  assert.match(cap, /fails closed to high/);
  assert.match(changedFilesFailure(2, 5, false), /fewer than pull_request\.changed_files \(5\)/);
  assert.match(changedFilesFailure(1, Number.NaN, false), /changed_files is missing/);
  assert.equal(changedFilesFailure(4, 4, false), null);
  assert.equal(decideTier({ listFailure: cap, paths: ["README.md"], rules }), "high");
  assert.equal(decideTier({ unsafeFailure: unsafePathReason(["a\\b"]), paths: ["a\\b"], rules }), "high");
  assert.equal(tierForLogLine("LICENSE", [], true), "high");
  assert.equal(tierForLogLine("README.md", rules, true), "high");
  assert.equal(tierForLogLine("LICENSE", rules, false), "medium");
  assert.equal(tierForLogLine("README.md", rules, false), "low");
  const script = fs.readFileSync(path.join(repoRoot(), "scripts/risk-tier.mjs"), "utf8");
  const mainSource = script.slice(script.indexOf("async function main"));
  assert.match(mainSource, /const forcedHigh = Boolean\(tiersFailure \|\| listFailure \|\| unsafeFailure\)/);
  assert.match(mainSource, /tierForLogLine\(filePath, rules, forcedHigh\)/);
  const failureAt = mainSource.indexOf("tiersFailure");
  const syncAt = mainSource.indexOf("syncLabel(token, owner, repo, number, computed)");
  assert.ok(failureAt !== -1 && syncAt > failureAt);
  const syncSource = script.slice(script.indexOf("async function syncLabel"));
  const settleAt = syncSource.indexOf("settleLabelPlan");
  assert.ok(settleAt !== -1 && syncSource.lastIndexOf("listIssueLabels") > settleAt);
  const workflow = fs.readFileSync(path.join(repoRoot(), ".github/workflows/risk-tier.yml"), "utf8");
  assert.match(workflow, /The files API page cap of /);
  assert.match(workflow, /risk-tiers is invalid/);
  assert.match(workflow, /contains a \.\. segment/);
});

test("a 403 midway through a label update never passes with two risk labels", async () => {
  const denied = Object.assign(new Error("Resource not accessible by integration"), { status: 403 });
  const starting = ["risk:low", "bug"];
  const plan = planLabelUpdates(starting, "high");
  let removes = 0;
  const blocked = await settleLabelPlan(starting, plan, async (action) => {
    if (action.op === "remove") {
      removes += 1;
      throw denied;
    }
  });
  assert.ok(removes >= 1);
  assert.equal(blocked.conflict, true);
  assert.deepEqual(blocked.risk.slice().sort(), ["risk:high", "risk:low"]);
  const blockedProblem = riskLabelProblem(blocked.risk, "high");
  assert.match(blockedProblem, /more than one risk/);
  const blockedGate = finishGate({ labelError: blocked.error, failure: null, labelProblem: blockedProblem });
  assert.equal(blockedGate.rethrow, false);
  assert.equal(blockedGate.exitCode, 1);
  assert.match(blockedGate.labelProblem, /more than one risk/);
  assert.match(blockedGate.warning, /403/);
  assert.doesNotMatch(blockedGate.warning, /Continuing with the body check/);

  let failedRemove = false;
  const cleared = await settleLabelPlan(starting, plan, async (action) => {
    if (action.op === "remove" && !failedRemove) {
      failedRemove = true;
      throw denied;
    }
  });
  assert.deepEqual(cleared.risk, ["risk:high"]);
  assert.equal(cleared.conflict, false);
  assert.equal(riskLabelProblem(cleared.risk, "high"), null);
  assert.equal(finishGate({ labelError: cleared.error, failure: null, labelProblem: null }).exitCode, 0);

  const fork = await settleLabelPlan([], planLabelUpdates([], "high"), async () => {
    throw denied;
  });
  assert.equal(fork.conflict, false);
  assert.deepEqual(fork.risk, []);
  assert.equal(riskLabelProblem(fork.risk, "high"), null);
  assert.equal(finishGate({ labelError: fork.error, failure: null, labelProblem: null }).exitCode, 0);
});

test("a refused add that leaves risk:low fails when the tier is higher", async () => {
  const denied = Object.assign(new Error("Resource not accessible by integration"), { status: 403 });
  const starting = ["risk:low"];
  const plan = planLabelUpdates(starting, "high");
  let adds = 0;
  const settled = await settleLabelPlan(starting, plan, async (action) => {
    if (action.op === "add") adds += 1;
    throw denied;
  });
  assert.equal(adds, 1);
  assert.deepEqual(settled.risk, ["risk:low"]);
  const labelProblem = riskLabelProblem(["risk:low"], "high");
  assert.match(labelProblem, /Risk label risk:low is lower than computed tier high/);
  const gate = finishGate({ labelError: settled.error, failure: null, labelProblem });
  assert.equal(gate.rethrow, false);
  assert.equal(gate.exitCode, 1);
  assert.match(gate.warning, /403/);
  assert.doesNotMatch(gate.warning, /Continuing with the body check/);
  assert.equal(riskLabelProblem([], "high"), null);
  assert.equal(riskLabelProblem(["risk:high"], "high"), null);
  assert.match(riskLabelProblem(["risk:high"], "medium"), /higher than computed tier medium/);
  assert.match(riskLabelProblem(["risk:medium"], "high"), /lower than computed tier high/);
  const workflow = fs.readFileSync(path.join(repoRoot(), ".github/workflows/risk-tier.yml"), "utf8");
  const bootstrap = bootstrapSource(workflow);
  const marker = '"/issues/" + number + "/labels?per_page=100"';
  const firstRead = bootstrap.indexOf(marker);
  const reread = bootstrap.indexOf(marker, firstRead + marker.length);
  assert.ok(firstRead !== -1 && reread > firstRead);
  assert.match(bootstrap, /is lower than computed tier high/);
  assert.match(bootstrap, /Label update left more than one risk:\* label/);
});

test("zero labels after a successful write fails", async () => {
  const empty = { writeSucceeded: true };
  const problem = riskLabelProblem([], "high", empty);
  assert.match(problem, /A label write succeeded but the pull request has no risk:\* label\./);
  assert.equal(riskLabelProblem([], "high"), null);
  assert.equal(riskLabelProblem([], "high", { writeSucceeded: false }), null);
  const denied = Object.assign(new Error("Resource not accessible by integration"), { status: 403 });
  const failed = finishGate({ labelError: denied, failure: null, labelProblem: problem });
  assert.equal(failed.rethrow, false);
  assert.equal(failed.exitCode, 1);
  assert.match(failed.warning, /403/);
  assert.doesNotMatch(failed.warning, /Continuing with the body check/);
  const warned = finishGate({
    labelError: denied,
    failure: null,
    labelProblem: riskLabelProblem([], "high", { writeSucceeded: false }),
  });
  assert.equal(warned.exitCode, 0);

  const { outcomeAfterLabelWrite, applyRiskLabel } = bootstrapLabelApi();
  assert.equal(outcomeAfterLabelWrite([], "high", empty), problem);
  assert.equal(outcomeAfterLabelWrite([], "high", { writeSucceeded: false }), null);
  let issueReads = 0;
  const applied = await applyRiskLabel(async (method, apiPath) => {
    if (method === "GET" && apiPath.includes("/issues/")) {
      issueReads += 1;
      return issueReads === 1 ? [{ name: "risk:low" }] : [];
    }
    if (method === "GET" && apiPath.includes("/labels/")) return { name: "risk:high" };
    if (method === "POST" && apiPath.includes("/issues/")) return [{ name: "risk:high" }];
    if (method === "DELETE") return null;
    throw new Error(`unexpected ${method} ${apiPath}`);
  }, "o", "r", 1);
  assert.equal(applied.writeSucceeded, true);
  assert.equal(applied.readError, null);
  assert.equal(applied.labelProblem, problem);
});

test("a leftover higher label after a write fails", () => {
  const problem = riskLabelProblem(["risk:high"], "medium", { writeSucceeded: true });
  assert.match(problem, /Risk label risk:high is higher than computed tier medium\./);
  assert.equal(riskLabelProblem(["risk:medium"], "medium", { writeSucceeded: true }), null);
  assert.equal(riskLabelProblem(["risk:high"], "high", { writeSucceeded: true }), null);
  const { outcomeAfterLabelWrite } = bootstrapLabelApi();
  assert.equal(outcomeAfterLabelWrite(["risk:high"], "medium", { writeSucceeded: true }), problem);
  assert.equal(outcomeAfterLabelWrite(["risk:medium"], "medium", { writeSucceeded: true }), null);
  assert.equal(outcomeAfterLabelWrite(["risk:high"], "high", { writeSucceeded: true }), null);
});

test("an unknown risk label fails", async () => {
  const problem = riskLabelProblem(["risk:foo"], "high");
  assert.match(problem, /Risk label risk:foo is not a known risk tier\./);
  assert.match(riskLabelProblem(["risk:high", "risk:foo"], "medium"), /Risk label risk:foo is not a known risk tier\./);
  assert.match(riskLabelProblem(["risk:foo"], "low", { writeSucceeded: false }), /Risk label risk:foo is not a known risk tier\./);
  assert.equal(riskLabelProblem(["risk:high", "bug"], "high"), null);

  const { outcomeAfterLabelWrite, applyRiskLabel } = bootstrapLabelApi();
  assert.equal(outcomeAfterLabelWrite(["risk:foo"], "high", {}), problem);
  assert.equal(outcomeAfterLabelWrite(["risk:high", "risk:foo"], "medium", { writeSucceeded: true }), riskLabelProblem(["risk:high", "risk:foo"], "medium", { writeSucceeded: true }));
  let issueReads = 0;
  const applied = await applyRiskLabel(async (method, apiPath) => {
    if (method === "GET" && apiPath.includes("/issues/")) {
      issueReads += 1;
      if (issueReads === 1) return [];
      return [{ name: "risk:high" }, { name: "risk:foo" }];
    }
    if (method === "GET" && apiPath.includes("/labels/")) return { name: "risk:high" };
    if (method === "POST" && apiPath.includes("/issues/")) return [{ name: "risk:high" }];
    throw new Error(`unexpected ${method} ${apiPath}`);
  }, "o", "r", 1);
  assert.equal(applied.writeSucceeded, true);
  assert.match(applied.labelProblem, /Risk label risk:foo is not a known risk tier\./);
});

test("a recovery write succeeds and then the re-read gets a 403, which fails", async () => {
  const denied = Object.assign(new Error("Resource not accessible by integration"), { status: 403 });
  const starting = ["risk:low"];
  const plan = planLabelUpdates(starting, "high");
  let removed = false;
  const settled = await settleLabelPlan(starting, plan, async (action) => {
    if (action.op === "add") throw denied;
    if (action.op === "remove") removed = true;
  });
  assert.equal(removed, true);
  assert.equal(settled.writeSucceeded, true);
  assert.equal(settled.error, denied);
  const readError = Object.assign(new Error("Resource not accessible by integration"), { status: 403 });
  const problem = riskLabelProblem(["risk:high"], "high", {
    writeSucceeded: settled.writeSucceeded,
    readError,
  });
  assert.match(problem, /Could not re-read labels after a successful label write\./);
  const gate = finishGate({ labelError: settled.error, failure: null, labelProblem: problem });
  assert.equal(gate.rethrow, false);
  assert.equal(gate.exitCode, 1);
  assert.match(gate.warning, /403/);
  assert.doesNotMatch(gate.warning, /Continuing with the body check/);
  assert.equal(riskLabelProblem(["risk:high"], "high", { writeSucceeded: false, readError }), null);
  assert.equal(riskLabelProblem([], "high", { writeSucceeded: false, readError }), null);

  let missedStep = 0;
  const missed = await settleLabelPlan(starting, plan, async () => {
    missedStep += 1;
    if (missedStep === 1) throw denied;
    throw Object.assign(new Error("gone"), { status: 404 });
  });
  assert.equal(missed.writeSucceeded, false);
  assert.equal(riskLabelProblem([], "high", { writeSucceeded: missed.writeSucceeded, readError }), null);

  const script = fs.readFileSync(path.join(repoRoot(), "scripts/risk-tier.mjs"), "utf8");
  const syncSource = script.slice(script.indexOf("async function syncLabel"), script.indexOf("function readEvent"));
  assert.match(syncSource, /let writeSucceeded = false/);
  assert.match(syncSource, /riskLabelProblem\(observed, tier, \{ writeSucceeded, readError \}\)/);
  assert.ok(syncSource.indexOf("let writeSucceeded = false") < syncSource.indexOf("if (!settled.error) settled.error = error"));

  const { outcomeAfterLabelWrite, applyRiskLabel } = bootstrapLabelApi();
  assert.equal(
    outcomeAfterLabelWrite(["risk:high"], "high", { writeSucceeded: true, readError }),
    problem,
  );
  let issueReads = 0;
  let deletes = 0;
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args.join(" "));
  };
  try {
    const applied = await applyRiskLabel(async (method, apiPath) => {
      if (method === "GET" && apiPath.includes("/issues/")) {
        issueReads += 1;
        if (issueReads === 1) return [{ name: "risk:low" }];
        throw denied;
      }
      if (method === "GET" && apiPath.includes("/labels/")) return { name: "risk:high" };
      if (method === "POST" && apiPath.includes("/issues/")) throw denied;
      if (method === "DELETE") {
        deletes += 1;
        return null;
      }
      throw new Error(`unexpected ${method} ${apiPath}`);
    }, "o", "r", 1);
    assert.equal(deletes, 1);
    assert.equal(applied.writeSucceeded, true);
    assert.equal(applied.labelError, denied);
    assert.equal(applied.readError.status, 403);
    assert.equal(applied.labelProblem, problem);
    assert.equal(warnings.some((line) => line.includes("could not re-read")), false);
  } finally {
    console.warn = originalWarn;
  }
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
  assert.match(tier, /runs-on:\s*ubuntu-slim/);
  assert.match(tier, /cancel-in-progress:\s*false/);
  assert.match(tier, /risk-tier-label-/);
  assert.doesNotMatch(tier, /cancel-in-progress:\s*true/);
  assert.match(tier, /computed high/);
  assert.match(testJob, /PR_NUMBER: \$\{\{ github\.event\.pull_request\.number \}\}/);
  for (const scriptText of shellSteps(testJob)) {
    assert.doesNotMatch(scriptText, /\$\{\{/);
  }
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

  const steps = shellSteps(tier);
  assert.ok(steps.some((script) => script.includes("node scripts/risk-tier.mjs")));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "risk-tier-bin-"));
  const log = path.join(bin, "calls.log");
  const marker = path.join(bin, "pwned");
  for (const name of ["npm", "yarn", "npx"]) {
    const file = path.join(bin, name);
    fs.writeFileSync(file, "#!/bin/sh\necho \"$0 $*\" >> \"$LABEL_JOB_CALL_LOG\"\nexit 0\n");
    fs.chmodSync(file, 0o755);
  }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "risk-tier-yarn-"));
  const repoYarnrc = path.join(repoRoot(), ".yarnrc");
  const repoYarn = path.join(repoRoot(), ".yarn");
  const repoYarnrcBefore = fs.existsSync(repoYarnrc);
  const repoYarnBefore = fs.existsSync(repoYarn);
  const evilPath = path.join(work, ".yarn", "releases", "evil.js");
  fs.mkdirSync(path.dirname(evilPath), { recursive: true });
  fs.writeFileSync(path.join(work, ".yarnrc"), "yarn-path \"./.yarn/releases/evil.js\"\n");
  fs.writeFileSync(evilPath, `require("fs").writeFileSync(${JSON.stringify(marker)}, "ran");\n`);
  try {
    const probe = spawnSync(path.join(bin, "yarn"), ["--version"], {
      env: { ...process.env, LABEL_JOB_CALL_LOG: log, PATH: `${bin}:${process.env.PATH}` },
      encoding: "utf8",
    });
    assert.equal(probe.status, 0);
    assert.match(fs.readFileSync(log, "utf8"), /yarn/);
    fs.writeFileSync(log, "");
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      LABEL_JOB_CALL_LOG: log,
      GITHUB_TOKEN: "",
      GH_TOKEN: "",
      GITHUB_OUTPUT: path.join(bin, "github-output"),
      GITHUB_STEP_SUMMARY: "",
      GITHUB_EVENT_PATH: "",
      BOOTSTRAP_SOURCE: bootstrapSource(workflow),
    };
    assert.ok(steps.length >= 3);
    for (const script of steps) {
      const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], {
        cwd: work,
        env,
        encoding: "utf8",
      });
      assert.equal(result.error, undefined, script.slice(0, 80));
      assert.notEqual(result.status, null, script.slice(0, 80));
      if (script.includes("[ -f scripts/risk-tier.mjs ]")) {
        assert.equal(result.status, 0, result.stderr);
      } else if (script.includes("node scripts/risk-tier.mjs")) {
        assert.notEqual(result.status, 0, result.stderr);
        assert.match(`${result.stderr}`, /Cannot find module|GITHUB_TOKEN is not set/);
      } else if (script.includes("BOOTSTRAP_SOURCE")) {
        assert.notEqual(result.status, 0, result.stderr);
        assert.match(`${result.stderr}`, /GITHUB_TOKEN is not set/);
      } else {
        assert.fail(`unexpected label step: ${script.slice(0, 80)}`);
      }
    }
    assert.equal(fs.existsSync(marker), false);
    assert.equal(fs.readFileSync(log, "utf8"), "");
    assert.equal(fs.existsSync(repoYarnrc), repoYarnrcBefore);
    assert.equal(fs.existsSync(repoYarn), repoYarnBefore);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
    fs.rmSync(bin, { recursive: true, force: true });
  }
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
