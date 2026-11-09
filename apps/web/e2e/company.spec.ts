import { expect, test } from "@playwright/test";

// Gate G-W5: The company and every system banner (Figma 154:3972, 154:4587).
for (const width of [1440, 1280, 1024]) {
  test(`company @${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/company");
    await expect(page.getByRole("heading", { name: "The rules Shark can’t change" })).toBeVisible();
    await expect(page.getByText(/128\.00 in − 38\.40 workers − 10\.00 reviews − 9\.60 referrals = 70\.00 profit/)).toBeVisible();
    await expect(page.getByText("returned · below floor")).toBeVisible();
    await expect(page.getByText(/last changed 30 Oct by DAO proposal #11/)).toBeVisible();
    await expect(page.getByText(/enough for ≈ 23 payouts/)).toBeVisible();
    await expect(page.getByText("held · unresolved, up to 7 days")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
    await page.screenshot({ path: `../../docs/web/screens/company-v2-${width}.png`, fullPage: true });
  });
}

for (const [mock, text] of [
  ["closed", "This company has been wound down."],
  ["paused", "The company is paused."],
  ["caged", "Shark is in the cage: 3 strikes."],
  ["no_worker", "No worker can take this job right now."],
  ["out_of_budget", "Shark has used today’s budget."],
] as const) {
  test(`banner ${mock}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/company?mock=${mock}`);
    await expect(page.getByRole("status").filter({ hasText: text })).toBeVisible();
  });
}

test("caged shows 3 of 3 and the cage", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/company?mock=caged");
  await expect(page.getByRole("heading", { name: "Shark is on 3 strikes" })).toBeVisible();
  await expect(page.getByText("3 of 3")).toBeVisible();
});

test("API down keeps the page with sample data and a notice", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/company?mock=upstream_down");
  await expect(page.getByText("Live numbers unavailable. Showing sample data.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Where the money went" })).toBeVisible();
});

test("the new incident kinds have names", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/company?mock=incident_kinds");
  for (const t of ["company · payout failed", "company · worker suspended", "j_000040 · strike"]) await expect(page.getByText(t)).toBeVisible();
});

test("Raven gas with no Base address reads not connected, not empty", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/company?mock=raven_gas_unset");
  await expect(page.getByText("not connected", { exact: true })).toBeVisible();
  await expect(page.getByText(/0 Sepolia ETH/)).toHaveCount(0);
  await expect(page.getByText(/payout gas not connected/)).toBeVisible();
});
