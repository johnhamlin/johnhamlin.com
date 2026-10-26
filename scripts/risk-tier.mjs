import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { minimatch } from "minimatch";

const RANK = { low: 0, medium: 1, high: 2 };
const FLOOR =
  "**/AGENTS.md **/CLAUDE.md **/REVIEW.md .cursor/** .claude/** .github/**".split(
    " ",
  );
const BOX =
  /^[ \t]*(?:[-*+]|\d+\.)\s+\[([xX])\]\s+(low|medium|high)(?![\w-])/gm;
const MATCH = { dot: true, nocase: true, nonegate: true, nocomment: true };

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function unquoteGit(field) {
  if (field[0] !== '"') return field;
  if (field.at(-1) !== '"') throw new Error("bad diff field");
  const bytes = [];
  const pattern = /\\([0-7]{3}|.)|[^\\]/g;
  field.slice(1, -1).replace(pattern, (all, esc) => {
    if (esc == null) bytes.push(all.charCodeAt(0));
    else if (esc === "n" || esc === "t") bytes.push(esc === "n" ? 10 : 9);
    else if (esc === "\\" || esc === '"') bytes.push(esc.charCodeAt(0));
    else if (/^[0-7]{3}$/.test(esc)) bytes.push(Number.parseInt(esc, 8));
    else throw new Error("bad diff field");
    return "";
  });
  return Buffer.from(bytes).toString();
}

export function pathsFromNameStatus(text) {
  const paths = [];
  for (const line of String(text).split("\n")) {
    if (!line) continue;
    const fields = line.split("\t").map(unquoteGit);
    const status = fields[0] ?? "";
    const renamed = status[0] === "R" || status[0] === "C";
    const names = fields.slice(1, renamed ? 3 : 2);
    const valid = /^[ACDMRTUXB]\d*$/.test(status);
    if (!valid || names.length !== (renamed ? 2 : 1) || names.some((n) => !n)) {
      throw new Error("unreadable diff line");
    }
    paths.push(...names);
  }
  return paths;
}

export function loadTiers(text) {
  if (typeof text !== "string")
    throw new Error("risk-tiers is missing or unreadable");
  const rules = FLOOR.map((glob) => ({ tier: "high", glob }));
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(low|medium|high)\s+(\S.*)$/);
    if (!match) throw new Error(`risk-tiers:${index + 1}: bad tier glob`);
    rules.push({ tier: match[1], glob: match[2].trim() });
  }
  return rules;
}

function tierOf(filePath, rules) {
  const bad =
    typeof filePath !== "string" ||
    filePath.includes("\\") ||
    filePath.split("/").includes("..");
  if (bad) throw new Error(`unsafe path ${JSON.stringify(filePath)}`);
  let best = null;
  for (const rule of rules) {
    const hit = minimatch(filePath, rule.glob, MATCH);
    if (hit && (best == null || RANK[rule.tier] > RANK[best])) best = rule.tier;
  }
  return best ?? "medium";
}

export function computeTier(paths, rules) {
  if (!Array.isArray(paths) || paths.length === 0) return "medium";
  let best = "low";
  for (const filePath of paths) {
    const tier = tierOf(filePath, rules);
    if (RANK[tier] > RANK[best]) best = tier;
  }
  return best;
}

export function claimedTier(body) {
  const text = String(body ?? "");
  const heading = text.match(/^## Risk tier\s*$/m);
  if (!heading)
    throw new Error("The pull request body has no Risk tier section.");
  const rest = text.slice(heading.index + heading[0].length);
  const next = rest.search(/^## /m);
  const section = next === -1 ? rest : rest.slice(0, next);
  const checked = [...section.matchAll(BOX)].map((match) => match[2]);
  if (checked.length !== 1) throw new Error("exactly one risk tier required");
  return checked[0];
}

export function checkClaim(body, paths, tiersText) {
  const computed = computeTier(paths, loadTiers(tiersText));
  const claimed = claimedTier(body);
  if (RANK[claimed] < RANK[computed]) {
    const detail = `${claimed} is lower than computed tier ${computed}.`;
    throw new Error(`Claimed risk tier ${detail}`);
  }
  return { computed, claimed };
}

function changedPaths(base, head) {
  const from = String(base ?? "");
  const to = String(head ?? "");
  if (!/^[0-9a-f]{40}$/i.test(from) || !/^[0-9a-f]{40}$/i.test(to)) {
    throw new Error("base and head must be full SHAs");
  }
  const shallow = git(["rev-parse", "--is-shallow-repository"]).trim();
  if (shallow === "true") git(["fetch", "--no-tags", "--unshallow", "origin"]);
  git(["fetch", "--no-tags", "origin", from, to]);
  const spec = `${from}...${to}`;
  return pathsFromNameStatus(git(["diff", "--name-status", "-M", spec]));
}

function main() {
  try {
    const event = fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8");
    const pull = JSON.parse(event).pull_request;
    if (!pull?.base?.sha || !pull?.head?.sha)
      throw new Error("needs a pull_request");
    const tiersText = fs.readFileSync("risk-tiers", "utf8");
    const paths = changedPaths(pull.base.sha, pull.head.sha);
    const result = checkClaim(pull.body, paths, tiersText);
    console.log(`computed ${result.computed}\nclaimed ${result.claimed}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const text = /ENOENT/.test(message)
      ? `risk-tiers is missing or unreadable. ${message}`
      : message;
    console.error(text);
    process.exitCode = 1;
  }
}

const ranDirect =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (ranDirect) main();
