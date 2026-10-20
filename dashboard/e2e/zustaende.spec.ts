import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { e2eDatabaseUrl } from "./db";

/** Abgleich im Fehlerzustand: Stempel nennt Fehler und Uhrzeit, die letzten Daten bleiben sichtbar. */
async function setGithubError(on: boolean) {
  const db = new Client({ connectionString: e2eDatabaseUrl() });
  await db.connect();
  try {
    await db.query(
      on
        ? "update sync_state set last_error_at = now(), last_error_message = 'Plattform nicht erreichbar' where source = 'github'"
        : "update sync_state set last_error_at = null, last_error_message = null where source = 'github'",
    );
  } finally {
    await db.end();
  }
}

test.describe("Zustände", () => {
  test.describe.configure({ mode: "serial" });
  test.afterEach(() => setGithubError(false));

  test("Abgleich-Fehler mit Uhrzeit, Daten bleiben sichtbar", async ({ page }) => {
    await setGithubError(true);
    for (const path of ["/", "/pull-requests", "/jobs", "/probleme"]) {
      await page.goto(path);
      await expect(page.getByText(/GitHub: Fehler \d{2}:\d{2}/).locator("visible=true").first()).toBeVisible();
    }
    await page.goto("/pull-requests");
    await expect(page.getByText(/offene PRs/).first()).toBeVisible();
  });

  test("Leerzustand mit Filter ohne Treffer", async ({ page }) => {
    await page.goto("/pull-requests?q=gibt-es-nicht");
    await expect(page.getByText("Keine Treffer für diese Filter.")).toBeVisible();
    await page.getByRole("link", { name: "Filter zurücksetzen" }).first().click();
    await expect(page).toHaveURL(/\/pull-requests$/);
  });
});
