import { expect, type Page } from "@playwright/test";
import { test } from "./support/persistentTest";
import {
  startDrawing,
  bitmap,
  paintLine,
  canvasPixel,
  viewState,
} from "./support/canvasView";
import { expectCanvasUnchanged } from "./support/canvasSnapshot";
import {
  expectSaved,
  observeStorageErrors,
} from "./support/storageDiagnostics";
import AxeBuilder from "@axe-core/playwright";

test.use({ viewport: { width: 360, height: 800 } });
test.beforeEach(async ({ page }) => observeStorageErrors(page));
const featureNames = ["下絵をなぞる", "レイヤー", "拡大・回転"];
const featureButton = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });

test("3つの入口を並べ、設定の切替でも絵・下絵・選択先を保ち保存再開できる", async ({
  page,
}, info) => {
  await startDrawing(page);
  for (const name of featureNames) {
    await expect(featureButton(page, name)).toBeInViewport({ ratio: 1 });
    await expect(featureButton(page, name)).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  }
  await expect(page.locator(".support-panel")).toBeHidden();
  const canvas = await page.getByLabel("お絵描きキャンバス").elementHandle();
  await page.getByLabel("ペンの色", { exact: true }).fill("#1234ab");
  await page
    .getByRole("slider", { name: "線の太さ", exact: true })
    .press("End");
  await paintLine(page);
  const drawn = await bitmap(page);
  await featureButton(page, "下絵をなぞる").click();
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 16;
    canvas.getContext("2d")!.fillRect(0, 0, 16, 16);
    return canvas.toDataURL().split(",")[1];
  });
  await page.getByLabel("下絵の画像を選ぶ", { exact: true }).setInputFiles({
    name: "guide.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await expect(page.locator(".tracing-underlay")).toHaveCount(1);
  await expect(featureButton(page, "下絵をなぞる")).toHaveAccessibleDescription(
    "下絵を表示中",
  );
  await featureButton(page, "レイヤー").click();
  await expect(featureButton(page, "下絵をなぞる")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(
    page.getByLabel("下絵の画像を選ぶ", { exact: true }),
  ).toBeHidden();
  await page
    .getByRole("button", { name: "レイヤーを追加", exact: true })
    .click();
  await expect(featureButton(page, "レイヤー")).toHaveAccessibleDescription(
    "2／5枚",
  );
  await featureButton(page, "拡大・回転").click();
  await expect(
    page.getByRole("button", { name: "レイヤーを追加", exact: true }),
  ).toBeHidden();
  await page.getByRole("button", { name: "表示を拡大", exact: true }).click();
  await page.getByRole("button", { name: "右に回す", exact: true }).click();
  expect((await viewState(page)).scale).toBeCloseTo(1.25, 5);
  await featureButton(page, "下絵をなぞる").click();
  await page
    .getByRole("button", { name: "サポートを閉じる", exact: true })
    .click();
  await expect(featureButton(page, "下絵をなぞる")).toBeFocused();
  expect(
    await canvas!.evaluate(
      (el) =>
        el ===
        document.querySelector("canvas[aria-label='お絵描きキャンバス']"),
    ),
  ).toBe(true);
  await expectCanvasUnchanged(page, drawn);
  await expect(page.locator(".layer-current")).toContainText("レイヤー2");
  await page.getByRole("button", { name: "取り消し", exact: true }).click();
  await expect(featureButton(page, "レイヤー")).toHaveAccessibleDescription(
    "1／5枚",
  );
  await expectCanvasUnchanged(page, drawn);
  await featureButton(page, "レイヤー").click();
  await page
    .getByRole("button", { name: "レイヤーを追加", exact: true })
    .click();
  await page.getByRole("button", { name: "途中で保存", exact: true }).click();
  await expectSaved(page);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  await expectCanvasUnchanged(page, drawn);
  await expect(featureButton(page, "レイヤー")).toHaveAccessibleDescription(
    "2／5枚",
  );
  await expect(featureButton(page, "下絵をなぞる")).toHaveAccessibleDescription(
    "下絵を表示中",
  );
  await expect(page.locator(".support-panel")).toBeHidden();
  await page.screenshot({ path: info.outputPath("drawing-support-360.png") });
});

test("専用画面でも直接開け、小画面・文字200%・キーボードで閉じて描画へ戻れる", async ({
  page,
}, info) => {
  await startDrawing(page, true);
  await paintLine(page);
  const drawn = await bitmap(page);
  const canvas = await page.getByLabel("お絵描きキャンバス").elementHandle();
  await page
    .getByRole("button", { name: "画面いっぱいで描く", exact: true })
    .click();
  const workspace = page.getByRole("dialog", {
    name: "画面いっぱいで描く",
    exact: true,
  });
  for (const size of [
    { width: 320, height: 568 },
    { width: 640, height: 360 },
    { width: 360, height: 800 },
  ]) {
    await page.setViewportSize(size);
    for (const name of featureNames) {
      const button = featureButton(page, name);
      await expect(button).toBeInViewport({ ratio: 1 });
      await button.focus();
      await page.keyboard.press("Enter");
      await expect(button).toHaveAttribute("aria-expanded", "true");
      await expect(page.locator(".support-panel-heading h3")).toBeFocused();
      const panelBox = (await page.locator(".support-panel").boundingBox())!;
      const triggerBox = (await button.boundingBox())!;
      expect(panelBox.x).toBeGreaterThanOrEqual(0);
      expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(size.width);
      expect(panelBox.y).toBeGreaterThanOrEqual(
        triggerBox.y + triggerBox.height,
      );
      for (const other of featureNames.filter((value) => value !== name))
        await expect(featureButton(page, other)).toHaveAttribute(
          "aria-expanded",
          "false",
        );
      const nextName =
        featureNames[(featureNames.indexOf(name) + 1) % featureNames.length];
      const next = featureButton(page, nextName);
      // 設定を開いたまま、見えている次の入口をポインターで押せること。
      await next.click({ timeout: 3000 });
      await expect(button).toHaveAttribute("aria-expanded", "false");
      await expect(next).toHaveAttribute("aria-expanded", "true");
      await page.keyboard.press("Escape");
      await expect(next).toBeFocused();
      await expect(page.locator(".support-panel")).toBeHidden();
      await expect(workspace).toBeVisible();
    }
  }
  await page.screenshot({
    path: info.outputPath("drawing-support-focused-360.png"),
  });
  const tools = page.getByRole("button", { name: "道具設定", exact: true });
  await tools.click();
  await page.getByLabel("ペンの色", { exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(page.locator(".workspace-options")).toBeHidden();
  await expect(tools).toBeFocused();
  await expect(workspace).toBeVisible();
  await page.setViewportSize({ width: 320, height: 568 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  const scroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  for (const name of featureNames) {
    const button = featureButton(page, name);
    await button.scrollIntoViewIfNeeded();
    // native scrollの整数化で縁が1px未満欠ける場合だけを許容する。
    // 画面内の割合に加え、実際のスクロール枠での欠けも別に測定する。
    await expect(button).toBeInViewport({ ratio: 0.99 });
    const clipping = await button.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const parent = element
        .closest(".support-buttons")!
        .getBoundingClientRect();
      return [
        parent.top - box.top,
        box.bottom - parent.bottom,
        parent.left - box.left,
        box.right - parent.right,
      ];
    });
    for (const difference of clipping) expect(difference).toBeLessThan(1);
    const box = (await button.boundingBox())!;
    expect(box.width + 0.001).toBeGreaterThanOrEqual(44);
    expect(box.height + 0.001).toBeGreaterThanOrEqual(44);
    await button.click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "サポートを閉じる", exact: true })
      .click();
    await expect(button).toBeFocused();
  }
  await featureButton(page, "レイヤー").click();
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    audit.violations.map((v) => ({
      id: v.id,
      targets: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  await page.screenshot({
    path: info.outputPath("drawing-support-text-200.png"),
  });
  await page
    .getByRole("button", { name: "サポートを閉じる", exact: true })
    .click();
  expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(
    scroll,
  );
  expect(
    await canvas!.evaluate(
      (el) =>
        el ===
        document.querySelector("canvas[aria-label='お絵描きキャンバス']"),
    ),
  ).toBe(true);
  await expectCanvasUnchanged(page, drawn);
  await page.getByRole("button", { name: "取り消し", exact: true }).click();
  expect((await canvasPixel(page))[3]).toBe(0);
  await page.keyboard.press("Escape");
  await expect(workspace).toHaveCount(0);
});
