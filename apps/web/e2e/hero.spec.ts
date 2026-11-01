import { expect, test } from "@playwright/test";

// Gate G-W2: the hero shader runs at ≤ 30 fps, keeps DPR ≤ 1.5, and pauses off screen.
type W = { __heroShader?: { fps: number } | null };

test("hero shader frame rate and pause", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.waitForFunction(() => !!(window as unknown as W).__heroShader);
  await page.waitForTimeout(3500); // a few fps windows
  const samples: number[] = [];
  for (let i = 0; i < 3; i++) {
    samples.push(await page.evaluate(() => (window as unknown as W).__heroShader!.fps));
    await page.waitForTimeout(1000);
  }
  console.log(`hero fps samples: ${samples.join(", ")}`);
  for (const f of samples) expect(f).toBeLessThanOrEqual(31);
  expect(Math.max(...samples)).toBeGreaterThanOrEqual(20); // smooth enough on this machine

  const ratio = await page.evaluate(() => {
    const c = document.querySelector("section canvas") as HTMLCanvasElement;
    return c.width / c.clientWidth;
  });
  expect(ratio).toBeLessThanOrEqual(1.5);

  await page.evaluate(() => window.scrollTo(0, 3000));
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => (window as unknown as W).__heroShader!.fps)).toBe(0);
});

test("reduced motion stops the shader", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.waitForFunction(() => !!(window as unknown as W).__heroShader);
  await page.waitForTimeout(2500);
  expect(await page.evaluate(() => (window as unknown as W).__heroShader!.fps)).toBeLessThanOrEqual(1);
});
