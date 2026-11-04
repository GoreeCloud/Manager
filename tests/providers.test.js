import test from "node:test";
import assert from "node:assert/strict";
import { github } from "../lib/github.js";
import { cloudflare } from "../lib/cloudflare.js";
import { openai } from "../lib/openai.js";
import { overview } from "../lib/providers.js";
import { readJson } from "../lib/http.js";

const ok = data => new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
test("GitHub aggregates public, non-archived repositories without assuming a token", async () => {
  let requested;
  const fetcher = async (url, init) => {
    if (url.includes("/actions/runs?")) return ok({ workflow_runs: [] });
    requested = { url, init };
    return ok([
      { name: "Manager", description: "Manager", html_url: "https://github.com/GoreeCloud/Manager", pushed_at: "2026-11-04T12:00:00Z", private: false, archived: false, stargazers_count: 7, open_issues_count: 2, language: "JavaScript" },
      { name: "private", private: true, archived: false, stargazers_count: 0 },
      { name: "archived", private: false, archived: true, stargazers_count: 0 }
    ]);
  };
  const data = await github({ GITHUB_OWNER: "GoreeCloud" }, fetcher);
  assert.equal(requested.init.headers.Authorization, undefined);
  assert.match(requested.url, /users\/GoreeCloud\/repos/);
  assert.equal(data.repositoryCount, 1);
  assert.equal(data.stars, 7);
  assert.equal(data.openWorkItems, 2);
  assert.equal(data.repositories[0].name, "Manager");
  assert.equal(data.truncated, false);
});
test("GitHub rejects malformed owner to constrain destinations", async () => {
  await assert.rejects(() => github({ GITHUB_OWNER: "../bad" }, async () => ok([])));
});
test("Cloudflare remains unconfigured rather than reporting zero", async () => {
  assert.equal(await cloudflare({}), null);
});
test("Cloudflare maps only safe project fields", async () => {
  const result = await cloudflare({ CF_ACCOUNT_ID: "f".repeat(32), CF_PAGES_READ_TOKEN: "in-memory-test-key" }, async (url, init) => {
    assert.ok(url.startsWith("https://api.cloudflare.com/client/v4/accounts/"));
    assert.equal(init.headers.Authorization, "Bearer in-memory-test-key");
    return ok({ success: true, result: [{ name: "site", subdomain: "site.pages.dev", env_vars: { PRIVATE_KEY: "do-not-export" }, latest_deployment: { created_on: "2026-11-04T10:00:00Z", latest_stage: { status: "success" }, deployment_trigger: { metadata: { branch: "main" } } } }] });
  });
  assert.equal(result.projectCount, 1);
  assert.equal(result.projects[0].status, "healthy");
  assert.equal(JSON.stringify(result).includes("do-not-export"), false);
});
test("OpenAI aggregates costs and usage without returning its admin key", async () => {
  const now = Date.parse("2026-11-04T13:00:00Z");
  const data = await openai({ OPENAI_ADMIN_KEY: "dummy-for-tests" }, async url => {
    assert.ok(url.startsWith("https://api.openai.com/v1/organization/"));
    if (url.includes("/costs?")) return ok({ data: [{ start_time: 1793750400, results: [{ amount: { value: 1.27, currency: "usd" } }] }] });
    return ok({ data: [{ results: [{ input_tokens: 100, output_tokens: 23, num_model_requests: 4 }] }] });
  }, now);
  assert.equal(data.costUsd, 1.27);
  assert.equal(data.inputTokens, 100);
  assert.equal(data.requests, 4);
  assert.equal(JSON.stringify(data).includes("dummy-for-tests"), false);
});
test("Overview never substitutes a successful zero for provider errors", async () => {
  const data = await overview({}, async () => { throw new Error("network down"); }, Date.parse("2026-11-04T13:00:00Z"));
  assert.deepEqual(data.sources.map(x => x.status), ["error", "unconfigured", "unconfigured"]);
  assert.equal(data.sources[0].data, null);
  assert.equal(data.readOnly, true);
});
test("Upstream HTTP failures are normalized and reject redirects", async () => {
  await assert.rejects(() => readJson("http://example.com"));
  await assert.rejects(() => readJson("https://api.github.com/example", {}, async () => new Response("no", { status: 403 })));
});

