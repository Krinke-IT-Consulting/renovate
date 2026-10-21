import { expect, test, type Page } from "@playwright/test";

/** Repos und Repo-Detail gegen die Fixture-Daten (Task 6.3). */

/** Tabelle und Karten stehen beide im DOM; je Viewport ist eines ausgeblendet. */
function visibleRows(page: Page) {
  return page.locator("tbody tr, ul[aria-label='Repos'] > li").locator("visible=true");
}

test.describe("Repos", () => {
  test("Link aus dem Lagebericht: onboarding=none zeigt nur infra, Chip ist aktiv", async ({ page }) => {
    await page.goto("/repos?onboarding=none");
    await expect(page.getByRole("link", { name: /^Nicht onboardet/ })).toHaveAttribute("aria-current", "true");
    await expect(visibleRows(page)).toHaveCount(1);
    await expect(visibleRows(page).first()).toContainText("beispiel-firma/infra");
    await expect(page.getByRole("heading", { level: 1, name: "Repos" })).toBeVisible();
    await expect(page.getByText(/^1 Repo \(gefiltert\)/)).toBeVisible();
  });

  test("Owner-Filter", async ({ page }) => {
    await page.goto("/repos?owner=beispiel-privat");
    await expect(page.getByRole("link", { name: /^beispiel-privat/ }).first()).toHaveAttribute("aria-current", "true");
    const rows = visibleRows(page);
    await expect(rows.first()).toBeVisible();
    const texts = await rows.allInnerTexts();
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) expect(t).toContain("beispiel-privat/");
    expect(texts.join("\n")).not.toContain("beispiel-firma/");
  });

  test("Entfernte Repos nur mit dem Chip", async ({ page }) => {
    await page.goto("/repos");
    await expect(page.getByRole("link", { name: "beispiel-firma/alt-tool" })).toHaveCount(0);
    await page.getByRole("link", { name: /^Entfernte zeigen/ }).click();
    await expect(page).toHaveURL(/entfernt=1/);
    await expect(page.getByRole("link", { name: "beispiel-firma/alt-tool" }).locator("visible=true")).toHaveCount(1);
  });

  test("Standardsortierung nach Handlungsbedarf: Fehler stehen vor Warnungen", async ({ page }) => {
    await page.goto("/repos");
    const rows = visibleRows(page);
    const first = await rows.first().innerText();
    // shop-api (Sicherheitsupdate) und blog (Sicherheitsupdate) sind Fehler; website ist aktuell.
    expect(first).toMatch(/Sicherheitsupdate|Lauf fehlgeschlagen|Konfigurationsfehler|CI rot|Lockfile/);
    const texts = await rows.allInnerTexts();
    const idx = (n: string) => texts.findIndex((t) => t.includes(n));
    expect(idx("beispiel-firma/shop-api")).toBeLessThan(idx("beispiel-firma/website"));
    expect(idx("beispiel-firma/legacy-portal")).toBeGreaterThan(idx("beispiel-firma/website"));
  });

  test("Sortieren per Tastatur: Spaltenkopf fokussieren, Enter", async ({ page }, info) => {
    test.skip(info.project.name === "mobil", "Spaltenköpfe gibt es nur in der Tabelle");
    await page.goto("/repos");
    const header = page.getByRole("columnheader", { name: /^Repo/ });
    await expect(header).not.toHaveAttribute("aria-sort", /.+/);
    await header.getByRole("button").focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/sort=repo/);
    await expect(header).toHaveAttribute("aria-sort", /ascending|descending/);

    const names = await page.locator("tbody tr td:first-child a").allInnerTexts();
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  test("Ein Klick auf einen Chip setzt den Filter in der Adresse", async ({ page }) => {
    await page.goto("/repos");
    await page.getByRole("link", { name: /^Eigene CI/ }).click();
    await expect(page).toHaveURL(/eigene-ci=1/);
    await expect(visibleRows(page)).toHaveCount(1);
    await expect(visibleRows(page).first()).toContainText("beispiel-firma/website");
    await page.getByRole("link", { name: "Filter zurücksetzen" }).first().click();
    await expect(page).toHaveURL(/\/repos$/);
  });

  test("Kein Treffer bietet das Zurücksetzen an", async ({ page }) => {
    await page.goto("/repos?q=gibt-es-nicht");
    await expect(page.getByRole("heading", { level: 2, name: "Keine Treffer für diese Filter." })).toBeVisible();
  });

  test("Die Repo-Spalte verlinkt aufs Detail", async ({ page }) => {
    await page.goto("/repos?q=kasse");
    await page.getByRole("link", { name: "beispiel-firma/kasse" }).locator("visible=true").click();
    await expect(page).toHaveURL(/\/repos\/beispiel-firma\/kasse$/);
  });
});

