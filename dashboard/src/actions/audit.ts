import type { Db } from "@/db/client";
import { auditLog } from "@/db/schema";

/** Datenbank oder Transaktion: der Eintrag steht so im selben Schritt wie die Änderung. */
export type DbOrTx = Pick<Db, "insert" | "select" | "update">;

export type AuditEntry = {
  actor: string;
  /** z. B. "job.trigger", "repo.own_ci", "settings.auto_onboarding". */
  action: string;
  target: string;
};

export async function writeAudit(db: DbOrTx, entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values(entry);
}
