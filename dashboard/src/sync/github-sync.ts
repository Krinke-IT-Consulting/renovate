import { and, asc, eq, inArray, isNotNull, isNull, lt, notInArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  httpCache,
  platformConnections,
  pullRequests,
  repositories,
  tenants,
} from "@/db/schema";
import { deriveBuildCheckStatus, deriveOnboardingStatus, deriveUpdateType } from "@/domain";
import {
  RateLimitPause,
  refreshRepositoryState,
  type PlatformAdapter,
  type PlatformConnection,
} from "@/platform";
import { syncProblems } from "./problems-sync";
import { loadOpenRollouts, type OpenRollouts } from "./rollouts";
import { errorCategory, pauseOutcome, recordRun, type PartialError, type RunOutcome } from "./sync-state";

/** ETag-Einträge, die so lange nicht mehr geschrieben wurden, werden am Ende eines Durchlaufs gelöscht. */
export const HTTP_CACHE_MAX_AGE_MS = 7 * 86_400_000;

export type GithubSyncOptions = { db: Db; adapter: PlatformAdapter; now?: () => Date };

export type GithubSyncSummary = RunOutcome & { connections: number; repositories: number };

type ConnectionRow = typeof platformConnections.$inferSelect;

/** Legt die Connection zur Installation an oder zieht den Owner nach. Zeilen werden nie gelöscht. */
async function upsertConnection(
  db: Db,
  tenantId: string,
  conn: PlatformConnection,
): Promise<ConnectionRow> {
  const installationId = Number(conn.externalConnectionId);
  const byInstallation = await db
    .select()
    .from(platformConnections)
    .where(
      and(
        eq(platformConnections.platform, "github"),
        eq(platformConnections.installationId, installationId),
      ),
    )
    .limit(1);
  if (byInstallation[0]) {
    if (byInstallation[0].ownerName === conn.ownerName) return byInstallation[0];
    const [row] = await db
      .update(platformConnections)
      .set({ ownerName: conn.ownerName })
      .where(eq(platformConnections.id, byInstallation[0].id))
      .returning();
    return row!;
  }
  // Von Hand angelegte Connection ohne Installations-ID übernehmen, statt eine zweite anzulegen.
  const byOwner = await db
    .select()
    .from(platformConnections)
    .where(
      and(
        eq(platformConnections.tenantId, tenantId),
        eq(platformConnections.platform, "github"),
        eq(platformConnections.ownerName, conn.ownerName),
        isNull(platformConnections.installationId),
      ),
    )
    .limit(1);
  if (byOwner[0]) {
    const [row] = await db
      .update(platformConnections)
      .set({ installationId })
      .where(eq(platformConnections.id, byOwner[0].id))
      .returning();
    return row!;
  }
  const [row] = await db
    .insert(platformConnections)
    .values({ tenantId, platform: "github", ownerName: conn.ownerName, installationId })
    .returning();
  return row!;
}

/** Repos einer Connection abgleichen: anlegen, nachziehen, Verschwundene mit removed_at markieren. */
async function syncRepositoryList(
  db: Db,
  adapter: PlatformAdapter,
  connRow: ConnectionRow,
  conn: PlatformConnection,
  now: Date,
): Promise<void> {
  const listed = await adapter.listRepositories(conn);
  const existing = await db
    .select()
    .from(repositories)
    .where(eq(repositories.connectionId, connRow.id));
  const byExternal = new Map(existing.map((r) => [r.externalId, r]));
  const listedIds = new Set<string>();

  for (const repo of listed) {
    listedIds.add(repo.externalId);
    const row = byExternal.get(repo.externalId);
    if (!row) {
      // first_seen_at bleibt beim Standardwert (Zeitpunkt des Einfügens).
      await db.insert(repositories).values({
        connectionId: connRow.id,
        externalId: repo.externalId,
        fullName: repo.fullName,
        defaultBranch: repo.defaultBranch,
        archived: repo.archived,
      });
    } else if (
      row.fullName !== repo.fullName ||
      row.defaultBranch !== repo.defaultBranch ||
      row.archived !== repo.archived ||
      row.removedAt !== null
    ) {
      await db
        .update(repositories)
        .set({
          fullName: repo.fullName,
          defaultBranch: repo.defaultBranch,
          archived: repo.archived,
          removedAt: null,
        })
        .where(eq(repositories.id, row.id));
    }
  }
  const gone = existing.filter((r) => r.removedAt === null && !listedIds.has(r.externalId));
  if (gone.length > 0) {
    await db
      .update(repositories)
      .set({ removedAt: now })
      .where(
        inArray(
          repositories.id,
          gone.map((r) => r.id),
        ),
      );
  }
}

