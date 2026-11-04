import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export function inspectPagesProjects(payload, target = "goreecloud-manager") {
  if (!/^[a-z0-9-]{1,63}$/.test(target)) throw new Error("Invalid Pages project name");
  const projects = Array.isArray(payload) ? payload
    : Array.isArray(payload?.result) ? payload.result
    : Array.isArray(payload?.projects) ? payload.projects : null;
  if (!projects) throw new Error("Unexpected Wrangler project response");
  const matches = projects.filter(p => p && p.name === target);
  if (matches.length === 0) return { status: "absent", linked: false };
  if (matches.length !== 1) return { status: "unverified", linked: false };
  const sourceType = matches[0].source?.type;
  if (sourceType === "github") {
    const config = matches[0].source?.config;
    const owner = config?.owner;
    const repo = config?.repo_name;
    if (owner === "GoreeCloud" && repo === "Manager") return { status: "git-linked", linked: true };
    return { status: "wrong-repository", linked: false };
  }
  if (sourceType === "gitlab") return { status: "wrong-provider", linked: false };
  if (sourceType === "direct_upload") return { status: "direct-upload", linked: false };
  return { status: "source-unverified", linked: false };
}

export function verifyPagesProject({ env = process.env, invoke = spawnSync } = {}) {
  const executable = env.WRANGLER_BIN || "wrangler";
  const project = env.PAGES_PROJECT_NAME || "goreecloud-manager";
  if (!/^[a-z0-9-]{1,63}$/.test(project)) throw new Error("Invalid Pages project name");

  const run = invoke(executable, ["pages", "project", "list", "--json"], {
    encoding: "utf8", timeout: 15_000, maxBuffer: 1_000_000,
    windowsHide: true,
  });
  if (run.error || run.status !== 0) {
    return { status: "cli-unavailable", linked: false };
  }
  let list;
  try { list = JSON.parse(run.stdout); }
  catch { return { status: "response-unverified", linked: false }; }
  return inspectPagesProjects(list, project);
}

export function main() {
  let result;
  try { result = verifyPagesProject(); }
  catch { result = { status: "response-unverified", linked: false }; }
  console.log("GoreeCloud Manager Pages preflight: " + result.status);
  if (!result.linked) {
    console.error("NOT READY: verify an authorized Git-linked Pages project; no changes were made");
    return 1;
  }
  console.log("Git integration metadata matches GoreeCloud/Manager; Access, DNS and deployment still require independent verification");
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
