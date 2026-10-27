import { expect, type Page } from "@playwright/test";
import { test } from "./support/persistentTest";
import {
  bitmap,
  canvasPixel,
  paperPosition,
  revision,
  startDrawing,
} from "./support/canvasView";
import { expectCanvasUnchanged } from "./support/canvasSnapshot";
import {
  DRAWING_SAVE_TIMEOUT_MS,
  observeStorageErrors,
} from "./support/storageDiagnostics";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { PNG } from "pngjs";

test.use({ viewport: { width: 360, height: 800 } });
test.setTimeout(60_000);
test.beforeEach(async ({ page }) => {
  // Persistent WebKit contexts use project options, so apply this file's
  // responsive viewport explicitly before loading the drawing screen.
  await page.setViewportSize({ width: 360, height: 800 });
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(360);
  await observeStorageErrors(page);
});
const workspace = (page: Page) =>
  page.getByRole("dialog", { name: "画面いっぱいで描く", exact: true });
const button = (page: Page, name: string) =>
  workspace(page).getByRole("button", { name, exact: true });
async function open(page: Page) {
  await page
    .getByRole("button", { name: "画面いっぱいで描く", exact: true })
    .click();
  await expect(workspace(page)).toBeVisible();
}
async function saved(page: Page) {
  await expect(workspace(page).locator(".workspace-status")).toHaveText(
    "保存済み",
    { timeout: DRAWING_SAVE_TIMEOUT_MS },
  );
}
async function draw(page: Page, y: number) {
  const a = await paperPosition(page, 0.48, y),
    b = await paperPosition(page, 0.52, y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
}
async function fullFrame(page: Page) {
  await expect
    .poll(() =>
      page.locator(".canvas-frame").evaluate((el) => {
        const box = el.getBoundingClientRect();
        return Math.max(
          Math.abs(box.x),
          Math.abs(box.y),
          Math.abs(box.width - innerWidth),
          Math.abs(box.height - innerHeight),
        );
      }),
    )
    .toBeLessThan(1);
  await expect
    .poll(() =>
      page
        .locator(".canvas-transform")
        .evaluate((el) =>
          Math.abs(
            parseFloat(getComputedStyle(el).width) -
              Math.floor(Math.min(innerWidth, innerHeight)),
          ),
        ),
    )
    .toBeLessThan(1);
}

test("ボタンを隠して画面全体へ描け、線・下絵・レイヤー・表示・取消と自動保存を保つ", async ({
  page,
}, info) => {
  await startDrawing(page, true);
  await page.getByLabel("ペンの色", { exact: true }).fill("#1234ab");
  await page
    .getByRole("slider", { name: "線の太さ", exact: true })
    .press("End");
  await page.getByRole("button", { name: "レイヤー", exact: true }).click();
  await page
    .getByRole("button", { name: "レイヤーを追加", exact: true })
    .click();
  await page
    .getByRole("button", { name: "サポートを閉じる", exact: true })
    .click();
  await open(page);
  await button(page, "拡大・回転").click();
  for (let i = 0; i < 4; i++) await button(page, "表示を拡大").click();
  await button(page, "右に回す").click();
  await button(page, "サポートを閉じる").click();
  await button(page, "途中で保存").click();
  await saved(page);
  const before = await revision(page),
    original = await bitmap(page);
  const canvas = await page.getByLabel("お絵描きキャンバス").elementHandle();
  const transform = await page
    .locator(".canvas-transform")
    .getAttribute("style");
  const normal = (await page.locator(".canvas-frame").boundingBox())!;
  await button(page, "ボタンを隠す").click();
  await fullFrame(page);
  await expect(button(page, "ボタンを表示")).toBeFocused();
  await expect(workspace(page).getByRole("button")).toHaveCount(1);
  expect(
    await canvas!.evaluate(
      (el) =>
        el ===
        document.querySelector("canvas[aria-label='お絵描きキャンバス']"),
    ),
  ).toBe(true);
  expect(await page.locator(".canvas-transform").getAttribute("style")).toBe(
    transform,
  );
  await expectCanvasUnchanged(page, original);
  expect(await revision(page)).toEqual(before);
  expect(await page.locator(".tracing-underlay").boundingBox()).toEqual(
    await page.getByLabel("お絵描きキャンバス").boundingBox(),
  );
  const target = await paperPosition(page, 0.5, 0.2);
  const geometry = await page.locator(".canvas-transform").evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      bounds: el.getBoundingClientRect().toJSON(),
      transform: style.transform,
      origin: style.transformOrigin,
      width: style.width,
      height: style.height,
    };
  });
  // This part of the enlarged picture was clipped by the previous square frame.
  expect(target.y).toBeLessThan(normal.y - 8);
  expect(target.y, JSON.stringify({ target, geometry })).toBeGreaterThan(60);
  await draw(page, 0.2);
  expect(await canvasPixel(page, 480, 192)).toEqual([18, 52, 171, 255]);
  await saved(page);
  await expect
    .poll(
      async () =>
        ((await revision(page)) as Array<{ revision: number }>)[0].revision,
    )
    .toBeGreaterThan((before as Array<{ revision: number }>)[0].revision);
  await page.screenshot({ path: info.outputPath("hidden-controls-360.png") });
  await button(page, "ボタンを表示").click();
  await expect(button(page, "ペン")).toHaveAttribute("aria-pressed", "true");
  await expect(workspace(page).locator(".layer-current")).toContainText(
    "レイヤー2",
  );
  expect(await page.locator(".canvas-transform").getAttribute("style")).toBe(
    transform,
  );
  await button(page, "取り消し").click();
  await expectCanvasUnchanged(page, original);
  await button(page, "途中で保存").click();
  await saved(page);
  await button(page, "ボタンを隠す").click();
  await fullFrame(page);
  await draw(page, 0.2);
  const drawn = await bitmap(page);
  await saved(page);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  await expectCanvasUnchanged(page, drawn);
  await expect(page.locator(".tracing-underlay")).toBeVisible();
  await expect(page.locator(".layer-current")).toContainText("レイヤー2");
  await open(page);
  await expect(button(page, "ボタンを隠す")).toBeVisible();
});

