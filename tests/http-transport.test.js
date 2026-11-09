import test from "node:test";
import assert from "node:assert/strict";
import { readJson, ProviderError } from "../lib/http.js";

const ok = () => new Response('{"allowed":true}', {
  headers: { "content-type": "application/json" },
});

test("Provider transport cannot be switched to a write method or follow redirects", async () => {
  let observed;
  const result = await readJson("https://api.github.com/test", {
    method: "POST",
    redirect: "follow",
    credentials: "include",
    headers: { Authorization: "Bearer synthetic-test-token" },
  }, async (url, options) => {
    observed = { url, ...options };
    return ok();
  });
  assert.deepEqual(result, { allowed: true });
  assert.equal(observed.method, "GET");
  assert.equal(observed.redirect, "error");
  assert.equal(observed.credentials, "omit");
  assert.equal(observed.headers.Authorization, "Bearer synthetic-test-token");
  assert.equal(observed.headers.Accept, "application/json");
});

test("Provider transport cannot override its internal AbortSignal", async () => {
  const caller = new AbortController();
  caller.abort();
  await readJson("https://api.openrouter.ai/test", { signal: caller.signal }, async (_, options) => {
    assert.ok(options.signal instanceof AbortSignal);
    assert.notEqual(options.signal, caller.signal);
    assert.equal(options.signal.aborted, false);
    return ok();
  });
});

test("Provider transport rejects HTTP and rejects redirect responses without following them", async () => {
  await assert.rejects(readJson("http://api.github.com/test", {}, async () => {
    throw new Error("Must never fetch non-HTTPS targets");
  }), /HTTPS required/);
  let calls = 0;
  await assert.rejects(readJson("https://api.github.com/test", {
    redirect: "follow",
  }, async (_, options) => {
    calls++;
    assert.equal(options.redirect, "error");
    return new Response(null, {
      status: 302,
      headers: { Location: "https://evil.example/collect" },
    });
  }), ProviderError);
  assert.equal(calls, 1);
});
