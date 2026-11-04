import { readJson } from "./http.js";

const PAGE_SIZE = 100;
const MAX_PAGES = 5;

const projectData = p => {
  const deployment = p.latest_deployment || p.canonical_deployment || null;
  const stage = deployment?.latest_stage;
  const rawDate = Date.parse(deployment?.created_on || deployment?.modified_on || "");
  const subdomain = String(p.subdomain || "");
  return {
    name: String(p.name || "").slice(0, 100),
    url: /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.pages\.dev$/i.test(subdomain)
      ? "https://" + subdomain : null,
    status: stage?.status === "success" ? "healthy"
      : stage?.status === "failure" ? "failed"
      : stage?.status === "active" ? "building" : "unknown",
    branch: String(deployment?.deployment_trigger?.metadata?.branch || "").slice(0, 100),
    deployedAt: Number.isFinite(rawDate) ? new Date(rawDate).toISOString() : null,
  };
};

export async function cloudflare(env, fetcher = fetch) {
  if (!env.CF_ACCOUNT_ID || !env.CF_PAGES_READ_TOKEN) return null;
  if (!/^[a-f0-9]{32}$/i.test(env.CF_ACCOUNT_ID)) throw new Error("Invalid account id");

  const endpoint = "https://api.cloudflare.com/client/v4/accounts/" + env.CF_ACCOUNT_ID + "/pages/projects";
  const options = { headers: { Authorization: "Bearer " + env.CF_PAGES_READ_TOKEN } };
  const getPage = async page => {
    const payload = await readJson(endpoint + "?per_page=" + PAGE_SIZE + "&page=" + page, options, fetcher);
    if (payload.success !== true || !Array.isArray(payload.result)) throw new Error("Malformed Cloudflare response");
    return payload;
  };

  const first = await getPage(1);
  const firstCount = first.result.length;
  const countField = first.result_info?.total_count;
  const total = Number.isInteger(countField) && countField >= 0 ? countField : null;
  const reportedPages = Number(first.result_info?.total_pages);
  const pages = [first];

  if (Number.isInteger(reportedPages) && reportedPages > 1) {
    const additional = Math.min(MAX_PAGES, reportedPages);
    const rest = await Promise.all(
      Array.from({ length: additional - 1 }, (_, i) => getPage(i + 2)),
    );
    pages.push(...rest);
  } else if (firstCount === PAGE_SIZE && (total === null || total > firstCount)) {
    // Older responses may not advertise total_pages; use bounded sequential reads.
    for (let number = 2; number <= MAX_PAGES; number++) {
      const page = await getPage(number);
      pages.push(page);
      const received = pages.reduce((sum, p) => sum + p.result.length, 0);
      if (page.result.length < PAGE_SIZE || (total !== null && received >= total)) break;
    }
  }

  // Stable IDs avoid overcounting duplicates if upstream pagination overlaps.
  const seen = new Set();
  const unique = [];
  for (const page of pages) {
    for (const project of page.result) {
      const id = typeof project.id === "string" && project.id ? project.id : String(project.name || "");
      if (seen.has(id)) continue;
      seen.add(id);
      unique.push(project);
    }
  }
  const collected = unique.length;
  const possibleMore = total === null
    ? pages.length === MAX_PAGES && pages[pages.length - 1].result.length === PAGE_SIZE
    : collected < total;

  return {
    projectCount: collected,
    truncated: possibleMore,
    projects: unique.slice(0, 12).map(projectData),
  };
}
