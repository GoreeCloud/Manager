import test from "node:test";
import assert from "node:assert/strict";
import { inspectPagesProjects, verifyPagesProject, verifyPagesProjectWithApi } from "../scripts/verify-pages-project.mjs";

test("Pages preflight recognizes only the correct Git-linked Manager repository", () => {
  const valid = [{ name: "goreecloud-manager", production_branch: "main", source: { type: "github", config: { owner: "GoreeCloud", repo_name: "Manager" } } }];
  assert.deepEqual(inspectPagesProjects(valid), { status: "git-linked", linked: true });
  assert.equal(inspectPagesProjects([{ name: "other" }]).status, "absent");
  assert.equal(inspectPagesProjects([{ name: "goreecloud-manager", source: null }]).status, "source-unverified");
  assert.equal(inspectPagesProjects([{ name: "goreecloud-manager", source: { type: "direct_upload" } }]).status, "direct-upload");
  assert.equal(inspectPagesProjects([{ name: "goreecloud-manager", source: { type: "github", config: { owner: "SomeoneElse", repo_name: "Manager" } } }]).status, "wrong-repository");
  assert.equal(inspectPagesProjects([{ name: "goreecloud-manager", source: { type: "gitlab" } }]).status, "wrong-provider");
  assert.throws(() => inspectPagesProjects({ somethingElse: [] }));
  assert.throws(() => inspectPagesProjects([], "../../bad"));
  assert.equal(inspectPagesProjects([{ name: "goreecloud-manager", production_branch: "develop", source: { type: "github", config: { owner: "GoreeCloud", repo_name: "Manager" } } }]).status, "branch-unverified");
});

test("Pages CLI preflight is read-only and never returns raw account metadata", () => {
  let commands = [];
  const invoke = (command, args, options) => {
    commands = [command, ...args];
    assert.equal(options.encoding, "utf8");
    return {
      status: 0,
      stdout: JSON.stringify([{ name: "goreecloud-manager", production_branch: "main", source: { type: "github", config: { owner: "GoreeCloud", repo_name: "Manager", secret: "must-not-appear" } } }]),
    };
  };
  const result = verifyPagesProject({ env: { WRANGLER_BIN: "wrangler" }, invoke });
  assert.deepEqual(commands, ["wrangler", "pages", "project", "list", "--json"]);
  assert.deepEqual(result, { status: "git-linked", linked: true });
  assert.equal(JSON.stringify(result).includes("must-not-appear"), false);
});

test("Pages preflight fails closed if the authorized CLI is unavailable", () => {
  assert.equal(verifyPagesProject({ env: {}, invoke: () => ({ status: 1, stdout: "", stderr: "secret" }) }).status, "cli-unavailable");
  assert.equal(verifyPagesProject({ env: {}, invoke: () => ({ status: 0, stdout: "not json" }) }).status, "response-unverified");
  assert.equal(verifyPagesProject({ env: {}, invoke: () => ({ error: new Error("not installed") }) }).status, "cli-unavailable");
});

test("CLI missing Git metadata may be verified via fixed, read-only Cloudflare Pages API", async () => {
  const env = { WRANGLER_BIN: "wrangler", CF_ACCOUNT_ID: "a".repeat(32), CF_PAGES_READ_TOKEN: "secret-read-token" };
  const invoke = (bin, args) => {
    assert.deepEqual([bin, ...args], ["wrangler", "pages", "project", "list", "--json"]);
    return { status: 0, stdout: JSON.stringify([{ name: "goreecloud-manager" }]) };
  };
  let requests = 0;
  const fetcher = async (url, options) => {
    requests++;
    assert.equal(url, "https://api.cloudflare.com/client/v4/accounts/" + "a".repeat(32) + "/pages/projects/goreecloud-manager");
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, "Bearer secret-read-token");
    return new Response(JSON.stringify({ success: true, result: {
      name: "goreecloud-manager", production_branch: "main",
      source: { type: "github", config: { owner: "GoreeCloud", repo_name: "Manager" } },
    } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await verifyPagesProjectWithApi({ env, invoke, fetcher });
  assert.equal(requests, 1);
  assert.deepEqual(result, { status: "git-linked", linked: true });
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("Pages preflight stays inconclusive if CLI omits source and no read token exists", async () => {
  const invoke = () => ({ status: 0, stdout: JSON.stringify([{ name: "goreecloud-manager" }]) });
  let requests = 0;
  const result = await verifyPagesProjectWithApi({
    env: { WRANGLER_BIN: "wrangler" }, invoke,
    fetcher: () => { requests++; throw new Error("Unexpected external request"); },
  });
  assert.equal(result.status, "source-unverified");
  assert.equal(result.linked, false);
  assert.equal(requests, 0);
});

test("Pages preflight fails closed for wrong source branch or invalid account config", async () => {
  const invoke = () => ({ status: 0, stdout: JSON.stringify([{ name: "goreecloud-manager" }]) });
  let apiReads = 0;
  const fetcher = async () => {
    apiReads++;
    return new Response(JSON.stringify({ success: true, result: {
      name: "goreecloud-manager", production_branch: "staging",
      source: { type: "github", config: { owner: "GoreeCloud", repo_name: "Manager" } },
    } }), { headers: { "content-type": "application/json" } });
  };
  const env = { CF_ACCOUNT_ID: "a".repeat(32), CF_PAGES_READ_TOKEN: "dummy" };
  const wrongBranch = await verifyPagesProjectWithApi({ env, invoke, fetcher });
  assert.deepEqual(wrongBranch, { status: "branch-unverified", linked: false });
  const wrongAccount = await verifyPagesProjectWithApi({
    env: { CF_ACCOUNT_ID: "not-an-account-id", CF_PAGES_READ_TOKEN: "dummy" },
    invoke, fetcher,
  });
  assert.deepEqual(wrongAccount, { status: "api-config-unverified", linked: false });
  assert.equal(apiReads, 1);
});

test("Pages preflight does not expose provider errors or contact APIs for absent projects", async () => {
  const env = { CF_ACCOUNT_ID: "a".repeat(32), CF_PAGES_READ_TOKEN: "redacted-provider-token" };
  let fetched = 0;
  const fetchedOnlyIfPresent = () => { fetched++; throw new Error("Unexpected provider request"); };
  const absent = await verifyPagesProjectWithApi({
    env,
    invoke: () => ({ status: 0, stdout: JSON.stringify([{ name: "different" }]) }),
    fetcher: fetchedOnlyIfPresent,
  });
  assert.deepEqual(absent, { status: "absent", linked: false });
  assert.equal(fetched, 0);

  const failed = await verifyPagesProjectWithApi({
    env,
    invoke: () => ({ status: 0, stdout: JSON.stringify([{ name: "goreecloud-manager" }]) }),
    fetcher: async () => new Response(JSON.stringify({ error: "private account data" }), {
      status: 403, headers: { "content-type": "application/json" },
    }),
  });
  assert.deepEqual(failed, { status: "api-unavailable", linked: false });
  assert.equal(JSON.stringify(failed).includes("redacted-provider-token"), false);
  assert.equal(JSON.stringify(failed).includes("private account data"), false);
});

test("Pages preflight refuses alternate project-name overrides", () => {
  assert.throws(() => verifyPagesProject({
    env: { PAGES_PROJECT_NAME: "unrelated-pages-project" },
    invoke: () => ({ status: 0, stdout: "[]" }),
  }));
});
