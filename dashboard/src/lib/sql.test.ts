import { describe, expect, it } from "vitest";
import { escapeLike, likePattern } from "./sql";

describe("sql", () => {
  it("maskiert %, _ und Backslash", () => {
    expect(escapeLike("a%b_c\\d")).toBe("a\\%b\\_c\\\\d");
    expect(escapeLike("plain")).toBe("plain");
  });

  it("baut ein Teilstring-Muster", () => {
    expect(likePattern("100%")).toBe("%100\\%%");
    expect(likePattern("kasse")).toBe("%kasse%");
  });
});
