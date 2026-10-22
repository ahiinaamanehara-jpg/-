import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: "**/drawing-long.spec.ts",
  outputDir: "./test-results/long",
});
