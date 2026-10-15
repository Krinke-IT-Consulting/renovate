import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { httpCache } from "@/db/schema";
import type { CachedResponse, HttpCache } from "./http-cache";

/** ETag-Cache in der Tabelle `http_cache`. Die Datenbank kommt vom Aufrufer. */
export class DbHttpCache implements HttpCache {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly db: NodePgDatabase<any>) {}

  async get(key: string): Promise<CachedResponse | null> {
    const rows = await this.db
      .select({ etag: httpCache.etag, body: httpCache.body })
      .from(httpCache)
      .where(eq(httpCache.key, key))
      .limit(1);
    return rows[0] ?? null;
  }

  async set(key: string, etag: string, body: unknown): Promise<void> {
    await this.db
      .insert(httpCache)
      .values({ key, etag, body })
      .onConflictDoUpdate({
        target: httpCache.key,
        set: { etag, body, updatedAt: sql`now()` },
      });
  }
}
