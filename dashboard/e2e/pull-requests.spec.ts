import { expect, test } from "@playwright/test";

const MAJOR = ["#98", "#57", "#35"];

test.describe("Pull Requests", () => {
  test("Gefilterte PR-Liste per Link", async ({ page }, info) => {
    await page.goto("/pull-requests?typ=major");
    await expect(page).toHaveURL(/typ=major/);

    const chip = page.getByRole("link", { name: /^Major/ });
    await expect(chip).toHaveAttribute("aria-current", "true");

    const list = info.project.name === "mobil" ? page.getByRole("list", { name: "Offene Pull Requests" }) : page.getByRole("table");
    const items = info.project.name === "mobil" ? list.getByRole("listitem") : list.locator("tbody tr");
    await expect(items).toHaveCount(3);

    // Fixtures: shop-api #98, kasse #57, blog #35. Die Nummer steht in der PR-Adresse.
    const hrefs = await items.locator("a[href*='/pull/']").evaluateAll((els) => els.map((e) => e.getAttribute("href")!));
    expect(hrefs.map((h) => `#${h.split("/pull/")[1]}`).sort()).toEqual([...MAJOR].sort());
  });

  test("Ein Klick auf einen Chip setzt den Filter in der Adresse", async ({ page }) => {
    await page.goto("/pull-requests");
    await page.getByRole("link", { name: /^Sicherheit/ }).click();
    await expect(page).toHaveURL(/typ=security/);
    await expect(page.getByRole("link", { name: /^Sicherheit/ })).toHaveAttribute("aria-current", "true");
    await expect(page.getByRole("link", { name: "Filter zurücksetzen" }).first()).toBeVisible();
  });

  test("Leerer Treffer zeigt Hinweis und Zurücksetzen", async ({ page }) => {
    await page.goto("/pull-requests?q=gibt-es-nicht");
    await expect(page.getByText("Keine Treffer für diese Filter.").first()).toBeVisible();
    await page.getByRole("link", { name: "Filter zurücksetzen" }).last().click();
    await expect(page).toHaveURL(/\/pull-requests$/);
  });

  test("Suche findet Paketnamen", async ({ page }) => {
    await page.goto("/pull-requests?q=lodash");
    await expect(page.getByRole("link", { name: /lodash/ }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /next to v16/ })).toHaveCount(0);
  });

  test("Karten und keine waagerechte Seitenleiste auf dem Handy", async ({ page }, info) => {
    test.skip(info.project.name !== "mobil", "nur 375 px");
    await page.goto("/pull-requests");
    await expect(page.getByRole("list", { name: "Offene Pull Requests" }).getByRole("listitem").first()).toBeVisible();
    await expect(page.getByRole("table")).toBeHidden();
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(375);
  });
});
