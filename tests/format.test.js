import test from "node:test";
import assert from "node:assert/strict";
import { money } from "../public/format.js";

test("USD formatting preserves sub-cent OpenRouter usage", () => {
  assert.equal(money(0.000001), "$0.000001");
  assert.equal(money(0.0049), "$0.0049");
  assert.equal(money(0.123456), "$0.123456");
  assert.equal(money(0), "$0.00");
  assert.equal(money(1.23), "$1.23");
  assert.equal(money(1000.12), "$1,000.12");
});

test("Missing or malformed amounts are never presented as actual zero", () => {
  for (const invalid of [undefined, null, "0", Number.NaN, Infinity, -Infinity, {}]) {
    assert.equal(money(invalid), "—");
  }
  assert.notEqual(money(0.000001), money(0));
});
