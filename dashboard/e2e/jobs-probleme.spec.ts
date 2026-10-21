import { expect, test } from "@playwright/test";

/** Jobs und Probleme gegen die Fixture-Daten (Task 6.5). */

test.describe("Jobs", () => {
  test("Log-Auszug aufklappen und kopieren", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/jobs?status=failed");

    const toggle = page.getByRole("button", { name: /Log anzeigen.*beispiel-firma\/kasse/ });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(page.getByRole("button", { name: /Log ausblenden.*beispiel-firma\/kasse/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    const log = page.getByRole("region", { name: "Log-Auszug beispiel-firma/kasse" });
    await expect(log).toBeVisible();
    await expect(log).toContainText("ERESOLVE");

    await log.getByRole("button", { name: "Kopieren" }).click();
    await expect(log.getByText("Kopiert", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("ERESOLVE");
  });

  test("Fokus bleibt beim Aufklappen auf dem Knopf", async ({ page }, info) => {
    test.skip(info.project.name === "mobil", "Tabellenzelle nur auf dem Desktop");
    await page.goto("/jobs?status=failed");
    const toggle = page.getByRole("button", { name: /Log anzeigen.*beispiel-firma\/kasse/ }).locator("visible=true");
    // Handle vor dem Klick: Der Name des Knopfs wechselt zu "Log ausblenden", ein Locator fände ihn nicht mehr.
    const button = await toggle.elementHandle();
    expect(button).not.toBeNull();
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: /Log ausblenden.*beispiel-firma\/kasse/ }).locator("visible=true")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    // Derselbe Knoten, nicht ein neu gemounteter: Der Fokus fällt sonst auf body.
    const state = await button!.evaluate((el) => ({
      same: el === document.activeElement,
      connected: el.isConnected,
      expanded: el.getAttribute("aria-expanded"),
    }));
    expect(state).toEqual({ same: true, connected: true, expanded: "true" });
  });

  test("bereinigter Job zeigt, dass der Log fehlt", async ({ page }) => {
    await page.goto("/jobs?status=failed&repo=beispiel-firma/shop-api");
    // Tabelle und Karte stehen beide im DOM; je Layout ist eines ausgeblendet.
    await expect(page.getByText("Log nicht mehr verfügbar").locator("visible=true")).toHaveCount(1);
  });

  test("Noch kein Lauf bei einem Repo ohne Jobs", async ({ page }) => {
    await page.goto("/jobs?repo=beispiel-privat/leeres-repo");
    await expect(page.getByRole("heading", { name: "Noch kein Lauf." })).toBeVisible();
  });

  test("Entferntes Repo in der Adresse bleibt als Filter erhalten", async ({ page }) => {
    // Fixture: beispiel-firma/alt-tool ist entfernt und hat keine Läufe; es darf nicht "alles" erscheinen.
    await page.goto("/jobs?repo=beispiel-firma/alt-tool");
    await expect(page.getByRole("heading", { name: "Noch kein Lauf." })).toBeVisible();
    await expect(page.getByRole("link", { name: "beispiel-firma/kasse" })).toHaveCount(0);
    await expect(page.getByText(/7 Tagen/)).toHaveCount(0);
  });

  test("Sortierung steht in der Adresse und gilt für die Liste", async ({ page }, info) => {
    test.skip(info.project.name === "mobil", "Spaltenköpfe nur auf dem Desktop");
    await page.goto("/jobs?sort=repo&dir=asc");
    const repos = await page.locator("tbody tr td:nth-child(2) a").allTextContents();
    expect(repos.length).toBeGreaterThan(1);
    expect(repos).toEqual([...repos].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
  });

  test("Filter ohne Treffer bietet das Zurücksetzen an", async ({ page }) => {
    await page.goto("/jobs?repo=beispiel-privat/leeres-repo&status=failed");
    await expect(page.getByRole("heading", { name: "Keine Treffer für diese Filter." })).toBeVisible();
    await page.getByRole("link", { name: "Filter zurücksetzen" }).first().click();
    await expect(page).toHaveURL(/\/jobs$/);
  });
});

test.describe("Probleme", () => {
  test("Offen gruppiert nach Art, Behoben über den Umschalter", async ({ page }) => {
    await page.goto("/probleme");
    await expect(page.getByRole("heading", { level: 2, name: /Konfigurationsfehler/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Offen/ })).toHaveAttribute("aria-current", "page");

    await page.getByRole("link", { name: /^Behoben/ }).click();
    await expect(page).toHaveURL(/ansicht=behoben/);
    await expect(page.getByRole("link", { name: /^Behoben/ })).toHaveAttribute("aria-current", "page");
    await expect(page.getByText(/behoben am/).first()).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: /Konfigurationsfehler/ })).toHaveCount(0);
  });

  test("Belege verlinken auf Läufe, PR und Repo", async ({ page }) => {
    await page.goto("/probleme");
    await expect(page.getByRole("link", { name: "Log ansehen" }).first()).toHaveAttribute(
      "href",
      /^\/jobs\?repo=.+&status=failed$/,
    );
    await expect(page.getByRole("link", { name: /PR #12 öffnen/ })).toHaveAttribute(
      "href",
      "https://github.com/beispiel-firma/lager-sync/pull/12",
    );
    await expect(page.getByRole("link", { name: "Repo-Details" }).first()).toHaveAttribute("href", /^\/repos\//);
  });

  test("Entferntes Repo in der Adresse bleibt als Filter erhalten", async ({ page }) => {
    await page.goto("/probleme?art=stale_pr&repo=beispiel-firma/alt-tool");
    await expect(page.getByRole("heading", { name: "Keine Treffer für diese Filter." })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: /PR hängt/ })).toHaveCount(0);
  });

  test("Art-Filter steht in der Adresse", async ({ page }) => {
    await page.goto("/probleme?art=stale_pr");
    await expect(page.getByRole("heading", { level: 2, name: /PR hängt/ })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: /Konfigurationsfehler/ })).toHaveCount(0);
  });
});

test("Mobil: kein waagerechtes Scrollen", async ({ page }, info) => {
  test.skip(info.project.name !== "mobil", "nur im Projekt mobil");
  for (const path of ["/jobs", "/jobs?status=failed", "/probleme", "/probleme?ansicht=behoben"]) {
    await page.goto(path);
    if (path === "/jobs?status=failed") {
      await page.getByRole("button", { name: /Log anzeigen.*beispiel-firma\/kasse/ }).click();
    }
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width, path).toBeLessThanOrEqual(375);
  }
});
