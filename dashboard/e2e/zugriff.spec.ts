import { expect, test } from "@playwright/test";

// Ohne Authelia-Cookie weist der Proxy jede Anfrage ab, auch statische Dateien und Server-Aktionen.
test.describe("Zugriff ohne Sitzung", () => {
  test("Seite, statische Datei und Server-Action-Aufruf liefern 403", async ({ playwright, request, baseURL }) => {
    // Pfad einer echten statischen Datei aus der HTML-Antwort (mit Cookie aus der Konfiguration).
    const html = await (await request.get("/")).text();
    const asset = /\/_next\/static\/[^"'\s)]+/.exec(html)?.[0];
    expect(asset, "keine Datei unter /_next/static/ in der HTML-Antwort").toBeTruthy();
    expect((await request.get(asset!)).status()).toBe(200);

    // Neuer Kontext ohne storageState: kein Cookie.
    const anon = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    try {
      expect((await anon.get("/")).status()).toBe(403);
      expect((await anon.get(asset!)).status()).toBe(403);
      const action = await anon.post("/repos", {
        headers: { "Next-Action": "x", "Content-Type": "text/plain;charset=UTF-8" },
        data: "[]",
      });
      expect(action.status()).toBe(403);
    } finally {
      await anon.dispose();
    }
  });
});
