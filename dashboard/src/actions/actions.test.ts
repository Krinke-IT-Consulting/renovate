import { beforeEach, describe, expect, it, vi } from "vitest";

const headerValues = new Map<string, string>();
vi.mock("next/headers", () => ({
  headers: async () => ({ get: (name: string) => headerValues.get(name) ?? null }),
}));

import { requireActor } from "./context";
import { ActionError, FALLBACK_ERROR, runAction } from "./result";

describe("requireActor", () => {
  beforeEach(() => headerValues.clear());

  it("liest den Nutzer aus x-dashboard-user und kürzt ihn", async () => {
    headerValues.set("x-dashboard-user", `  ${"a".repeat(80)} `);
    expect(await requireActor()).toBe("a".repeat(64));
  });

  it("lehnt die Aktion ohne Nutzer ab", async () => {
    await expect(requireActor()).rejects.toBeInstanceOf(ActionError);
    headerValues.set("x-dashboard-user", "   ");
    await expect(requireActor()).rejects.toBeInstanceOf(ActionError);
  });
});

describe("runAction", () => {
  it("gibt das Ergebnis weiter", async () => {
    expect(await runAction(async () => ({ status: "idle" }))).toEqual({ status: "idle" });
  });

  it("zeigt ActionError-Texte als Fehlermeldung", async () => {
    const state = await runAction(async () => {
      throw new ActionError("Unbekanntes Repo.");
    });
    expect(state).toEqual({ status: "error", message: "Unbekanntes Repo." });
  });

  it("zeigt bei allen anderen Fehlern nur die feste Meldung, nie den Text des Fehlers", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const state = await runAction(async () => {
      throw new Error("Bearer geheim-123 abgelehnt");
    });
    expect(state).toEqual({ status: "error", message: FALLBACK_ERROR });
    expect(JSON.stringify(spy.mock.calls)).not.toContain("geheim-123");
    spy.mockRestore();
  });
});
