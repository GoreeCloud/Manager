import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const begin = app.indexOf("async function validateVisibleSession() {");
const end = app.indexOf("\nfunction theme(mode)", begin);
assert.ok(begin >= 0 && end > begin, "Session validator should be present");

function scene(fetcher) {
  const calls = { renders: 0, aborts: 0 };
  const nodes = { "#overall-status": { textContent: "" }, "#sync-time": { textContent: "" } };
  const oldSnapshot = { sources: [{ name: "github", data: { sensitive: "private-row" } }] };
  const context = {
    snapshot: oldSnapshot,
    dataRevision: 1,
    controller: { abort: () => { calls.aborts++; } },
    document: { visibilityState: "visible" },
    notice: { hidden: true, textContent: "" },
    refresh: { disabled: true },
    $: key => nodes[key],
    render: () => { calls.renders++; },
    fetch: fetcher,
  };
  const validate = runInNewContext(app.slice(begin, end) + "\nvalidateVisibleSession", context);
  return { context, calls, oldSnapshot, validate };
}

test("Valid Access JSON preserves the existing authorized dashboard", async () => {
  const s = scene(async (url, options) => {
    assert.equal(url, "/api/session");
    assert.equal(options.cache, "no-store");
    assert.equal(options.credentials, "same-origin");
    return new Response(JSON.stringify({ authenticated: true }), {
      headers: { "content-type": "application/json" },
    });
  });
  await s.validate();
  assert.equal(s.context.snapshot, s.oldSnapshot);
  assert.equal(s.calls.renders, 0);
  assert.equal(s.calls.aborts, 0);
});

for (const [name, response] of [
  ["200 HTML fallback", new Response("<html>Login</html>", { status: 200, headers: { "content-type": "text/html" } })],
  ["200 invalid proof", new Response(JSON.stringify({ authenticated: false }), { status: 200 })],
  ["401 Access denial", new Response("Unauthorized", { status: 401 })],
]) {
  test("Session " + name + " clears previously private state", async () => {
    const s = scene(async () => response);
    await s.validate();
    assert.equal(s.context.snapshot, null);
    assert.equal(s.calls.aborts, 1);
    assert.equal(s.calls.renders, 1);
    assert.equal(s.context.refresh.disabled, false);
    assert.equal(s.context.notice.hidden, false);
    assert.match(s.context.notice.textContent, /session could not be verified/);
    assert.equal(s.context.dataRevision, 2);
  });
}

test("Network outage clears private DOM instead of leaving a trusted appearance", async () => {
  const s = scene(async () => { throw new Error("network unavailable"); });
  await s.validate();
  assert.equal(s.context.snapshot, null);
  assert.equal(s.calls.renders, 1);
});

test("Superseded tab-return checks cannot clear newer refresh state", async () => {
  let finish;
  const s = scene(() => new Promise(resolve => { finish = resolve; }));
  const pending = s.validate();
  s.context.dataRevision = 2; // A newer overview fetch owns the session state.
  finish(new Response(JSON.stringify({ authenticated: false }), { status: 200 }));
  await pending;
  assert.equal(s.context.snapshot, s.oldSnapshot);
  assert.equal(s.calls.renders, 0);
  assert.equal(s.calls.aborts, 0);
});


test("A session denial cannot be undone by an old overview response", async () => {
  const loadBegin = app.indexOf("async function load() {");
  const loadEnd = app.indexOf("\n// An Access check on returning", loadBegin);
  assert.ok(loadBegin >= 0 && loadEnd > loadBegin, "Integrated load guard should be present");

  let deliverOverview;
  const delayedOverview = new Promise(resolve => { deliverOverview = resolve; });
  const nodes = { "#overall-status": { textContent: "" }, "#sync-time": { textContent: "" } };
  let renders = 0;
  let sessionChecks = 0;
  const context = {
    snapshot: { sources: [{ name: "github", data: { confidential: "never-restore" } }] },
    dataRevision: 1,
    controller: null,
    AbortController,
    document: { visibilityState: "visible" },
    notice: { hidden: true, textContent: "" },
    refresh: { disabled: false },
    $: name => nodes[name],
    render: () => { renders++; },
    fetch: (url) => {
      if (url === "/api/overview") return delayedOverview;
      assert.equal(url, "/api/session");
      sessionChecks++;
      return Promise.resolve(new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }));
    },
  };

  const functions = runInNewContext(
    app.slice(loadBegin, loadEnd) + "\n" +
    app.slice(begin, end) + "\n({ load, validateVisibleSession })",
    context,
  );
  const pendingLoad = functions.load();
  assert.equal(context.dataRevision, 2, "New overview must own a new revision");
  await functions.validateVisibleSession();
  assert.equal(sessionChecks, 1);
  assert.equal(context.snapshot, null);
  assert.equal(context.dataRevision, 3, "Denied session invalidates in-flight overview");
  assert.equal(context.controller, null, "Denied session releases the aborted controller");

  // Simulate a fetch implementation returning a stale response despite abort.
  // The combined active-signal and revision guard must reject this result.
  deliverOverview(new Response(JSON.stringify({
    readOnly: true,
    generatedAt: "2026-11-04T00:00:00Z",
    sources: [{ name: "github", status: "connected", data: { confidential: "never-restore" } }],
  }), { headers: { "content-type": "application/json" } }));
  await pendingLoad;
  assert.equal(context.snapshot, null);
  assert.equal(nodes["#overall-status"].textContent, "Private session unavailable");
  assert.equal(nodes["#sync-time"].textContent, "Private data cleared");
  assert.equal(context.refresh.disabled, false);
  assert.equal(renders, 1, "Only the private purge should render");
});