test("OpenAI reports malformed responses as errors rather than connected zeros", async () => {
  await assert.rejects(() => openai({ OPENAI_ADMIN_KEY: "dummy" }, async () => ok({ data: null })));
});
test("OpenAI marks paginated usage data incomplete", async () => {
  const now = Date.parse("2026-11-04T13:00:00Z");
  const data = await openai({ OPENAI_ADMIN_KEY: "dummy" }, async url => {
    if (url.includes("/costs?")) return ok({ data: [{ start_time: 1793750400, results: [] }], has_more: false });
    return ok({ data: [{ results: [{ input_tokens: 25, output_tokens: 10, num_model_requests: 1 }] }], has_more: true });
  }, now);
  assert.equal(data.partial, true);
  assert.equal(data.requests, 1);
});

test("Upstream JSON reader enforces response-size bounds", async () => {
  const big = "x".repeat(1_500_100);
  await assert.rejects(() => readJson("https://api.github.com/big", {}, async () =>
    new Response(JSON.stringify({ value: big }), { headers: { "content-type": "application/json" } })));
  await assert.rejects(() => readJson("https://api.github.com/big", {}, async () =>
    new Response("{}", { headers: { "content-type": "application/json", "content-length": "1500001" } })));
});

test("Cloudflare Pages aggregates all reported pages and deduplicates project IDs", async () => {
  const requests = [];
  const result = await cloudflare({ CF_ACCOUNT_ID: "a".repeat(32), CF_PAGES_READ_TOKEN: "test-read" }, async (url) => {
    const page = Number(new URL(url).searchParams.get("page"));
    requests.push(page);
    const rows = page === 1
      ? [{ id: "p1", name: "first", subdomain: "first.pages.dev" }]
      : page === 2
        ? [{ id: "p2", name: "second", subdomain: "second.pages.dev" }, { id: "p1", name: "first", subdomain: "first.pages.dev" }]
        : [{ id: "p3", name: "third", subdomain: "attacker.example.com" }];
    return ok({ success: true, result: rows, result_info: { total_pages: 3, total_count: 3 } });
  });
  assert.deepEqual(requests.sort(), [1, 2, 3]);
  assert.equal(result.projectCount, 3);
  assert.equal(result.truncated, false);
  assert.equal(result.projects[2].url, null);
});

test("Cloudflare Pages advertises incomplete totals after the five-page cap", async () => {
  const queried = [];
  const result = await cloudflare({ CF_ACCOUNT_ID: "a".repeat(32), CF_PAGES_READ_TOKEN: "test-read" }, async (url) => {
    const page = Number(new URL(url).searchParams.get("page"));
    queried.push(page);
    return ok({
      success: true, result_info: { total_pages: 6, total_count: 600 },
      result: Array.from({ length: 100 }, (_, index) => ({
        id: "p" + page + "-" + index, name: "page-" + page + "-" + index, subdomain: "project.pages.dev",
      })),
    });
  });
  assert.deepEqual(queried.sort(), [1, 2, 3, 4, 5]);
  assert.equal(result.projectCount, 500);
  assert.equal(result.truncated, true);
  assert.equal(result.projects.length, 12);
});

test("Cloudflare Pages rejects malformed subsequent pages instead of claiming completeness", async () => {
  await assert.rejects(() => cloudflare({ CF_ACCOUNT_ID: "a".repeat(32), CF_PAGES_READ_TOKEN: "test-read" }, async (url) => {
    const page = Number(new URL(url).searchParams.get("page"));
    if (page === 1) return ok({ success: true, result: [{ id: "p1", name: "one" }], result_info: { total_pages: 2, total_count: 2 } });
    return ok({ success: false, result: [] });
  }));
});
