import { expect, test, type Page } from "@playwright/test";

// Gate G-W3: fill → 402 → mock paid → job, and every state of Figma 150:4148 via ?mock=.
async function fill(page: Page, mock = "") {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/order${mock ? `?mock=${mock}` : ""}`);
  await page.getByLabel("Instructions").fill("Summarise this article in 150 words or fewer. Mention NEAR Intents and fees.");
  await page.locator("#source").fill("https://example.com/blog/intents-explained");
  await page.getByLabel("Your NEAR account").fill("demo-buyer.testnet");
}
const getQuote = (page: Page) => page.getByRole("button", { name: "Get brief & price" }).click();

test("order → brief → pay → delivered, with the job link", async ({ page }) => {
  await fill(page);
  await getQuote(page);
  await expect(page.getByText("Shark’s reason: “6 pages, 2 required points.”")).toBeVisible();
  await expect(page.getByText("Shark’s brief · checked by code")).toBeVisible();
  await expect(page.getByText("Word count is 150 or fewer").first()).toBeVisible();
  await page.getByRole("button", { name: "Pay 0.60 test USDC" }).click();
  await expect(page.getByText("Paid 0.60 test USDC on NEAR").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Owl passed it in a TEE: 5 of 5 checks/)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("p").filter({ hasText: "Crab +0.18" }).filter({ hasText: "Owl +0.05" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("link", { name: /Open the job page/ })).toHaveAttribute("href", /\/jobs\/j_\d+/);
  await page.screenshot({ path: "../../docs/web/screens/order-delivered-1440.png", fullPage: true });
});

test("quoting shows Shark writing the brief", async ({ page }) => {
  await fill(page, "quoting");
  await getQuote(page);
  await expect(page.getByText("Shark is writing your brief")).toBeVisible();
  await expect(page.getByText("your money: not charged yet")).toBeVisible();
});

for (const [mock, title] of [
  ["refused", "We can’t take this job"],
  ["infeasible", "Can’t be done as asked"],
  ["unreadable", "Shark couldn’t read the source"],
] as const) {
  test(`422 ${mock}`, async ({ page }) => {
    await fill(page, mock);
    await getQuote(page);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByText(/your money: not charged/)).toBeVisible();
  });
}

test("infeasible offers Shark's own fixes, each with its price", async ({ page }) => {
  await fill(page, "infeasible");
  await getQuote(page);
  await expect(page.getByRole("button", { name: /Raise the limit to 300 words\s*0\.75 test USDC/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Keep 1 required point\s*0\.60 test USDC/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit the order myself" })).toBeVisible();
});

test("413 is an inline source error", async ({ page }) => {
  await fill(page, "too_large");
  await getQuote(page);
  await expect(page.getByRole("alert").filter({ hasText: "That file is over 2 MB or 20 pages. Nothing was charged." })).toBeVisible();
});

for (const [mock, text] of [
  ["paused", "The company is paused."],
  ["caged", "Shark is in the cage: 3 strikes."],
  ["no_worker", "No worker can take this job right now."],
  ["out_of_budget", "Shark has used today’s budget."],
  ["rate_limited", "Too many requests: try again in 30 s."],
  ["upstream_down", "A service we depend on didn’t answer."],
] as const) {
  test(`system state ${mock}`, async ({ page }) => {
    await fill(page, mock);
    await getQuote(page);
    await expect(page.getByRole("status").filter({ hasText: text })).toBeVisible();
  });
}

test("unregistered payer registers before paying", async ({ page }) => {
  await fill(page, "unregistered");
  await getQuote(page);
  const pay = page.getByRole("button", { name: "Pay 0.60 test USDC" });
  await expect(pay).toBeDisabled();
  await page.getByRole("button", { name: "Register" }).click();
  await expect(pay).toBeEnabled();
});

test("returned payment says the money came back", async ({ page }) => {
  await fill(page, "returned");
  await getQuote(page);
  await page.getByRole("button", { name: "Pay 0.60 test USDC" }).click();
  await expect(page.getByRole("heading", { name: "Payment returned" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("your money: 0.60 test USDC sent back to your NEAR account")).toBeVisible();
});

test("wrong wallet account is blocked before signing", async ({ page }) => {
  await fill(page);
  await page.getByLabel("Your NEAR account").fill("someone-else.testnet");
  await getQuote(page);
  await page.getByRole("button", { name: "Pay 0.60 test USDC" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "but this quote is for someone-else.testnet" })).toBeVisible();
});

test("customer text renders as text, never HTML", async ({ page }) => {
  await fill(page);
  await page.getByLabel("Instructions").fill('<img src=x onerror="window.__xss=1">Summarise this.');
  await getQuote(page);
  await expect(page.getByText('<img src=x onerror="window.__xss=1">Summarise this.')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
});
