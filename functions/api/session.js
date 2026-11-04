import { json } from "../../lib/http.js";

// Runs behind the mandatory root Cloudflare Access middleware that protects static and API routes.
// No providers are queried, and no identity or secret values are sent to the UI.
export function onRequest(context) {
  if (context.request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  if (!context.data?.viewer) return json({ error: "Unauthorized" }, 401);
  return json({ authenticated: true });
}
