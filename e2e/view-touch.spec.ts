import {
  devices,
  expect,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import {
  bitmap,
  canvasPixel,
  paintLine,
  paperPosition,
  revision,
  startDrawing,
  viewState,
} from "./support/canvasView";
import { expectCanvasUnchanged } from "./support/canvasSnapshot";
import { DRAWING_SAVE_TIMEOUT_MS } from "./support/storageDiagnostics";

test.use({ ...devices["Pixel 7"], viewport: { width: 360, height: 800 } });

async function setup(page: Page) {
  await startDrawing(page, true);
  await page.getByLabel("ペンの色", { exact: true }).fill("#1234ab");
  await page
    .getByRole("slider", { name: "線の太さ", exact: true })
    .press("End");
}
async function save(page: Page) {
  await page.getByRole("button", { name: "途中で保存", exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText("保存済み", {
    timeout: DRAWING_SAVE_TIMEOUT_MS,
  });
}

async function contacts(page: Page, context: BrowserContext) {
  const viewport = page.getByRole("group", {
    name: "キャンバスの表示範囲",
    exact: true,
  });
  await viewport.scrollIntoViewIfNeeded();
  const b = (await viewport.boundingBox())!;
  const point = (id: number, x: number, y: number) => ({
    id,
    x: b.x + 1 + (b.width - 2) * x,
    y: b.y + 1 + (b.height - 2) * y,
  });
  const cdp = await context.newCDPSession(page);
  return { cdp, point };
}

test("2本指で拡大・回転・移動しても線と保存を変えず、1本残った指は描画せず、変換後も指の位置に描ける", async ({
  page,
  context,
}, info) => {
  await setup(page);
  await paintLine(page, 0.3);
  await save(page);
  const original = await bitmap(page),
    before = await revision(page);
  await page.clock.install();
  const { cdp, point } = await contacts(page, context);
  try {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [point(1, 0.35, 0.5)],
    });
    await expect
      .poll(async () => (await canvasPixel(page, 336, 480))[3])
      .toBe(255);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [point(1, 0.35, 0.5), point(2, 0.65, 0.5)],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [point(1, 0.2, 0.4), point(2, 0.8, 0.6)],
    });
    await expect
      .poll(async () => (await viewState(page)).scale)
      .toBeGreaterThan(2);
    const transformed = await viewState(page);
    expect(transformed.rotation).toBeGreaterThan(0.3);
    await expectCanvasUnchanged(page, original);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [point(2, 0.8, 0.6)],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [point(2, 0.65, 0.45)],
    });
    await expectCanvasUnchanged(page, original);
    expect(await viewState(page)).toEqual(transformed);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await page.clock.runFor(2000);
    expect(await revision(page)).toEqual(before);
    await expect(
      page.getByRole("button", { name: "ペン", exact: true }),
    ).toBeEnabled();
    const from = await paperPosition(page, 0.45, 0.5),
      to = await paperPosition(page, 0.55, 0.5);
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
    expect(await canvasPixel(page)).toEqual([18, 52, 171, 255]);
    const drawn = await bitmap(page);
    await save(page);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "ペン", exact: true }),
    ).toBeEnabled();
    expect(await viewState(page)).toEqual({
      scale: 1,
      rotation: 0,
      x: 0,
      y: 0,
    });
    await expectCanvasUnchanged(page, drawn);
    await page
      .getByRole("group", { name: "キャンバスの表示範囲", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath("view-touch-360.png") });
  } finally {
    await cdp.detach();
  }
});

test("3本目の指とpointercancelでも描きかけだけを取り消し、完了済み9操作と取り消し履歴を保つ", async ({
  page,
  context,
}) => {
  await setup(page);
  const blank = await bitmap(page);
  for (let i = 0; i < 9; i++) await paintLine(page, 0.2 + i * 0.06);
  await save(page);
  const original = await bitmap(page);
  const { cdp, point } = await contacts(page, context);
  try {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [point(1, 0.4, 0.8)],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [point(1, 0.4, 0.8), point(2, 0.6, 0.8)],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [point(1, 0.4, 0.8), point(2, 0.6, 0.8), point(3, 0.5, 0.9)],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [point(1, 0.3, 0.7), point(2, 0.7, 0.8), point(3, 0.5, 0.9)],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchCancel",
      touchPoints: [],
    });
    await expect(
      page.getByRole("button", { name: "ペン", exact: true }),
    ).toBeEnabled();
    await expectCanvasUnchanged(page, original);
    const undo = page.getByRole("button", { name: "取り消し", exact: true });
    let count = 0;
    while (await undo.isEnabled()) {
      await undo.click();
      expect(++count).toBeLessThanOrEqual(9);
    }
    expect(count).toBe(9);
    await expectCanvasUnchanged(page, blank);
    await save(page);
  } finally {
    await cdp.detach();
  }
});
