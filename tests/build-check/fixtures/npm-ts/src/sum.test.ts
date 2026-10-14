import assert from "node:assert/strict";
import { test } from "node:test";
import { sum } from "./sum.js";

test("sum addiert", () => {
  assert.equal(sum(1, 2), 3);
});
