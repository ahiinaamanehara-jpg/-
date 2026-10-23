import { expect, type Locator, type Page } from "@playwright/test";
import { test } from "./support/persistentTest";
import { expectCanvasUnchanged } from "./support/canvasSnapshot";
import {
  expectSaved,
  observeStorageErrors,
} from "./support/storageDiagnostics";

test.beforeEach(async ({ page }) => observeStorageErrors(page));

async function start(page: Page) {
  await page.goto("#/new");
  await page
    .getByRole("button", { name: "テーマを決めずに進む", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
}

async function canvasAtTop(page: Page) {
  await page.getByLabel("お絵描きキャンバス").evaluate((el) => {
    // 枠も見える余白を残す。端への配置ではスクロールの丸めで1px未満欠ける。
    window.scrollTo(0, el.getBoundingClientRect().top + scrollY - 16);
  });
}

async function stroke(page: Page) {
  await canvasAtTop(page);
  const box = (await page.getByLabel("お絵描きキャンバス").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.5, {
    steps: 4,
  });
  await page.mouse.up();
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
}

const bitmap = (page: Page) =>
  page
    .getByLabel("お絵描きキャンバス")
    .evaluate((c) => (c as HTMLCanvasElement).toDataURL());

const centerPixel = (page: Page) =>
  page
    .getByLabel("お絵描きキャンバス")
    .evaluate((c) =>
      Array.from(
        (c as HTMLCanvasElement).getContext("2d")!.getImageData(480, 480, 1, 1)
          .data,
      ),
    );

function controls(page: Page): Locator[] {
  return [
    ...["ペン", "消しゴム", "取り消し", "途中で保存"].map((name) =>
      page.getByRole("button", { name, exact: true }),
    ),
    page.getByLabel("ペンの色", { exact: true }),
    page.getByRole("slider", { name: "線の太さ", exact: true }),
  ];
}

async function usableSize(control: Locator) {
  const box = (await control.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
}

for (const width of [320, 360]) {
  test(`${width}pxの短い縦画面でキャンバスと道具・途中保存を一緒に表示し、描画・取消・保存復帰できる`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 640 });
    await start(page);
    await canvasAtTop(page);
    await expect(page.getByLabel("お絵描きキャンバス")).toBeInViewport({
      ratio: 1,
    });
    for (const control of controls(page)) {
      await expect(control).toBeInViewport({ ratio: 1 });
      await usableSize(control);
    }
    const scroll = await page.evaluate(() => scrollY);
    await page.getByLabel("ペンの色", { exact: true }).fill("#2b61a1");
    const range = page.getByRole("slider", { name: "線の太さ", exact: true });
    await range.focus();
    await page.keyboard.press("End");
    await expect(range).toHaveValue("40");
    await stroke(page);
    expect(await centerPixel(page)).toEqual([43, 97, 161, 255]);
    const drawn = await bitmap(page);
    const eraser = page.getByRole("button", { name: "消しゴム", exact: true });
    await eraser.click();
    await expect(eraser).toHaveAttribute("aria-pressed", "true");
    await stroke(page);
    expect((await centerPixel(page))[3]).toBe(0);
    await page.getByRole("button", { name: "取り消し", exact: true }).click();
    await expectCanvasUnchanged(page, drawn);
    await page.getByRole("button", { name: "途中で保存", exact: true }).click();
    await expectSaved(page);
    expect(await page.evaluate(() => scrollY)).toBe(scroll);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("canvas-and-tools.png") });
    await page.reload();
    await expect(eraser).toBeEnabled();
    await expect(eraser).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("ペンの色", { exact: true })).toHaveValue(
      "#2b61a1",
    );
    await expect(range).toHaveValue("40");
    await expectCanvasUnchanged(page, drawn);
  });
}

test("320／360px幅の文字200%でも道具が欠けず、スクロールとキーボードで保存できる", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await start(page);
  await stroke(page);
  const drawn = await bitmap(page);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  for (const width of [320, 360]) {
    await page.setViewportSize({ width, height: 640 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    for (const control of controls(page)) {
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeInViewport({ ratio: 1 });
      await usableSize(control);
      if ((await control.evaluate((el) => el.tagName)) === "BUTTON") {
        expect(
          await control.evaluate(
            (el) =>
              el.scrollWidth <= el.clientWidth &&
              el.scrollHeight <= el.clientHeight,
          ),
        ).toBe(true);
      }
    }
    await expectCanvasUnchanged(page, drawn);
  }
  const pen = page.getByRole("button", { name: "ペン", exact: true });
  await pen.focus();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "消しゴム", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "消しゴム", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const save = page.getByRole("button", { name: "途中で保存", exact: true });
  for (let i = 0; i < 4; i++) await page.keyboard.press("Tab");
  await expect(save).toBeFocused();
  await page.keyboard.press("Enter");
  await expectSaved(page);
  await expectCanvasUnchanged(page, drawn);
  await page.screenshot({ path: info.outputPath("large-text-tools.png") });
});
