import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  testIgnore: "**/drawing-long.spec.ts",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4173/workshop/",
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  webServer: {
    command:
      "npm run build -- --base=/workshop/ && npm run preview -- --base=/workshop/ --port 4173 --strictPort",
    url: "http://127.0.0.1:4173/workshop/",
    reuseExistingServer: false,
  },
});
