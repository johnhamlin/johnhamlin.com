import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const API = "https://api.github.com";
const API_VERSION = "2022-11-28";

const RANK = {
  low: 0,
  medium: 1,
  high: 2,
};

const LABEL_FOR_TIER = {
  low: "risk:low",
  medium: "risk:medium",
  high: "risk:high",
};

const LABEL_SPECS = [
  { name: "risk:low", color: "0e8a16", description: "Computed path risk tier is low." },
  { name: "risk:medium", color: "fbca04", description: "Computed path risk tier is medium." },
  { name: "risk:high", color: "b60205", description: "Computed path risk tier is high." },
];

const CASE_INSENSITIVE_NAMES = new Set(["agents.md", "claude.md", "review.md"]);
const RISK_LABELS = new Set(["risk:low", "risk:medium", "risk:high"]);

// Floor. A pull request cannot downgrade these by editing risk-tiers.
// AGENTS.md, CLAUDE.md, and REVIEW.md match at any depth.
export const ALWAYS_HIGH = [
  "**/AGENTS.md",
  "**/CLAUDE.md",
  "**/REVIEW.md",
  ".cursor/**",
  ".claude/**",
  ".github/**",
  "risk-tiers",
  "scripts/risk-tier.mjs",
  "scripts/risk-tier.test.mjs",
];

const ALWAYS_HIGH_RULES = ALWAYS_HIGH.map((glob) => ({
  glob,
  regex: globToRegExp(glob),
}));

const CHECKBOX = /^[ \t]*(?:[-*+]|\d+\.)\s+\[([ xX])\]\s+(low|medium|high)(?=\s|$)/;

export const FILES_API_CAP = 3000;

export function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function defaultTiersPath() {
  return path.join(repoRoot(), "risk-tiers");
}

export function globToRegExp(glob) {
  let source = "";
  let index = 0;
  while (index < glob.length) {
    const rest = glob.slice(index);
    if (rest.startsWith("**/")) {
      source += "(?:.*/)?";
      index += 3;
      continue;
    }
    if (rest.startsWith("**")) {
      source += ".*";
      index += 2;
      continue;
    }
    const character = glob[index];
    if (character === "*") {
      source += "[^/]*";
    } else if (character === "?") {
      source += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(character)) {
      source += `\\${character}`;
    } else {
      source += character;
    }
    index += 1;
  }
  // `s` makes `**` (`.*`) match a newline inside a path.
  // AGENTS.md, CLAUDE.md, and REVIEW.md match in any case. Other globs do not.
  return new RegExp(`^${source}$`, regexFlags(glob));
}

function regexFlags(glob) {
  let flags = "";
  if (glob.includes("**")) flags += "s";
  const base = glob.slice(glob.lastIndexOf("/") + 1).toLowerCase();
  if (CASE_INSENSITIVE_NAMES.has(base)) flags += "i";
  return flags === "" ? undefined : flags;
}

export function unsafePathReason(filePaths) {
  for (const filePath of filePaths) {
    if (typeof filePath !== "string") continue;
    if (filePath.includes("\\")) {
      return `Changed path ${JSON.stringify(filePath)} contains \\. The tier fails closed to high.`;
    }
    if (filePath.split("/").includes("..")) {
      return `Changed path ${JSON.stringify(filePath)} contains a .. segment. The tier fails closed to high.`;
    }
  }
  return null;
}

export function loadTiers(text) {
  const rules = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(low|medium|high)\s+(\S.*)$/);
    if (!match) {
      throw new Error(`risk-tiers:${index + 1}: expected "tier glob"`);
    }
    const glob = match[2].trim();
    rules.push({
      tier: match[1],
      glob,
      regex: globToRegExp(glob),
    });
  }
  return rules;
}

export function loadTiersFile(filePath = defaultTiersPath()) {
  return loadTiers(fs.readFileSync(filePath, "utf8"));
}

