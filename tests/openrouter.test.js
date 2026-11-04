import test from "node:test";
import assert from "node:assert/strict";
import { openrouter } from "../lib/openrouter.js";

test("OpenRouter can remain unconfigured", async () => {
  assert.equal(await openrouter({}), null);
});
const ok = value => new Response(JSON.stringify(value), {
  headers: { "content-type": "application/json" },
});

test("OpenRouter key usage is GET-only, bounded to one endpoint", async () => {
  const paths = [];
  const result = await openrouter({ OPENROUTER_API_KEY: "test-only" }, async (url, init) => {
    paths.push(url);
    assert.equal(init.method, "GET");
    return ok({ data: {
      usage: 12.2, usage_daily: 0.4, usage_weekly: 1.8, usage_monthly: 7.9,
      limit: 25, limit_remaining: 12.8, limit_reset: "monthly",
      creator_user_id: "private", label: "hidden-label",
    } });
  });
  assert.deepEqual(paths, ["https://openrouter.ai/api/v1/key"]);
  assert.equal(result.key.weeklyUsd, 1.8);
  assert.equal(result.key.limitRemainingUsd, 12.8);
  assert.equal(result.partial, false);
  assert.equal(result.credits, null);
  assert.equal(JSON.stringify(result).includes("private"), false);
  assert.equal(JSON.stringify(result).includes("hidden-label"), false);
});
test("OpenRouter optional account credits and activity summarize only safe fields", async () => {
  const urls = [];
  const result = await openrouter({ OPENROUTER_MANAGEMENT_KEY: "test-only" }, async (url, init) => {
    urls.push(url);
    assert.equal(init.method, "GET");
    if (url.endsWith("/credits")) return ok({ data: { total_credits: 100.5, total_usage: 25.25 } });
    if (url.endsWith("/activity")) return ok({ data: [
      { model: "anthropic/claude", requests: 3, prompt_tokens: 20, completion_tokens: 10, usage: 0.001, endpoint_id: "private-endpoint" },
      { model: "anthropic/claude", requests: 2, prompt_tokens: 10, completion_tokens: 4, usage: 0.002 },
      { model: "openai/gpt-4", requests: 1, prompt_tokens: 5, completion_tokens: 1, usage: 0.003 },
    ] });
    throw new Error("Wrong destination");
  });
  assert.deepEqual(urls.sort(), ["https://openrouter.ai/api/v1/activity", "https://openrouter.ai/api/v1/credits"]);
  assert.equal(result.key, null);
  assert.equal(result.credits.availableUsd, 75.25);
  assert.equal(result.activity.requests, 6);
  assert.equal(result.activity.inputTokens, 35);
  assert.equal(result.activity.outputTokens, 15);
  assert.equal(result.activity.spendUsd, 0.006);
  assert.equal(result.activity.topModels[0].requests, 5);
  assert.equal(JSON.stringify(result).includes("private-endpoint"), false);
});
test("OpenRouter preserves key metrics when management reporting fails", async () => {
  const result = await openrouter({ OPENROUTER_API_KEY: "a", OPENROUTER_MANAGEMENT_KEY: "b" },
    async url => url.endsWith("/key")
      ? ok({ data: { usage: 0, usage_weekly: 0 } })
      : new Response("unauthorized", { status: 403 }));
  assert.equal(result.key.usageUsd, 0);
  assert.equal(result.partial, true);
  assert.equal(result.credits, null);
  assert.equal(result.activity, null);
});

test("OpenRouter malformed responses never become successful zero readings", async () => {
  await assert.rejects(openrouter({ OPENROUTER_API_KEY: "a" }, async () => ok({ data: { usage: "0" } })));
  await assert.rejects(openrouter({ OPENROUTER_MANAGEMENT_KEY: "b" }, async () => ok({ data: {} })));
});

test("OpenRouter invalid activity rows do not become connected results", async () => {
  await assert.rejects(openrouter({ OPENROUTER_MANAGEMENT_KEY: "b" }, async url =>
    url.endsWith("/credits")
      ? ok({ data: {} })
      : ok({ data: [{ requests: -1, prompt_tokens: 0, completion_tokens: 0, usage: 0 }] })));
});
