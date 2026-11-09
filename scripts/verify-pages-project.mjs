import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { readJson } from "../lib/http.js";

const DEFAULT_PROJECT = "goreecloud-manager";

export function inspectPagesProjects(payload, target = DEFAULT_PROJECT) {
  if (!/^[a-z0-9-]{1,63}$/.test(target)) throw new Error("Invalid Pages project name");
  const projects = Array.isArray(payload) ? payload
    : Array.isArray(payload?.result) ? payload.result
    : Array.isArray(payload?.projects) ? payload.projects : null;
  if (!projects) throw new Error("Unexpected Wrangler project response");
  const matches = projects.filter(p => p && p.name === target);
  if (matches.length === 0) return { status: "absent", linked: false };
  if (matches.length !== 1) return { status: "unverified", linked: false };
  const project = matches[0];
  const sourceType = project.source?.type;
  if (sourceType === "github") {
    const config = project.source?.config;
    if (config?.owner !== "GoreeCloud" || config?.repo_name !== "Manager") {
      return { status: "wrong-repository", linked: false };
    }
    const branch = project.production_branch || config?.production_branch;
    if (branch !== "main") return { status: "branch-unverified", linked: false };
    return { status: "git-linked", linked: true };
  }
  if (sourceType === "gitlab") return { status: "wrong-provider", linked: false };
  if (sourceType === "direct_upload") return { status: "direct-upload", linked: false };
  return { status: "source-unverified", linked: false };
}

/** Read-only CLI inventory. Wrangler may omit source metadata from list output. */
export function verifyPagesProject({ env = process.env, invoke = spawnSync } = {}) {
  const executable = env.WRANGLER_BIN || "wrangler";
  const project = env.PAGES_PROJECT_NAME || DEFAULT_PROJECT;
  if (project !== DEFAULT_PROJECT) throw new Error("Unexpected Manager Pages project");
  const run = invoke(executable, ["pages", "project", "list", "--json"], {
    encoding: "utf8", timeout: 15_000, maxBuffer: 1_000_000, windowsHide: true,
  });
  if (run.error || run.status !== 0) return { status: "cli-unavailable", linked: false };
  let list;
  try { list = JSON.parse(run.stdout); }
  catch { return { status: "response-unverified", linked: false }; }
  return inspectPagesProjects(list, project);
}

/**
 * Optional, read-only Pages:Read API inspection when the CLI confirms the
 * project exists but omits the Git source. Only fixed HTTPS GET is permitted.
 * No account details, API token, or raw response leave this function.
 */
export async function verifyPagesProjectWithApi({
  env = process.env, invoke = spawnSync, fetcher = fetch,
} = {}) {
  const result = verifyPagesProject({ env, invoke });
  if (result.status !== "source-unverified") return result;

  if (!env.CF_ACCOUNT_ID || !env.CF_PAGES_READ_TOKEN) return result;
  if (!/^[a-f0-9]{32}$/i.test(env.CF_ACCOUNT_ID) ||
      typeof env.CF_PAGES_READ_TOKEN !== "string" ||
      !env.CF_PAGES_READ_TOKEN.trim()) {
    return { status: "api-config-unverified", linked: false };
  }
  const url = "https://api.cloudflare.com/client/v4/accounts/" + env.CF_ACCOUNT_ID +
    "/pages/projects/" + DEFAULT_PROJECT;
  try {
    const payload = await readJson(url, {
      headers: { Authorization: "Bearer " + env.CF_PAGES_READ_TOKEN },
    }, fetcher);
    if (payload?.success !== true || !payload.result ||
        typeof payload.result !== "object" ||
        payload.result.name !== DEFAULT_PROJECT) {
      return { status: "api-response-unverified", linked: false };
    }
    return inspectPagesProjects([payload.result]);
  } catch {
    return { status: "api-unavailable", linked: false };
  }
}

export async function main() {
  let result;
  try { result = await verifyPagesProjectWithApi(); }
  catch { result = { status: "response-unverified", linked: false }; }
  console.log("GoreeCloud Manager Pages preflight: " + result.status);
  if (!result.linked) {
    console.error("NOT READY: verify an authorized Git-linked Pages project; no changes were made");
    return 1;
  }
  console.log("GitHub source and main branch match GoreeCloud/Manager; Access, DNS and deployments still require separate verification");
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }, () => { process.exitCode = 1; });
}
