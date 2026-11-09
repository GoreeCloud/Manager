import test from "node:test";
import assert from "node:assert/strict";
import { sourceResult } from "../lib/http.js";
import { overview } from "../lib/providers.js";

const ok = value => new Response(JSON.stringify(value), {
  headers: { "content-type": "application/json" },
});

test("Provider status distinguishes connected, partial, unavailable and unconfigured", () => {
  assert.deepEqual(sourceResult("openai", { costUsd: 0, partial: true }), {
    name: "openai", status: "partial", data: { costUsd: 0, partial: true }, message: null,
  });
  assert.equal(sourceResult("openrouter", { partial: false }).status, "connected");
  assert.equal(sourceResult("github", { repositories: [] }).status, "connected");
  assert.equal(sourceResult("cloudflare", null, "Not configured").status, "unconfigured");
  assert.equal(sourceResult("cloudflare", null, "Provider unavailable").status, "error");
});

test("Overview marks verified-but-incomplete OpenAI costs separately from errors", async () => {
  const report = await overview({ OPENAI_ADMIN_KEY: "test-admin" }, async url => {
    if (url.includes("/organization/costs")) return ok({
      data: [{ start_time: 1793750400, results: [{
        amount: { value: 2.35, currency: "usd" },
      }] }],
    });
    if (url.includes("/organization/usage/completions")) return new Response("{}", { status: 429 });
    throw new Error("Unconfigured provider must not be queried");
  }, Date.parse("2026-11-08T13:00:00Z"));
  assert.deepEqual(report.sources.map(s => s.status),
    ["error", "unconfigured", "partial", "unconfigured"]);
  assert.equal(report.sources[2].data.costUsd, 2.35);
  assert.equal(report.sources[2].data.requests, null);
  assert.equal(report.sources[2].message, null);
  assert.equal(report.readOnly, true);
});

test("Partial OpenRouter management reads retain verified key usage but signal incompleteness", async () => {
  const report = await overview({
    OPENROUTER_API_KEY: "test-key",
    OPENROUTER_MANAGEMENT_KEY: "test-management",
  }, async url => url.endsWith("/key")
    ? ok({ data: { usage: 0.001 } })
    : new Response("{}", { status: 403 }));
  const router = report.sources.find(s => s.name === "openrouter");
  assert.equal(router.status, "partial");
  assert.equal(router.data.key.usageUsd, 0.001);
  assert.equal(router.data.credits, null);
  assert.equal(router.data.partial, true);
});
