import { expect, type Page } from "@playwright/test";
import { test } from "./support/persistentTest";
import {
  bitmap,
  canvasPixel,
  paintLine,
  startDrawing,
  viewState,
  revision,
} from "./support/canvasView";
import { expectCanvasUnchanged } from "./support/canvasSnapshot";
import {
  observeStorageErrors,
  DRAWING_SAVE_TIMEOUT_MS,
} from "./support/storageDiagnostics";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { PNG } from "pngjs";

test.use({ viewport: { width: 360, height: 800 } });
test.beforeEach(async ({ page }) => observeStorageErrors(page));
const workspace = (page: Page) =>
  page.getByRole("dialog", { name: "画面いっぱいで描く", exact: true });
async function open(page: Page) {
  await page
    .getByRole("button", { name: "画面いっぱいで描く", exact: true })
    .click();
  await expect(workspace(page)).toBeVisible();
  await expect
    .poll(
      async () => (await page.locator(".canvas-frame").boundingBox())!.width,
    )
    .toBeGreaterThan(100);
}
async function saved(page: Page) {
  await expect(workspace(page).locator(".workspace-status")).toHaveText(
    "保存済み",
    { timeout: DRAWING_SAVE_TIMEOUT_MS },
  );
}

test("専用画面への切替でCanvas・線・下絵・履歴・倍率を保ち、描画消去・PNG・保存再開ができる", async ({
  page,
}, info) => {
  await startDrawing(page, true);
  const blank = await bitmap(page);
  await page.getByLabel("ペンの色", { exact: true }).fill("#1234ab");
  await page
    .getByRole("slider", { name: "線の太さ", exact: true })
    .press("End");
  await paintLine(page, 0.3);
  const original = await bitmap(page);
  const canvas = await page.getByLabel("お絵描きキャンバス").elementHandle();
  await page.getByRole("button", { name: "拡大・回転", exact: true }).click();
  await page.getByRole("button", { name: "表示を拡大", exact: true }).click();
  await page.getByRole("button", { name: "右に回す", exact: true }).click();
  const view = await viewState(page);
  await page.getByRole("button", { name: "拡大・回転", exact: true }).click();
  await open(page);
  expect(
    await canvas!.evaluate(
      (el) =>
        el ===
        document.querySelector("canvas[aria-label='お絵描きキャンバス']"),
    ),
  ).toBe(true);
  expect(await viewState(page)).toEqual(view);
  await expectCanvasUnchanged(page, original);
  expect(await page.locator(".tracing-underlay").boundingBox()).toEqual(
    await page.getByLabel("お絵描きキャンバス").boundingBox(),
  );
  await paintLine(page);
  expect(await canvasPixel(page)).toEqual([18, 52, 171, 255]);
  const drawn = await bitmap(page);
  await workspace(page)
    .getByRole("button", { name: "消しゴム", exact: true })
    .click();
  await paintLine(page);
  expect((await canvasPixel(page))[3]).toBe(0);
  await workspace(page)
    .getByRole("button", { name: "取り消し", exact: true })
    .click();
  await expectCanvasUnchanged(page, drawn);
  await workspace(page)
    .getByRole("button", { name: "途中で保存", exact: true })
    .click();
  await saved(page);
  await page.getByRole("button", { name: "拡大・回転", exact: true }).click();
  await page.getByRole("button", { name: "表示を拡大", exact: true }).click();
  expect((await viewState(page)).scale).toBeCloseTo(1.5625, 5);
  await workspace(page)
    .getByRole("button", { name: "サポートを閉じる", exact: true })
    .click();
  await workspace(page)
    .getByRole("button", { name: "道具設定", exact: true })
    .click();
  const download = page.waitForEvent("download");
  await workspace(page)
    .getByRole("button", { name: "PNGを書き出す", exact: true })
    .click();
  const png = PNG.sync.read(await readFile((await (await download).path())!));
  expect([png.width, png.height]).toEqual([960, 960]);
  expect(Array.from(png.data.subarray(0, 4))).toEqual([255, 255, 255, 255]);
  const index = (480 * 960 + 480) * 4;
  expect(Array.from(png.data.subarray(index, index + 4))).toEqual([
    18, 52, 171, 255,
  ]);
  await workspace(page)
    .getByRole("button", { name: "設定を閉じる", exact: true })
    .click();
  await page.screenshot({ path: info.outputPath("workspace-360.png") });
  const beforeClose = await viewState(page);
  const oldScroll = await page.evaluate(
    () => -parseFloat(document.body.style.top),
  );
  await workspace(page)
    .getByRole("button", { name: "通常画面に戻る", exact: true })
    .click();
  await expect(workspace(page)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "画面いっぱいで描く", exact: true }),
  ).toBeFocused();
  expect(
    Math.abs((await page.evaluate(() => scrollY)) - oldScroll),
  ).toBeLessThan(1);
  expect(await page.evaluate(() => document.body.style.position)).toBe("");
  expect(await viewState(page)).toEqual(beforeClose);
  await expectCanvasUnchanged(page, drawn);
  await page.getByRole("button", { name: "取り消し", exact: true }).click();
  await expectCanvasUnchanged(page, original);
  await page.getByRole("button", { name: "取り消し", exact: true }).click();
  await expectCanvasUnchanged(page, blank);
  await page.getByRole("button", { name: "途中で保存", exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText("保存済み", {
    timeout: DRAWING_SAVE_TIMEOUT_MS,
  });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  await expectCanvasUnchanged(page, blank);
  await open(page);
  expect(await viewState(page)).toEqual({ scale: 1, rotation: 0, x: 0, y: 0 });
});