type ContentState = { headSha: string | null; configPath: string | null; hasBuildCheck: boolean | null };

/**
 * Speichert Head-SHA und Inhalt (Konfigurationspfad, Build-Check) sofort nach dem Lesen und leitet
 * daraus die Status ab. `ce_status` und `own_ci` werden dabei frisch aus der Datenbank gelesen
 * (Zeile gesperrt), damit ein parallel vom CE-Abgleich gesetzter Status nicht überschrieben wird.
 * `hasBuildCheck: null` heißt: Inhalt unverändert, der gespeicherte Stand gilt.
 */
async function saveContentState(
  db: Db,
  repositoryId: string,
  content: ContentState,
  open: OpenRollouts | undefined,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [fresh] = await tx
      .select({
        ceStatus: repositories.ceStatus,
        ownCi: repositories.ownCi,
        configPath: repositories.configPath,
        buildCheckStatus: repositories.buildCheckStatus,
      })
      .from(repositories)
      .where(eq(repositories.id, repositoryId))
      .for("update");
    if (!fresh) return;
    // Ohne neuen Head-SHA gilt der gespeicherte Stand; "active" gibt es nur mit Aufrufdatei.
    const unchanged = content.hasBuildCheck === null;
    const configPath = unchanged ? fresh.configPath : content.configPath;
    const hasBuildCheck = unchanged ? fresh.buildCheckStatus === "active" : content.hasBuildCheck;
    await tx
      .update(repositories)
      .set({
        headSha: content.headSha,
        configPath,
        onboardingStatus: deriveOnboardingStatus({
          hasConfig: configPath !== null,
          openOnboardingPr: open?.onboarding ?? false,
          ceStatus: fresh.ceStatus,
        }),
        buildCheckStatus: deriveBuildCheckStatus({
          hasCallerFile: hasBuildCheck === true,
          openRolloutPr: open?.buildCheck ?? false,
          ownCi: fresh.ownCi,
        }),
      })
      .where(eq(repositories.id, repositoryId));
  });
}

/** Offene Update-PRs mit CI-Status abgleichen; nicht mehr gelistete auf ihren Endzustand setzen. */
async function syncPullRequests(
  db: Db,
  adapter: PlatformAdapter,
  conn: PlatformConnection,
  ref: { fullName: string; defaultBranch: string },
  repositoryId: string,
): Promise<void> {
  const listed = await adapter.listUpdatePullRequests(conn, ref);
  const stored = await db
    .select()
    .from(pullRequests)
    .where(eq(pullRequests.repositoryId, repositoryId));
  const storedByNumber = new Map(stored.map((p) => [p.number, p]));

  for (const pr of listed) {
    const prev = storedByNumber.get(pr.number);
    let ciStatus = prev?.ciStatus ?? "none";
    // Neu lesen bei neuem PR/Commit und solange das Ergebnis nicht "success" ist: Checks laufen
    // auch ohne neuen Commit zu Ende, und ein Rerun macht einen roten Stand wieder grün.
    // (Bedingte Anfragen: unveränderte Antworten kosten kein Kontingent.)
    if (
      !prev ||
      prev.state !== "open" ||
      prev.headSha !== pr.headSha ||
      prev.ciStatus !== "success"
    ) {
      ciStatus = (await adapter.getChangeStatus(conn, ref, pr.headSha)).ci;
    }
    const values = {
      title: pr.title,
      url: pr.url,
      updateType: deriveUpdateType(pr.labels),
      packageNames: pr.packageNames,
      labels: pr.labels,
      headSha: pr.headSha,
      automerge: pr.automerge,
      ciStatus,
      state: "open" as const,
      createdAt: new Date(pr.createdAt),
      updatedAt: new Date(pr.updatedAt),
      mergedAt: null,
    };
    await db
      .insert(pullRequests)
      .values({ repositoryId, number: pr.number, ...values })
      .onConflictDoUpdate({
        target: [pullRequests.repositoryId, pullRequests.number],
        set: values,
      });
  }

  // In der DB offen, aber nicht mehr gelistet: Endzustand nachladen.
  const listedNumbers = new Set(listed.map((p) => p.number));
  for (const prev of stored) {
    if (prev.state !== "open" || listedNumbers.has(prev.number)) continue;
    const end = await adapter.getPullRequestState(conn, ref, prev.number);
    if (end.state === "open") continue;
    await db
      .update(pullRequests)
      .set({ state: end.state, mergedAt: end.mergedAt ? new Date(end.mergedAt) : null })
      .where(eq(pullRequests.id, prev.id));
  }
}

