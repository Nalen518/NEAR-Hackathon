import { expect, test } from "@playwright/test";

// Gate G-W1: the v2 component gallery, next to Figma Components v2.0 (130:1845) and Mascots v2.0 (129:860).
test("components gallery renders every v2 component", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dev/components");
  for (const t of ["Shark’s brief", "Owl’s review · passed", "Only the payer can see the delivery", "Not what you ordered?", "Shark is in the cage: 3 strikes.", "Nav v2 · Footer v2", "SeaMist (light · dark)", "OrderForm (summary", "Receipt (quote · delivered · public)", "live · from the contract"])
    await expect(page.getByText(t).first()).toBeVisible();
  const broken = await page.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src));
  expect(broken).toEqual([]);
  await page.screenshot({ path: "../../docs/web/screens/components-v2-1440.png", fullPage: true });
});

// API §0.3 N1: a host for another network is refused everywhere.
test("wrong network host shows a banner and blocks the order", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/company?mock=wrong_network");
  await expect(page.getByRole("alert").filter({ hasText: "This Shark host serves near:othernet, not near:testnet." })).toBeVisible();
  await expect(page.getByText("Live numbers unavailable. Showing sample data.")).toBeVisible();
  await page.goto("/order?mock=wrong_network");
  await page.getByLabel("Instructions").fill("Summarise this.");
  await page.locator("#source").fill("https://example.com/a");
  await page.getByLabel("Your NEAR account").fill("demo-buyer.testnet");
  await page.getByRole("button", { name: "Get brief & price" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Nothing was charged and nothing can be paid until they match." })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Pay / })).toHaveCount(0);
  await page.goto("/jobs/j_000042?mock=wrong_network");
  await expect(page.getByRole("heading", { name: "This job is on the other network" })).toBeVisible();
});

// Prompt §10: no horizontal scroll down to 1024 px, on every page and the states that change layout.
test("no horizontal scroll at 1024 px", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  const check = async (label: string) => {
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over, label).toBe(0);
  };
  for (const u of ["/order", "/jobs/j_000042", "/jobs/j_000042?mock=refunded", "/dev/components"]) {
    await page.goto(u);
    await check(u);
  }
  await page.goto("/jobs/j_000042");
  await page.getByRole("button", { name: "Sign in to view" }).click();
  await expect(page.getByText("you paid for this")).toBeVisible();
  await check("job payer view");
  await page.goto("/order");
  await page.getByLabel("Instructions").fill("Summarise this.");
  await page.locator("#source").fill("https://example.com/blog/intents-explained");
  await page.getByLabel("Your NEAR account").fill("demo-buyer.testnet");
  await page.getByRole("button", { name: "Get brief & price" }).click();
  await expect(page.getByRole("button", { name: /^Pay / })).toBeVisible();
  await check("order quote");
});
