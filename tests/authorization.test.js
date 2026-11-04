import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { isAllowedViewer } from "../lib/authorization.js";
import { onRequest } from "../functions/_middleware.js";

test("Exact identity allowlist denies missing, malformed, wildcard and mismatched emails", () => {
  const viewer = { sub: "access-user-1", email: "Owner+Manager@Example.com" };
  assert.equal(isAllowedViewer(viewer, { MANAGER_ALLOWED_EMAILS: " owner+manager@example.COM " }), true);
  assert.equal(isAllowedViewer(viewer, { MANAGER_ALLOWED_EMAILS: "another@example.org,OWNER+MANAGER@example.com" }), true);
  for (const value of [undefined, "", " ", "*", "*@example.com", "owner+manager@example.com,", "owner+manager@example.com,not-a-mail", "different@example.com"]) {
    assert.equal(isAllowedViewer(viewer, { MANAGER_ALLOWED_EMAILS: value }), false, String(value));
  }
  assert.equal(isAllowedViewer({ sub: "service-credential", email: null }, { MANAGER_ALLOWED_EMAILS: "owner+manager@example.com" }), false);
  assert.equal(isAllowedViewer({ email: viewer.email }, { MANAGER_ALLOWED_EMAILS: "owner+manager@example.com" }), false);
  assert.equal(isAllowedViewer(viewer, { MANAGER_ALLOWED_EMAILS: "owner+manager@example.com,".repeat(30) }), false);
});

test("Signed Access token still requires owner allowlist for static pages and API", async () => {
  const pair = await webcrypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"],
  );
  const jwk = await webcrypto.subtle.exportKey("jwk", pair.publicKey);
  jwk.kid = "identity-test-key";
  const team = "owner-allowlist-test.cloudflareaccess.com";
  const now = Math.floor(Date.now() / 1000);
  const baseEnv = { CF_ACCESS_TEAM_DOMAIN: team, CF_ACCESS_AUD: "allowlist-test-audience" };
  const b64 = content => Buffer.from(content).toString("base64url");
  const sign = async (email, options = {}) => {
    const header = b64(JSON.stringify({ alg: "RS256", kid: jwk.kid }));
    const body = b64(JSON.stringify({
      iss: "https://" + team, aud: [baseEnv.CF_ACCESS_AUD], sub: "test-identity",
      email, exp: now + 600, nbf: now - 5, ...options,
    }));
    const input = header + "." + body;
    const signature = await webcrypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(input));
    return input + "." + b64(Buffer.from(signature));
  };
  const originalFetch = globalThis.fetch;
  let certReads = 0;
  globalThis.fetch = async url => {
    assert.equal(url, "https://" + team + "/cdn-cgi/access/certs");
    certReads++;
    return new Response(JSON.stringify({ keys: [jwk] }), { headers: { "content-type": "application/json" } });
  };
  try {
    const valid = await sign("owner@example.com");
    const call = async (path, token, additional = {}) => {
      const headers = { "Cf-Access-Jwt-Assertion": token };
      let reached = false;
      const context = {
        request: new Request("https://manager.goreecloud.com" + path, { headers }),
        env: { ...baseEnv, ...additional }, data: {},
        next: () => { reached = true; return new Response("allowed"); },
      };
      const response = await onRequest(context);
      return { status: response.status, reached, viewer: context.data.viewer };
    };
    for (const path of ["/", "/app.js", "/api/overview", "/api/session"]) {
      const response = await call(path, valid, { MANAGER_ALLOWED_EMAILS: "owner@example.com" });
      assert.equal(response.status, 200, path);
      assert.equal(response.reached, true, path);
      assert.equal(response.viewer.email, "owner@example.com");
    }
    assert.equal((await call("/", valid, {})).status, 403);
    assert.equal((await call("/api/overview", valid, { MANAGER_ALLOWED_EMAILS: "someone@example.com" })).status, 403);
    assert.equal((await call("/api/session", valid, { MANAGER_ALLOWED_EMAILS: "someone@example.com" })).status, 403);
    assert.equal((await call("/", await sign(undefined), { MANAGER_ALLOWED_EMAILS: "owner@example.com" })).status, 403);
    assert.equal((await call("/", await sign("owner@example.com", { aud: ["wrong"] }), { MANAGER_ALLOWED_EMAILS: "owner@example.com" })).status, 401);
    assert.equal(certReads, 1, "test signing keys should be fetched at most once");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
