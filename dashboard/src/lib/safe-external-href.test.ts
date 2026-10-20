import { describe, expect, it } from "vitest";
import { safeExternalHref } from "./safe-external-href";

describe("safeExternalHref", () => {
  it("lässt https-Adressen durch", () => {
    expect(safeExternalHref("https://github.com/o/r/pull/1")).toBe("https://github.com/o/r/pull/1");
  });

  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,<script>1</script>",
    "http://github.com/o/r",
    "//github.com/o/r",
    "/repos/o/r",
    "github.com/o/r",
    "",
    "   ",
  ])("verwirft %j", (url) => {
    expect(safeExternalHref(url)).toBeNull();
  });

  it("verwirft fehlende Werte", () => {
    expect(safeExternalHref(null)).toBeNull();
    expect(safeExternalHref(undefined)).toBeNull();
  });
});
