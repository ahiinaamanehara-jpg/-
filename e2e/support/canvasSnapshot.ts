import { expect, type Page } from "@playwright/test";
import { comparePngPixels } from "./pngComparison";

export async function expectCanvasUnchanged(page: Page, before: string) {
  const after = await page
    .getByLabel("お絵描きキャンバス")
    .evaluate((c) => (c as HTMLCanvasElement).toDataURL());
  const comparison = comparePngPixels(
    Buffer.from(before.split(",")[1], "base64"),
    Buffer.from(after.split(",")[1], "base64"),
  );
  expect(comparison.sameSize, JSON.stringify(comparison)).toBe(true);
  expect(comparison.visibleChangedPixels, JSON.stringify(comparison)).toBe(0);
}
