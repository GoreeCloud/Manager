import { readJson } from "./http.js";

const DAY_SECONDS = 86_400;
const MAX_BUCKETS = 7;
const MAX_REPORTABLE_USD = Number.MAX_SAFE_INTEGER / 100;

function buckets(payload) {
  if (!Array.isArray(payload?.data) || payload.data.length > MAX_BUCKETS) {
    throw new Error("OpenAI report has invalid bucket data");
  }
  for (const bucket of payload.data) {
    if (!bucket || !Array.isArray(bucket.results)) {
      throw new Error("OpenAI report bucket has no results array");
    }
  }
  return payload.data;
}

function amount(value) {
  if (typeof value !== "number" || !Number.isFinite(value) ||
      Math.abs(value) > MAX_REPORTABLE_USD) {
    throw new Error("OpenAI cost outside safely reportable range");
  }
  return value;
}
const money = value => Math.round(amount(value) * 100) / 100;

function costsReport(payload) {
  let grandTotal = 0;
  const dailyCosts = buckets(payload).map(bucket => {
    if (!Number.isSafeInteger(bucket.start_time) || bucket.start_time < 0 ||
        !Number.isFinite(bucket.start_time * 1000)) {
      throw new Error("OpenAI cost bucket timestamp invalid");
    }
    const dateValue = new Date(bucket.start_time * 1000);
    if (Number.isNaN(dateValue.getTime())) {
      throw new Error("OpenAI cost bucket timestamp invalid");
    }
    let total = 0;
    for (const result of bucket.results) {
      const billed = result?.amount;
      if (!billed || billed.currency !== "usd") {
        throw new Error("OpenAI cost amount or currency unavailable");
      }
      const item = amount(billed.value);
      total = amount(total + item);
    }
    grandTotal = amount(grandTotal + total);
    return { date: dateValue.toISOString().slice(0, 10), usd: money(total) };
  });
  return { costUsd: money(grandTotal), dailyCosts, hasMore: payload.has_more === true };
}

function usageReport(payload) {
  let inputTokens = 0;
  let outputTokens = 0;
  let requests = 0;
  for (const bucket of buckets(payload)) {
    for (const item of bucket.results) {
      const values = [item?.input_tokens, item?.output_tokens, item?.num_model_requests];
      if (!values.every(value => Number.isSafeInteger(value) && value >= 0)) {
        throw new Error("OpenAI usage contains invalid counts");
      }
      inputTokens += values[0];
      outputTokens += values[1];
      requests += values[2];
      if (![inputTokens, outputTokens, requests].every(Number.isSafeInteger)) {
        throw new Error("OpenAI usage exceeds safe integer range");
      }
    }
  }
  return { inputTokens, outputTokens, requests, hasMore: payload.has_more === true };
}

export async function openai(env, fetcher = fetch, nowMs = Date.now()) {
  if (!env.OPENAI_ADMIN_KEY) return null;
  if (!Number.isFinite(nowMs)) throw new Error("Invalid reporting time");
  const start = Math.floor(nowMs / (DAY_SECONDS * 1000)) * DAY_SECONDS - 6 * DAY_SECONDS;
  const params = "?start_time=" + start + "&end_time=" + Math.floor(nowMs / 1000) +
    "&bucket_width=1d&limit=7";
  const options = { headers: { Authorization: "Bearer " + env.OPENAI_ADMIN_KEY } };

  const [costs, usage] = await Promise.allSettled([
    readJson("https://api.openai.com/v1/organization/costs" + params, options, fetcher)
      .then(costsReport),
    readJson("https://api.openai.com/v1/organization/usage/completions" + params, options, fetcher)
      .then(usageReport),
  ]);
  if (costs.status === "rejected" && usage.status === "rejected") throw costs.reason;

  const c = costs.status === "fulfilled" ? costs.value : null;
  const u = usage.status === "fulfilled" ? usage.value : null;
  return {
    period: "7 days",
    costUsd: c?.costUsd ?? null,
    inputTokens: u?.inputTokens ?? null,
    outputTokens: u?.outputTokens ?? null,
    requests: u?.requests ?? null,
    dailyCosts: c?.dailyCosts ?? null,
    partial: !c || !u || c.hasMore || u.hasMore,
  };
}
