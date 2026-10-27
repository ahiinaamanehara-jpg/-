import { devices, expect, test } from "@playwright/test";
import {
  bitmap,
  canvasPixel,
  paperPosition,
  startDrawing,
  viewState,
} from "./support/canvasView";
import { expectCanvasUnchanged } from "./support/canvasSnapshot";
import {
  DRAWING_SAVE_TIMEOUT_MS,
  observeStorageErrors,
} from "./support/storageDiagnostics";

test.use({ ...devices["Pixel 7"], viewport: { width: 360, height: 800 } });

test("タップでボタンを隠す・戻すを行い、全画面の指描画・2本指・縦横変更と保存再開ができる", async ({
  page,
  context,
}, info) => {
  await observeStorageErrors(page);
  await startDrawing(page, true);
  await page.getByLabel("ペンの色", { exact: true }).fill("#1234ab");
  await page
    .getByRole("slider", { name: "線の太さ", exact: true })
    .press("End");
  await page
    .getByRole("button", { name: "画面いっぱいで描く", exact: true })
    .tap();
  const workspace = page.getByRole("dialog", {
    name: "画面いっぱいで描く",
    exact: true,
  });
  const button = (name: string) =>
    workspace.getByRole("button", { name, exact: true });
  const normal = (await page.locator(".canvas-frame").boundingBox())!;
  const blank = await bitmap(page);
  await button("ボタンを隠す").tap();
  await expect(button("ボタンを表示")).toBeVisible();
  await button("ボタンを表示").tap();
  await expect(button("ペン")).toBeVisible();
  await button("ボタンを隠す").tap();
  await expect
    .poll(
      async () => (await page.locator(".canvas-frame").boundingBox())!.height,
    )
    .toBe(800);
  const cdp = await context.newCDPSession(page);
  const point = (id: number, x: number, y: number) => ({ id, x, y });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [point(1, 140, 440)],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [point(1, 140, 440), point(2, 220, 440)],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [point(1, 80, 380), point(2, 280, 500)],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expectCanvasUnchanged(page, blank);
  expect((await viewState(page)).scale).toBeGreaterThan(2);
  expect((await viewState(page)).rotation).toBeGreaterThan(0.3);
  const a = await paperPosition(page, 0.48, 0.25),
    b = await paperPosition(page, 0.52, 0.25);
  expect(a.y).toBeLessThan(normal.y - 8);
  expect(a.y).toBeGreaterThan(60);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [point(1, a.x, a.y)],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [point(1, b.x, b.y)],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  expect(await canvasPixel(page, 480, 240)).toEqual([18, 52, 171, 255]);
  const drawn = await bitmap(page),
    transform = await page.locator(".canvas-transform").getAttribute("style");
  await page.setViewportSize({ width: 640, height: 360 });
  await expect
    .poll(
      async () => (await page.locator(".canvas-frame").boundingBox())!.width,
    )
    .toBe(640);
  expect(await page.locator(".canvas-transform").getAttribute("style")).toBe(
    transform,
  );
  await expectCanvasUnchanged(page, drawn);
  expect(await page.locator(".tracing-underlay").boundingBox()).toEqual(
    await page.getByLabel("お絵描きキャンバス").boundingBox(),
  );
  await page.screenshot({
    path: info.outputPath("hidden-controls-touch-landscape.png"),
  });
  // As in existing touch tests, distinguish mouse UI input after CDP gestures.
  await button("ボタンを表示").click();
  await button("途中で保存").click();
  await expect(workspace.locator(".workspace-status")).toHaveText("保存済み", {
    timeout: DRAWING_SAVE_TIMEOUT_MS,
  });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  await expectCanvasUnchanged(page, drawn);
  await expect(page.locator(".tracing-underlay")).toBeVisible();
});
