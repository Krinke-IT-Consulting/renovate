/** Cache für bedingte Requests: je Schlüssel ETag und letzte Antwort. */
export interface CachedResponse {
  etag: string;
  body: unknown;
}

export interface HttpCache {
  get(key: string): Promise<CachedResponse | null>;
  set(key: string, etag: string, body: unknown): Promise<void>;
}

/** Für Tests und lokale Läufe ohne Datenbank. */
export class MemoryHttpCache implements HttpCache {
  private readonly entries = new Map<string, CachedResponse>();

  async get(key: string): Promise<CachedResponse | null> {
    return this.entries.get(key) ?? null;
  }

  async set(key: string, etag: string, body: unknown): Promise<void> {
    this.entries.set(key, { etag, body });
  }
}
