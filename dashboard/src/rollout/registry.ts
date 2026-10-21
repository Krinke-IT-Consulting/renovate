import { getRolloutService } from "./service";
import type { RolloutService } from "./types";

/**
 * Bezugsstelle der Rollout-Logik für die Server Actions der Oberfläche. Die Actions kennen nur den
 * Vertrag (types.ts); welche Implementierung dahinter steckt, entscheidet allein dieser Import.
 */
export function getRolloutServiceForActions(): RolloutService {
  return getRolloutService();
}
