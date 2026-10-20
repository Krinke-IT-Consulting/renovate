import { expect, test } from "@playwright/test";

test.describe("Lagebericht", () => {
  test("Zahl im Lagebericht führt zur gefilterten PR-Liste", async ({ page }) => {
    await page.goto("/");
    const link = page.getByRole("link", { name: "2 Sicherheitsupdates" });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "/pull-requests?typ=security");
  });

  test("Schritte in fester Reihenfolge", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "Gruppenansicht nur auf dem Desktop");
    await page.goto("/");
    const headings = page.locator("h2[id^='gruppe-']");
    await expect(headings.first()).toBeVisible();
    const titles = await headings.allInnerTexts();
    expect(titles.map((t) => t.replace(/\s*\d+$/, ""))).toEqual([
      "Sicherheitsupdates",
      "Rote Builds und fehlgeschlagene Läufe",
      "Major-Updates zur Freigabe",
      "Nicht onboardete Repos",
      "Hängende PRs",
    ]);
  });

  test("Kachel filtert die Schritte auf ein Repo", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /^kasse:/ }).click();
    await expect(page).toHaveURL(/repo=beispiel-firma%2Fkasse/);
    await expect(page.getByText("Filter aufheben")).toBeVisible();
    await expect(page.getByRole("link", { name: /^shop-api$/ })).toHaveCount(0);
  });

  test("Mobil ohne waagerechtes Scrollen der Seite", async ({ page }, info) => {
    test.skip(info.project.name !== "mobil", "nur mobil");
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await expect(page.getByText(/Schritt 1 von \d+/)).toBeVisible();
  });
});
