import fs from "node:fs";
import { pathToFileURL } from "node:url";
const RANK = { low: 0, medium: 1, high: 2 };
const FLOOR = ["**/AGENTS.md", "**/CLAUDE.md", "**/REVIEW.md", ".cursor/**", ".claude/**", ".github/**"];
const BOX = /^[ \t]*(?:[-*+]|\d+\.)\s+\[([xX])\]\s+(low|medium|high)(?![\w-])/gm;
function globToRegExp(glob) {
  let source = "";
  const pattern = glob.toLowerCase();
  for (let i = 0; i < pattern.length; i += 1) {
    const rest = pattern.slice(i);
    if (rest.startsWith("**/")) { source += "(?:.*/)?"; i += 2; continue; }
    if (rest.startsWith("**")) { source += ".*"; i += 1; continue; }
    const c = pattern[i];
    source += c === "*" ? "[^/]*" : c === "?" ? "[^/]" : "\\^$.|+()[]{}".includes(c) ? `\\${c}` : c;
  }
  return new RegExp(`^${source}$`, "s");
}
export function loadTiers(text) {
  if (typeof text !== "string") throw new Error("risk-tiers is missing or unreadable");
  const rules = FLOOR.map((glob) => ({ tier: "high", regex: globToRegExp(glob) }));
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(low|medium|high)\s+(\S.*)$/);
    if (!match) throw new Error(`risk-tiers:${index + 1}: expected "tier glob"`);
    rules.push({ tier: match[1], regex: globToRegExp(match[2].trim()) });
  }
  return rules;
}
function tierOf(filePath, rules) {
  if (typeof filePath !== "string" || filePath.includes("\\") || filePath.split("/").includes("..")) {
    throw new Error(`unsafe path ${JSON.stringify(filePath)}`);
  }
  let best = null;
  const lowered = filePath.toLowerCase();
  for (const rule of rules) {
    if (rule.regex.test(lowered) && (best == null || RANK[rule.tier] > RANK[best])) best = rule.tier;
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
  if (!heading) throw new Error("The pull request body has no Risk tier section.");
  const rest = text.slice(heading.index + heading[0].length);
  const next = rest.search(/^## /m);
  const section = next === -1 ? rest : rest.slice(0, next);
  const checked = [...section.matchAll(BOX)].map((match) => match[2]);
  if (checked.length !== 1) throw new Error("The pull request body must check exactly one risk tier.");
  return checked[0];
}
export function checkClaim(body, paths, tiersText) {
  const computed = computeTier(paths, loadTiers(tiersText));
  const claimed = claimedTier(body);
  if (RANK[claimed] < RANK[computed]) throw new Error(`Claimed risk tier ${claimed} is lower than computed tier ${computed}.`);
  return { computed, claimed };
}
async function changedPaths(token, owner, repo, number, changedFiles) {
  const files = [];
  const headers = { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "User-Agent": "johnhamlin-com-risk-tier", "X-GitHub-Api-Version": "2022-11-28" };
  for (let page = 1; ; page += 1) {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${number}/files?per_page=100&page=${page}`, { headers });
    if (!response.ok) throw new Error(`GET files failed (${response.status})`);
    const batch = await response.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    files.push(...batch);
    if (batch.length < 100) break;
  }
  if (!Number.isInteger(changedFiles) || files.length < changedFiles) throw new Error("The changed-file list is incomplete.");
  return files.flatMap((file) => [file.filename, file.previous_filename].filter(Boolean));
}
async function main() {
  try {
    const token = process.env.GITHUB_TOKEN;
    const repository = process.env.GITHUB_REPOSITORY || "";
    const slash = repository.indexOf("/");
    if (!token || slash <= 0) throw new Error(token ? "GITHUB_REPOSITORY must be owner/name" : "GITHUB_TOKEN is not set");
    const pull = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")).pull_request;
    if (!pull) throw new Error("risk-tier.mjs needs a pull_request event");
    const paths = await changedPaths(token, repository.slice(0, slash), repository.slice(slash + 1), pull.number, pull.changed_files);
    const result = checkClaim(pull.body, paths, fs.readFileSync("risk-tiers", "utf8"));
    console.log(`computed ${result.computed}\nclaimed ${result.claimed}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(/ENOENT/.test(message) ? `risk-tiers is missing or unreadable. ${message}` : message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
