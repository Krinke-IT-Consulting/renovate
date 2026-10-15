import { afterEach, describe, expect, it, vi } from "vitest";
import { closeDb, getPool } from "./client";

describe("getPool", () => {
  afterEach(async () => {
    await closeDb();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("ein Fehler auf einer Leerlauf-Verbindung beendet den Prozess nicht und loggt keine Werte", () => {
    // Fixture: erfundene Zugangsdaten, es wird nie verbunden.
    vi.stubEnv("DATABASE_URL", "postgresql://nutzer:fixture-geheimnis@localhost:1/db");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const pool = getPool();
    // Ohne Fehler-Handler am Pool würde emit("error") werfen (und im Betrieb den Prozess beenden).
    expect(() => pool.emit("error", new Error("Verbindung mit fixture-geheimnis verloren"))).not.toThrow();
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]?.[0])).not.toContain("geheimnis");
  });
});
