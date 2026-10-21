import { getDb } from "@/db/client";
import { getEnv } from "@/env";
import { DbHttpCache } from "../http-cache-db";
import { GitHubAdapter } from "./adapter";

const GLOBAL_KEY = Symbol.for("dashboard.githubAdapter");

/**
 * Die eine `GitHubAdapter`-Instanz je Prozess (auch über Hot-Reload und getrennte Bundles hinweg,
 * daher `globalThis`). Abgleich (Scheduler) und Server Actions teilen sich damit Kontingent-Pause,
 * Vorlagen-Cache und Token-Cache. Träge: Env und Datenbank werden erst beim ersten Aufruf gelesen.
 * Wirft eine feste Meldung (nur Variablennamen), wenn die Konfiguration fehlt oder die App nicht
 * initialisierbar ist; die Rohmeldung der Bibliothek könnte Teile des Schlüssels enthalten.
 */
export function getGitHubAdapter(): GitHubAdapter {
  const g = globalThis as { [GLOBAL_KEY]?: GitHubAdapter };
  if (g[GLOBAL_KEY]) return g[GLOBAL_KEY];
  const env = getEnv();
  let adapter: GitHubAdapter;
  try {
    adapter = new GitHubAdapter({
      appId: env.MEND_RNV_GITHUB_APP_ID,
      privateKey: env.MEND_RNV_GITHUB_APP_KEY,
      cache: new DbHttpCache(getDb()),
    });
  } catch {
    throw new Error(
      "GitHub-App nicht initialisierbar (MEND_RNV_GITHUB_APP_ID / MEND_RNV_GITHUB_APP_KEY prüfen).",
    );
  }
  g[GLOBAL_KEY] = adapter;
  return adapter;
}