function higherTier(left, right) {
  if (left == null) return right;
  return RANK[right] > RANK[left] ? right : left;
}

export function tierForPath(filePath, rules) {
  if (unsafePathReason([filePath])) return "high";
  const literal = String(filePath);
  let best = null;
  for (const rule of rules) {
    if (rule.regex.test(literal)) best = higherTier(best, rule.tier);
  }
  for (const rule of ALWAYS_HIGH_RULES) {
    if (rule.regex.test(literal)) best = "high";
  }
  return best ?? "medium";
}

export function computeTier(filePaths, rules) {
  if (filePaths.length === 0) return "medium";
  if (unsafePathReason(filePaths)) return "high";
  let best = null;
  for (const filePath of filePaths) {
    best = higherTier(best, tierForPath(filePath, rules));
  }
  return best ?? "medium";
}

export function changedFilesFailure(returnedCount, changedFiles, capHit) {
  if (capHit) {
    return `The files API page cap of ${FILES_API_CAP} was hit (${returnedCount} files returned). The tier fails closed to high.`;
  }
  if (!Number.isInteger(changedFiles) || changedFiles < 0) {
    return "pull_request.changed_files is missing. The tier fails closed to high.";
  }
  if (!Number.isInteger(returnedCount) || returnedCount < changedFiles) {
    const count = Number.isInteger(returnedCount) ? returnedCount : 0;
    return `The files API returned ${count} files, fewer than pull_request.changed_files (${changedFiles}). The list stops at ${FILES_API_CAP}. The tier fails closed to high.`;
  }
  return null;
}

export function decideTier({ tiersFailure, listFailure, unsafeFailure, paths, rules }) {
  if (tiersFailure || listFailure || unsafeFailure) return "high";
  return computeTier(paths, rules);
}

export function changedPaths(files) {
  const paths = [];
  for (const file of files) {
    if (file.filename) paths.push(file.filename);
    if (file.previous_filename) paths.push(file.previous_filename);
  }
  return paths;
}

export function riskTierSection(body) {
  const text = String(body ?? "");
  const heading = text.match(/^## Risk tier\s*$/m);
  if (!heading || heading.index === undefined) return "";
  const start = heading.index + heading[0].length;
  const rest = text.slice(start);
  const next = rest.search(/^## /m);
  return next === -1 ? rest : rest.slice(0, next);
}

export function parseClaimedTier(body) {
  const checked = [];
  for (const line of riskTierSection(body).split(/\r?\n/)) {
    const match = line.match(CHECKBOX);
    if (!match) continue;
    if (match[1] === "x" || match[1] === "X") checked.push(match[2]);
  }
  if (checked.length === 0) {
    return { ok: false, message: "No risk tier is checked in the pull request body." };
  }
  if (checked.length > 1) {
    return { ok: false, message: "The pull request body checks more than one risk tier." };
  }
  return { ok: true, tier: checked[0] };
}

export function claimFailure(claimedTier, computedTier) {
  if (RANK[claimedTier] < RANK[computedTier]) {
    return `Claimed risk tier ${claimedTier} is lower than computed tier ${computedTier}.`;
  }
  return null;
}

export function labelForTier(tier) {
  const label = LABEL_FOR_TIER[tier];
  if (!label) throw new Error(`Unknown tier: ${tier}`);
  return label;
}

export function planLabelUpdates(currentLabels, tier) {
  const label = labelForTier(tier);
  const remove = currentLabels.filter(
    (name) => name !== label && (name === "risk:low" || name === "risk:medium" || name === "risk:high"),
  );
  const add = currentLabels.includes(label) ? [] : [label];
  return { label, add, remove };
}

export function failClosedReason(missing) {
  if (!Array.isArray(missing) || missing.length === 0) return null;
  return `base has no ${missing.join(" and ")}`;
}

export function finishGate({ labelError, failure, conflict = false }) {
  const denied = Boolean(labelError && labelError.status === 403);
  if (labelError && !denied) {
    return { rethrow: true, exitCode: 1, warning: null, conflictFailure: null };
  }
  const warning = denied
    ? `warning: label write was denied (403). Continuing with the body check. ${labelError.message}`
    : null;
  const conflictFailure = conflict ? "Label update left more than one risk:* label." : null;
  return { rethrow: false, exitCode: failure || conflictFailure ? 1 : 0, warning, conflictFailure };
}

function isRiskLabel(name) {
  return RISK_LABELS.has(name);
}

export async function settleLabelPlan(currentLabels, plan, write) {
  let labels = currentLabels.slice();
  let error = null;
  const add = (name) => {
    if (!labels.includes(name)) labels.push(name);
  };
  const remove = (name) => {
    labels = labels.filter((item) => item !== name);
  };
  try {
    if (plan.add.length > 0) {
      await write({ op: "add", name: plan.label });
      add(plan.label);
    }
    for (const name of plan.remove) {
      if (!labels.includes(name)) continue;
      await write({ op: "remove", name });
      remove(name);
    }
  } catch (caught) {
    error = caught;
  }
  if (error) {
    const stale = labels.filter((name) => isRiskLabel(name) && name !== plan.label);
    for (const name of stale) {
      try {
        await write({ op: "remove", name });
        remove(name);
      } catch (cleanupError) {
        if (cleanupError && cleanupError.status === 404) remove(name);
      }
    }
  }
  const risk = labels.filter(isRiskLabel);
  return { labels, error, conflict: risk.length > 1, risk };
}

export function applyLabelPlan(currentLabels, plan) {
  const next = currentLabels.filter((name) => !plan.remove.includes(name));
  for (const name of plan.add) {
    if (!next.includes(name)) next.push(name);
  }
  return next;
}

function apiHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "johnhamlin-com-risk-tier",
    "X-GitHub-Api-Version": API_VERSION,
  };
}

