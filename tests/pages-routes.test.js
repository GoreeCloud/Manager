import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("All Manager static assets and API routes invoke Pages Functions middleware", () => {
  const routes = JSON.parse(readFileSync(new URL("../public/_routes.json", import.meta.url), "utf8"));
  assert.deepEqual(routes, {
    version: 1,
    include: ["/*"],
    exclude: [],
  }, "No paths may bypass the authorization middleware");
  // The sole root wildcard covers every current and future route without exclusions.
});
