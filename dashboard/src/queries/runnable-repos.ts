import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { repositories } from "@/db/schema";

/** Repos, für die ein Lauf Sinn ergibt: onboardet, nicht archiviert, nicht entfernt. */
const runnable = and(
  eq(repositories.onboardingStatus, "onboarded"),
  eq(repositories.archived, false),
  isNull(repositories.removedAt),
);

export async function listRunnableRepos(db: Pick<Db, "select">): Promise<{ id: string; fullName: string }[]> {
  return db
    .select({ id: repositories.id, fullName: repositories.fullName })
    .from(repositories)
    .where(runnable)
    .orderBy(asc(repositories.fullName));
}

export async function countRunnableRepos(db: Pick<Db, "select">): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(repositories).where(runnable);
  return row?.n ?? 0;
}
