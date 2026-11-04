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
  assert.equal(canonicalBase("https://preview.goreecloud-manager.pages.dev/"), "https://preview.goreecloud-manager.pages.dev");
  for (const invalid of ["http://manager.goreecloud.com/", "https://example.com/", "https://manager.goreecloud.com@evil.com/", "https://manager.goreecloud.com/path"]) {
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
  assert.equal(urls.length, 3);
  assert.deepEqual(reports.map(r => r.verdict), ["denied", "denied", "denied"]);
});
