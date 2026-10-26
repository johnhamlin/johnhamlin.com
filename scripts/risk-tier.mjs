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

const CHECKBOX = /^[ \t]*(?:[-*+]|\d+\.)\s+\[([ xX])\]\s+(low|medium|high)(?![\w-])/;

export const FILES_API_CAP = 3000;

export function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function defaultTiersPath() {
  return path.join(repoRoot(), "risk-tiers");
}

export function globToRegExp(glob) {
  const pattern = glob.toLowerCase();
  let source = "";
  let index = 0;
  while (index < pattern.length) {
    const rest = pattern.slice(index);
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
    const character = pattern[index];
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
  // Globs are lowercased here. Callers lowercase the path once before testing.
  return new RegExp(`^${source}$`, regexFlags(pattern));
}

function regexFlags(glob) {
  if (glob.includes("**")) return "s";
  return undefined;
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
  const literal = String(filePath).toLowerCase();
  let best = null;
  for (const rule of rules) {
    if (rule.regex.test(literal)) best = higherTier(best, rule.tier);
  }
  for (const rule of ALWAYS_HIGH_RULES) {
    if (rule.regex.test(literal)) best = "high";
  }
  return best ?? "medium";
}

export function tierForLogLine(filePath, rules, forcedHigh) {
  if (forcedHigh) return "high";
  return tierForPath(filePath, rules);
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

export function riskLabelProblem(labels, computedTier, options = {}) {
  const writeSucceeded = Boolean(options && options.writeSucceeded);
  const readError = options && options.readError ? options.readError : null;
  if (writeSucceeded && readError) return "Could not re-read labels after a successful label write.";
  const names = Array.isArray(labels) ? labels : [];
  const unknown = names.find(
    (name) => typeof name === "string" && name.startsWith("risk:") && !RISK_LABELS.has(name),
  );
  if (unknown) return `Risk label ${unknown} is not a known risk tier.`;
  const risk = names.filter((name) => RISK_LABELS.has(name));
  if (risk.length > 1) return "Label update left more than one risk:* label.";
  if (risk.length === 1) {
    const tier = risk[0].slice("risk:".length);
    if (RANK[tier] != null && RANK[computedTier] != null && RANK[tier] > RANK[computedTier]) {
      return `Risk label ${risk[0]} is higher than computed tier ${computedTier}.`;
    }
    if (RANK[tier] == null || RANK[computedTier] == null || RANK[tier] !== RANK[computedTier]) {
      return `Risk label ${risk[0]} is lower than computed tier ${computedTier}.`;
    }
    return null;
  }
  const writeDenied = Boolean(options && options.writeDenied);
  if (writeDenied && !writeSucceeded) return null;
  if (readError) return null;
  if (writeSucceeded) return "A label write succeeded but the pull request has no risk:* label.";
  return "The pull request has no risk:* label.";
}

export function finishGate({ labelError, failure, labelProblem = null }) {
  const denied = Boolean(labelError && labelError.status === 403);
  if (labelError && !denied) {
    return { rethrow: true, exitCode: 1, warning: null, labelProblem: null };
  }
  const problem = labelProblem || null;
  const exitCode = failure || problem ? 1 : 0;
  const warning = denied
    ? `warning: label write was denied (403). ${exitCode === 0 ? "Continuing with the body check. " : ""}${labelError.message}`
    : null;
  return { rethrow: false, exitCode, warning, labelProblem: problem };
}

function isRiskLabel(name) {
  return RISK_LABELS.has(name);
}

export async function settleLabelPlan(currentLabels, plan, write) {
  let labels = currentLabels.slice();
  let error = null;
  let writeSucceeded = false;
  const add = (name) => {
    if (!labels.includes(name)) labels.push(name);
  };
  const remove = (name) => {
    labels = labels.filter((item) => item !== name);
  };
  const record = async (action) => {
    const wrote = await write(action);
    if (wrote !== false) writeSucceeded = true;
  };
  try {
    if (plan.add.length > 0) {
      await record({ op: "add", name: plan.label });
      add(plan.label);
    }
    for (const name of plan.remove) {
      if (!labels.includes(name)) continue;
      await record({ op: "remove", name });
      remove(name);
    }
  } catch (caught) {
    error = caught;
  }
  if (error) {
    const stale = labels.filter((name) => isRiskLabel(name) && name !== plan.label);
    for (const name of stale) {
      try {
        await record({ op: "remove", name });
        remove(name);
      } catch (cleanupError) {
        if (cleanupError && cleanupError.status === 404) remove(name);
      }
    }
  }
  const risk = labels.filter(isRiskLabel);
  return { labels, error, conflict: risk.length > 1, risk, writeSucceeded };
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

async function github(token, method, apiPath, body, gate) {
  const labelWrite = Boolean(gate) && (method === "POST" || method === "DELETE" || method === "PUT");
  if (labelWrite) gate.mutating = true;
  try {
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
      if (gate && gate.mutating && error.status === 403) gate.writeDenied = true;
      throw error;
    }
    return parsed;
  } finally {
    if (labelWrite) gate.mutating = false;
  }
}

async function ensureLabel(token, owner, repo, spec, gate) {
  const encoded = encodeURIComponent(spec.name);
  try {
    await github(token, "GET", `/repos/${owner}/${repo}/labels/${encoded}`);
    return false;
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  try {
    await github(token, "POST", `/repos/${owner}/${repo}/labels`, spec, gate);
    return true;
  } catch (error) {
    if (error.status !== 422) throw error;
    return false;
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

export async function syncLabel(token, owner, repo, number, tier) {
  const gate = { mutating: false, writeDenied: false };
  let current = [];
  let settledError = null;
  try {
    current = await listIssueLabels(token, owner, repo, number);
  } catch (error) {
    settledError = error;
  }
  const plan = planLabelUpdates(current, tier);
  const write = async (action) => {
    if (action.op === "remove") {
      const encoded = encodeURIComponent(action.name);
      try {
        await github(token, "DELETE", `/repos/${owner}/${repo}/issues/${number}/labels/${encoded}`, undefined, gate);
      } catch (error) {
        if (error.status !== 404) throw error;
        return false;
      }
      return;
    }
    if (action.op === "add") {
      await github(token, "POST", `/repos/${owner}/${repo}/issues/${number}/labels`, {
        labels: [action.name],
      }, gate);
      return;
    }
    throw new Error(`Unknown label op: ${action.op}`);
  };
  let writeSucceeded = false;
  let settled = {
    labels: current.slice(),
    error: settledError,
    conflict: current.filter(isRiskLabel).length > 1,
    risk: current.filter(isRiskLabel),
    writeSucceeded: false,
  };
  if (!settledError) {
    try {
      for (const spec of LABEL_SPECS) {
        if (await ensureLabel(token, owner, repo, spec, gate)) writeSucceeded = true;
      }
      settled = await settleLabelPlan(current, plan, write);
      if (settled.writeSucceeded) writeSucceeded = true;
    } catch (error) {
      settled = { ...settled, error };
    }
  }
  settled.writeSucceeded = writeSucceeded;
  const writeDenied = Boolean(gate.writeDenied && !writeSucceeded);
  let observed = settled.labels;
  let readError = null;
  try {
    observed = await listIssueLabels(token, owner, repo, number);
  } catch (error) {
    readError = error;
    if (!settled.error) settled.error = error;
  }
  const labelProblem = riskLabelProblem(observed, tier, { writeSucceeded, readError, writeDenied });
  if (writeSucceeded && readError && readError.status !== 403 && labelProblem) console.error(labelProblem);
  if (settled.error) {
    settled.error.labelProblem = labelProblem;
    throw settled.error;
  }
  return { ...plan, labelProblem };
}

function readEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error("GITHUB_EVENT_PATH is not set");
  const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
  if (!event.pull_request) throw new Error("risk-tier.mjs needs a pull_request event");
  return event;
}

export async function main() {
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
  const forcedHigh = Boolean(tiersFailure || listFailure || unsafeFailure);
  for (const filePath of paths) {
    console.log(`${tierForLogLine(filePath, rules, forcedHigh)} ${filePath}`);
  }
  console.log(`computed ${computed}`);
  const claimed = parseClaimedTier(event.pull_request.body);
  console.log(`claimed ${claimed.ok ? claimed.tier : "none"}`);
  const failure = claimed.ok ? claimFailure(claimed.tier, computed) : claimed.message;
  let plan = null;
  let labelError = null;
  let labelProblem = null;
  try {
    plan = await syncLabel(token, owner, repo, number, computed);
    labelProblem = plan.labelProblem;
  } catch (error) {
    labelError = error;
    labelProblem = error.labelProblem ?? null;
  }
  const gate = finishGate({
    labelError,
    failure,
    labelProblem,
  });
  if (gate.rethrow) throw labelError;
  if (plan && !labelProblem) {
    console.log(`risk label: ${plan.label}`);
    if (plan.remove.length > 0) console.log(`removed ${plan.remove.join(", ")}`);
  }
  if (gate.warning) console.warn(gate.warning);
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    const note = [gate.warning, tiersFailure, listFailure, unsafeFailure].filter(Boolean).join("\n\n");
    if (labelProblem) {
      if (note) fs.appendFileSync(summaryPath, `${note}\n`);
    } else {
      const label = plan ? plan.label : labelForTier(computed);
      const extra = note ? `\n\n${note}` : "";
      fs.appendFileSync(
        summaryPath,
        `Risk label: \`${label}\`\n\nComputed from the changed paths. The pull request body does not set this tier.${extra}\n`,
      );
    }
  }
  if (gate.exitCode !== 0) {
    if (failure) console.error(failure);
    if (gate.labelProblem) console.error(gate.labelProblem);
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
