import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { classifyAnonymousResponse, canonicalBase, verifyAnonymousAccess } from "../scripts/verify-anonymous-access.mjs";

test("Pages root middleware cannot silently regress to API-only scope", () => {
  assert.ok(existsSync(new URL("../functions/_middleware.js", import.meta.url)));
  assert.equal(existsSync(new URL("../functions/api/_middleware.js", import.meta.url)), false);
  const body = readFileSync(new URL("../functions/_middleware.js", import.meta.url), "utf8");
  assert.match(body, /verifyAccessJwt/);
});
test("Anonymous access probe rejects success, unsafe redirect, and non-HTTPS URL", () => {
  assert.equal(classifyAnonymousResponse(200, null, "https://manager.goreecloud.com/"), "exposed");
  assert.equal(classifyAnonymousResponse(401, null, "https://manager.goreecloud.com/"), "denied");
  assert.equal(classifyAnonymousResponse(403, null, "https://manager.goreecloud.com/"), "denied");
  assert.equal(classifyAnonymousResponse(302, "/cdn-cgi/access/login", "https://manager.goreecloud.com/"), "denied");
  assert.equal(classifyAnonymousResponse(302, "https://team.cloudflareaccess.com/cdn-cgi/access/login", "https://manager.goreecloud.com/"), "denied");
  assert.equal(classifyAnonymousResponse(302, "https://example.com/login", "https://manager.goreecloud.com/"), "unexpected");
  assert.equal(classifyAnonymousResponse(302, "http://manager.goreecloud.com/cdn-cgi/access/login", "https://manager.goreecloud.com/"), "unexpected");
});
test("Only approved Manager HTTPS origins can be probed", () => {
  assert.equal(canonicalBase("https://manager.goreecloud.com/"), "https://manager.goreecloud.com");
  assert.equal(canonicalBase("https://goreecloud-manager.pages.dev/"), "https://goreecloud-manager.pages.dev");
  assert.equal(canonicalBase("https://preview.goreecloud-manager.pages.dev/"), "https://preview.goreecloud-manager.pages.dev");
  assert.equal(canonicalBase("https://a1b2c3.goreecloud-manager.pages.dev/"), "https://a1b2c3.goreecloud-manager.pages.dev");
  for (const invalid of ["http://manager.goreecloud.com/", "https://example.com/", "https://some-other-project.pages.dev/", "https://preview.some-other-project.pages.dev/", "https://nested.preview.goreecloud-manager.pages.dev/", "https://preview.goreecloud-manager.pages.dev.evil.com/", "https://manager.goreecloud.com@evil.com/", "https://manager.goreecloud.com/path", "https://manager.goreecloud.com:444/", "https://goreecloud-manager.pages.dev/?secret=yes"]) {
    assert.throws(() => canonicalBase(invalid));
  }
});
test("Access probe reports each route without following redirects", async () => {
  const urls = [];
  const reports = await verifyAnonymousAccess("https://manager.goreecloud.com", async (url, options) => {
    urls.push(url);
    assert.equal(options.redirect, "manual");
    return new Response(null, { status: 401 });
  });
  assert.deepEqual(urls.map(url => new URL(url).pathname),
    ["/", "/index.html", "/app.js", "/styles.css", "/api/overview", "/api/session"]);
  assert.deepEqual(reports.map(r => r.verdict), Array(6).fill("denied"));
});

test("Anonymous probe executes six independent routes concurrently and detects a single exposure", async () => {
  const pending = [];
  const request = verifyAnonymousAccess("https://goreecloud-manager.pages.dev", (url, options) =>
    new Promise(resolve => {
      assert.equal(options.method, "GET");
      assert.equal(options.redirect, "manual");
      assert.equal(options.credentials, undefined);
      pending.push({ path: new URL(url).pathname, resolve });
    }));
  assert.equal(pending.length, 6, "All route probes must begin before any upstream response");
  for (const entry of pending) {
    entry.resolve(new Response(null, { status: entry.path === "/api/session" ? 200 : 401 }));
  }
  const rows = await request;
  assert.deepEqual(rows.map(row => row.path), [
    "/", "/index.html", "/app.js", "/styles.css", "/api/overview", "/api/session",
  ]);
  assert.equal(rows.filter(row => row.verdict === "exposed").length, 1);
  assert.equal(rows.find(row => row.path === "/api/session").verdict, "exposed");
});