test("スマホ縦横・320px・文字200%で画面内へ収まり、枠外のスクロールを止め、設定とキーボードを使える", async ({
  page,
}, info) => {
  await startDrawing(page);
  await open(page);
  const blank = await bitmap(page);
  for (const size of [
    { width: 320, height: 568 },
    { width: 640, height: 360 },
    { width: 360, height: 800 },
  ]) {
    await page.setViewportSize(size);
    await expect
      .poll(async () => {
        const b = (await page.locator(".canvas-frame").boundingBox())!;
        const stage = (await page.locator(".workspace-stage").boundingBox())!;
        return Math.abs(
          b.width - Math.floor(Math.min(stage.width, stage.height)),
        );
      })
      .toBeLessThan(1);
    const b = (await page.locator(".canvas-frame").boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(-0.01);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(size.width + 0.01);
    expect(b.y + b.height).toBeLessThanOrEqual(size.height + 0.01);
    const scroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
    await page.mouse.move(4, size.height / 2);
    await page.mouse.wheel(0, 500);
    await expect
      .poll(() => page.evaluate(() => ({ x: scrollX, y: scrollY })))
      .toEqual(scroll);
  }
  await expectCanvasUnchanged(page, blank);
  const close = workspace(page).getByRole("button", {
    name: "通常画面に戻る",
    exact: true,
  });
  const more = workspace(page).getByRole("button", {
    name: "道具設定",
    exact: true,
  });
  await close.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(more).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await more.click();
  await page.getByRole("button", { name: "拡大・回転", exact: true }).click();
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    audit.violations.map((v) => ({
      id: v.id,
      targets: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const panel = page.locator(".support-panel");
  await panel.hover();
  await page.mouse.wheel(0, 800);
  await expect
    .poll(() => panel.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  await workspace(page)
    .getByRole("button", { name: "サポートを閉じる", exact: true })
    .click();
  await more.click();
  await page
    .getByRole("slider", { name: "線の太さ", exact: true })
    .press("End");
  await workspace(page)
    .getByRole("button", { name: "設定を閉じる", exact: true })
    .click();
  expect(
    (await page.locator(".canvas-frame").boundingBox())!.width,
  ).toBeGreaterThan(80);
  await page.screenshot({ path: info.outputPath("workspace-text-200.png") });
  await page.keyboard.press("Escape");
  await expect(workspace(page)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "画面いっぱいで描く", exact: true }),
  ).toBeFocused();
  expect(
    await page.evaluate(() => document.documentElement.style.overflow),
  ).toBe("");
  const y = await page.evaluate(() => scrollY);
  await page.mouse.move(2, 300);
  await page.mouse.wheel(0, 500);
  await expect.poll(() => page.evaluate(() => scrollY)).not.toBe(y);
});

test("専用画面でも保存不足で絵を保ち、PNG退避・再試行と画面移動後のスクロール復帰ができる", async ({
  page,
}) => {
  await startDrawing(page);
  await open(page);
  await workspace(page)
    .getByRole("button", { name: "途中で保存", exact: true })
    .click();
  await saved(page);
  const before = await revision(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as unknown as { restorePut: () => void }).restorePut = () => {
      IDBObjectStore.prototype.put = original;
    };
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "artworks")
        throw new DOMException("test quota", "QuotaExceededError");
      return original.apply(this, args);
    };
  });
  await paintLine(page);
  const drawn = await bitmap(page);
  await workspace(page)
    .getByRole("button", { name: "途中で保存", exact: true })
    .click();
  await expect(workspace(page).getByRole("alert")).toContainText("保存領域", {
    timeout: DRAWING_SAVE_TIMEOUT_MS,
  });
  expect(await revision(page)).toEqual(before);
  await expectCanvasUnchanged(page, drawn);
  await workspace(page)
    .getByRole("button", { name: "道具設定", exact: true })
    .click();
  const download = page.waitForEvent("download");
  await workspace(page)
    .getByRole("button", { name: "PNGを書き出す", exact: true })
    .click();
  expect(await (await download).path()).toBeTruthy();
  await workspace(page)
    .getByRole("button", { name: "設定を閉じる", exact: true })
    .click();
  await page.evaluate(() =>
    (window as unknown as { restorePut: () => void }).restorePut(),
  );
  await workspace(page)
    .getByRole("button", { name: "途中で保存", exact: true })
    .click();
  await saved(page);
  await page.evaluate(() => {
    location.hash = "/";
  });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "好き、からはじめよう。",
  );
  expect(await page.evaluate(() => document.body.style.position)).toBe("");
  expect(
    await page.evaluate(() => document.documentElement.style.overflow),
  ).toBe("");
  await page.getByRole("link", { name: "続きから描く", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  await expectCanvasUnchanged(page, drawn);
});
