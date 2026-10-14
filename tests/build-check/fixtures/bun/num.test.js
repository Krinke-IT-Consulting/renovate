import { expect, test } from "bun:test";
import isNumber from "is-number";

test("is-number erkennt Zahlen", () => {
  expect(isNumber(5)).toBe(true);
  expect(isNumber("x")).toBe(false);
});
