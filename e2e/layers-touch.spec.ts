import { devices, expect, test } from "@playwright/test";
import {
  startDrawing,
  bitmap,
  canvasPixel,
  paperPosition,
  viewState,
} from "./support/canvasView";
import { expectCanvasUnchanged } from "./support/canvasSnapshot";
import {
  observeStorageErrors,
  DRAWING_SAVE_TIMEOUT_MS,
} from "./support/storageDiagnostics";

test.use({ ...devices["Pixel 7"], viewport: { width: 360, height: 800 } });
test("専用画面の指描画でレイヤーだけを消去し、2本指の取消・拡大回転と保存再開でも下の線を保つ", async ({
  page,
  context,
}, info) => {
  await observeStorageErrors(page);
  await startDrawing(page);
  await page.getByLabel("ペンの色", { exact: true }).fill("#dd2211");
  await page
    .getByRole("slider", { name: "線の太さ", exact: true })
    .press("End");
  await page.locator(".layer-controls summary").tap();
  await page.getByRole("button", { name: "レイヤーを追加", exact: true }).tap();
  await page
    .getByRole("button", { name: "レイヤー1に描く", exact: true })
    .tap();
  await page
    .getByRole("button", { name: "画面いっぱいで描く", exact: true })
    .tap();
  await expect(
    page.getByRole("dialog", { name: "画面いっぱいで描く", exact: true }),
  ).toBeVisible();
  const cdp = await context.newCDPSession(page);
  const line = async (y = 0.5) => {
    const from = await paperPosition(page, 0.35, y),
      to = await paperPosition(page, 0.65, y);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ id: 1, ...from }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ id: 1, ...to }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  };
  try {
    await line();
    expect(await canvasPixel(page)).toEqual([221, 34, 17, 255]);
    // ローカルChromiumのタッチ後のUI制約はmouse clickと区別する。
    await page.getByRole("button", { name: "道具設定", exact: true }).click();
    await page.locator(".layer-controls summary").click();
    await page
      .getByRole("button", { name: "レイヤー2に描く", exact: true })
      .click();
    await page.getByLabel("ペンの色", { exact: true }).fill("#1234ab");
    await page
      .getByRole("button", { name: "設定を閉じる", exact: true })
      .click();
    await line();
    expect(await canvasPixel(page)).toEqual([18, 52, 171, 255]);
    await page.getByRole("button", { name: "消しゴム", exact: true }).click();
    await line();
    expect(await canvasPixel(page)).toEqual([221, 34, 17, 255]);
    await page.getByRole("button", { name: "取り消し", exact: true }).click();
    expect(await canvasPixel(page)).toEqual([18, 52, 171, 255]);
    await page.getByRole("button", { name: "ペン", exact: true }).click();
    const original = await bitmap(page),
      frame = (await page.locator(".canvas-frame").boundingBox())!;
    const touch = (id: number, x: number, y: number) => ({
      id,
      x: frame.x + 1 + (frame.width - 2) * x,
      y: frame.y + 1 + (frame.height - 2) * y,
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [touch(1, 0.35, 0.7)],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [touch(1, 0.35, 0.7), touch(2, 0.65, 0.7)],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [touch(1, 0.2, 0.6), touch(2, 0.8, 0.8)],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [touch(2, 0.8, 0.8)],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [touch(2, 0.7, 0.75)],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expectCanvasUnchanged(page, original);
    expect((await viewState(page)).scale).toBeGreaterThan(2);
    await expect(page.locator(".layer-current")).toContainText("レイヤー2");
    await page.getByRole("button", { name: "道具設定", exact: true }).click();
    await page.getByLabel("ペンの色", { exact: true }).fill("#228833");
    await page
      .getByRole("button", { name: "設定を閉じる", exact: true })
      .click();
    await line(0.6);
    expect(await canvasPixel(page, 480, 576)).toEqual([34, 136, 51, 255]);
    const drawn = await bitmap(page);
    await page.getByRole("button", { name: "途中で保存", exact: true }).click();
    await expect(page.locator(".workspace-status")).toHaveText("保存済み", {
      timeout: DRAWING_SAVE_TIMEOUT_MS,
    });
    await page.screenshot({ path: info.outputPath("layers-touch-360.png") });
    await page.reload();
    await expect(
      page.getByRole("button", { name: "ペン", exact: true }),
    ).toBeEnabled();
    await expectCanvasUnchanged(page, drawn);
    await page.getByRole("button", { name: "消しゴム", exact: true }).click();
    await page
      .getByRole("group", { name: "キャンバスの表示範囲", exact: true })
      .scrollIntoViewIfNeeded();
    await line();
    expect(await canvasPixel(page)).toEqual([221, 34, 17, 255]);
  } finally {
    await cdp.detach();
  }
});
