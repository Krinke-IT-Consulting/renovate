import { getDb } from "@/db/client";
import type { PlatformAdapter } from "@/platform";
import { getGitHubAdapter } from "@/platform/github/runtime";
import { createE2eFakeAdapter, e2eFakePlatformEnabled } from "./e2e-fake-adapter";
import { createRolloutService } from "./service";
import type { RolloutService } from "./types";

const GLOBAL_KEY = Symbol.for("dashboard.rolloutService");

/**
 * Rollout-Service für die Laufzeit: Server Actions und Scheduler nutzen dieselbe Instanz und damit
 * denselben Adapter (`getGitHubAdapter`). Träge: Env und Datenbank werden erst beim ersten Aufruf
 * gelesen, nie beim Import. Ein Prozess hält genau eine Instanz (auch über Hot-Reload hinweg).
 * Ein Fehler beim Anlegen (unvollständige Konfiguration) wirft; die Meldung nennt nur Variablennamen.
 */
export function getRolloutService(): RolloutService {
  const g = globalThis as { [GLOBAL_KEY]?: RolloutService };
  if (g[GLOBAL_KEY]) return g[GLOBAL_KEY];
  // Nur im E2E (siehe e2e-fake-adapter.ts); in Produktion wirkungslos.
  const adapter: PlatformAdapter = e2eFakePlatformEnabled() ? createE2eFakeAdapter() : getGitHubAdapter();
  const service = createRolloutService({ db: getDb(), adapter });
  g[GLOBAL_KEY] = service;
  return service;
}