test("縦横・文字200%でもボタンを戻せ、キーボードとEscapeで制作へ復帰できる", async ({
  page,
}, info) => {
  await startDrawing(page);
  await open(page);
  const blank = await bitmap(page);
  await button(page, "拡大・回転").click();
  await button(page, "表示を動かす").click();
  const hide = button(page, "ボタンを隠す");
  await hide.focus();
  await page.keyboard.press("Enter");
  await expect(button(page, "ボタンを表示")).toBeFocused();
  for (const size of [
    { width: 320, height: 568 },
    { width: 640, height: 360 },
    { width: 768, height: 1024 },
    { width: 375, height: 667 },
  ]) {
    await page.setViewportSize(size);
    await fullFrame(page);
    const shape = await page.locator(".canvas-transform").evaluate((el) => ({
      width: parseFloat(getComputedStyle(el).width),
      height: parseFloat(getComputedStyle(el).height),
    }));
    expect(shape.width).toBe(shape.height);
    const scroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
    await page.mouse.move(2, size.height / 2);
    await page.mouse.wheel(0, 300);
    expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(
      scroll,
    );
  }
  await page.setViewportSize({ width: 320, height: 640 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await fullFrame(page);
  const restore = button(page, "ボタンを表示");
  const box = (await restore.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(320);
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    audit.violations.map((violation) => ({
      id: violation.id,
      targets: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
  await restore.focus();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("group", { name: "キャンバスの表示範囲", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(restore).toBeFocused();
  await page.screenshot({
    path: info.outputPath("hidden-controls-text-200.png"),
  });
  await page.keyboard.press("Escape");
  await expect(workspace(page)).toBeVisible();
  await expect(button(page, "ボタンを隠す")).toBeFocused();
  await expect(page.locator(".support-panel")).toBeHidden();
  await expectCanvasUnchanged(page, blank);
  await button(page, "拡大・回転").click();
  await expect(button(page, "表示を動かす")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await button(page, "サポートを閉じる").click();
  await page.keyboard.press("Escape");
  await expect(workspace(page)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "画面いっぱいで描く", exact: true }),
  ).toBeFocused();
  expect(await page.evaluate(() => document.body.style.position)).toBe("");
});

test("ボタンを隠しても保存失敗と非表示レイヤーの案内を示し、書出と再試行ができる", async ({
  page,
}) => {
  await startDrawing(page);
  await page.getByLabel("ペンの色", { exact: true }).fill("#1234ab");
  await page
    .getByRole("slider", { name: "線の太さ", exact: true })
    .press("End");
  await open(page);
  await button(page, "途中で保存").click();
  await saved(page);
  const before = await revision(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (
      window as unknown as { restoreHiddenWrites: () => void }
    ).restoreHiddenWrites = () => {
      IDBObjectStore.prototype.put = original;
    };
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "artworks")
        throw new DOMException("test quota", "QuotaExceededError");
      return original.apply(this, args);
    };
  });
  await button(page, "ボタンを隠す").click();
  await fullFrame(page);
  await draw(page, 0.5);
  const drawn = await bitmap(page),
    frame = await page.locator(".canvas-frame").boundingBox();
  await expect(workspace(page).getByRole("alert")).toContainText("保存領域", {
    timeout: DRAWING_SAVE_TIMEOUT_MS,
  });
  await expect(workspace(page).getByRole("alert")).toBeVisible();
  expect(await page.locator(".canvas-frame").boundingBox()).toEqual(frame);
  expect(await revision(page)).toEqual(before);
  await expectCanvasUnchanged(page, drawn);
  await button(page, "ボタンを表示").click();
  await button(page, "道具設定").click();
  const download = page.waitForEvent("download");
  await button(page, "PNGを書き出す").click();
  const png = PNG.sync.read(await readFile((await (await download).path())!));
  expect([png.width, png.height]).toEqual([960, 960]);
  expect(
    Array.from(
      png.data.subarray((480 * 960 + 480) * 4, (480 * 960 + 480) * 4 + 4),
    ),
  ).toEqual([18, 52, 171, 255]);
  await button(page, "設定を閉じる").click();
  await page.evaluate(() =>
    (
      window as unknown as { restoreHiddenWrites: () => void }
    ).restoreHiddenWrites(),
  );
  await button(page, "途中で保存").click();
  await saved(page);
  await button(page, "レイヤー").click();
  await button(page, "レイヤーを追加").click();
  await button(page, "レイヤー2を隠す").click();
  await button(page, "ボタンを隠す").click();
  await fullFrame(page);
  await expect(
    workspace(page)
      .getByRole("status")
      .filter({ hasText: "選択中のレイヤーは非表示" }),
  ).toBeVisible();
  await button(page, "ボタンを表示").click();
  await button(page, "表示して描く").click();
  await button(page, "ボタンを隠す").click();
  await expect(
    workspace(page)
      .getByRole("status")
      .filter({ hasText: "選択中のレイヤーは非表示" }),
  ).toHaveCount(0);
});
