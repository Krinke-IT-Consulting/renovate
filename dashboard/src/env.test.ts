import { describe, expect, it } from "vitest";
import { EnvError, parseEnv } from "./env";

// Platzhalter, keine echten Werte.
const valid = {
  DATABASE_URL: "postgresql://user:pw@localhost:5432/db",
  RENOVATE_CE_API_URL: "http://renovate-ce:8080",
  MEND_RNV_API_SERVER_SECRET: "test-api-secret",
  MEND_RNV_GITHUB_APP_ID: "12345",
  MEND_RNV_GITHUB_APP_KEY: "test-app-key",
  AUTHELIA_INTERNAL_URL: "http://renovate-authelia:9091",
};

function catchError(fn: () => unknown): EnvError {
  try {
    fn();
  } catch (e) {
    return e as EnvError;
  }
  throw new Error("Es wurde kein Fehler geworfen");
}

describe("parseEnv", () => {
  it("akzeptiert vollständige Konfiguration", () => {
    expect(parseEnv(valid).AUTHELIA_INTERNAL_URL).toBe("http://renovate-authelia:9091");
  });

  it("bricht bei fehlendem Wert mit dem Namen ab", () => {
    const { MEND_RNV_GITHUB_APP_KEY: _omit, ...rest } = valid;
    void _omit;
    const error = catchError(() => parseEnv(rest));
    expect(error).toBeInstanceOf(EnvError);
    expect(error.message).toContain("MEND_RNV_GITHUB_APP_KEY");
    expect(error.names).toEqual(["MEND_RNV_GITHUB_APP_KEY"]);
  });

  it("behandelt leere Werte wie fehlende", () => {
    const error = catchError(() => parseEnv({ ...valid, AUTHELIA_INTERNAL_URL: "  " }));
    expect(error.names).toEqual(["AUTHELIA_INTERNAL_URL"]);
  });

  it("verlangt für AUTHELIA_INTERNAL_URL eine http(s)-URL", () => {
    const error = catchError(() => parseEnv({ ...valid, AUTHELIA_INTERNAL_URL: "renovate-authelia:9091" }));
    expect(error.names).toEqual(["AUTHELIA_INTERNAL_URL"]);
  });

  it("gibt bei ungültigen Werten keinen Wert aus", () => {
    const secretish = "geheimer-wert-der-nicht-erscheinen-darf";
    const error = catchError(() =>
      parseEnv({ ...valid, DATABASE_URL: secretish, MEND_RNV_API_SERVER_SECRET: "" }),
    );
    expect(error.names).toEqual(["DATABASE_URL", "MEND_RNV_API_SERVER_SECRET"]);
    const output = `${error.message}\n${error.stack ?? ""}\n${JSON.stringify(error)}`;
    expect(output).not.toContain(secretish);
    for (const value of Object.values(valid)) {
      expect(output).not.toContain(value);
    }
  });

  it("prüft mit keys nur die genannten Variablen", () => {
    expect(parseEnv({ AUTHELIA_INTERNAL_URL: "http://a:1" }, ["AUTHELIA_INTERNAL_URL"])).toEqual({
      AUTHELIA_INTERNAL_URL: "http://a:1",
    });
    const error = catchError(() => parseEnv({}, ["DATABASE_URL"]));
    expect(error.names).toEqual(["DATABASE_URL"]);
  });
});