async function github(token, method, apiPath, body) {
  const response = await fetch(`${API}${apiPath}`, {
    method,
    headers: {
      ...apiHeaders(token),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!response.ok) {
    const detail = parsed && typeof parsed === "object" && parsed.message ? parsed.message : text;
    const error = new Error(`${method} ${apiPath} failed (${response.status}): ${detail}`);
    error.status = response.status;
    throw error;
  }
  return parsed;
}

async function ensureLabel(token, owner, repo, spec) {
  const encoded = encodeURIComponent(spec.name);
  try {
    await github(token, "GET", `/repos/${owner}/${repo}/labels/${encoded}`);
    return;
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  try {
    await github(token, "POST", `/repos/${owner}/${repo}/labels`, spec);
  } catch (error) {
    if (error.status !== 422) throw error;
  }
}

async function listPullRequestFiles(token, owner, repo, number) {
  const files = [];
  let capHit = false;
  for (let page = 1; ; page += 1) {
    const batch = await github(
      token,
      "GET",
      `/repos/${owner}/${repo}/pulls/${number}/files?per_page=100&page=${page}`,
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    const room = FILES_API_CAP - files.length;
    if (batch.length > room) {
      files.push(...batch.slice(0, room));
      capHit = true;
      break;
    }
    files.push(...batch);
    if (files.length >= FILES_API_CAP) {
      capHit = true;
      break;
    }
    if (batch.length < 100) break;
  }
  return { files, capHit };
}

async function listIssueLabels(token, owner, repo, number) {
  const names = [];
  for (let page = 1; ; page += 1) {
    const batch = await github(
      token,
      "GET",
      `/repos/${owner}/${repo}/issues/${number}/labels?per_page=100&page=${page}`,
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const label of batch) names.push(label.name);
    if (batch.length < 100) break;
  }
  return names;
}

async function syncLabel(token, owner, repo, number, tier) {
  const current = await listIssueLabels(token, owner, repo, number);
  const plan = planLabelUpdates(current, tier);
  try {
    for (const spec of LABEL_SPECS) {
      await ensureLabel(token, owner, repo, spec);
    }
  } catch (error) {
    error.conflict = current.filter(isRiskLabel).length > 1;
    throw error;
  }
  const write = async (action) => {
    if (action.op === "remove") {
      const encoded = encodeURIComponent(action.name);
      try {
        await github(token, "DELETE", `/repos/${owner}/${repo}/issues/${number}/labels/${encoded}`);
      } catch (error) {
        if (error.status !== 404) throw error;
      }
      return;
    }
    if (action.op === "add") {
      await github(token, "POST", `/repos/${owner}/${repo}/issues/${number}/labels`, {
        labels: [action.name],
      });
      return;
    }
    throw new Error(`Unknown label op: ${action.op}`);
  };
  const settled = await settleLabelPlan(current, plan, write);
  if (settled.error) {
    settled.error.conflict = settled.conflict;
    throw settled.error;
  }
  return plan;
}

function readEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error("GITHUB_EVENT_PATH is not set");
  const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
  if (!event.pull_request) throw new Error("risk-tier.mjs needs a pull_request event");
  return event;
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!token) throw new Error("GITHUB_TOKEN is not set");
  if (!repository || !repository.includes("/")) throw new Error("GITHUB_REPOSITORY must be owner/name");
  const [owner, repo] = repository.split("/");
  const event = readEvent();
  const number = event.pull_request.number;
  let rules = [];
  let tiersFailure = null;
  try {
    rules = loadTiersFile();
  } catch (error) {
    tiersFailure = `risk-tiers is invalid. The tier fails closed to high. ${error.message}`;
    console.log(tiersFailure);
  }
  let paths = [];
  let listFailure = null;
  try {
    const listed = await listPullRequestFiles(token, owner, repo, number);
    paths = changedPaths(listed.files);
    listFailure = changedFilesFailure(listed.files.length, event.pull_request.changed_files, listed.capHit);
    if (listFailure) console.log(listFailure);
  } catch (error) {
    listFailure = `The files API could not be read. The tier fails closed to high. ${error.message}`;
    console.log(listFailure);
  }
  const unsafeFailure = unsafePathReason(paths);
  if (unsafeFailure) console.log(unsafeFailure);
  const computed = decideTier({ tiersFailure, listFailure, unsafeFailure, paths, rules });
  for (const filePath of paths) {
    console.log(`${unsafeFailure ? "high" : tierForPath(filePath, rules)} ${filePath}`);
  }
  console.log(`computed ${computed}`);
  const claimed = parseClaimedTier(event.pull_request.body);
  console.log(`claimed ${claimed.ok ? claimed.tier : "none"}`);
  const failure = claimed.ok ? claimFailure(claimed.tier, computed) : claimed.message;
  let plan = null;
  let labelError = null;
  try {
    plan = await syncLabel(token, owner, repo, number, computed);
  } catch (error) {
    labelError = error;
  }
  const gate = finishGate({ labelError, failure, conflict: Boolean(labelError && labelError.conflict) });
  if (gate.rethrow) throw labelError;
  if (plan) {
    console.log(`risk label: ${plan.label}`);
    if (plan.remove.length > 0) console.log(`removed ${plan.remove.join(", ")}`);
  }
  if (gate.warning) console.warn(gate.warning);
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    const label = plan ? plan.label : labelForTier(computed);
    const note = [gate.warning, tiersFailure, listFailure, unsafeFailure].filter(Boolean).join("\n\n");
    const extra = note ? `\n\n${note}` : "";
    fs.appendFileSync(
      summaryPath,
      `Risk label: \`${label}\`\n\nComputed from the changed paths. The pull request body does not set this tier.${extra}\n`,
    );
  }
  if (gate.exitCode !== 0) {
    if (failure) console.error(failure);
    if (gate.conflictFailure) console.error(gate.conflictFailure);
    process.exitCode = gate.exitCode;
  }
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
