import test from "node:test";
import assert from "node:assert/strict";
import { workflowRuns } from "../lib/workflows.js";
import { github } from "../lib/github.js";

const ok = data => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });

test("GitHub Actions returns a bounded, sanitized five-run activity list", async () => {
  const items = Array.from({ length: 8 }, (_, index) => ({
    name: index === 0 ? "<script>alert(1)</script>" : "CI",
    head_branch: "main", status: "completed", conclusion: "success",
    html_url: "https://github.com/GoreeCloud/Manager/actions/runs/" + (1000 + index),
    updated_at: "2026-11-04T12:00:00Z",
    secret: "never-expose",
  }));
  const result = await workflowRuns({ GITHUB_OWNER: "GoreeCloud" }, async (url, options) => {
    assert.match(url, /\/repos\/GoreeCloud\/Manager\/actions\/runs\?per_page=5$/);
    assert.equal(options.headers.Authorization, undefined);
    return ok({ total_count: 8, workflow_runs: items });
  });
  assert.equal(result.repository, "Manager");
  assert.equal(result.runs.length, 5);
  assert.equal(result.runs[0].name, "<script>alert(1)</script>");
  assert.ok(!JSON.stringify(result).includes("never-expose"));
});
test("GitHub Actions rejects malformed repository paths", async () => {
  await assert.rejects(() => workflowRuns({ GITHUB_ACTIONS_REPO: "../private" }, async () => ok({ workflow_runs: [] })));
});
test("GitHub Actions masks unsafe links and unknown provider states", async () => {
  const result = await workflowRuns({}, async () => ok({ workflow_runs: [
    { name:"sample", status:"bogus", conclusion:"imaginary", html_url:"https://example.com/steal", head_branch:"main" },
  ] }));
  assert.equal(result.runs[0].url, null);
  assert.equal(result.runs[0].status, "unknown");
  assert.equal(result.runs[0].conclusion, null);
});
test("GitHub repository metrics remain available when Actions API fails", async () => {
  const result = await github({ GITHUB_OWNER: "GoreeCloud" }, async url => {
    if (url.includes("/actions/runs?")) return new Response("no", { status: 403 });
    return ok([{ name: "Manager", private: false, archived: false, stargazers_count: 1, open_issues_count: 0 }]);
  });
  assert.equal(result.repositoryCount, 1);
  assert.equal(result.workflowRuns, null);
});

test("GitHub Actions never queries repositories absent from verified public inventory", async () => {
  let workflowsRequested = 0;
  const data = await github({ GITHUB_OWNER:"GoreeCloud", GITHUB_ACTIONS_REPO:"SecretRepo", GITHUB_READ_TOKEN:"in-memory-test" }, async url => {
    if (url.includes("/actions/runs?")) {
      workflowsRequested++;
      throw new Error("private Actions metadata must not be queried");
    }
    return ok([
      {name:"Manager",private:false,archived:false,stargazers_count:1,open_issues_count:0},
      {name:"SecretRepo",private:true,archived:false,stargazers_count:0,open_issues_count:0}
    ]);
  });
  assert.equal(data.repositoryCount,1);
  assert.equal(workflowsRequested,0);
  assert.equal(data.workflowRuns,null);
});
