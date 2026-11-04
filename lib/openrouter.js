import { readJson } from "./http.js";

const ROOT = "https://openrouter.ai/api/v1";
const nonnegative = value => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const integer = value => Number.isInteger(value) && value >= 0 ? value : null;
const dollar = value => value === null ? null : Math.round(value * 1_000_000) / 1_000_000;
const allowedReset = new Set(["daily", "weekly", "monthly"]);

function currentKey(payload) {
  const p = payload?.data;
  if (!p || typeof p !== "object" || Array.isArray(p)) throw new Error("OpenRouter key data missing");
  const usage = nonnegative(p.usage);
  if (usage === null) throw new Error("OpenRouter key usage unavailable");
  const expire = typeof p.expires_at === "string" && Number.isFinite(Date.parse(p.expires_at))
    ? new Date(p.expires_at).toISOString() : null;
  return {
    usageUsd: dollar(usage),
    dailyUsd: dollar(nonnegative(p.usage_daily)),
    weeklyUsd: dollar(nonnegative(p.usage_weekly)),
    monthlyUsd: dollar(nonnegative(p.usage_monthly)),
    limitUsd: dollar(nonnegative(p.limit)),
    limitRemainingUsd: dollar(nonnegative(p.limit_remaining)),
    limitReset: allowedReset.has(p.limit_reset) ? p.limit_reset : null,
    expiresAt: expire,
  };
}
function credits(payload) {
  const p = payload?.data;
  const total = nonnegative(p?.total_credits);
  const used = nonnegative(p?.total_usage);
  if (total === null || used === null) throw new Error("OpenRouter credit report malformed");
  return {
    purchasedUsd: dollar(total),
    lifetimeUsageUsd: dollar(used),
    availableUsd: dollar(total - used),
  };
}
function activity(payload) {
  if (!Array.isArray(payload?.data)) throw new Error("OpenRouter activity report malformed");
  if (payload.data.length > 10_000) throw new Error("OpenRouter activity report too large");
  let requests = 0, inputTokens = 0, outputTokens = 0, spend = 0;
  const models = new Map();
  for (const item of payload.data) {
    const cost = nonnegative(item?.usage);
    const count = integer(item?.requests);
    const inTok = integer(item?.prompt_tokens);
    const outTok = integer(item?.completion_tokens);
    if ([cost, count, inTok, outTok].some(value => value === null)) throw new Error("OpenRouter activity row malformed");
    requests += count; inputTokens += inTok; outputTokens += outTok; spend += cost;
    const model = typeof item.model === "string" ? item.model.slice(0, 90) : "";
    if (model && /^[a-z0-9._/:-]+$/i.test(model)) {
      const previous = models.get(model) || { model, requests: 0, spendUsd: 0 };
      previous.requests += count; previous.spendUsd += cost;
      models.set(model, previous);
    }
  }
  if (![requests, inputTokens, outputTokens, spend].every(Number.isSafeInteger) &&
      ![requests, inputTokens, outputTokens].every(Number.isSafeInteger)) {
    throw new Error("OpenRouter activity totals invalid");
  }
  if (!Number.isFinite(spend)) throw new Error("OpenRouter activity totals invalid");
  return {
    period: "Last 30 completed UTC days",
    requests, inputTokens, outputTokens, spendUsd: dollar(spend),
    topModels: [...models.values()]
      .sort((a, b) => b.spendUsd - a.spendUsd || a.model.localeCompare(b.model))
      .slice(0, 5)
      .map(row => ({ ...row, spendUsd: dollar(row.spendUsd) })),
  };
}

/**
 * Optional read-only snapshot, never a proxy for OpenRouter inference operations.
 *
 * A standard (possibly spend-limited) key supplies its own usage and key limit.
 * A separately configured management key may supply account credit and 30-day
 * activity summaries. No raw API key, hash, label, workspace, user or endpoint
 * identifiers are returned to the frontend.
 */
export async function openrouter(env, fetcher = fetch) {
  const apiKey = env.OPENROUTER_API_KEY;
  const managementKey = env.OPENROUTER_MANAGEMENT_KEY;
  if (!apiKey && !managementKey) return null;

  const get = (path, token) => readJson(ROOT + path, {
    headers: { Authorization: "Bearer " + token },
  }, fetcher);
  const jobs = [];
  if (apiKey) jobs.push(["key", () => get("/key", apiKey).then(currentKey)]);
  if (managementKey) {
    jobs.push(["credits", () => get("/credits", managementKey).then(credits)]);
    jobs.push(["activity", () => get("/activity", managementKey).then(activity)]);
  }
  const outcomes = await Promise.allSettled(jobs.map(([, task]) => task()));
  const values = { key: null, credits: null, activity: null };
  let failures = 0;
  for (let i = 0; i < outcomes.length; i++) {
    const outcome = outcomes[i];
    if (outcome.status === "fulfilled") values[jobs[i][0]] = outcome.value;
    else failures++;
  }
  if (failures === jobs.length) throw outcomes.find(r => r.status === "rejected").reason;

  return {
    key: values.key,
    credits: values.credits,
    activity: values.activity,
    managementConfigured: Boolean(managementKey),
    partial: failures > 0,
  };
}
