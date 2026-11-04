import test from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/api/overview.js";

test("overview endpoint rejects write methods", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const result = await onRequest({ request: new Request("https://manager.goreecloud.com/api/overview", { method }), env: {} });
    assert.equal(result.status, 405);
    assert.equal(result.headers.get("cache-control"), "private, no-store, max-age=0");
  }
});
