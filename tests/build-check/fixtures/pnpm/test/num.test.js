const assert = require("node:assert/strict");
const { test } = require("node:test");
const isNumber = require("is-number");

test("is-number erkennt Zahlen", () => {
  assert.equal(isNumber(5), true);
  assert.equal(isNumber("x"), false);
});
