/**
 * Next-Hook, einmal je Serverinstanz. Startet den Abgleich (design.md, Entscheidung 2) nur in der
 * Node-Laufzeit und nie beim Build. Ohne vollständige Konfiguration (Env-Schema) startet er nicht;
 * so läuft er in lokalen Tests und im E2E-Smoke ohne GitHub- und CE-Zugang nicht an.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { startSyncFromEnv } = await import("./sync/scheduler");
  startSyncFromEnv();
}
