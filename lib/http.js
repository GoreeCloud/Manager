export const SECURITY_HEADERS = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
});
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...SECURITY_HEADERS, "Content-Type": "application/json; charset=utf-8" },
  });
}
export class ProviderError extends Error {
  constructor(source, status = 502) {
    super(source + " provider unavailable");
    this.source = source;
    this.status = status;
  }
}
export async function readJson(url, options = {}, fetcher = fetch) {
  if (new URL(url).protocol !== "https:") throw new Error("HTTPS required");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6500);
  try {
    const res = await fetcher(url, {
      method: "GET", redirect: "error",
      ...options, signal: controller.signal,
      headers: { Accept: "application/json", ...(options.headers || {}) },
    });
    if (!res.ok) throw new ProviderError("upstream", res.status);
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("json")) throw new ProviderError("upstream");
    const raw = await res.text();
    if (raw.length > 1_500_000) throw new ProviderError("upstream");
    return JSON.parse(raw);
  } finally {
    clearTimeout(timer);
  }
}
export function sourceResult(name, data, message = null) {
  return { name, status: data === null ? (message === "Not configured" ? "unconfigured" : "error") : "connected", data, message };
}
export function safeMessage(error) {
  if (error instanceof ProviderError && error.status === 429) return "Provider rate limit reached";
  if (error instanceof ProviderError && error.status === 403) return "Provider access denied";
  if (error instanceof ProviderError && error.status === 401) return "Provider credentials rejected";
  return "Provider unavailable";
}
