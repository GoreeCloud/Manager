import { readJson } from "./http.js";
import { workflowRuns } from "./workflows.js";
const sum = (items, key) => items.reduce((n, item) => n + (Number(item[key]) || 0), 0);
function date(value) {
  const n = Date.parse(value);
  return Number.isFinite(n) ? new Date(n).toISOString() : null;
}
export async function github(env, fetcher = fetch) {
  const owner = env.GITHUB_OWNER || "GoreeCloud";
  if (!/^[A-Za-z0-9-]{1,39}$/.test(owner)) throw new Error("Invalid owner");
  const headers = { "X-GitHub-Api-Version": "2022-11-28" };
  if (env.GITHUB_READ_TOKEN) headers.Authorization = "Bearer " + env.GITHUB_READ_TOKEN;
  const repositories = [];
  let truncated = false;
  for (let page = 1; page <= 4; page++) {
    const result = await readJson("https://api.github.com/users/" + owner + "/repos?per_page=100&type=owner&sort=updated&page=" + page, { headers }, fetcher);
    if (!Array.isArray(result)) throw new Error("Invalid GitHub response");
    repositories.push(...result);
    if (result.length < 100) break;
    if (page === 4) truncated = true;
  }
  const publicRepos = repositories.filter(repo => !repo.private && !repo.archived);
  let workflows = null;
  try { workflows = await workflowRuns(env, fetcher); }
  catch { /* GitHub Actions failures must not discard verified repository data. */ }
  return {
    owner, repositoryCount: publicRepos.length, truncated,
    workflowRepository: workflows?.repository || env.GITHUB_ACTIONS_REPO || "Manager",
    workflowRuns: workflows?.runs ?? null,
    stars: sum(publicRepos, "stargazers_count"),
    openWorkItems: sum(publicRepos, "open_issues_count"),
    repositories: publicRepos.slice(0, 12).map(repo => ({
      name: String(repo.name || ""),
      description: String(repo.description || "").slice(0, 180),
      url: typeof repo.html_url === "string" && repo.html_url.startsWith("https://github.com/") ? repo.html_url : null,
      updatedAt: date(repo.pushed_at),
      language: repo.language || null,
      stars: Number(repo.stargazers_count || 0),
      openWorkItems: Number(repo.open_issues_count || 0),
    })),
  };
}
