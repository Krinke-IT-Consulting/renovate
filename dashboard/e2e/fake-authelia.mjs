// Ersatz für Authelia im E2E-Smoke und bei der lokalen Ansicht mit Fixtures: beantwortet
// /api/authz/forward-auth mit 200 und Remote-User, sobald irgendein Cookie mitkommt.
// Nur lokal; lauscht ausschließlich auf 127.0.0.1.
import { createServer } from "node:http";

const port = Number(process.env.FAKE_AUTHELIA_PORT ?? 9191);
createServer((req, res) => {
  if (req.url?.startsWith("/api/authz/forward-auth") && req.headers.cookie) {
    res.writeHead(200, { "Remote-User": "fixture", "Remote-Name": "Fixture" });
  } else if (req.url === "/api/health") {
    res.writeHead(200);
  } else {
    res.writeHead(401);
  }
  res.end();
}).listen(port, "127.0.0.1", () => console.log(`Fake-Authelia auf 127.0.0.1:${port}`));
