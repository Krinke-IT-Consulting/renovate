import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { queryE2e, seed } from "./db";

/**
 * Mergen im Dashboard (Change dashboard-pr-merge, Tasks 4.1 bis 4.4): Knöpfe, Dialoge und
 * Sammel-Merge. Geprüft wird, was die Oberfläche selbst entscheidet: wo "Mergen" erscheint, was der
 * Dialog nennt, dass Abbrechen nichts protokolliert. Die Erfolgs- und Abweichungspfade des Merges
 * selbst gehören zur Server-Logik und stehen dort.
 *
 * Fixtures: grüne Patch/Minor-PRs sind kasse #59 (minor) und lager-sync #12 (minor); lager-sync
 * erlaubt nur den Merge-Commit, alle anderen Repos Squash und Merge-Commit. Sicherheit (shop-api #101,
 * blog #33) und Major (blog #35) sind vom Sammel-Merge ausgenommen, shop-api #98 und kasse #57 haben rote CI.
 */
const audit = () => queryE2e<{ action: string }>("select action from audit_log order by created_at");

test.beforeEach(async () => {
  await seed();
});

test.afterAll(async () => {
  await seed();
});

/** Zeile der PR-Tabelle (Desktop) bzw. Karte (Mobil) mit diesem Text. */
function prItem(page: Page, info: TestInfo, text: string) {
  const items =
    info.project.name === "mobil"
      ? page.getByRole("list", { name: "Offene Pull Requests" }).getByRole("listitem")
      : page.getByRole("table").locator("tbody tr");
  return items.filter({ hasText: text });
}

const mergeButton = (scope: Page | ReturnType<Page["locator"]>, repo: string, n: number) =>
  scope.getByRole("button", { name: `Mergen ${repo} #${n}`, exact: true });

async function openDialog(page: Page, button: ReturnType<Page["locator"]>) {
  await button.locator("visible=true").first().click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("Mergen in der PR-Liste", () => {
  test("Grüner PR: ruhiger Knopf, Dialog nennt PR und Methode, Abbrechen protokolliert nichts", async ({ page }, info) => {
    await page.goto("/pull-requests");
    const row = prItem(page, info, "expo monorepo");
    const button = mergeButton(row, "beispiel-firma/kasse", 59);
    await expect(button).toBeVisible();
    // Der Titel-Link zum PR bleibt neben dem Knopf.
    await expect(row.locator("a[href='https://github.com/beispiel-firma/kasse/pull/59']").first()).toBeVisible();

    const dialog = await openDialog(page, button);
    await expect(dialog.getByRole("heading", { name: "beispiel-firma/kasse #59 mergen?" })).toBeVisible();
    await expect(dialog).toContainText(
      "beispiel-firma/kasse #59 wird per Squash gemergt. Vorher prüft das Dashboard, ob CI und Commit noch stimmen.",
    );
    await dialog.getByRole("button", { name: "Abbrechen" }).click();
    await expect(dialog).toBeHidden();
    await expect(button.locator("visible=true").first()).toBeFocused();
    expect(await audit()).toEqual([]);
  });

  test("Repo mit nur Merge-Commit: der Dialog nennt den Merge-Commit", async ({ page }, info) => {
    await page.goto("/pull-requests");
    const dialog = await openDialog(page, mergeButton(prItem(page, info, "requests to v2.33.0"), "beispiel-firma/lager-sync", 12));
    await expect(dialog).toContainText("beispiel-firma/lager-sync #12 wird per Merge-Commit gemergt.");
    await dialog.getByRole("button", { name: "Abbrechen" }).click();
    expect(await audit()).toEqual([]);
  });

  test("Rote oder laufende CI: kein Knopf, der Link zum PR bleibt", async ({ page }, info) => {
    await page.goto("/pull-requests");
    for (const [text, href] of [
      ["next to v16", "https://github.com/beispiel-firma/shop-api/pull/98"],
      ["zod to v4.6.8", "https://github.com/beispiel-firma/shop-api/pull/103"],
    ]) {
      const row = prItem(page, info, text);
      await expect(row.getByRole("button", { name: /^Mergen/ })).toHaveCount(0);
      await expect(row.locator(`a[href='${href}']`).first()).toBeVisible();
    }
  });

  test("Repo ohne erlaubte Methode: kein Knopf trotz grüner CI", async ({ page }, info) => {
    await queryE2e("update repositories set merge_methods = '{}' where full_name = $1", ["beispiel-firma/kasse"]);
    await page.goto("/pull-requests");
    await expect(prItem(page, info, "expo monorepo").getByRole("button", { name: /^Mergen/ })).toHaveCount(0);
    // Die Sammel-Zahl folgt: nur noch lager-sync #12.
    await expect(page.getByRole("button", { name: "Alle grünen Patch- und Minor-PRs mergen (1)" })).toBeVisible();
  });

  test("Repo-Detail: dieselbe Tabelle mit Knopf, Dialog mit Methode", async ({ page }) => {
    await page.goto("/repos/beispiel-firma/lager-sync");
    const dialog = await openDialog(page, mergeButton(page, "beispiel-firma/lager-sync", 12));
    await expect(dialog).toContainText("beispiel-firma/lager-sync #12 wird per Merge-Commit gemergt.");
    await dialog.getByRole("button", { name: "Abbrechen" }).click();
    expect(await audit()).toEqual([]);
  });
});

test.describe("Mergen im Lagebericht", () => {
  test("Grünes Sicherheitsupdate: Hauptaktion ist Mergen mit Bestätigung, kein Plattform-Link", async ({ page }) => {
    await page.goto("/");
    const button = mergeButton(page, "beispiel-firma/shop-api", 101);
    await expect(button.locator("visible=true").first()).toBeVisible();
    await expect(mergeButton(page, "beispiel-privat/blog", 33).locator("visible=true").first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Auf GitHub mergen/ })).toHaveCount(0);

    const dialog = await openDialog(page, button);
    await expect(dialog).toContainText("beispiel-firma/shop-api #101 wird per Squash gemergt.");
    await dialog.getByRole("button", { name: "Abbrechen" }).click();
    expect(await audit()).toEqual([]);
  });

  test("Major-Update: grüne CI bietet Mergen, rote CI bleibt beim Link „Freigeben“", async ({ page }) => {
    await page.goto("/");
    await expect(mergeButton(page, "beispiel-privat/blog", 35).locator("visible=true").first()).toBeVisible();
    // shop-api #98 und kasse #57 haben rote CI.
    await expect(page.getByRole("link", { name: /^Freigeben/ }).locator("visible=true")).toHaveCount(2);
  });

  test("Repo-Detail: Schritte mit Mergen als Hauptaktion", async ({ page }) => {
    await page.goto("/repos/beispiel-privat/blog");
    // Schritte (olivfarbene Hauptaktion) und PR-Tabelle (ruhiger Knopf) stehen in eigenen Abschnitten.
    const steps = page.getByRole("region", { name: /^Was hier zu tun ist/ });
    await expect(mergeButton(steps, "beispiel-privat/blog", 33)).toBeVisible();
    await expect(mergeButton(steps, "beispiel-privat/blog", 35)).toBeVisible();
    await expect(mergeButton(page.getByRole("region", { name: /^Offene PRs/ }), "beispiel-privat/blog", 33).locator("visible=true")).toHaveCount(1);
  });
});

