import test from "node:test";
import assert from "node:assert/strict";
import { openai } from "../lib/openai.js";

const NOW = Date.parse("2026-11-04T13:00:00Z");
const env = { OPENAI_ADMIN_KEY: "test-only-never-real" };
const ok = data => new Response(JSON.stringify(data), {
  headers: { "content-type": "application/json" },
});
const request = (costs, usage) => openai(env, async (url, init) => {
  assert.equal(init.method, "GET");
  assert.equal(init.headers.Authorization, "Bearer " + env.OPENAI_ADMIN_KEY);
  if (url.includes("/costs?")) return ok(costs);
  if (url.includes("/usage/completions?")) return ok(usage);
  throw new Error("Unexpected provider destination");
}, NOW);

const validCosts = {
  data: [{ start_time: 1793750400, results: [
    { amount: { currency: "usd", value: 1.25 }, api_key_id: "private-key" },
  ] }],
};
const validUsage = {
  data: [{ results: [{ input_tokens: 75, output_tokens: 20, num_model_requests: 2,
    project_id: "internal-project" }] }],
};

test("OpenAI preserves raw precision until cost aggregation", async () => {
  const result = await request(
    { data: [{ start_time: 1793750400, results: [
      { amount: { currency: "usd", value: 0.004 } },
      { amount: { currency: "usd", value: 0.004 } },
    ] }] }, validUsage,
  );
  assert.equal(result.costUsd, 0.01);
  assert.equal(result.dailyCosts[0].usd, 0.01);
  assert.equal(result.inputTokens, 75);
  assert.equal(result.partial, false);
  assert.equal(JSON.stringify(result).includes("private-key"), false);
  assert.equal(JSON.stringify(result).includes("internal-project"), false);
});

test("OpenAI malformed USD amount cannot be rendered as a confirmed zero", async () => {
  for (const value of [null, undefined, "0", Number.MAX_VALUE]) {
    const result = await request({
      data: [{ start_time: 1793750400, results: [{ amount: { currency: "usd", value } }] }],
    }, validUsage);
    assert.equal(result.costUsd, null);
    assert.equal(result.dailyCosts, null);
    assert.equal(result.requests, 2);
    assert.equal(result.partial, true);
  }
});

test("OpenAI rejects non-USD amounts and absent result arrays instead of claiming zero", async () => {
  const examples = [
    { data: [{ start_time: 1793750400, results: [{ amount: { currency: "eur", value: 10 } }] }] },
    { data: [{ start_time: 1793750400 }] },
    { data: [{ start_time: 1e99, results: [] }] },
  ];
  for (const costs of examples) {
    const result = await request(costs, validUsage);
    assert.equal(result.costUsd, null);
    assert.equal(result.partial, true);
  }
});

test("OpenAI rejects malformed or oversized completion counts without hiding valid costs", async () => {
  for (const bad of [
    { input_tokens: "0", output_tokens: 10, num_model_requests: 1 },
    { input_tokens: Number.MAX_SAFE_INTEGER + 1, output_tokens: 10, num_model_requests: 1 },
    { input_tokens: 10, output_tokens: -1, num_model_requests: 1 },
    { input_tokens: 10, output_tokens: 10 },
  ]) {
    const result = await request(validCosts, { data: [{ results: [bad] }] });
    assert.equal(result.costUsd, 1.25);
    assert.equal(result.inputTokens, null);
    assert.equal(result.requests, null);
    assert.equal(result.partial, true);
  }
});

test("OpenAI accepts genuine zero usage and marks paginated reports incomplete", async () => {
  const normal = await request({ data: [] }, { data: [] });
  assert.equal(normal.costUsd, 0);
  assert.equal(normal.requests, 0);
  assert.equal(normal.partial, false);
  const partial = await request({ data: [], has_more: true }, { data: [] });
  assert.equal(partial.partial, true);
});

test("OpenAI fails the source if both independently validated reports are invalid", async () => {
  await assert.rejects(request({ data: null }, { data: [{ results: null }] }));
});
