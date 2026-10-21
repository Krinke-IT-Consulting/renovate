import { afterEach, describe, expect, it, vi } from "vitest";

const GLOBAL_KEYS = [
  Symbol.for("dashboard.syncLoops"),
  Symbol.for("dashboard.githubAdapter"),
  Symbol.for("dashboard.rolloutService"),
];

describe("startSyncFromEnv: ungültiger GitHub-App-Schlüssel", () => {
  afterEach(() => {
    for (const key of GLOBAL_KEYS) delete (globalThis as Record<symbol, unknown>)[key];
    vi.unstubAllEnvs();
    vi.doUnmock("@/platform/github/adapter");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("loggt einen festen Text und startet nichts, nie die Rohmeldung", async () => {
    // Fixture-Werte, kein echter Schlüssel und keine echte Datenbank.
    const secret = "FIXTURE-SCHLUESSEL-INHALT";
    vi.stubEnv("DATABASE_URL", "postgresql://u:p@localhost:1/db");
    vi.stubEnv("RENOVATE_CE_API_URL", "http://ce.test:8080");
    vi.stubEnv("MEND_RNV_API_SERVER_SECRET", "fixture");
    vi.stubEnv("MEND_RNV_GITHUB_APP_ID", "1");
    vi.stubEnv("MEND_RNV_GITHUB_APP_KEY", secret);
    vi.stubEnv("AUTHELIA_INTERNAL_URL", "http://authelia.test:9091");
    vi.resetModules();
    // Der Adapter kommt aus der gemeinsamen Fabrik (platform/github/runtime.ts).
    vi.doMock("@/platform/github/adapter", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/platform/github/adapter")>();
      return {
        ...actual,
        GitHubAdapter: class {
          constructor() {
            throw new Error(`secretOrPrivateKey is invalid: ${secret}`);
          }
        },
      };
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const { startSyncFromEnv } = await import("./scheduler");
    expect(startSyncFromEnv()).toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
    const text = String(log.mock.calls[0]?.[0]);
    expect(text).toContain("GitHub-App nicht initialisierbar");
    expect(text).not.toContain(secret);
    expect(text).not.toContain("secretOrPrivateKey");
    const { closeDb } = await import("@/db/client");
    await closeDb();
  });
});
