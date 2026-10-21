import { createCeClient, type CeClient } from "@/ce";
import { EnvError, getEnvFor } from "@/env";
import { ActionError } from "./result";

/**
 * CE-Client für die Aktionen, aus dem Env-Schema gebaut und unabhängig vom Scheduler (der nur mit
 * vollständiger GitHub-Konfiguration startet). Die Fehlermeldung nennt nur Variablennamen.
 */
export function getCeClientFromEnv(): CeClient {
  try {
    const env = getEnvFor("RENOVATE_CE_API_URL", "MEND_RNV_API_SERVER_SECRET");
    return createCeClient({ baseUrl: env.RENOVATE_CE_API_URL, secret: env.MEND_RNV_API_SERVER_SECRET });
  } catch (e) {
    if (e instanceof EnvError) {
      throw new ActionError(`Renovate CE ist nicht konfiguriert (${e.names.join(", ")}).`);
    }
    throw e;
  }
}
