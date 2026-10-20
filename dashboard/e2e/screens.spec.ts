import { test } from "@playwright/test";

/**
 * Kein Test, sondern Hilfe beim Gestalten: Bildschirmfotos aller Seiten mit Fixture-Daten nach
 * test-results/screens/. Nur mit SCREENS=1 (npm run e2e:screens), optional SCREENS_PATHS=/repos,/jobs.
 */
const paths = (process.env.SCREENS_PATHS ?? "/,/repos,/repos/beispiel-firma/kasse,/pull-requests,/jobs,/probleme").split(",");

test.describe("Bildschirmfotos", () => {
  test.skip(process.env.SCREENS !== "1", "nur mit SCREENS=1");
  for (const p of paths) {
    test(`Foto ${p}`, async ({ page }, info) => {
      await page.goto(p);
      await page.waitForLoadState("networkidle");
      const name = p === "/" ? "uebersicht" : p.slice(1).replaceAll("/", "_");
      await page.screenshot({ path: `test-results/screens/${info.project.name}-${name}.png`, fullPage: true });
    });
  }
});
