import { expect, test } from "@playwright/test";

/**
 * Text-Zoom 200 % (WCAG 1.4.4): Nur die Schriftgröße wächst (`documentElement.style.fontSize`),
 * die Seite darf nicht waagerecht scrollen. Läuft in beiden Projekten (375 und 1440 px). Die
 * Media-Queries bleiben dabei in Pixeln der Standardgröße: Bei 1440 px gilt weiter das Desktop-Layout.
 */
const PATHS = ["/", "/repos", "/repos/beispiel-firma/kasse", "/pull-requests", "/jobs", "/probleme"];

for (const path of PATHS) {
  test(`Text-Zoom 200 % ohne Querscrollen: ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    const { scrollWidth, clientWidth, culprits } = await page.evaluate(() => {
      const de = document.documentElement;
      const width = de.clientWidth;
      // Elemente, die über den rechten Rand ragen und nicht in einem eigenen Scrollcontainer stehen.
      const out: string[] = [];
      for (const el of Array.from(document.body.querySelectorAll("*"))) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.right <= width + 1) continue;
        let p = el.parentElement;
        let scrolls = false;
        while (p && p !== document.body) {
          const o = getComputedStyle(p).overflowX;
          if (o === "auto" || o === "scroll" || o === "hidden") scrolls = true;
          p = p.parentElement;
        }
        if (!scrolls) out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}: ${Math.round(r.right)}`);
      }
      return { scrollWidth: de.scrollWidth, clientWidth: width, culprits: out.slice(0, 6) };
    });
    expect(scrollWidth, `ragt über den Rand: ${culprits.join(" | ")}`).toBeLessThanOrEqual(clientWidth);
  });
}
