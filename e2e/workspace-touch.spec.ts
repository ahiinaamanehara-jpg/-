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

test("スマホ相当の枠外スワイプで専用画面が動かず、指描画・2本指操作・保存と通常画面のスクロール復帰ができる", async ({
  page,
  context,
}, info) => {
  await observeStorageErrors(page);
  await startDrawing(page, true);
  await page
    .getByRole("button", { name: "画面いっぱいで描く", exact: true })
    .tap();
  const dialog = page.getByRole("dialog", {
    name: "画面いっぱいで描く",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  const frame = page.locator(".canvas-frame");
  await expect
    .poll(async () => (await frame.boundingBox())!.width)
    .toBeGreaterThan(300);
  const before = (await frame.boundingBox())!;
  const blank = await bitmap(page);
  const stage = (await page.locator(".workspace-stage").boundingBox())!;
  expect(before.y - stage.y).toBeGreaterThan(30);
  const cdp = await context.newCDPSession(page);
  const swipe = async (x: number, y: number, toY: number) => {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ id: 1, x, y }],
    });
    for (let i = 1; i <= 6; i++)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ id: 1, x, y: y + ((toY - y) * i) / 6 }],
      });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  };
  try {
    // Canvasから始まらない入力も含む。余白と上部の保存状態からスワイプする。
    const header = (await page.locator(".workspace-heading").boundingBox())!;
    const scroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
    await swipe(5, before.y - 12, stage.y + 4);
    await swipe(6, header.y + header.height - 6, header.y + 2);
    expect(await frame.boundingBox()).toEqual(before);
    expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(
      scroll,
    );
    expect(await dialog.evaluate((el) => el.scrollTop)).toBe(0);
    await expectCanvasUnchanged(page, blank);
    const from = await paperPosition(page, 0.35, 0.5),
      to = await paperPosition(page, 0.65, 0.5);
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
    expect((await canvasPixel(page))[3]).toBe(255);
    const drawn = await bitmap(page);
    const center = await paperPosition(page, 0.5, 0.5);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ id: 1, x: center.x - 30, y: center.y + 40 }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { id: 1, x: center.x - 30, y: center.y + 40 },
        { id: 2, x: center.x + 30, y: center.y + 40 },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { id: 1, x: center.x - 60, y: center.y + 10 },
        { id: 2, x: center.x + 60, y: center.y + 70 },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [{ id: 2, x: center.x + 60, y: center.y + 70 }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ id: 2, x: center.x + 70, y: center.y + 80 }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    expect((await viewState(page)).scale).toBeGreaterThan(2);
    expect((await viewState(page)).rotation).toBeGreaterThan(0.3);
    await expectCanvasUnchanged(page, drawn);
    expect(await frame.boundingBox()).toEqual(before);
    // タッチ後のUI操作はローカルChromiumの制約によりmouse clickと区別する。
    await dialog
      .getByRole("button", { name: "途中で保存", exact: true })
      .click();
    await expect(dialog.locator(".workspace-status")).toHaveText("保存済み", {
      timeout: DRAWING_SAVE_TIMEOUT_MS,
    });
    await page.screenshot({ path: info.outputPath("workspace-touch-360.png") });
    await dialog
      .getByRole("button", { name: "通常画面に戻る", exact: true })
      .click();
    await page.evaluate(() => scrollTo(0, 0));
    await swipe(2, 650, 200);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "ペン", exact: true }),
    ).toBeEnabled();
    await expectCanvasUnchanged(page, drawn);
  } finally {
    await cdp.detach();
  }
});
