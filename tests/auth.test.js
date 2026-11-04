import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { verifyAccessJwt } from "../lib/auth.js";
import { onRequest } from "../functions/_middleware.js";
import { onRequest as onSessionRequest } from "../functions/api/session.js";
import { readFileSync } from "node:fs";
const enc = new TextEncoder();
const b64 = data => Buffer.from(data).toString("base64url");
const env = { CF_ACCESS_TEAM_DOMAIN: "manager-team.cloudflareaccess.com", CF_ACCESS_AUD: "manager-audience" };
test("Root middleware fails closed for static assets and API routes", async () => {
  for (const route of ["/", "/index.html", "/app.js", "/styles.css", "/api/overview", "/api/session"]) {
    const response = await onRequest({ request: new Request("https://manager.goreecloud.com" + route), env, data: {}, next: () => { throw new Error("should not run"); } });
    assert.equal(response.status, 401, route);
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  }
});
test("Rejects missing Access configuration and malformed tokens", async () => {
  await assert.rejects(() => verifyAccessJwt("junk", {}, { subtle: webcrypto.subtle }));
  await assert.rejects(() => verifyAccessJwt("junk", env, { subtle: webcrypto.subtle }));
});
test("Validates Access JWT signature, audience, expiry and issuer", async () => {
  const pair = await webcrypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: "SHA-256" },
    true, ["sign", "verify"]
  );
  const jwk = await webcrypto.subtle.exportKey("jwk", pair.publicKey);
  jwk.kid = "sample-key";
  const now = 1793793600;
  const header = b64(JSON.stringify({ alg: "RS256", kid: "sample-key", typ: "JWT" }));
  const claims = { iss: "https://" + env.CF_ACCESS_TEAM_DOMAIN, aud: [env.CF_ACCESS_AUD], sub: "test-user", email: "test@example.com", exp: now + 1000, nbf: now - 10 };
  async function sign(payload) {
    const body = b64(JSON.stringify(payload));
    const message = header + "." + body;
    const signature = await webcrypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, enc.encode(message));
    return message + "." + b64(signature);
  }
  const fetcher = async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { "content-type": "application/json" } });
  const token = await sign(claims);
  const verified = await verifyAccessJwt(token, env, { now, fetcher, subtle: webcrypto.subtle });
  assert.equal(verified.email, "test@example.com");
  await assert.rejects(() => verifyAccessJwt(token.slice(0, -2) + "xx", env, { now, fetcher, subtle: webcrypto.subtle }));
  const badAudience = await sign({ ...claims, aud: ["different"] });
  const expired = await sign({ ...claims, exp: now - 1 });
  await assert.rejects(() => verifyAccessJwt(badAudience, env, { now, fetcher, subtle: webcrypto.subtle }));
  await assert.rejects(() => verifyAccessJwt(expired, env, { now, fetcher, subtle: webcrypto.subtle }));
});

test("Access signing-key rotation refreshes a bounded JWKS cache", async () => {
  const environment = { CF_ACCESS_TEAM_DOMAIN: "rotation-test.cloudflareaccess.com", CF_ACCESS_AUD: "rotation-audience" };
  const keys = await Promise.all(["old", "new"].map(async kid => {
    const pair = await webcrypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true, ["sign", "verify"],
    );
    const jwk = await webcrypto.subtle.exportKey("jwk", pair.publicKey);
    return { kid, pair, jwk: { ...jwk, kid } };
  }));
  const at = 1793795000;
  const sign = async (entry, kid = entry.kid) => {
    const header = b64(JSON.stringify({ alg: "RS256", kid }));
    const claims = b64(JSON.stringify({
      iss: "https://" + environment.CF_ACCESS_TEAM_DOMAIN,
      aud: [environment.CF_ACCESS_AUD], sub: "rotation-viewer", exp: at + 500,
    }));
    const signingInput = header + "." + claims;
    const signature = await webcrypto.subtle.sign("RSASSA-PKCS1-v1_5", entry.pair.privateKey, enc.encode(signingInput));
    return signingInput + "." + b64(signature);
  };
  let published = keys[0].jwk;
  let requests = 0;
  const fetcher = async () => {
    requests++;
    return new Response(JSON.stringify({ keys: [published] }), { headers: { "content-type": "application/json" } });
  };
  const opts = now => ({ now, fetcher, subtle: webcrypto.subtle });
  assert.equal((await verifyAccessJwt(await sign(keys[0]), environment, opts(at))).sub, "rotation-viewer");
  assert.equal(requests, 1);
  published = keys[1].jwk;
  // No network refresh is allowed for unknown key IDs within the cooldown.
  await assert.rejects(verifyAccessJwt(await sign(keys[1]), environment, opts(at + 10)));
  assert.equal(requests, 1);
  assert.equal((await verifyAccessJwt(await sign(keys[1]), environment, opts(at + 40))).sub, "rotation-viewer");
  assert.equal(requests, 2);
  // The old token is no longer verifiable after an upstream key rotation.
  await assert.rejects(verifyAccessJwt(await sign(keys[0]), environment, opts(at + 41)));
  assert.equal(requests, 2);
});

test("Lightweight session route never leaks identity and fails closed without middleware", async () => {
  const request = new Request("https://manager.goreecloud.com/api/session");
  const rejected = await onSessionRequest({ request, data: {} });
  assert.equal(rejected.status, 401);
  assert.equal(rejected.headers.get("cache-control"), "private, no-store, max-age=0");
  const verified = await onSessionRequest({
    request, data: { viewer: { sub: "internal-private-subject", email: "private@example.com" } }
  });
  assert.equal(verified.status, 200);
  assert.deepEqual(await verified.json(), { authenticated: true });
  const body = JSON.stringify(await (await onSessionRequest({
    request, data: { viewer: { sub: "private-subject" } }
  })).json());
  assert.ok(!body.includes("private-subject"));
  const wrongMethod = await onSessionRequest({
    request: new Request(request.url, { method: "POST" }), data: { viewer: { sub: "test" } }
  });
  assert.equal(wrongMethod.status, 405);
});

test("Manager browser has a fail-closed tab-return session check and revision guard", () => {
  // Source-level regression only; real tab/session/cookie browser acceptance remains separate.
  const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(app, /fetch\("\/api\/session"/);
  assert.match(app, /session\?\.authenticated === true/);
  assert.match(app, /window\.addEventListener\("focus"/);
  assert.match(app, /window\.addEventListener\("pageshow"/);
  assert.match(app, /document\.addEventListener\("visibilitychange"/);
  assert.match(app, /revision !== dataRevision/);
  assert.match(app, /snapshot = null/);
  assert.match(app, /Private data cleared/);
});
