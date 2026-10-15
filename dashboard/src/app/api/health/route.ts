import { isHealthy } from "@/db/health";

export const dynamic = "force-dynamic";

// Antwortet nur mit dem Zustand, ohne Details (Ausnahme der Vertrauensgrenze, siehe proxy.ts).
export async function GET() {
  const ok = await isHealthy();
  return Response.json(ok ? { status: "ok" } : { status: "unavailable" }, {
    status: ok ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