/**
 * Ein Repo abgleichen: Inhalte (nur bei neuem Head-SHA), PRs, CI, Dashboard-Link, Status.
 * Head-SHA und Inhalt werden sofort gespeichert; PR-Teil und Dashboard-Suche laufen in eigenen
 * try/catch-Blöcken. Deren Fehler kommen als Teilfehler zurück (der gespeicherte Stand bleibt).
 * Fehler beim Lesen des Inhalts selbst werfen; RateLimitPause wird immer weitergereicht.
 */
async function syncRepository(
  db: Db,
  adapter: PlatformAdapter,
  conn: PlatformConnection,
  row: typeof repositories.$inferSelect,
  open: OpenRollouts | undefined,
  now: Date,
): Promise<PartialError[]> {
  const ref = { fullName: row.fullName, defaultBranch: row.defaultBranch };
  const errors: PartialError[] = [];

  const refresh = await refreshRepositoryState(adapter, conn, ref, row.headSha);
  await saveContentState(
    db,
    row.id,
    {
      headSha: refresh.headSha,
      configPath: refresh.state?.configPath ?? null,
      hasBuildCheck: refresh.state ? refresh.state.hasBuildCheck : null,
    },
    open,
  );

  try {
    await syncPullRequests(db, adapter, conn, ref, row.id);
  } catch (e) {
    if (e instanceof RateLimitPause) throw e;
    errors.push({ repository: row.fullName, message: `Pull Requests: ${errorCategory(e)}` });
  }

  // Bei einem Fehler bleibt der alte Link stehen.
  const dashboard: { dependencyDashboardUrl?: string | null } = {};
  try {
    dashboard.dependencyDashboardUrl = await adapter.findDependencyDashboard(conn, ref);
  } catch (e) {
    if (e instanceof RateLimitPause) throw e;
    errors.push({ repository: row.fullName, message: `Dependency Dashboard: ${errorCategory(e)}` });
  }

  await db
    .update(repositories)
    .set({ ...dashboard, syncedAt: now })
    .where(eq(repositories.id, row.id));
  return errors;
}

/**
 * Repos, deren Installation nicht mehr in der Liste steht (deinstalliert oder gesperrt), bekommen
 * `removed_at`. Nur nach erfolgreichem `listConnections` aufrufen.
 */
async function markRemovedInstallations(
  db: Db,
  tenantId: string,
  present: readonly PlatformConnection[],
  now: Date,
): Promise<void> {
  const ids = present.map((c) => Number(c.externalConnectionId));
  const gone = await db
    .select({ id: platformConnections.id })
    .from(platformConnections)
    .where(
      and(
        eq(platformConnections.tenantId, tenantId),
        eq(platformConnections.platform, "github"),
        isNotNull(platformConnections.installationId),
        ids.length > 0 ? notInArray(platformConnections.installationId, ids) : undefined,
      ),
    );
  if (gone.length === 0) return;
  await db
    .update(repositories)
    .set({ removedAt: now })
    .where(
      and(
        inArray(
          repositories.connectionId,
          gone.map((g) => g.id),
        ),
        isNull(repositories.removedAt),
      ),
    );
}

