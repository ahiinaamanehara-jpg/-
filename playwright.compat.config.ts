import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

const commonTests = [
  "**/acceptance.spec.ts",
  "**/accessibility.spec.ts",
  "**/compatibility-storage.spec.ts",
  "**/drawing-layout.spec.ts",
  "**/drawing-support.spec.ts",
  "**/tracing.spec.ts",
  "**/view.spec.ts",
  "**/workspace.spec.ts",
  "**/layers.spec.ts",
];

// 利用可能なブラウザーを明示的に実行する。未導入を成功やスキップにしない。
export default defineConfig({
  ...base,
  testMatch: commonTests,
  outputDir: "./test-results/compat",
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [
    ["list"],
    ...(process.env.GITHUB_ACTIONS ? ([["github"]] as const) : []),
    ["json", { outputFile: "test-results/compat/report.json" }],
  ],
  projects: [
    {
      name: "chromium",
      testMatch: [
        ...commonTests,
        "**/view-touch.spec.ts",
        "**/workspace-touch.spec.ts",
        "**/layers-touch.spec.ts",
      ],
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
