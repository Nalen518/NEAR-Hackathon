import { expect, test } from "@playwright/test";

// Gate G-W2: / at 1440, 1280 and 1024, reduced motion, error fallback.
for (const width of [1440, 1280, 1024]) {
  test(`landing @${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" }); // end states, stable shots
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Three small jobs. Checked every time." })).toBeVisible();
    await expect(page.getByText("128.00").first()).toBeVisible();
    await expect(page.getByText("0.20 to 1.00 test USDC").first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
    // The hero job card floats right of the copy: the lede must end before it starts
    const gap = await page.evaluate(() => {
      const lede = document.querySelector("main > section:first-of-type p.mono-lede")!.getBoundingClientRect();
      const card = document.querySelector("main > section:first-of-type article")!.getBoundingClientRect();
      return card.left - lede.right;
    });
    expect(gap).toBeGreaterThan(0);
    const broken = await page.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src));
    expect(broken).toEqual([]);
    await page.screenshot({ path: `../../docs/web/screens/landing-v2-${width}.png`, fullPage: true });
  });
}

test("reduced motion prints the full receipt and pins nothing", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByText("05 · delivered + payouts")).toBeVisible();
  await expect(page.getByText("printing")).toHaveCount(0);
  const sticky = await page.locator("#how-it-works > div").nth(1).evaluate((el) => getComputedStyle(el).position);
  expect(sticky).not.toBe("sticky");
});

test("receipt prints beat by beat on scroll", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: /You order\. Shark writes the brief/ }).scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: /You order\. Shark writes the brief/ }).click();
  await expect(page.getByText("01 / 05 · Shark writes the brief")).toBeVisible();
  await page.getByRole("button", { name: /Owl checks the work/ }).click();
  await expect(page.getByText("04 / 05 · Owl passes it")).toBeVisible();
  await expect(page.getByText("3 / 3 pass")).toBeVisible();
});

test("auction example tabs switch with the keyboard reachable", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("tab", { name: "Unresolved" }).click();
  await expect(page.getByText("// unresolved · job j_000045")).toBeVisible();
  await page.getByRole("tab", { name: "Refund" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("// refund · job j_000040")).toBeVisible();
});

test("caged scenario fills the cage meter", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?mock=caged");
  await expect(page.getByText("strikes 3 / 3 · caged")).toBeVisible();
});

test("API down falls back to sample data with a notice", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?mock=upstream_down");
  await expect(page.getByText("Live numbers unavailable. Showing sample data.").first()).toBeVisible();
  await expect(page.getByText("128.00").first()).toBeVisible();
});

test("hovering a partner chip types its line into the headline", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: /^OutLayer:/ }).hover();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("The reviewer can’t lie.", { ignoreCase: true });
});
