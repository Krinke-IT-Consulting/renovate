import { defineConfig, devices } from "@playwright/test";
import { e2eDatabaseUrl } from "./e2e/db";

/**
 * Playwright-Smoke mit Fixture-Daten (Task 6.6). Startet Fake-Authelia, Fake-CE und `next dev`
 * gegen die Wegwerf-Datenbank dashboard_e2e. Die GitHub-Variablen bleiben leer, damit der Abgleich
 * nicht anläuft (instrumentation.ts); die Aktionen sprechen mit dem Fake-CE.
 */
// Ports per Umgebung änderbar, damit mehrere Arbeitskopien parallel testen können.
const PORT = Number(process.env.E2E_PORT ?? 3100);
const AUTH_PORT = Number(process.env.E2E_AUTH_PORT ?? 9191);
const CE_PORT = Number(process.env.E2E_CE_PORT ?? 9291);
// Erfundener Wert nur für den Fake-CE; kein echtes Secret.
const CE_SECRET = "e2e-secret";
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    trace: "retain-on-failure",
    // Irgendein Cookie genügt der Fake-Authelia.
    storageState: {
      cookies: [
        { name: "authelia_session", value: "e2e", domain: "127.0.0.1", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" },
      ],
      origins: [],
    },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobil", use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } },
  ],
  webServer: [
    {
      command: `FAKE_AUTHELIA_PORT=${AUTH_PORT} node e2e/fake-authelia.mjs`,
      url: `http://127.0.0.1:${AUTH_PORT}/api/health`,
      reuseExistingServer: true,
    },
    {
      command: `FAKE_CE_PORT=${CE_PORT} FAKE_CE_SECRET=${CE_SECRET} node e2e/fake-ce.mjs`,
      url: `http://127.0.0.1:${CE_PORT}/system/v1/status`,
      reuseExistingServer: true,
    },
    {
      command: `npx next dev -p ${PORT} -H 127.0.0.1`,
      // Ohne Cookie antwortet der Proxy mit 403; das genügt als "bereit" (globalSetup legt die DB erst danach an).
      url: `${baseURL}/`,
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        DATABASE_URL: e2eDatabaseUrl(),
        AUTHELIA_INTERNAL_URL: `http://127.0.0.1:${AUTH_PORT}`,
        // Die Aktionen sprechen mit dem Fake-CE. Der Abgleich startet trotzdem nicht: Die
        // GitHub-Variablen sind leer (und überstimmen Werte aus .env.local).
        RENOVATE_CE_API_URL: `http://127.0.0.1:${CE_PORT}`,
        MEND_RNV_API_SERVER_SECRET: CE_SECRET,
        MEND_RNV_GITHUB_APP_ID: "",
        MEND_RNV_GITHUB_APP_KEY: "",
      },
    },
  ],
});