test.describe("Repo-Detail", () => {
  test("kasse: Was hier zu tun ist mit fehlgeschlagenem Lauf und PR #57", async ({ page }) => {
    await page.goto("/repos/beispiel-firma/kasse");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("beispiel-firma/kasse");

    const section = page.getByRole("region", { name: "Was hier zu tun ist" });
    await expect(section).toBeVisible();
    await expect(section.getByText("Fehlgeschlagenen Lauf klären")).toBeVisible();
    await expect(section.getByText("PR #57").first()).toBeVisible();

    // Erster Abschnitt der Seite.
    const firstH2 = page.locator("main h2").first();
    await expect(firstH2).toHaveText(/Was hier zu tun ist/);

    await expect(page.getByRole("link", { name: /Auf GitHub öffnen/ })).toHaveAttribute(
      "href",
      "https://github.com/beispiel-firma/kasse",
    );
    await expect(page.getByRole("link", { name: /Dependency Dashboard/ })).toHaveAttribute(
      "href",
      "https://github.com/beispiel-firma/kasse/issues/1",
    );
    await expect(page.getByRole("link", { name: "Alle Läufe" })).toHaveAttribute(
      "href",
      "/jobs?repo=beispiel-firma%2Fkasse",
    );
    for (const name of ["Offene PRs", "Letzte Jobs", "Probleme", "Rollout-Aktionen"]) {
      await expect(page.getByRole("heading", { level: 2, name: new RegExp(`^${name}`) })).toBeVisible();
    }
    // kasse ist onboardet und hat den Build-Check: nur "Lauf starten", kein Onboarding- oder Rollout-Knopf.
    await expect(page.getByRole("button", { name: "Lauf starten" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Onboarding|ausrollen/ })).toHaveCount(0);
  });

  test("leeres-repo: Noch kein Lauf, Nichts zu tun", async ({ page }) => {
    await page.goto("/repos/beispiel-privat/leeres-repo");
    await expect(page.getByText("Noch kein Lauf.", { exact: true })).toBeVisible();
    await expect(page.getByText("Nichts zu tun.", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Dependency Dashboard" })).toHaveCount(0);
  });

  test("shop-api: Rollout-Aktionen mit PR-Link", async ({ page }) => {
    await page.goto("/repos/beispiel-firma/shop-api");
    const link = page.getByRole("link", { name: /PR #4/ }).locator("visible=true");
    await expect(link).toHaveAttribute("href", "https://github.com/beispiel-firma/shop-api/pull/4");
  });

  test("infra: Onboarding-Schritt ohne Knopf", async ({ page }) => {
    await page.goto("/repos/beispiel-firma/infra");
    const section = page.getByRole("region", { name: "Was hier zu tun ist" });
    await expect(section.getByText("Noch keine Renovate-Konfiguration")).toBeVisible();
    await expect(section.getByRole("link")).toHaveCount(0);
  });

  test("entferntes Repo ist gekennzeichnet", async ({ page }) => {
    await page.goto("/repos/beispiel-firma/alt-tool");
    await expect(page.getByText(/nicht\s+mehr auf der Plattform erreichbar/)).toBeVisible();
  });

  test("unbekanntes Repo zeigt die Not-Found-Seite", async ({ page }) => {
    // Kein Statuscode-Test: mit loading.tsx ist der Kopf der Antwort beim notFound() schon gesendet (200).
    await page.goto("/repos/gibt/es-nicht");
    await expect(page.getByRole("heading", { level: 1, name: "Seite nicht gefunden" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Alle Repos ansehen" })).toHaveAttribute("href", "/repos");
  });
});

test("Mobil: kein waagerechtes Scrollen", async ({ page }, info) => {
  test.skip(info.project.name !== "mobil", "nur im Projekt mobil");
  for (const path of [
    "/repos",
    "/repos?entfernt=1",
    "/repos/beispiel-firma/kasse",
    "/repos/beispiel-firma/shop-api",
    "/repos/beispiel-privat/leeres-repo",
    "/repos/beispiel-firma/alt-tool",
  ]) {
    await page.goto(path);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width, path).toBeLessThanOrEqual(375);
  }
});
