import { verifyAccessJwt } from "../../lib/auth.js";
import { json } from "../../lib/http.js";
export async function onRequest(context) {
  const jwt = context.request.headers.get("Cf-Access-Jwt-Assertion");
  try {
    const viewer = await verifyAccessJwt(jwt, context.env);
    context.data.viewer = viewer;
    return context.next();
  } catch {
    return json({ error: "Unauthorized", detail: "Valid Cloudflare Access session required" }, 401);
  }
}
