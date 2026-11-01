import { defineConfig } from "@playwright/test";

// Uses the installed Chrome (channel) so no browser download is needed.
export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  use: { baseURL: process.env.BASE_URL ?? "http://localhost:3100", channel: "chrome" },
});
