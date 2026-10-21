import type { Pool } from "pg";
import { createCeClient } from "@/ce";
import { getDb, getPool, type Db } from "@/db/client";
import { EnvError, getEnv } from "@/env";
import type { PlatformAdapter } from "@/platform";
import { getGitHubAdapter } from "@/platform/github/runtime";
import { getRolloutService } from "@/rollout/runtime";
import { createRolloutService } from "@/rollout/service";
import type { RolloutService } from "@/rollout/types";
import { runCeSync, type CeSyncOptions } from "./ce-sync";
import { runGithubSync } from "./github-sync";
import { SYNC_LOCK_KEYS, withAdvisoryLock } from "./lock";
import { errorCategory, recordFailure, type SyncSource } from "./sync-state";

/** Intervalle sind Konstanten (design.md, Entscheidung 5), keine Variablen. */
export const GITHUB_INTERVAL_MS = 5 * 60_000;
export const CE_INTERVAL_MS = 60_000;
export const FIRST_RUN_DELAY_MS = 10_000;

export type SyncLoopOptions = {
  db: Db;
  pool: Pool;
  adapter: PlatformAdapter;
  ceClient: CeSyncOptions["client"];
  /** Rollout-Service des Prozesses (teilt den Adapter mit den Server Actions); Standard: eigener um `adapter`. */
  rollout?: RolloutService;
  intervals?: { githubMs: number; ceMs: number };
  firstRunDelayMs?: number;
};

export type SyncLoops = {
  /** Ein Durchlauf der Quelle, geschützt gegen Überlappen (Prozess und Lock). Gibt false zurück, wenn er übersprungen wurde. */
  run(source: SyncSource): Promise<boolean>;
  stop(): void;
};

/**
 * Startet je Quelle eine Intervall-Schleife. Ein Durchlauf läuft nie parallel zu sich selbst:
 * im Prozess verhindert das ein Flag, über Instanzen hinweg der Advisory-Lock. Fehler werden
 * gefangen, als Kategorie in sync_state vermerkt und ohne Werte geloggt.
 */
export function startSyncLoops(options: SyncLoopOptions): SyncLoops {
  const { db, pool, adapter, ceClient } = options;
  const intervals = options.intervals ?? { githubMs: GITHUB_INTERVAL_MS, ceMs: CE_INTERVAL_MS };
  const rollout = options.rollout ?? createRolloutService({ db, adapter });
  const busy = new Set<SyncSource>();
  let stopped = false;

  const tasks: Record<SyncSource, () => Promise<unknown>> = {
    github: () => runGithubSync({ db, adapter, rollout }),
    ce: () => runCeSync({ db, client: ceClient }),
  };

  async function run(source: SyncSource): Promise<boolean> {
    if (stopped || busy.has(source)) return false;
    busy.add(source);
    try {
      const result = await withAdvisoryLock(pool, SYNC_LOCK_KEYS[source], tasks[source]);
      return result.ran;
    } catch (e) {
      console.error(`Abgleich ${source} fehlgeschlagen: ${errorCategory(e)}`);
      try {
        await recordFailure(db, source, e);
      } catch {
        /* Datenbank nicht erreichbar: nichts weiter zu vermerken */
      }
      return true;
    } finally {
      busy.delete(source);
    }
  }

  const timers: NodeJS.Timeout[] = [];
  const delay = options.firstRunDelayMs ?? FIRST_RUN_DELAY_MS;
  for (const [source, ms] of [
    ["github", intervals.githubMs],
    ["ce", intervals.ceMs],
  ] as const) {
    timers.push(setTimeout(() => void run(source), delay), setInterval(() => void run(source), ms));
  }
  // Die Timer halten den Prozess nicht am Leben.
  for (const t of timers) t.unref();

  return {
    run,
    stop() {
      stopped = true;
      for (const t of timers) {
        clearTimeout(t);
        clearInterval(t);
      }
    },
  };
}

const GLOBAL_KEY = Symbol.for("dashboard.syncLoops");

/**
 * Startet die Schleifen mit der Konfiguration aus dem Env-Schema. Ist sie unvollständig, wird einmal
 * geloggt (nur Variablennamen) und nichts gestartet. Mehrfachaufrufe starten nichts doppelt.
 */
export function startSyncFromEnv(): SyncLoops | null {
  const g = globalThis as { [GLOBAL_KEY]?: SyncLoops };
  if (g[GLOBAL_KEY]) return g[GLOBAL_KEY];
  let env;
  try {
    env = getEnv();
  } catch (e) {
    const names = e instanceof EnvError ? e.names.join(", ") : "unbekannt";
    console.error(`Abgleich nicht gestartet: Konfiguration unvollständig (${names}).`);
    return null;
  }
  const db = getDb();
  let adapter: PlatformAdapter;
  let rollout: RolloutService;
  try {
    // Dieselbe Adapter- und Rollout-Instanz wie in den Server Actions: gemeinsame Kontingent-Pause,
    // gemeinsamer Vorlagen- und Token-Cache.
    adapter = getGitHubAdapter();
    rollout = getRolloutService();
  } catch {
    // Feste Meldung: die Rohmeldung der Bibliothek könnte Teile des Schlüssels enthalten.
    console.error(
      "Abgleich nicht gestartet: GitHub-App nicht initialisierbar (MEND_RNV_GITHUB_APP_ID / MEND_RNV_GITHUB_APP_KEY prüfen).",
    );
    return null;
  }
  const loops = startSyncLoops({
    db,
    pool: getPool(),
    adapter,
    rollout,
    ceClient: createCeClient({
      baseUrl: env.RENOVATE_CE_API_URL,
      secret: env.MEND_RNV_API_SERVER_SECRET,
    }),
  });
  g[GLOBAL_KEY] = loops;
  return loops;
}
