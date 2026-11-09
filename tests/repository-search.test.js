import test from "node:test";
import assert from "node:assert/strict";
import { filterRepositories } from "../public/filter.js";

const repos = [
  { name: "Manager", language: "JavaScript" },
  { name: "Wardveil", language: "TypeScript" },
  { name: "GoreeCloud-Mesh", language: "Python" },
  { name: "design-system", language: null },
];

test("Local repository search filters by case-insensitive name or language", () => {
  assert.deepEqual(filterRepositories(repos, " manager ").map(r => r.name), ["Manager"]);
  assert.deepEqual(filterRepositories(repos, "script").map(r => r.name), ["Manager", "Wardveil"]);
  assert.deepEqual(filterRepositories(repos, "PYTHON").map(r => r.name), ["GoreeCloud-Mesh"]);
  assert.deepEqual(filterRepositories(repos, "").map(r => r.name), repos.map(r => r.name));
});

test("Repository filters are literal, bounded, and tolerate malformed data", () => {
  assert.deepEqual(filterRepositories(repos, "<script>"), []);
  assert.deepEqual(filterRepositories(repos, "missing-repo"), []);
  assert.deepEqual(filterRepositories(undefined, "Manager"), []);
  assert.deepEqual(filterRepositories([null, {}, { name: "Manager" }], "manager"), [{ name: "Manager" }]);
  assert.deepEqual(filterRepositories(repos, "m".repeat(200)), []);
});

test("Filtering never mutates the verified provider snapshot", () => {
  const before = JSON.stringify(repos);
  filterRepositories(repos, "javascript");
  assert.equal(JSON.stringify(repos), before);
});

test("GitHub provider returns the complete bounded public inventory for local search", async () => {
  const { github } = await import("../lib/github.js");
  const records = Array.from({ length: 28 }, (_, i) => ({
    name: "repo-" + String(i).padStart(2, "0"),
    private: false, archived: false, language: i % 2 ? "JavaScript" : "Python",
    stargazers_count: 1, open_issues_count: 0,
    pushed_at: "2026-11-08T15:00:00Z",
    html_url: "https://github.com/GoreeCloud/repo-" + String(i).padStart(2, "0"),
    secret_from_untrusted_api: "must never reach the browser",
  }));
  records.push({ name: "hidden", private: true, archived: false, html_url: "https://github.com/GoreeCloud/hidden" });
  records.push({ name: "old", private: false, archived: true, html_url: "https://github.com/GoreeCloud/old" });
  const response = await github({ GITHUB_OWNER: "GoreeCloud" }, async url => {
    assert.match(url, /https:\/\/api.github.com\/users\/GoreeCloud\/repos\?/);
    return new Response(JSON.stringify(records), { headers: { "content-type": "application/json" } });
  });
  assert.equal(response.repositoryCount, 28);
  assert.equal(response.repositories.length, 28, "GitHub page must be able to search beyond the first 12");
  assert.equal(response.repositories[27].name, "repo-27");
  assert.equal(response.truncated, false);
  const exported = JSON.stringify(response);
  assert.ok(!exported.includes("secret_from_untrusted_api"));
  assert.ok(!exported.includes("must never reach the browser"));
  assert.ok(!exported.includes("/hidden"));
  assert.ok(!exported.includes("/old"));
});
