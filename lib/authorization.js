// An additional identity boundary independent from Cloudflare Access policy.
// Configure a comma-separated exact email allowlist in Pages runtime settings.
// Empty, malformed or missing configuration denies every viewer.
const EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export function isAllowedViewer(viewer, env) {
  const configured = env?.MANAGER_ALLOWED_EMAILS;
  if (typeof configured !== "string" || !configured.trim() || configured.length > 2048) return false;
  const entries = configured.split(",").map(value => value.trim());
  if (entries.length > 20 || entries.some(value => !EMAIL.test(value))) return false;
  if (typeof viewer?.sub !== "string" || !viewer.sub.trim() || typeof viewer?.email !== "string") return false;
  return EMAIL.test(viewer.email) && entries.some(value => value.toLowerCase() === viewer.email.toLowerCase());
}
