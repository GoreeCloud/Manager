import { readJson } from "./http.js";
const decode = (part) => {
  if (typeof part !== "string" || !/^[A-Za-z0-9_-]+$/.test(part)) throw new Error("Malformed token");
  const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const text = new TextDecoder();
let certCache = { host: "", until: 0, lastRefresh: 0, keys: [] };
async function refreshKeys(host, now, fetcher) {
  const certs = await readJson("https://" + host + "/cdn-cgi/access/certs", {}, fetcher);
  if (!Array.isArray(certs.keys)) throw new Error("No Access keys");
  certCache = { host, keys: certs.keys, until: now + 300, lastRefresh: now };
  return certCache.keys;
}
export async function verifyAccessJwt(jwt, env, options = {}) {
  const host = env.CF_ACCESS_TEAM_DOMAIN;
  const audience = env.CF_ACCESS_AUD;
  if (!host || !audience || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(host)) throw new Error("Access not configured");
  if (!jwt || jwt.length > 8192) throw new Error("Missing or invalid token");
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new Error("Malformed token");
  const header = JSON.parse(text.decode(decode(parts[0])));
  const body = JSON.parse(text.decode(decode(parts[1])));
  if (header.alg !== "RS256" || typeof header.kid !== "string" || header.kid.length > 256) throw new Error("Unsupported token");
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (body.iss !== "https://" + host ||
      !([].concat(body.aud || [])).includes(audience) ||
      !Number.isFinite(body.exp) || body.exp <= now ||
      (body.nbf !== undefined && (!Number.isFinite(body.nbf) || body.nbf > now)) ||
      !body.sub || typeof body.sub !== "string") throw new Error("Token claims rejected");
  const fetcher = options.fetcher || fetch;
  let keys = certCache.host === host && certCache.until > now
    ? certCache.keys : await refreshKeys(host, now, fetcher);
  const findKey = () => keys.find(k => k.kid === header.kid && k.kty === "RSA" && k.use !== "enc");
  let jwk = findKey();
  // Allow a bounded signing-key rotation refresh while preserving fail-closed
  // behavior. Unknown key IDs cannot force unbounded upstream fetches.
  if (!jwk && certCache.host === host && now - certCache.lastRefresh >= 30) {
    certCache.lastRefresh = now; // throttle even if the refresh fails
    keys = await refreshKeys(host, now, fetcher);
    jwk = findKey();
  }
  if (!jwk) throw new Error("Signing key unavailable");
  const subtle = options.subtle || crypto.subtle;
  const key = await subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await subtle.verify("RSASSA-PKCS1-v1_5", key, decode(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
  if (!valid) throw new Error("Token signature invalid");
  return { sub: body.sub, email: typeof body.email === "string" ? body.email : null };
}
