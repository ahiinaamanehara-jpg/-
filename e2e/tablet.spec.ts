import { expect, test, type Page } from "@playwright/test";

test.use({
  viewport: { width: 768, height: 1024 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
});

async function start(page: Page) {
  await page.goto("#/new");
  await page
    .getByRole("button", { name: "テーマを決めずに進む", exact: true })
    .tap();
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
}
const bitmap = (page: Page) =>
  page
    .getByLabel("お絵描きキャンバス")
    .evaluate((c) => (c as HTMLCanvasElement).toDataURL());
async function saved(page: Page) {
  await page.getByRole("button", { name: "途中で保存", exact: true }).tap();
  await expect(page.locator(".save-status")).toHaveText("保存済み");
}

test("iPad相当の縦横・画面分割サイズでタッチ描画の座標と保存画像を保つ", async ({
  page,
  context,
}, info) => {
  await start(page);
  const canvas = page.getByLabel("お絵描きキャンバス"),
    cdp = await context.newCDPSession(page);
  let before = await bitmap(page),
    step = 0;
  for (const [width, height] of [
    [768, 1024],
    [1024, 768],
    [810, 1080],
    [1080, 810],
    [375, 1024],
  ]) {
    await page.setViewportSize({ width, height });
    expect(await bitmap(page)).toBe(before);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await canvas.scrollIntoViewIfNeeded();
    const b = (await canvas.boundingBox())!,
      y = 0.2 + step++ * 0.12;
    const point = (x: number) => ({
      id: 1,
      x: b.x + b.width * x,
      y: b.y + b.height * y,
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [point(0.2)],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [point(0.8)],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    expect(
      await canvas.evaluate(
        (c, y) =>
          (c as HTMLCanvasElement)
            .getContext("2d")!
            .getImageData(480, Math.round(960 * y), 1, 1).data[3],
        y,
      ),
    ).toBe(255);
    await saved(page);
    before = await bitmap(page);
  }
  await page.reload();
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  expect(await bitmap(page)).toBe(before);
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.screenshot({
    path: info.outputPath("tablet-portrait.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.screenshot({
    path: info.outputPath("tablet-landscape.png"),
    fullPage: true,
  });
  expect(await canvas.evaluate((c) => getComputedStyle(c).touchAction)).toBe(
    "none",
  );
  expect(
    await page
      .locator("body")
      .evaluate((el) => getComputedStyle(el).touchAction),
  ).toBe("auto");
  const viewport = await page
    .locator("meta[name=viewport]")
    .getAttribute("content");
  expect(viewport).not.toMatch(/user-scalable\s*=\s*no|maximum-scale\s*=\s*1/);
  await cdp.detach();
});

test("タブレットの短い表示領域でも任意回答・ギャラリー・PNG出力へ進める", async ({
  page,
}) => {
  await start(page);
  const canvas = page.getByLabel("お絵描きキャンバス");
  await canvas.scrollIntoViewIfNeeded();
  const b = (await canvas.boundingBox())!;
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  await saved(page);
  const before = await bitmap(page);
  await page
    .getByRole("button", { name: "描くヒント（任意）", exact: true })
    .tap();
  await page.getByRole("button", { name: "簡単なポーズ", exact: true }).tap();
  await page.getByRole("button", { name: "描く画面に戻る", exact: true }).tap();
  expect(await bitmap(page)).toBe(before);
  await page
    .getByRole("button", { name: "振り返る（任意）", exact: true })
    .tap();
  await page.setViewportSize({ width: 768, height: 420 });
  const d = page.getByRole("dialog");
  await d
    .getByLabel("自由に書く（任意）", { exact: true })
    .fill("横向きでも短い落書きを残す");
  await d.getByRole("button", { name: "回答を保存", exact: true }).tap();
  await expect(
    d.getByText("横向きでも短い落書きを残す", { exact: true }),
  ).toBeVisible();
  await d.getByRole("button", { name: "振り返りを終える", exact: true }).tap();
  await page.setViewportSize({ width: 1024, height: 768 });
  expect(await bitmap(page)).toBe(before);
  await page.getByRole("link", { name: "作品の棚", exact: true }).tap();
  await page.locator(".work-card").getByRole("link").tap();
  await page
    .getByRole("button", { name: "振り返りを見る・書く（任意）", exact: true })
    .tap();
  await expect(
    d.getByText("横向きでも短い落書きを残す", { exact: true }),
  ).toBeVisible();
  await d.getByRole("button", { name: "振り返りを終える", exact: true }).tap();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "PNGを書き出す", exact: true }).tap();
  expect((await download).suggestedFilename()).toBe("すきのスケッチ.png");
});
