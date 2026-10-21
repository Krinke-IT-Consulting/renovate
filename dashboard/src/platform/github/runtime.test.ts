import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const GLOBAL_KEYS = [Symbol.for("dashboard.githubAdapter"), Symbol.for("dashboard.rolloutService")];

describe("gemeinsame Instanzen je Prozess", () => {
  afterEach(async () => {
    for (const key of GLOBAL_KEYS) delete (globalThis as Record<symbol, unknown>)[key];
    vi.unstubAllEnvs();
    vi.resetModules();
    const { closeDb } = await import("@/db/client");
    await closeDb();
  });

  it("Server Actions und Scheduler bekommen denselben Adapter und denselben Rollout-Service", async () => {
    // Wegwerf-Schlüssel, nur für diesen Test erzeugt; Datenbank wird nie verbunden.
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    vi.stubEnv("DATABASE_URL", "postgresql://u:p@localhost:1/db");
    vi.stubEnv("RENOVATE_CE_API_URL", "http://ce.test:8080");
    vi.stubEnv("MEND_RNV_API_SERVER_SECRET", "fixture");
    vi.stubEnv("MEND_RNV_GITHUB_APP_ID", "1");
    vi.stubEnv("MEND_RNV_GITHUB_APP_KEY", privateKey);
    vi.stubEnv("AUTHELIA_INTERNAL_URL", "http://authelia.test:9091");
    vi.resetModules();

    const { getGitHubAdapter } = await import("./runtime");
    const { getRolloutService } = await import("@/rollout/runtime");
    expect(getGitHubAdapter()).toBe(getGitHubAdapter());
    expect(getRolloutService()).toBe(getRolloutService());

    // Auch über ein zweites Bundle hinweg (neu geladene Module): globalThis hält die Instanz.
    const first = getGitHubAdapter();
    vi.resetModules();
    const again = await import("./runtime");
    expect(again.getGitHubAdapter()).toBe(first);
  });
});
