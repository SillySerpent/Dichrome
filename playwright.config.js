import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./scripts/browser",
  timeout: 30000,
  workers: 1,
  reporter: "list",
  use: { trace: "retain-on-failure" }
});
