import { overview } from "../../lib/providers.js";
import { json } from "../../lib/http.js";

export async function onRequest(context) {
  if (context.request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const data = await overview(context.env);
  return json(data);
}
