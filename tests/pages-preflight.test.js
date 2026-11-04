import test from "node:test";
import assert from "node:assert/strict";
import { inspectPagesProjects, verifyPagesProject } from "../scripts/verify-pages-project.mjs";

test("Pages preflight recognizes only the correct Git-linked Manager repository", () => {
  const valid = [{ name: "goreecloud-manager", source: { type: "github", config: { owner: "GoreeCloud", repo_name: "Manager" } } }];
  assert.deepEqual(inspectPagesProjects(valid), { status: "git-linked", linked: true });
  assert.equal(inspectPagesProjects([{ name: "other" }]).status, "absent");
  assert.equal(inspectPagesProjects([{ name: "goreecloud-manager", source: null }]).status, "source-unverified");
  assert.equal(inspectPagesProjects([{ name: "goreecloud-manager", source: { type: "direct_upload" } }]).status, "direct-upload");
  assert.equal(inspectPagesProjects([{ name: "goreecloud-manager", source: { type: "github", config: { owner: "SomeoneElse", repo_name: "Manager" } } }]).status, "wrong-repository");
  assert.equal(inspectPagesProjects([{ name: "goreecloud-manager", source: { type: "gitlab" } }]).status, "wrong-provider");
  assert.throws(() => inspectPagesProjects({ somethingElse: [] }));
  assert.throws(() => inspectPagesProjects([], "../../bad"));
});

test("Pages CLI preflight is read-only and never returns raw account metadata", () => {
  let commands = [];
  const invoke = (command, args, options) => {
    commands = [command, ...args];
    assert.equal(options.encoding, "utf8");
    return {
      status: 0,
      stdout: JSON.stringify([{ name: "goreecloud-manager", source: { type: "github", config: { owner: "GoreeCloud", repo_name: "Manager", secret: "must-not-appear" } } }]),
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
