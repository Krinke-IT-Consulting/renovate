import { getDb } from "@/db/client";
import { getEnv } from "@/env";
import { DbHttpCache, GitHubAdapter } from "@/platform";
import { createRolloutService } from "./service";
import type { RolloutService } from "./types";

const GLOBAL_KEY = Symbol.for("dashboard.rolloutService");

/**
 * Rollout-Service für die Laufzeit (Server Actions). Träge: Env und Datenbank werden erst beim ersten
 * Aufruf gelesen, nie beim Import. Ein Prozess hält genau eine Instanz (auch über Hot-Reload hinweg),
 * damit Vorlagen-Cache und Kontingentstand des Adapters geteilt werden. Ein Fehler beim Anlegen
 * (unvollständige Konfiguration) wirft; die Fehlermeldung nennt nur Variablennamen.
 */
export function getRolloutService(): RolloutService {
  const g = globalThis as { [GLOBAL_KEY]?: RolloutService };
  if (g[GLOBAL_KEY]) return g[GLOBAL_KEY];
  const env = getEnv();
  const db = getDb();
  let adapter: GitHubAdapter;
  try {
    adapter = new GitHubAdapter({
      appId: env.MEND_RNV_GITHUB_APP_ID,
      privateKey: env.MEND_RNV_GITHUB_APP_KEY,
      cache: new DbHttpCache(db),
    });
  } catch {
    // Feste Meldung: die Rohmeldung der Bibliothek könnte Teile des Schlüssels enthalten.
    throw new Error(
      "GitHub-App nicht initialisierbar (MEND_RNV_GITHUB_APP_ID / MEND_RNV_GITHUB_APP_KEY prüfen).",
    );
  }
  const service = createRolloutService({ db, adapter });
  g[GLOBAL_KEY] = service;
  return service;
}
