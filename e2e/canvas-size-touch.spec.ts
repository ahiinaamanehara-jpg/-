import { devices, expect, test } from "@playwright/test";
import {
  bitmap,
  canvasPixel,
  paperPosition,
  viewState,
} from "./support/canvasView";
import { expectCanvasUnchanged } from "./support/canvasSnapshot";
import { observeStorageErrors } from "./support/storageDiagnostics";

test.use({ ...devices["Pixel 7"], viewport: { width: 360, height: 800 } });
test("縦長の紙で2本指の物理的な回転・拡縮を保ち、ボタンを隠して指描画・縦横変更・再開できる", async ({
  page,
  context,
}, info) => {
  await observeStorageErrors(page);
  await page.goto("#/new");
  await page
    .getByLabel("キャンバスの形", { exact: true })
    .selectOption("portrait");
  await page
    .getByRole("button", { name: "テーマを決めずに進む", exact: true })
    .tap();
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("ペンの色", { exact: true }).fill("#1234ab");
  await page
    .getByRole("slider", { name: "線の太さ", exact: true })
    .press("End");
  await page
    .getByRole("button", { name: "画面いっぱいで描く", exact: true })
    .tap();
  await page.getByRole("button", { name: "ボタンを隠す", exact: true }).tap();
  const original = await bitmap(page);
  const center = await paperPosition(page, 0.5, 0.5);
  const cdp = await context.newCDPSession(page);
  const touch = (id: number, x: number, y: number) => ({
    id,
    x: center.x + x,
    y: center.y + y,
  });
  try {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [touch(1, -40, 0)],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [touch(1, -40, 0), touch(2, 40, 0)],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [touch(1, 0, -60), touch(2, 0, 60)],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    const view = await viewState(page);
    expect(view.scale).toBeCloseTo(1.5, 3);
    expect(view.rotation).toBeCloseTo(Math.PI / 2, 3);
    await expectCanvasUnchanged(page, original);
    const target = await paperPosition(page, 0.6, 0.5);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ id: 1, ...target }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    expect(await canvasPixel(page, 432, 480)).toEqual([18, 52, 171, 255]);
    const ink = await bitmap(page);
    await page.setViewportSize({ width: 640, height: 360 });
    await expectCanvasUnchanged(page, ink);
    const ratio = await page.locator(".canvas-transform").evaluate((el) => {
      const s = getComputedStyle(el);
      return parseFloat(s.width) / parseFloat(s.height);
    });
    expect(ratio).toBeCloseTo(0.75, 5);
    await page.screenshot({
      path: info.outputPath("portrait-touch-rotated.png"),
    });
    // CDP後のUI操作には既存のローカルChromiumと同じ制約があるためmouseで区別する。
    await page
      .getByRole("button", { name: "ボタンを表示", exact: true })
      .click();
    await page.getByRole("button", { name: "途中で保存", exact: true }).click();
    await expect(page.locator(".workspace-status")).toHaveText("保存済み");
    await page.reload();
    await expect(
      page.getByRole("button", { name: "ペン", exact: true }),
    ).toBeEnabled();
    await expectCanvasUnchanged(page, ink);
    await expect(page.getByLabel("お絵描きキャンバス")).toHaveAttribute(
      "width",
      "720",
    );
    await expect(page.getByLabel("お絵描きキャンバス")).toHaveAttribute(
      "height",
      "960",
    );
  } finally {
    await cdp.detach();
  }
});