/**
 * Ein GitHub-Durchlauf (design.md, Entscheidung 6). Fehler je Repo werden gefangen und als
 * Teilfehler vermerkt; RateLimitPause beendet den Durchlauf sauber. Ein Fehler beim Auflisten der
 * Installationen wirft (der Aufrufer vermerkt ihn). Danach werden die Probleme neu bewertet.
 */
export async function runGithubSync(options: GithubSyncOptions): Promise<GithubSyncSummary> {
  const { db, adapter } = options;
  const clock = options.now ?? (() => new Date());
  const partialErrors: PartialError[] = [];
  let pause: RunOutcome["pause"];
  let connectionCount = 0;
  let repoCount = 0;

  // MVP: genau ein Tenant (design.md, Entscheidung 3). Bei mehreren gilt der älteste; mit der
  // Mandantenfähigkeit wird die Connection dem Tenant der Installation zugeordnet.
  const [tenant] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .orderBy(asc(tenants.createdAt))
    .limit(1);
  if (!tenant) throw new Error("Kein Tenant vorhanden");

  try {
    const connections = await adapter.listConnections();
    // Nur nach erfolgreichem Abruf: bei Fehler oder Pause bleibt der Stand unangetastet.
    await markRemovedInstallations(db, tenant.id, connections, clock());
    for (const conn of connections) {
      let connRow: ConnectionRow;
      try {
        connRow = await upsertConnection(db, tenant.id, conn);
      } catch (e) {
        // z. B. Eindeutigkeitskonflikt (23505): die übrigen Connections laufen weiter.
        partialErrors.push({ repository: conn.ownerName, message: errorCategory(e) });
        continue;
      }
      connectionCount++;
      try {
        await syncRepositoryList(db, adapter, connRow, conn, clock());
      } catch (e) {
        if (e instanceof RateLimitPause) throw e;
        partialErrors.push({ repository: conn.ownerName, message: errorCategory(e) });
        continue;
      }
      // Älteste Abgleiche zuerst (nie abgeglichene vorn): bei Pausen verhungern nicht immer
      // dieselben Repos am Ende der Liste.
      const rows = await db
        .select()
        .from(repositories)
        .where(
          and(
            eq(repositories.connectionId, connRow.id),
            eq(repositories.archived, false),
            isNull(repositories.removedAt),
          ),
        )
        .orderBy(sql`${repositories.syncedAt} asc nulls first`);
      const openRollouts = await loadOpenRollouts(
        db,
        rows.map((r) => r.id),
      );
      for (const row of rows) {
        try {
          const errors = await syncRepository(db, adapter, conn, row, openRollouts.get(row.id), clock());
          partialErrors.push(...errors);
          repoCount++;
        } catch (e) {
          if (e instanceof RateLimitPause) throw e;
          partialErrors.push({ repository: row.fullName, message: errorCategory(e) });
        }
      }
    }
  } catch (e) {
    if (!(e instanceof RateLimitPause)) throw e;
    pause = pauseOutcome(e);
  }

  // Aufräumen: ETag-Einträge ohne Schreibzugriff seit 7 Tagen (Daten, die sich nie ändern, werden
  // dabei höchstens einmal je Woche neu geladen).
  try {
    await db
      .delete(httpCache)
      .where(lt(httpCache.updatedAt, new Date(clock().getTime() - HTTP_CACHE_MAX_AGE_MS)));
  } catch (e) {
    partialErrors.push({ repository: "(Cache aufräumen)", message: errorCategory(e) });
  }

  await syncProblems(db, { now: clock() });
  const outcome: RunOutcome = { partialErrors, pause };
  await recordRun(db, "github", outcome, clock());
  return { ...outcome, connections: connectionCount, repositories: repoCount };
}
