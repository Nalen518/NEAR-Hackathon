import { expect, test, type Page } from "@playwright/test";

// Gate G-W4: public and payer views, the NEP-413 sign step (mock wallet), complaints, and every state of 153:6714.
const open = async (page: Page, mock = "") => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/jobs/j_000042${mock ? `?mock=${mock}` : ""}`);
};

test("public view hides the delivery and the instructions", async ({ page }) => {
  await open(page, "public_view");
  await expect(page.getByRole("heading", { name: "JOB #0042" })).toBeVisible();
  await expect(page.getByText("public view").first()).toBeVisible();
  await expect(page.getByText("Only the payer can see the delivery")).toBeVisible();
  await expect(page.getByText("Your instructions")).toHaveCount(0);
  await expect(page.getByText("Not what you ordered?")).toHaveCount(0);
  await expect(page.getByText("Crab: cheaper, 93% first pass", { exact: false }).or(page.getByText(/Crab is cheaper/)).first()).toBeVisible();
  await page.screenshot({ path: "../../docs/web/screens/job-public-1440.png", fullPage: true });
});

test("signing in as the payer opens the delivery and the complaint box", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Sign in to view" }).click();
  await expect(page.getByText("you paid for this")).toBeVisible();
  await expect(page.getByText("Your instructions")).toBeVisible();
  await expect(page.getByText(/NEAR Intents lets a user state the outcome/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Not what you ordered?" })).toBeVisible();
  await page.screenshot({ path: "../../docs/web/screens/job-payer-1440.png", fullPage: true });
});

test("a complaint needs a signature and a reason", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Sign in to view" }).click();
  const send = page.getByRole("button", { name: "Send complaint" });
  await expect(send).toBeDisabled();
  await page.getByLabel("Your reason").fill("I asked for bullet points. The brief said paragraph.");
  await send.click();
  await expect(page.getByRole("heading", { name: "Complaint sent" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("heading", { name: "Complaint under review" })).toBeVisible();
});

for (const [mock, title] of [
  ["working", "Crab is working"],
  ["reviewing", "Owl is checking the work"],
  ["revision", "One revision"],
  ["refunded", "Failed twice. You’re refunded."],
  ["dispute", "Second opinion"],
  ["disputed_overturned", "Fail overturned"],
  ["unresolved", "Unresolved: refunded"],
  ["complaint_review", "Complaint under review"],
  ["complaint_upheld", "Complaint upheld"],
  ["complaint_rejected", "Complaint not upheld"],
  ["finalized", "Finalized"],
  ["needs_review", "Being checked by hand"],
] as const) {
  test(`state ${mock}`, async ({ page }) => {
    await open(page, mock);
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(page.getByText(/^your money: /).first()).toBeVisible();
  });
}

test("loading and unreachable", async ({ page }) => {
  await open(page, "job_loading");
  await expect(page.getByRole("heading", { name: "Loading this job" })).toBeVisible();
  await open(page, "job_unreachable");
  await expect(page.getByRole("heading", { name: "Can’t reach Shark right now" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("your money: unchanged, held by the contract")).toBeVisible();
});

test("refunded jobs never show the delivery, even to the payer", async ({ page }) => {
  await open(page, "refunded");
  await page.getByRole("button", { name: "Sign in to view" }).click();
  await expect(page.getByText("The delivery is withheld because you were refunded.")).toBeVisible();
});

test("thread job: 3 posts, then the rest on request", async ({ page }) => {
  await open(page, "thread_job");
  await page.getByRole("button", { name: "Sign in to view" }).click();
  await expect(page.getByText("job j_000042 · thread · you paid for this")).toBeVisible();
  await expect(page.getByText("Exactly 5 posts").first()).toBeVisible();
  const more = page.getByRole("button", { name: "+ 2 more posts" });
  await expect(more).toBeVisible();
  await more.click();
  await expect(page.getByText("5/5")).toBeVisible();
  await page.screenshot({ path: "../../docs/web/screens/job-thread-1440.png", fullPage: true });
});

test("extraction job: table, show all, Download .json", async ({ page }) => {
  await open(page, "extract_job");
  await page.getByRole("button", { name: "Sign in to view" }).click();
  await expect(page.getByText("24 records · 4 shown")).toBeVisible();
  await page.getByRole("button", { name: "show all" }).click();
  await expect(page.getByText("24 records · 24 shown")).toBeVisible();
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download .json" }).click()]);
  expect(file.suggestedFilename()).toMatch(/^delivery-\w+\.json$/);
  await page.screenshot({ path: "../../docs/web/screens/job-extract-1440.png", fullPage: true });
});
