import { defineConfig } from "vitest/config";

// e2e/ is Playwright's; keep Vitest to unit tests.
export default defineConfig({ test: { exclude: ["e2e/**", "node_modules/**"] } });
