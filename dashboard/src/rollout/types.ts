/**
 * Vertrag zwischen Rollout-Logik (Onboarding- und Build-Check-PRs, design.md Entscheidung 10) und
 * Oberfläche (Server Actions). Die Logik legt RolloutAction und AuditLog selbst an; die Oberfläche
 * zeigt nur das Ergebnis. Meldungen sind deutsch und für den Betreiber formuliert, ohne Werte aus
 * Tokens oder Antworten der Plattform.
 */

export type RolloutKind = "onboarding" | "build_check";

export type RolloutRequest = {
  repositoryId: string;
  kind: RolloutKind;
  /** Authelia-Nutzer (x-dashboard-user) oder "auto" beim automatischen Onboarding. */
  actor: string;
  /**
   * Nur beim automatischen Onboarding: Fehlschläge vor dem Anlegen der Aktion (Vorabfragen,
   * fehlende Installation) werden als `failed`-Aktion festgehalten, damit das Repo nicht ewig
   * Kandidat bleibt. Kontingent-Pausen bleiben ohne Spur.
   */
  recordEarlyFailure?: boolean;
};

export type NotNeededReason =
  | "config_present"
  | "build_check_present"
  | "own_ci"
  | "not_onboarded"
  | "archived"
  | "removed";

export type RolloutOutcome =
  /** PR neu angelegt. */
  | { status: "created"; prUrl: string; prNumber: number }
  /** Es gab schon einen offenen PR dieser Art; kein zweiter (Scenario „Wiederholter Klick“). */
  | { status: "existing"; prUrl: string; prNumber: number }
  /** Nichts zu tun, etwa weil die Konfiguration schon da ist. */
  | { status: "not_needed"; reason: NotNeededReason; message: string }
  /** Fehlgeschlagen; die RolloutAction trägt den Fehler, ein angelegter Branch ist wieder gelöscht (sonst nennt die Meldung ihn). */
  | { status: "failed"; message: string };

export interface RolloutService {
  run(request: RolloutRequest): Promise<RolloutOutcome>;
}
