import { readJson } from "./http.js";
export async function cloudflare(env, fetcher = fetch) {
  if (!env.CF_ACCOUNT_ID || !env.CF_PAGES_READ_TOKEN) return null;
  if (!/^[a-f0-9]{32}$/i.test(env.CF_ACCOUNT_ID)) throw new Error("Invalid account id");
  const response = await readJson(
    "https://api.cloudflare.com/client/v4/accounts/" + env.CF_ACCOUNT_ID + "/pages/projects?per_page=100",
    { headers: { Authorization: "Bearer " + env.CF_PAGES_READ_TOKEN } },
    fetcher
  );
  if (response.success !== true || !Array.isArray(response.result)) throw new Error("Malformed Cloudflare response");
  const projects = response.result;
  return {
    projectCount: projects.length,
    truncated: (response.result_info?.total_count || 0) > projects.length,
    projects: projects.slice(0, 12).map(project => {
      const deploy = project.latest_deployment || null;
      const stage = deploy?.latest_stage || null;
      const subdomain = String(project.subdomain || "");
      const rawDate = Date.parse(deploy?.created_on || "");
      return {
        name: String(project.name || ""),
        url: /^[a-z0-9.-]+$/i.test(subdomain) ? "https://" + subdomain : null,
        status: stage?.status === "success" ? "healthy" : stage?.status === "failure" ? "failed" : "unknown",
        branch: String(deploy?.deployment_trigger?.metadata?.branch || ""),
        deployedAt: Number.isFinite(rawDate) ? new Date(rawDate).toISOString() : null,
      };
    }),
  };
}
