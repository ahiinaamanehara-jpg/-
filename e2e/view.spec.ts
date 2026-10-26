import { expect } from "@playwright/test";
import { test } from "./support/persistentTest";
import {
  expectSaved,
  observeStorageErrors,
} from "./support/storageDiagnostics";
import { expectCanvasUnchanged } from "./support/canvasSnapshot";
import {
  bitmap,
  canvasPixel,
  paintLine,
  paperPosition,
  revision,
  startDrawing,
  viewState,
} from "./support/canvasView";
import { readFile } from "node:fs/promises";
import { PNG } from "pngjs";
import AxeBuilder from "@axe-core/playwright";

test.use({ viewport: { width: 360, height: 800 } });
test.beforeEach(async ({ page }) => observeStorageErrors(page));

test("表示だけを拡大・90度回転・移動し、下絵と線を合わせて描画・消去・取消・保存・PNG出力できる", async ({
  page,
}, info) => {
  await startDrawing(page, true);
  await page.getByRole("button", { name: "途中で保存", exact: true }).click();
  await expectSaved(page);
  const initial = await revision(page);
  await page.getByRole("button", { name: "拡大・回転", exact: true }).click();
  for (let i = 0; i < 2; i++)
    await page.getByRole("button", { name: "表示を拡大", exact: true }).click();
  for (let i = 0; i < 6; i++)
    await page.getByRole("button", { name: "右に回す", exact: true }).click();
  await page.getByRole("button", { name: "表示を動かす", exact: true }).click();
  await page.keyboard.press("ArrowRight");
  expect((await viewState(page)).scale).toBeCloseTo(1.5625, 5);
  expect((await viewState(page)).rotation).toBeCloseTo(Math.PI / 2, 5);
  expect(await revision(page)).toEqual(initial);
  await page.getByRole("button", { name: "描く", exact: true }).click();
  await page.getByLabel("ペンの色", { exact: true }).fill("#1234ab");
  await page
    .getByRole("slider", { name: "線の太さ", exact: true })
    .press("End");
  await paintLine(page);
  expect(await canvasPixel(page)).toEqual([18, 52, 171, 255]);
  expect(await canvasPixel(page, 360, 480)).toEqual([18, 52, 171, 255]);
  expect((await canvasPixel(page, 480, 360))[3]).toBe(0);
  const drawn = await bitmap(page);
  const canvas = page.getByLabel("お絵描きキャンバス"),
    guide = page.locator(".tracing-underlay");
  expect(await guide.boundingBox()).toEqual(await canvas.boundingBox());
  await page.getByRole("button", { name: "消しゴム", exact: true }).click();
  await paintLine(page);
  expect((await canvasPixel(page))[3]).toBe(0);
  await page.getByRole("button", { name: "取り消し", exact: true }).click();
  await expectCanvasUnchanged(page, drawn);
  await page.getByRole("button", { name: "途中で保存", exact: true }).click();
  await expectSaved(page);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "PNGを書き出す", exact: true })
    .click();
  const png = PNG.sync.read(await readFile((await (await download).path())!));
  expect([png.width, png.height]).toEqual([960, 960]);
  const pixel = (x: number, y: number) =>
    Array.from(png.data.subarray((y * 960 + x) * 4, (y * 960 + x) * 4 + 4));
  expect(pixel(360, 480)).toEqual([18, 52, 171, 255]);
  expect(pixel(480, 360)).toEqual([255, 255, 255, 255]);
  await page
    .getByRole("group", { name: "キャンバスの表示範囲", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("rotated-tracing.png") });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  expect(await viewState(page)).toEqual({ scale: 1, rotation: 0, x: 0, y: 0 });
  await expectCanvasUnchanged(page, drawn);
});

test("表示の上限・縮小・リセットと移動モードが使え、320px・文字200%でも操作できる", async ({
  page,
}, info) => {
  await startDrawing(page);
  const blank = await bitmap(page);
  await page.getByRole("button", { name: "拡大・回転", exact: true }).click();
  for (let i = 0; i < 6; i++)
    await page.getByRole("button", { name: "表示を縮小", exact: true }).click();
  expect((await viewState(page)).scale).toBe(0.5);
  for (let i = 0; i < 14; i++)
    await page.getByRole("button", { name: "表示を拡大", exact: true }).click();
  expect((await viewState(page)).scale).toBe(8);
  await page.getByRole("button", { name: "表示を動かす", exact: true }).click();
  const viewport = page.getByRole("group", {
    name: "キャンバスの表示範囲",
    exact: true,
  });
  await viewport.scrollIntoViewIfNeeded();
  const b = (await viewport.boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.7, b.y + b.height * 0.6, {
    steps: 4,
  });
  await page.mouse.up();
  await expectCanvasUnchanged(page, blank);
  await page.getByRole("button", { name: "表示を戻す", exact: true }).click();
  expect(await viewState(page)).toEqual({ scale: 1, rotation: 0, x: 0, y: 0 });
  await expect(
    page.getByRole("button", { name: "描く", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    audit.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const small = await page
    .locator(".canvas-view-controls button")
    .evaluateAll((elements) =>
      elements
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width < 44 || r.height < 44;
        })
        .map((el) => el.textContent),
    );
  expect(small).toEqual([]);
  const enlarge = page.getByRole("button", { name: "表示を拡大", exact: true });
  await enlarge.focus();
  await page.keyboard.press("Enter");
  expect((await viewState(page)).scale).toBe(1.25);
  await page.getByRole("button", { name: "表示を戻す", exact: true }).click();
  await expectCanvasUnchanged(page, blank);
  await page.screenshot({
    path: info.outputPath("view-text-200.png"),
    fullPage: true,
  });
  await page
    .getByRole("slider", { name: "線の太さ", exact: true })
    .press("End");
  await paintLine(page);
  expect((await canvasPixel(page))[3]).toBe(255);
  expect((await paperPosition(page, 0.5, 0.5)).x).toBeGreaterThan(0);
});
