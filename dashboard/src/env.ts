import { z } from "zod";

/**
 * Zentrales Schema aller Konfigurationswerte des Dashboards (design.md, Entscheidung 5).
 *
 * Gelesen wird erst zur Laufzeit (getEnv / getEnvFor), nie beim Import: Der Build gelingt damit
 * ohne gesetzte Variablen. Fehlermeldungen nennen nur Namen, nie Werte.
 */
const nonEmpty = z.string().trim().min(1);

export const envSchema = z.object({
  DATABASE_URL: nonEmpty.refine((v) => /^postgres(ql)?:\/\//.test(v)),
  RENOVATE_CE_API_URL: nonEmpty.refine((v) => /^https?:\/\//.test(v)),
  MEND_RNV_API_SERVER_SECRET: nonEmpty,
  MEND_RNV_GITHUB_APP_ID: nonEmpty,
  MEND_RNV_GITHUB_APP_KEY: nonEmpty,
  DASHBOARD_PROXY_SECRET: nonEmpty,
});

export type Env = z.infer<typeof envSchema>;
export type EnvName = keyof Env;

type Source = Record<string, string | undefined>;

export class EnvError extends Error {
  readonly names: readonly string[];

  constructor(names: readonly string[]) {
    super(
      `Ungültige oder fehlende Konfiguration. Betroffene Variablen: ${names.join(", ")}. ` +
        "Werte werden aus Sicherheitsgründen nicht ausgegeben.",
    );
    this.name = "EnvError";
    this.names = names;
  }
}

/** Prüft die genannten Variablen (Standard: alle). Wirft EnvError, die nur Namen enthält. */
export function parseEnv<K extends EnvName = EnvName>(
  source: Source,
  keys?: readonly K[],
): Pick<Env, K> {
  const mask = keys ? Object.fromEntries(keys.map((k) => [k, true])) : undefined;
  const schema = mask ? envSchema.pick(mask as Record<EnvName, true>) : envSchema;
  const input: Source = {};
  for (const key of Object.keys(envSchema.shape)) {
    input[key] = source[key];
  }
  const result = schema.safeParse(input);
  if (!result.success) {
    // Nur den Pfad (Variablenname) übernehmen, niemals Meldung oder Eingabewert.
    const names = [...new Set(result.error.issues.map((i) => String(i.path[0])))];
    throw new EnvError(names);
  }
  return result.data as unknown as Pick<Env, K>;
}

let cached: Env | undefined;

/** Alle Werte, erst beim ersten Aufruf zur Laufzeit gelesen. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Nur die benötigten Werte prüfen (z. B. Proxy-Guard und Migration brauchen nicht alle). */
export function getEnvFor<K extends EnvName>(...keys: K[]): Pick<Env, K> {
  return parseEnv(process.env, keys);
}
