import type { RolloutOutcome, RolloutService } from "./types";

/**
 * PLATZHALTER. Diese Datei gehört dem parallelen Rollout-Strang (Phase 7.3/7.4) und wird dort durch
 * die echte Implementierung ersetzt. Sie existiert in diesem Zweig nur, damit die Oberfläche
 * (rollout/registry.ts) kompiliert und die Fehlermeldung testbar ist.
 *
 * BEIM MERGE GEWINNT DIE ECHTE service.ts DES ANDEREN AGENTEN.
 */
const placeholder: RolloutService = {
  async run(): Promise<RolloutOutcome> {
    return { status: "failed", message: "Noch nicht verfügbar." };
  },
};

export function getRolloutService(): RolloutService {
  return placeholder;
}
