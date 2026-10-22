import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

// 利用可能なブラウザーを明示的に実行する。未導入を成功やスキップにしない。
export default defineConfig({
  ...base,
  testMatch: ["**/acceptance.spec.ts", "**/accessibility.spec.ts"],
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
        },
      },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"], launchOptions: {} },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"], launchOptions: {} },
    },
    {
      name: "mobile-webkit",
      use: { ...devices["iPhone 13"], launchOptions: {} },
    },
  ],
});
