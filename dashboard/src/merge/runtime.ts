import type { MergePlatform } from "@/actions/core/merge";
import { ActionError } from "@/actions/result";
import { createE2eFakeAdapter, e2eFakePlatformEnabled } from "@/rollout/e2e-fake-adapter";
import { getGitHubAdapter } from "@/platform/github/runtime";

const GLOBAL_KEY = Symbol.for("dashboard.mergePlatform");

/**
 * Plattform für die Merge-Aktionen: im Betrieb die eine `GitHubAdapter`-Instanz je Prozess (damit
 * Kontingent-Pause und Token-Cache mit dem Abgleich geteilt werden), im E2E der Plattform-Ersatz
 * (siehe rollout/e2e-fake-adapter.ts), sofern er die Merge-Methoden anbietet. Träge: Env und
 * Datenbank werden erst beim ersten Aufruf gelesen. Die Fehlermeldungen nennen keine Werte.
 */
export function getMergePlatform(): MergePlatform {
  const g = globalThis as { [GLOBAL_KEY]?: MergePlatform };
  if (g[GLOBAL_KEY]) return g[GLOBAL_KEY];
  let platform: MergePlatform;
  if (e2eFakePlatformEnabled()) {
    const fake = createE2eFakeAdapter() as Partial<MergePlatform>;
    if (typeof fake.getMergeReadiness !== "function" || typeof fake.mergeChangeRequest !== "function") {
      throw new ActionError("Der Plattform-Ersatz unterstützt das Mergen nicht.");
    }
    platform = fake as MergePlatform;
  } else {
    try {
      platform = getGitHubAdapter();
    } catch {
      // Unvollständige Konfiguration (Env) oder App nicht initialisierbar: feste Meldung ohne Werte.
      throw new ActionError(
        "Die Verbindung zur Plattform ist nicht konfiguriert. Pull Requests können gerade nicht gemergt werden.",
      );
    }
  }
  g[GLOBAL_KEY] = platform;
  return platform;
}
