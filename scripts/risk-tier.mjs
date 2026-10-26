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

const CHECKBOX = /^[ \t]*(?:[-*+]|\d+\.)\s+\[([ xX])\]\s+(low|medium|high)\b/;

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
  return new RegExp(`^${source}$`, glob.includes("**") ? "s" : undefined);
}

export function normalizePath(filePath) {
  return filePath.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "");
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
  const normalized = normalizePath(filePath);
  let best = null;
  for (const rule of rules) {
    if (rule.regex.test(normalized)) best = higherTier(best, rule.tier);
  }
  for (const rule of ALWAYS_HIGH_RULES) {
    if (rule.regex.test(normalized)) best = "high";
  }
  return best ?? "medium";
}

export function computeTier(filePaths, rules) {
  if (filePaths.length === 0) return "medium";
  let best = null;
  for (const filePath of filePaths) {
    best = higherTier(best, tierForPath(filePath, rules));
  }
  return best ?? "medium";
}

export function changedPaths(files) {
  const paths = [];
  for (const file of files) {
    if (file.filename) paths.push(file.filename);
    if (file.previous_filename) paths.push(file.previous_filename);
  }
  return paths;
}

export function parseClaimedTier(body) {
  const checked = [];
  for (const line of String(body ?? "").split(/\r?\n/)) {
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

export function finishGate({ labelError, failure }) {
  const denied = Boolean(labelError && labelError.status === 403);
  if (labelError && !denied) {
    return { rethrow: true, exitCode: 1, warning: null };
  }
  const warning = denied
    ? `warning: label write was denied (403). Continuing with the body check. ${labelError.message}`
    : null;
  return { rethrow: false, exitCode: failure ? 1 : 0, warning };
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

async function listChangedPaths(token, owner, repo, number) {
  const files = [];
  for (let page = 1; ; page += 1) {
    const batch = await github(
      token,
      "GET",
      `/repos/${owner}/${repo}/pulls/${number}/files?per_page=100&page=${page}`,
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    files.push(...batch);
    if (batch.length < 100) break;
  }
  return changedPaths(files);
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
  for (const spec of LABEL_SPECS) {
    await ensureLabel(token, owner, repo, spec);
  }
  const current = await listIssueLabels(token, owner, repo, number);
  const plan = planLabelUpdates(current, tier);
  for (const name of plan.remove) {
    const encoded = encodeURIComponent(name);
    try {
      await github(token, "DELETE", `/repos/${owner}/${repo}/issues/${number}/labels/${encoded}`);
    } catch (error) {
      if (error.status !== 404) throw error;
    }
  }
  if (plan.add.length > 0) {
    await github(token, "POST", `/repos/${owner}/${repo}/issues/${number}/labels`, { labels: plan.add });
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
  const rules = loadTiersFile();
  const paths = await listChangedPaths(token, owner, repo, number);
  const computed = computeTier(paths, rules);
  for (const filePath of paths) {
    console.log(`${tierForPath(filePath, rules)} ${filePath}`);
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
  const gate = finishGate({ labelError, failure });
  if (gate.rethrow) throw labelError;
  if (plan) {
    console.log(`risk label: ${plan.label}`);
    if (plan.remove.length > 0) console.log(`removed ${plan.remove.join(", ")}`);
  }
  if (gate.warning) console.warn(gate.warning);
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    const label = plan ? plan.label : labelForTier(computed);
    const note = gate.warning ? `\n\n${gate.warning}` : "";
    fs.appendFileSync(
      summaryPath,
      `Risk label: \`${label}\`\n\nComputed from the changed paths. The pull request body does not set this tier.${note}\n`,
    );
  }
  if (gate.exitCode !== 0) {
    console.error(failure);
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
