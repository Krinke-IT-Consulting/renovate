// Ersatz für die interne API von Renovate CE im E2E-Smoke. Beantwortet nur, was die Aktionen
// brauchen: POST /system/v1/jobs/add. Das erste Einreihen eines Repos ergibt "inserted", jedes
// weitere "unchanged" (wie CE bei einem wartenden oder laufenden Job), bis /__reset aufgerufen wird.
// Prüft das Bearer-Secret (Fake-Wert, nur in playwright.config.ts). Nur lokal; lauscht
// ausschließlich auf 127.0.0.1.
import { createServer } from "node:http";

const port = Number(process.env.FAKE_CE_PORT ?? 9291);
// Kommt aus playwright.config.ts; ohne Wert startet der Fake nicht.
const secret = process.env.FAKE_CE_SECRET;
if (!secret) throw new Error("FAKE_CE_SECRET fehlt.");

/** Repos mit wartendem Job, und alle Aufrufe in Reihenfolge (für die Tests unter /__calls). */
let queued = new Set();
let calls = [];

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

createServer(async (req, res) => {
  const path = req.url?.split("?")[0];
  if (req.method === "GET" && path === "/system/v1/status") return json(res, 200, { ok: true });
  if (req.method === "POST" && path === "/__reset") {
    queued = new Set();
    calls = [];
    return json(res, 200, { ok: true });
  }
  if (req.method === "GET" && path === "/__calls") return json(res, 200, { calls });
  if (req.method === "POST" && path === "/system/v1/jobs/add") {
    if (req.headers.authorization !== `Bearer ${secret}`) return json(res, 401, { error: "unauthorized" });
    let repository;
    try {
      repository = JSON.parse(await readBody(req)).repository;
    } catch {
      return json(res, 400, { error: "bad request" });
    }
    if (typeof repository !== "string" || !repository.includes("/")) return json(res, 400, { error: "bad request" });
    calls.push(repository);
    const change = queued.has(repository) ? "unchanged" : "inserted";
    queued.add(repository);
    return json(res, 200, { jobId: `fake-job-${calls.length}`, status: "pending", change });
  }
  json(res, 404, { error: "not found" });
}).listen(port, "127.0.0.1", () => console.log(`Fake-CE auf 127.0.0.1:${port}`));
