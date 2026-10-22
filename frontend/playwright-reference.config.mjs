import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./reference",
  timeout: 75_000,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.DESIGN_BASE_URL || "http://127.0.0.1:5174",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
