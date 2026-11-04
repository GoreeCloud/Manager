import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { verifyAccessJwt } from "../lib/auth.js";
import { onRequest } from "../functions/_middleware.js";
const enc = new TextEncoder();
const b64 = data => Buffer.from(data).toString("base64url");
const env = { CF_ACCESS_TEAM_DOMAIN: "manager-team.cloudflareaccess.com", CF_ACCESS_AUD: "manager-audience" };
test("Root middleware fails closed for static assets and API routes", async () => {
  for (const route of ["/", "/index.html", "/app.js", "/styles.css", "/api/overview"]) {
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