test.describe("Sammel-Merge", () => {
  const LABEL = "Alle grünen Patch- und Minor-PRs mergen (2)";

  test("Knopf zeigt die Zahl, Dialog nennt PRs, Repos und Ausnahmen, Abbrechen protokolliert nichts", async ({ page }) => {
    await page.goto("/pull-requests");
    const button = page.getByRole("button", { name: LABEL });
    await expect(button).toBeVisible();

    const dialog = await openDialog(page, button);
    await expect(dialog).toContainText(
      "2 PRs in 2 Repos werden nacheinander gemergt. Sicherheits- und Major-Updates sind ausgenommen. Jeder PR wird vorher geprüft.",
    );
    await dialog.getByRole("button", { name: "Abbrechen" }).click();
    await expect(dialog).toBeHidden();
    expect(await audit()).toEqual([]);
  });

  test("Filter ändern die Zahl nicht", async ({ page }) => {
    await page.goto("/pull-requests?typ=major");
    await expect(page.getByRole("button", { name: LABEL })).toBeVisible();
  });

  test("Ohne grüne Patch- oder Minor-PRs gibt es keinen Knopf", async ({ page }) => {
    await queryE2e("update pull_requests set ci_status = 'failure' where update_type in ('patch', 'minor')");
    await page.goto("/pull-requests");
    await expect(page.getByRole("heading", { name: "Pull Requests", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: /Alle grünen Patch- und Minor-PRs mergen/ })).toHaveCount(0);
  });
});

