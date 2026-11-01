import { expect, test } from "@playwright/test";

// Gate G-W5: The company on both networks and every system banner (Figma 154:3972, 154:4322, 154:4587).
for (const network of ["testnet", "mainnet"] as const) {
  for (const width of [1440, 1280, 1024]) {
    test(`company ${network} @${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/company?network=${network}`);
      await expect(page.getByRole("heading", { name: "The rules Shark can’t change" })).toBeVisible();
      if (network === "testnet") {
        await expect(page.getByText(/128\.00 in − 38\.40 workers − 10\.00 reviews − 9\.60 referrals = 70\.00 profit/)).toBeVisible();
        await expect(page.getByText("returned · below floor")).toBeVisible();
        await expect(page.getByText(/last changed 30 Oct by DAO proposal #11/)).toBeVisible();
        await expect(page.getByText(/enough for ≈ 23 payouts/)).toBeVisible();
        await expect(page.getByText("held · unresolved, up to 7 days")).toBeVisible();
      } else {
        await expect(page.getByText("3.20").first()).toBeVisible();
        await expect(page.getByText("sharkco.sputnik-dao.near")).toBeVisible();
        await expect(page.getByText(/Raven on Base through Chain Signatures/)).toBeVisible();
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBe(0);
      await page.screenshot({ path: `../../docs/web/screens/company-v2-${network}-${width}.png`, fullPage: true });
    });
  }
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
