import { readJson } from "./http.js";

const statuses = new Set(["completed", "in_progress", "queued", "waiting", "requested", "pending", "action_required"]);
const conclusions = new Set(["success", "failure", "cancelled", "skipped", "timed_out", "neutral", "stale", "action_required", "startup_failure"]);

export async function workflowRuns(env, fetcher = fetch) {
  const owner = env.GITHUB_OWNER || "GoreeCloud";
  const repository = env.GITHUB_ACTIONS_REPO || "Manager";
  if (!/^[A-Za-z0-9-]{1,39}$/.test(owner) ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(repository)) {
    throw new Error("Invalid workflow repository");
  }
  const headers = { "X-GitHub-Api-Version": "2022-11-28" };
  if (env.GITHUB_READ_TOKEN) headers.Authorization = "Bearer " + env.GITHUB_READ_TOKEN;
  const data = await readJson(
    "https://api.github.com/repos/" + owner + "/" + repository + "/actions/runs?per_page=5",
    { headers }, fetcher,
  );
  if (!Array.isArray(data.workflow_runs)) throw new Error("Malformed workflow response");
  const date = value => {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  };
  return {
    repository,
    runs: data.workflow_runs.slice(0, 5).map(run => ({
      name: String(run.name || "Workflow").slice(0, 100),
      branch: String(run.head_branch || "").slice(0, 90),
      status: statuses.has(run.status) ? run.status : "unknown",
      conclusion: conclusions.has(run.conclusion) ? run.conclusion : null,
      updatedAt: date(run.updated_at),
      url: typeof run.html_url === "string" && /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/actions\/runs\/[0-9]+$/.test(run.html_url)
        ? run.html_url : null,
    })),
  };
}
