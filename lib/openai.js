import { readJson } from "./http.js";
const sum = (arr, fn) => arr.reduce((value, item) => value + (Number(fn(item)) || 0), 0);
const results = response => response.data.flatMap(bucket => bucket.results || []);
export async function openai(env, fetcher = fetch, nowMs = Date.now()) {
  if (!env.OPENAI_ADMIN_KEY) return null;
  const start = Math.floor(nowMs / 86_400_000) * 86400 - 6 * 86400;
  const params = "?start_time=" + start + "&end_time=" + Math.floor(nowMs / 1000) + "&bucket_width=1d&limit=7";
  const options = { headers: { Authorization: "Bearer " + env.OPENAI_ADMIN_KEY } };
  const [costs, usage] = await Promise.allSettled([
    readJson("https://api.openai.com/v1/organization/costs" + params, options, fetcher),
    readJson("https://api.openai.com/v1/organization/usage/completions" + params, options, fetcher),
  ]);
  if (costs.status === "rejected" && usage.status === "rejected") throw costs.reason;
  const c = costs.status === "fulfilled" && Array.isArray(costs.value.data) ? costs.value : null;
  const u = usage.status === "fulfilled" && Array.isArray(usage.value.data) ? usage.value : null;
  const usd = record => record.amount?.currency === "usd" ? record.amount.value : 0;
  return {
    period: "7 days",
    costUsd: c ? Math.round(sum(results(c), usd) * 100) / 100 : null,
    inputTokens: u ? sum(results(u), r => r.input_tokens) : null,
    outputTokens: u ? sum(results(u), r => r.output_tokens) : null,
    requests: u ? sum(results(u), r => r.num_model_requests) : null,
    dailyCosts: c ? c.data.map(bucket => ({
      date: new Date(bucket.start_time * 1000).toISOString().slice(0, 10),
      usd: Math.round(sum(bucket.results || [], usd) * 100) / 100,
    })) : null,
    partial: !c || !u,
  };
}
