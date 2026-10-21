import { expect, test, type Page } from "@playwright/test";
import { queryE2e, seed } from "./db";

/**
 * Aktionen in der Oberfläche (Phase 7): Bestätigung, Meldung, AuditLog. Renovate CE ist der
 * Fake aus e2e/fake-ce.mjs, die Rollout-Logik der Platzhalter ("Noch nicht verfügbar.").
 */
const CE_URL = `http://127.0.0.1:${process.env.E2E_CE_PORT ?? 9291}`;

const ceCalls = async (): Promise<string[]> => ((await (await fetch(`${CE_URL}/__calls`)).json()) as { calls: string[] }).calls;
const audit = () => queryE2e<{ actor: string; action: string; target: string }>("select actor, action, target from audit_log order by created_at");

test.beforeEach(async () => {
  // Jeder Test beginnt mit frischen Fixtures, leerem AuditLog und leerer Fake-CE-Warteschlange.
  await seed();
  await fetch(`${CE_URL}/__reset`, { method: "POST" });
});

test.afterAll(async () => {
  await seed();
});

/** Meldung einer Aktion (role="status"); mehrere Aktionen auf einer Seite haben je eine eigene Region. */
const status = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });

/** Öffnet den Dialog über den Knopf und gibt ihn zurück. */
async function openDialog(page: Page, buttonName: string | RegExp) {
  await page.getByRole("button", { name: buttonName }).locator("visible=true").first().click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("Bestätigung", () => {
  test("Abgebrochene Bestätigung: nichts passiert, kein AuditLog-Eintrag, kein Aufruf an CE", async ({ page }) => {
    await page.goto("/repos/beispiel-firma/kasse");
    const trigger = page.getByRole("button", { name: "Lauf starten" });
    const dialog = await openDialog(page, "Lauf starten");
    await expect(dialog.getByRole("heading", { name: "Lauf starten?" })).toBeVisible();
    await expect(dialog).toContainText("Renovate CE reiht für beispiel-firma/kasse einen Lauf ein.");

    await dialog.getByRole("button", { name: "Abbrechen" }).click();
    await expect(dialog).toBeHidden();
    // Der Fokus kehrt zum Knopf zurück.
    await expect(trigger).toBeFocused();
    await expect(page.getByRole("status").filter({ hasText: /\S/ })).toHaveCount(0);

    expect(await audit()).toEqual([]);
    expect(await ceCalls()).toEqual([]);
  });

  test("Escape bricht ebenfalls ab", async ({ page }) => {
    await page.goto("/repos/beispiel-firma/kasse");
    const dialog = await openDialog(page, "Lauf starten");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect(await audit()).toEqual([]);
  });
});

test.describe("Läufe", () => {
  test("Lauf starten im Repo-Detail: Meldung mit Link, AuditLog, zweiter Klick ohne zweiten Lauf", async ({ page }) => {
    await page.goto("/repos/beispiel-firma/kasse");
    const dialog = await openDialog(page, "Lauf starten");
    await dialog.getByRole("button", { name: "Lauf starten" }).click();

    const lauf = status(page, "Lauf eingereiht.");
    await expect(lauf).toBeVisible();
    await expect(lauf.getByRole("link", { name: "Läufe des Repos ansehen" })).toHaveAttribute(
      "href",
      "/jobs?repo=beispiel-firma%2Fkasse",
    );
    expect(await ceCalls()).toEqual(["beispiel-firma/kasse"]);
    expect(await audit()).toEqual([{ actor: "fixture", action: "job.trigger", target: "beispiel-firma/kasse" }]);

    // Zweiter Klick: CE meldet "unchanged", es entsteht kein zweiter Lauf.
    const again = await openDialog(page, "Lauf starten");
    await again.getByRole("button", { name: "Lauf starten" }).click();
    await expect(status(page, "Für dieses Repo wartet oder läuft bereits ein Lauf.")).toBeVisible();
    await expect(status(page, "Lauf eingereiht.")).toHaveCount(0);
  });

  test("Alle Repos laufen lassen: Dialog nennt die Anzahl, Meldung ebenfalls", async ({ page }) => {
    await page.goto("/jobs");
    const dialog = await openDialog(page, "Alle Repos laufen lassen");
    // Fixtures: neun onboardete, nicht archivierte, nicht entfernte Repos.
    await expect(dialog).toContainText("für 9 onboardete Repos je einen Lauf ein");
    await dialog.getByRole("button", { name: "Alle Läufe einreihen" }).click();

    const alle = status(page, "9 Läufe eingereiht.");
    await expect(alle).toBeVisible();
    await expect(alle.getByRole("link", { name: "Läufe ansehen" })).toHaveAttribute("href", "/jobs");
    expect(await ceCalls()).toHaveLength(9);
    expect(await audit()).toEqual([{ actor: "fixture", action: "job.trigger_all", target: "9 Repos" }]);
  });
});

test.describe("Eigene CI", () => {
  test("Markieren: Build-Check-Status und Problem verschwinden, Aufheben bringt sie zurück", async ({ page }) => {
    await page.goto("/repos/beispiel-firma/lager-sync");
    const facts = page.locator("header dl");
    await expect(facts).toContainText("Fehlt");
    await expect(page.getByRole("button", { name: "Build-Check ausrollen" })).toBeVisible();
    const problems = page.getByRole("region", { name: "Probleme" });
    await expect(problems).toContainText("Build-Check fehlt");

    const dialog = await openDialog(page, "Als eigene CI markieren");
    await dialog.getByRole("button", { name: "Als eigene CI markieren" }).click();

    await expect(status(page, "Als eigene CI markiert.")).toBeVisible();
    await expect(facts).toContainText("Eigene CI");
    await expect(facts).not.toContainText("Fehlt");
    await expect(problems).not.toContainText("Build-Check fehlt");
    await expect(page.getByRole("button", { name: "Build-Check ausrollen" })).toHaveCount(0);

    const open = await queryE2e("select 1 from problems p join repositories r on r.id = p.repository_id where r.full_name = $1 and p.kind = 'missing_build_check' and p.resolved_at is null", ["beispiel-firma/lager-sync"]);
    expect(open).toEqual([]);
    expect(await audit()).toEqual([
      { actor: "fixture", action: "repo.own_ci", target: "beispiel-firma/lager-sync: eigene CI an" },
    ]);

    const undo = await openDialog(page, /Markierung .eigene CI. aufheben/);
    await undo.getByRole("button", { name: "Markierung aufheben" }).click();
    await expect(status(page, "Markierung aufgehoben.")).toBeVisible();
    await expect(facts).toContainText("Fehlt");
    await expect(page.getByRole("button", { name: "Build-Check ausrollen" })).toBeVisible();
  });
});

test.describe("Onboarding und Rollout", () => {
  test("Repo-Detail: Onboarding-PR anlegen zeigt die Meldung der Rollout-Logik als Fehler", async ({ page }) => {
    await page.goto("/repos/beispiel-firma/infra");
    const dialog = await openDialog(page, "Onboarding-PR anlegen");
    await expect(dialog).toContainText("Das Dashboard legt für beispiel-firma/infra einen Pull Request an");
    await dialog.getByRole("button", { name: "Onboarding-PR anlegen" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Noch nicht verfügbar." })).toBeVisible();
  });

  test("Repo-Detail zeigt nur die passenden Knöpfe", async ({ page }) => {
    await page.goto("/repos/beispiel-firma/infra");
    await expect(page.getByRole("button", { name: "Lauf starten" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Build-Check ausrollen" })).toHaveCount(0);
    await page.goto("/repos/beispiel-firma/shop-api");
    await expect(page.getByRole("button", { name: "Lauf starten" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Onboarding-PR anlegen" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Build-Check ausrollen" })).toHaveCount(0);
    await page.goto("/repos/beispiel-firma/legacy-portal");
    await expect(page.getByRole("button", { name: "Lauf starten" })).toHaveCount(0);
    await page.goto("/repos/beispiel-firma/alt-tool");
    await expect(page.getByRole("region", { name: "Aktionen" })).toHaveCount(0);
  });

  test("Lagebericht: der Onboarding-Schritt legt den Onboarding-PR an statt zum Repo zu führen", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Zum Repo" })).toHaveCount(0);
    const dialog = await openDialog(page, "Onboarding-PR anlegen");
    await expect(dialog).toContainText("beispiel-firma/infra");
    await dialog.getByRole("button", { name: "Abbrechen" }).click();
    expect(await audit()).toEqual([]);
  });
});

test.describe("Automatisches Onboarding", () => {
  test("Schalter je Owner: Standard aus, Einschalten nach Bestätigung, AuditLog", async ({ page }) => {
    await page.goto("/repos");
    const section = page.getByRole("region", { name: "Automatisches Onboarding" });
    await expect(section).toContainText("Bestehende Repos sind ausgenommen.");
    const toggle = section.getByRole("button", { name: /für beispiel-firma/ });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(toggle).toContainText("Aus");

    const dialog = await openDialog(page, /Automatisches Onboarding für beispiel-firma/);
    await dialog.getByRole("button", { name: "Einschalten" }).click();
    await expect(status(page, "ist an")).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(toggle).toContainText("An");
    expect(await audit()).toEqual([{ actor: "fixture", action: "settings.auto_onboarding", target: "beispiel-firma: an" }]);
    const [conn] = await queryE2e<{ on: boolean; at: Date | null }>(
      "select auto_onboarding as on, auto_onboarding_enabled_at as at from platform_connections where owner_name = 'beispiel-firma'",
    );
    expect(conn?.on).toBe(true);
    expect(conn?.at).not.toBeNull();
  });
});

test("Mobil: Dialog ist bedienbar und die Seite scrollt nicht waagerecht", async ({ page }, info) => {
  test.skip(info.project.name !== "mobil", "nur im Projekt mobil");
  await page.goto("/repos/beispiel-firma/kasse");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  const dialog = await openDialog(page, "Lauf starten");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(375);
  for (const name of ["Abbrechen", "Lauf starten"]) {
    const button = dialog.getByRole("button", { name });
    await expect(button).toBeVisible();
    // Die Einblendung skaliert kurz; erst danach gilt die endgültige Größe.
    await expect.poll(async () => (await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await dialog.getByRole("button", { name: "Lauf starten" }).click();
  await expect(status(page, "Lauf eingereiht.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  for (const path of ["/jobs", "/repos", "/"]) {
    await page.goto(path);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(375);
  }
});
