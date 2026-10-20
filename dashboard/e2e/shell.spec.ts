import { expect, test } from "@playwright/test";

test("Shell zeigt den Abgleich-Stempel aus sync_state", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Abgleich").first()).toBeVisible();
  await expect(page.getByText(/GitHub \d{2}:\d{2}/).first()).toBeAttached();
});
