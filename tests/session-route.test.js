import test from "node:test";
import assert from "node:assert/strict";
import { onRequest as session } from "../functions/api/session.js";
import { onRequest as root } from "../functions/_middleware.js";

test("Session endpoint returns no identifying viewer data", async () => {
  const request = new Request("https://manager.goreecloud.com/api/session");
  const result = await session({ request, data: {
    viewer: { sub: "private-id", email: "private@example.com", metadata: "secret" },
  } });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { authenticated: true });
  assert.equal(result.headers.get("cache-control"), "private, no-store, max-age=0");
});

test("Session endpoint is GET-only and denies requests without verified middleware", async () => {
  const url = "https://manager.goreecloud.com/api/session";
  assert.equal((await session({ request: new Request(url), data: {} })).status, 401);
  assert.equal((await session({
    request: new Request(url, { method: "POST" }),
    data: { viewer: { sub: "test" } },
  })).status, 405);
});

test("Root site authentication still rejects anonymous session checks", async () => {
  const result = await root({
    request: new Request("https://manager.goreecloud.com/api/session"),
    env: {}, data: {},
    next: () => { throw new Error("Anonymous route incorrectly reached"); },
  });
  assert.equal(result.status, 401);
});
