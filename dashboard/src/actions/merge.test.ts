import { beforeEach, describe, expect, it, vi } from "vitest";

const headerValues = new Map<string, string>();
vi.mock("next/headers", () => ({
  headers: async () => ({ get: (name: string) => headerValues.get(name) ?? null }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: () => ({ fake: "db" }) }));
vi.mock("@/merge/runtime", () => ({ getMergePlatform: () => ({ fake: "platform" }) }));

const mergeOne = vi.fn();
const mergeAll = vi.fn();
vi.mock("./core/merge", async (importActual) => ({
  ...(await importActual<typeof import("./core/merge")>()),
  mergePullRequestCore: (...args: unknown[]) => mergeOne(...args),
  mergeAllGreenCore: (...args: unknown[]) => mergeAll(...args),
}));

import { BULK_MERGE_LIMIT, type MergeTarget } from "@/merge/types";
import { mergeAllGreen, mergePullRequest } from "./merge";

const ID = "7f1c2d3e-4a5b-4c6d-8e7f-0123456789ab";
const target: MergeTarget = { pullRequestId: ID, expectedSha: "a".repeat(40), expectedMethod: "squash" };
const bad = (over: Record<string, unknown>) => ({ ...target, ...over }) as unknown as MergeTarget;

describe("Server Actions zum Mergen (Hüllen)", () => {
  beforeEach(() => {
    headerValues.clear();
    headerValues.set("x-dashboard-user", "sascha");
    mergeOne.mockReset();
    mergeAll.mockReset();
  });

  describe("mergePullRequest", () => {
    it("ohne Sitzung: Fehlermeldung, der Kern wird nicht aufgerufen", async () => {
      headerValues.clear();
      const state = await mergePullRequest(target);
      expect(state).toMatchObject({ status: "error", message: "Die Aktion braucht einen angemeldeten Nutzer." });
      expect(mergeOne).not.toHaveBeenCalled();
    });

    it.each([
      ["keine UUID", { pullRequestId: "nicht-eine-uuid" }],
      ["SHA ungültig", { expectedSha: "xyz" }],
      ["SHA zu kurz", { expectedSha: "abc12" }],
      ["Methode ungültig", { expectedMethod: "fast-forward" }],
    ])("%s: lehnt ab, ohne den Kern aufzurufen", async (_name, over) => {
      const state = await mergePullRequest(bad(over));
      expect(state).toEqual({ status: "error", message: "Ungültige Angaben zum Pull Request." });
      expect(mergeOne).not.toHaveBeenCalled();
    });

    it("gültig: ruft den Kern mit Ziel und Nutzer auf und übersetzt das Ergebnis", async () => {
      mergeOne.mockResolvedValue({ status: "merged", prUrl: "https://example.test/pr/1", prNumber: 1, repoFullName: "o/a" });
      const state = await mergePullRequest(target);
      expect(mergeOne).toHaveBeenCalledWith(
        { db: { fake: "db" }, platform: { fake: "platform" } },
        { ...target, actor: "sascha" },
      );
      expect(state).toMatchObject({ status: "done", tone: "erfolg" });
    });
  });

  describe("mergeAllGreen", () => {
    it("ohne Sitzung: Fehlermeldung", async () => {
      headerValues.clear();
      expect(await mergeAllGreen([target])).toMatchObject({ status: "error" });
      expect(mergeAll).not.toHaveBeenCalled();
    });

    it("ungültiges Ziel in der Liste: lehnt die ganze Liste ab", async () => {
      for (const over of [{ pullRequestId: "x" }, { expectedSha: "zz" }, { expectedMethod: "ff" }]) {
        const state = await mergeAllGreen([target, bad(over)]);
        expect(state).toEqual({ status: "error", message: "Ungültige Angaben zu den Pull Requests." });
      }
      expect(mergeAll).not.toHaveBeenCalled();
    });

    it("zu viele Ziele: genau an der Grenze der Prüfung (5 x Limit) ist Schluss", async () => {
      mergeAll.mockResolvedValue({ outcomes: [], ignored: 0, notAttempted: 0, stopped: null, pauseResetAt: null });
      const many = (n: number) => Array.from({ length: n }, () => target);
      expect(await mergeAllGreen(many(BULK_MERGE_LIMIT * 5 + 1))).toEqual({
        status: "error",
        message: "Ungültige Angaben zu den Pull Requests.",
      });
      expect(mergeAll).not.toHaveBeenCalled();
      expect(await mergeAllGreen(many(BULK_MERGE_LIMIT * 5))).toMatchObject({ status: "done" });
      expect(mergeAll).toHaveBeenCalledTimes(1);
    });
  });
});
