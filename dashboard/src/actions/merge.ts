"use server";

/**
 * Server Actions für das Mergen (Change dashboard-pr-merge). VERTRAG, noch ohne Logik: Die
 * Umsetzung (Live-Prüfung, Merge, AuditLog) kommt in Tasks 3.1 bis 3.3; die Oberfläche (Tasks 4.x)
 * baut gegen diese Signaturen. Beide Funktionen sind für `bind` + `useActionState` gedacht.
 */
import { failed, type ActionState } from "./result";
import type { MergeTarget } from "@/merge/types";

/** Einen PR mergen, wenn die Live-Prüfung den angezeigten Stand bestätigt. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function mergePullRequest(target: MergeTarget): Promise<ActionState> {
  return failed("Mergen ist noch nicht verfügbar.");
}

/** Sammel-Merge: genau die beim Rendern übergebenen Ziele, nacheinander, höchstens 20. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function mergeAllGreen(targets: MergeTarget[]): Promise<ActionState> {
  return failed("Sammel-Merge ist noch nicht verfügbar.");
}