test.describe("Handy", () => {
  test("Karten mit Kartenknopf von mindestens 44 px, keine waagerechte Seitenleiste", async ({ page }, info) => {
    test.skip(info.project.name !== "mobil", "nur 375 px");
    await page.goto("/pull-requests");
    const button = mergeButton(prItem(page, info, "expo monorepo"), "beispiel-firma/kasse", 59);
    await expect(button).toBeVisible();
    const box = (await button.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThan(300);
    await expect(page.getByRole("button", { name: "Alle grünen Patch- und Minor-PRs mergen (2)" })).toBeVisible();

    for (const path of ["/pull-requests", "/", "/repos/beispiel-privat/blog"]) {
      await page.goto(path);
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(width, path).toBeLessThanOrEqual(375);
    }
  });
});

/**
 * Erfolgs- und Abweichungspfade mit der echten Server-Logik (Merge-Kern) gegen den Plattform-Ersatz,
 * der den Stand aus der Datenbank liest. Änderungen "auf der Plattform" nach dem Rendern entstehen
 * per SQL.
 */
test.describe("Mergen ausführen", () => {
  const state = (repo: string, n: number) =>
    queryE2e<{ state: string }>(
      "select p.state from pull_requests p join repositories r on r.id = p.repository_id where r.full_name = $1 and p.number = $2",
      [repo, n],
    ).then((rows) => rows[0]?.state);

  test("Grüner PR in der Liste: gemergt, Meldung mit Link, Status und AuditLog", async ({ page }, info) => {
    await page.goto("/pull-requests");
    const dialog = await openDialog(page, mergeButton(prItem(page, info, "expo monorepo"), "beispiel-firma/kasse", 59));
    await dialog.getByRole("button", { name: "Mergen", exact: true }).click();

    const status = page.getByRole("status").filter({ hasText: /gemergt/ }).locator("visible=true").first();
    await expect(status).toBeVisible();
    await expect(status.getByRole("link", { name: /#59/ })).toHaveAttribute("href", "https://github.com/beispiel-firma/kasse/pull/59");
    expect(await state("beispiel-firma/kasse", 59)).toBe("merged");
    expect((await audit()).map((a) => a.action)).toEqual(["pr.merge"]);
    // Der PR ist nicht mehr offen und verschwindet aus der Liste.
    await expect(prItem(page, info, "expo monorepo")).toHaveCount(0);
  });

  test("Neuer Commit seit dem Klick: nicht gemergt, Meldung nennt den Grund", async ({ page }, info) => {
    await page.goto("/pull-requests");
    const button = mergeButton(prItem(page, info, "expo monorepo"), "beispiel-firma/kasse", 59);
    await expect(button.locator("visible=true").first()).toBeVisible();
    await queryE2e(
      "update pull_requests set head_sha = 'ffffffffffffffffffffffffffffffffffffffff' where number = 59",
    );
    const dialog = await openDialog(page, button);
    await dialog.getByRole("button", { name: "Mergen", exact: true }).click();

    await expect(page.getByText(/geändert/).locator("visible=true").first()).toBeVisible();
    expect(await state("beispiel-firma/kasse", 59)).toBe("open");
    expect((await audit()).map((a) => a.action)).toEqual(["pr.merge.skipped"]);
  });

  test("Lagebericht: grünes Sicherheitsupdate wird gemergt und als erledigt abgehakt", async ({ page }) => {
    await page.goto("/");
    const dialog = await openDialog(page, mergeButton(page, "beispiel-firma/shop-api", 101));
    await dialog.getByRole("button", { name: "Mergen", exact: true }).click();

    await expect(page.getByRole("status").filter({ hasText: /gemergt/ }).locator("visible=true").first()).toBeVisible();
    expect(await state("beispiel-firma/shop-api", 101)).toBe("merged");
    expect((await audit()).map((a) => a.action)).toEqual(["pr.merge"]);
  });

  test("Sammel-Merge, gemischte Lage: einer gemergt, einer mit Grund übersprungen", async ({ page }) => {
    await page.goto("/pull-requests");
    const button = page.getByRole("button", { name: "Alle grünen Patch- und Minor-PRs mergen (2)" });
    await expect(button).toBeVisible();
    // lager-sync #12 bekommt nach dem Rendern einen neuen Commit.
    await queryE2e(
      "update pull_requests set head_sha = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' where number = 12",
    );
    const dialog = await openDialog(page, button);
    await dialog.getByRole("button", { name: "Alle mergen" }).click();

    const message = page.getByText(/1 PR gemergt, 1 übersprungen/).locator("visible=true").first();
    await expect(message).toBeVisible();
    expect(await state("beispiel-firma/kasse", 59)).toBe("merged");
    expect(await state("beispiel-firma/lager-sync", 12)).toBe("open");
    const actions = (await audit()).map((a) => a.action);
    expect(actions[0]).toBe("pr.merge_bulk");
    expect(actions.slice(1).sort()).toEqual(["pr.merge", "pr.merge.skipped"]);
  });
});
