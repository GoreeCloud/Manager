import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export function classifyAnonymousResponse(status, location, requestUrl) {
  if (status === 401 || status === 403) return "denied";
  if (status >= 200 && status < 300) return "exposed";
  if ([301, 302, 303, 307, 308].includes(status) && location) {
    let next;
    try { next = new URL(location, requestUrl); } catch { return "unexpected"; }
    const req = new URL(requestUrl);
    if (next.protocol !== "https:") return "unexpected";
    const isAccess = next.pathname.startsWith("/cdn-cgi/access/");
    if (isAccess && next.hostname === req.hostname) return "denied";
    if (isAccess && /^[a-z0-9-]+\.cloudflareaccess\.com$/.test(next.hostname)) return "denied";
  }
  return "unexpected";
}

export function canonicalBase(input) {
  const url = new URL(input);
  const allowed = url.hostname === "manager.goreecloud.com" ||
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)?goreecloud-manager\.pages\.dev$/.test(url.hostname);
  if (url.protocol !== "https:" || !allowed || url.username || url.password ||
      url.port || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Only approved Manager HTTPS origins are accepted");
  }
  return url.origin;
}

export async function verifyAnonymousAccess(origin, fetcher = fetch) {
  const base = canonicalBase(origin + (origin.endsWith("/") ? "" : "/"));
  const paths = ["/", "/index.html", "/app.js", "/styles.css", "/api/overview", "/api/session"];
  // Independent anonymous checks run concurrently, with one timeout per route.
  // Keep the path order stable for deterministic reports.
  return Promise.all(paths.map(async path => {
    const url = base + path;
    try {
      const response = await fetcher(url, {
        method: "GET", redirect: "manual", cache: "no-store",
        signal: AbortSignal.timeout(6000),
      });
      const verdict = classifyAnonymousResponse(response.status, response.headers.get("location"), url);
      void response.body?.cancel().catch(() => {});
      return { path, status: response.status, verdict };
    } catch {
      return { path, status: null, verdict: "unreachable" };
    }
  }));
}

export async function main() {
  let origin;
  try { origin = canonicalBase(process.env.MANAGER_BASE_URL || "https://manager.goreecloud.com/"); }
  catch { console.error("Invalid Manager base URL"); return 1; }
  const rows = await verifyAnonymousAccess(origin);
  for (const item of rows) console.log(item.path + " " + (item.status ?? "network-error") + " " + item.verdict);
  if (rows.some(r => r.verdict === "exposed")) {
    console.error("SECURITY: a protected Manager path is accessible without credentials");
    return 2;
  }
  if (rows.some(r => r.verdict !== "denied")) {
    console.error("Access could not be verified: check DNS, redirect and Access policies");
    return 1;
  }
  console.log("PASS: tested paths denied anonymous access");
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(() => { process.exitCode = 1; });
}
