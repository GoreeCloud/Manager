import test from "node:test";
import assert from "node:assert/strict";
import { overview } from "../lib/providers.js";
import { openai } from "../lib/openai.js";
import { readJson, safeMessage, ProviderError } from "../lib/http.js";

const ok = value => new Response(JSON.stringify(value), {
  headers: { "content-type": "application/json" },
});

test("HTTP 429 diagnostics are redacted and do not claim a particular billing cause", async () => {
  const message = safeMessage(new ProviderError("upstream", 429));
  assert.match(message, /rate, quota or spending/i);
  assert.doesNotMatch(message, /private-test-key|raw payload/i);
});

test("Concurrent reporting isolates limit errors from unrelated provider data", async () => {
  const calls = [];
  const fake = async (url, options) => {
    calls.push({ url, method: options.method });
    if (url.includes("/organization/")) {
      return new Response(JSON.stringify({ message: "private upstream diagnostic" }), {
        status: 429, headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/users/GoreeCloud/repos")) {
      return ok([{ name: "Manager", private: false, archived: false,
        stargazers_count: 0, open_issues_count: 0 }]);
    }
    if (url.includes("/actions/runs?")) return ok({ workflow_runs: [] });
    if (url.includes("/api/v1/key")) return ok({ data: { usage: 0.25, usage_daily: 0.01 } });
    throw new Error("Unexpected external URL");
  };
  const report = await overview({
    GITHUB_OWNER: "GoreeCloud",
    OPENAI_ADMIN_KEY: "private-test-key",
    OPENROUTER_API_KEY: "test-openrouter-key",
  }, fake, Date.parse("2026-11-04T13:00:00Z"));
  assert.deepEqual(report.sources.map(s => s.status),
    ["connected", "unconfigured", "error", "connected"]);
  assert.match(report.sources[2].message, /rate, quota or spending/i);
  assert.equal(report.sources[2].data, null);
  assert.equal(report.sources[3].data.key.usageUsd, 0.25);
  assert.equal(report.sources[0].data.repositoryCount, 1);
  assert.equal(calls.filter(c => c.url.includes("/organization/")).length, 2);
  assert.ok(calls.every(c => c.method === "GET"));
  const exported = JSON.stringify(report);
  assert.ok(!exported.includes("private upstream diagnostic"));
  assert.ok(!exported.includes("private-test-key"));
  assert.ok(!exported.includes("test-openrouter-key"));
});

test("Partial OpenAI costs survive a completion-usage request limit", async () => {
  const report = await openai({ OPENAI_ADMIN_KEY: "synthetic" }, async url => {
    if (url.includes("/costs?")) return ok({ data: [{
      start_time: 1793750400, results: [{ amount: { value: 2.35, currency: "usd" } }],
    }] });
    return new Response("{}", { status: 429 });
  }, Date.parse("2026-11-04T13:00:00Z"));
  assert.equal(report.costUsd, 2.35);
  assert.equal(report.requests, null);
  assert.equal(report.inputTokens, null);
  assert.equal(report.outputTokens, null);
  assert.equal(report.partial, true);
});

test("Raw upstream HTTP response is never surfaced in sanitized messages", async () => {
  let failure;
  try {
    await readJson("https://api.openai.com/v1/organization/costs", {}, async () =>
      new Response("sensitive upstream body", { status: 429 }));
  } catch (error) { failure = error; }
  assert.equal(failure?.status, 429);
  assert.ok(!safeMessage(failure).includes("sensitive upstream body"));
});
