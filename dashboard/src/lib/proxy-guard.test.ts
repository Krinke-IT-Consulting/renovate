import { describe, expect, it } from "vitest";
import { decideAccess, safeEqual } from "./proxy-guard";

const base = {
  method: "GET",
  pathname: "/",
  proxySecret: null,
  remoteUser: null,
  expectedSecret: "test-secret",
};

describe("decideAccess", () => {
  it("weist ohne Secret ab (403), auch mit Remote-User", () => {
    expect(decideAccess({ ...base, remoteUser: "admin" })).toEqual({ allow: false, reason: "secret" });
  });

  it("weist ein falsches Secret ab", () => {
    expect(decideAccess({ ...base, proxySecret: "falsch", remoteUser: "admin" })).toEqual({
      allow: false,
      reason: "secret",
    });
  });

  it("weist mit Secret, aber ohne Remote-User ab (403)", () => {
    expect(decideAccess({ ...base, proxySecret: "test-secret" })).toEqual({
      allow: false,
      reason: "user",
    });
    expect(decideAccess({ ...base, proxySecret: "test-secret", remoteUser: "  " })).toEqual({
      allow: false,
      reason: "user",
    });
  });

  it("lässt mit Secret und Remote-User durch", () => {
    expect(decideAccess({ ...base, proxySecret: "test-secret", remoteUser: "admin" })).toEqual({
      allow: true,
    });
  });

  it("weist ab, wenn kein Secret konfiguriert ist (fail closed)", () => {
    expect(
      decideAccess({ ...base, expectedSecret: undefined, proxySecret: "", remoteUser: "admin" }),
    ).toEqual({ allow: false, reason: "secret" });
  });

  it("nimmt nur GET /api/health aus", () => {
    expect(decideAccess({ ...base, pathname: "/api/health" })).toEqual({ allow: true });
    expect(decideAccess({ ...base, pathname: "/api/health", method: "POST" }).allow).toBe(false);
    expect(decideAccess({ ...base, pathname: "/api/health/x" }).allow).toBe(false);
  });
});

describe("safeEqual", () => {
  it("vergleicht Werte unterschiedlicher Länge ohne Fehler", () => {
    expect(safeEqual("a", "abc")).toBe(false);
    expect(safeEqual("abc", "abc")).toBe(true);
  });
});
