import { getRolloutService } from "./runtime";
import { ActionError } from "@/actions/result";
import type { RolloutService } from "./types";

/**
 * Bezugsstelle der Rollout-Logik für die Server Actions der Oberfläche. Die Actions kennen nur den
 * Vertrag (types.ts); welche Implementierung dahinter steckt, entscheidet allein dieser Import.
 */
export function getRolloutServiceForActions(): RolloutService {
  try {
    return getRolloutService();
  } catch {
    // Unvollständige Konfiguration (Env) oder App nicht initialisierbar: feste, verständliche Meldung
    // ohne Variablenwerte; die Aktion bleibt ohne RolloutAction und AuditLog.
    throw new ActionError("Die Verbindung zur Plattform ist nicht konfiguriert. Pull Requests können gerade nicht angelegt werden.");
  }
}
