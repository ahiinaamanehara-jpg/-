import { expect, type Page } from "@playwright/test";
import { test } from "./support/persistentTest";
import {
  startDrawing,
  paintLine,
  bitmap,
  canvasPixel,
} from "./support/canvasView";
import { expectCanvasUnchanged } from "./support/canvasSnapshot";
import {
  expectSaved,
  observeStorageErrors,
} from "./support/storageDiagnostics";
import AxeBuilder from "@axe-core/playwright";

test.use({ viewport: { width: 360, height: 800 } });
test.beforeEach(async ({ page }) => observeStorageErrors(page));
const hints = (page: Page) =>
  page.getByRole("dialog", { name: "描くヒント", exact: true });
const topicButton = (page: Page, name: string) =>
  hints(page).getByRole("button", { name, exact: true });
const basic = ["表情", "顔の形", "簡単なポーズ", "模写", "トレース"];
const advanced = ["レイヤー", "拡大・回転", "模写とトレース"];

test("基礎5項目と応用3項目を自由に選び、読み替えても絵と道具・取消を保つ", async ({
  page,
}, info) => {
  const external: string[] = [],
    errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.protocol.startsWith("http") &&
      url.origin !== new URL(String(info.project.use.baseURL)).origin
    )
      external.push(request.url());
  });
  await startDrawing(page, true);
  await page.getByLabel("ペンの色", { exact: true }).fill("#1234ab");
  await page
    .getByRole("slider", { name: "線の太さ", exact: true })
    .press("End");
  await paintLine(page);
  await page.getByRole("button", { name: "途中で保存", exact: true }).click();
  await expectSaved(page);
  const drawn = await bitmap(page);
  const canvas = await page.getByLabel("お絵描きキャンバス").elementHandle();
  const trigger = page.getByRole("button", {
    name: "描くヒント（任意）",
    exact: true,
  });
  await trigger.click();
  await expect(topicButton(page, "基礎")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    hints(page)
      .getByRole("group", { name: "基礎のヒント", exact: true })
      .getByRole("button"),
  ).toHaveText(basic);
  await page.screenshot({ path: info.outputPath("hint-categories-360.png") });
  // 基礎を読み終えなくても応用を直接選べる。
  await topicButton(page, "応用").click();
  await expect(
    hints(page)
      .getByRole("group", { name: "応用のヒント", exact: true })
      .getByRole("button"),
  ).toHaveText(advanced);
  for (const name of advanced) {
    await topicButton(page, name).click();
    await expect(
      hints(page).getByRole("heading", {
        name: `${name}のヒント`,
        exact: true,
      }),
    ).toBeVisible();
  }
  await expect(hints(page).locator("dt")).toHaveText(["模写", "トレース"]);
  await expect(hints(page)).toContainText("利用条件");
  await expect(hints(page)).toContainText(
    "必要な許可の代わりになるとは限りません",
  );
  await topicButton(page, "レイヤー").click();
  await expect(hints(page)).toContainText("最大5枚");
  await expect(hints(page)).toContainText("選んだ1枚だけ");
  await expect(hints(page)).toContainText("バックアップZIP");
  await topicButton(page, "拡大・回転").click();
  await expect(hints(page)).toContainText("一度両方の指を離し");
  await expect(hints(page)).toContainText(
    "保存・PNGの大きさや向きは変わりません",
  );
  await topicButton(page, "基礎").click();
  for (const name of basic) {
    await topicButton(page, name).click();
    await expect(
      hints(page).getByRole("heading", {
        name: `${name}のヒント`,
        exact: true,
      }),
    ).toBeVisible();
    if (basic.indexOf(name) < 3)
      await expect(hints(page).getByRole("img")).toBeVisible();
  }
  await expect(hints(page)).toContainText("下絵は作品のPNGには入りません");
  await expect(hints(page)).toContainText("下絵をなぞる");
  await topicButton(page, "応用").click();
  await expect(topicButton(page, "拡大・回転")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await topicButton(page, "基礎").click();
  await expect(topicButton(page, "トレース")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await hints(page)
    .getByRole("heading", { name: "トレースのヒント", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("basic-tracing-360.png") });
  await hints(page)
    .getByRole("button", { name: "描く画面に戻る", exact: true })
    .click();
  await expect(trigger).toBeFocused();
  expect(
    await canvas!.evaluate(
      (element) =>
        element ===
        document.querySelector("canvas[aria-label='お絵描きキャンバス']"),
    ),
  ).toBe(true);
  await expectCanvasUnchanged(page, drawn);
  await expect(page.getByLabel("ペンの色", { exact: true })).toHaveValue(
    "#1234ab",
  );
  await expect(
    page.getByRole("slider", { name: "線の太さ", exact: true }),
  ).toHaveValue("40");
  await expect(page.locator(".tracing-underlay")).toBeVisible();
  await page.getByRole("button", { name: "取り消し", exact: true }).click();
  expect((await canvasPixel(page))[3]).toBe(0);
  await paintLine(page, 0.6);
  await page.getByRole("button", { name: "途中で保存", exact: true }).click();
  await expectSaved(page);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test("一時描画でも基礎と応用を読め、320px・文字200%・キーボードで閉じて戻れる", async ({
  page,
}, info) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "indexedDB", {
      get() {
        throw new Error("disabled for test");
      },
    }),
  );
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("#/draw/new");
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  await paintLine(page);
  const drawn = await bitmap(page);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  const trigger = page.getByRole("button", {
    name: "描くヒント（任意）",
    exact: true,
  });
  await trigger.click();
  await expect(topicButton(page, "閉じる")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(topicButton(page, "基礎")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(topicButton(page, "応用")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(topicButton(page, "応用")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  for (const [level, names] of [
    ["基礎", basic],
    ["応用", advanced],
  ] as const) {
    await topicButton(page, level).click();
    for (const name of names) {
      const button = topicButton(page, name);
      await button.click();
      const box = (await button.boundingBox())!;
      expect(box.width + 0.001).toBeGreaterThanOrEqual(44);
      expect(box.height + 0.001).toBeGreaterThanOrEqual(44);
      expect(
        await hints(page).evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
    }
  }
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    audit.violations.map((v) => ({
      id: v.id,
      targets: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  await hints(page)
    .getByRole("heading", { name: "模写とトレースのヒント", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath("advanced-methods-text-200.png"),
  });
  const back = hints(page).getByRole("button", {
    name: "描く画面に戻る",
    exact: true,
  });
  await back.focus();
  await page.keyboard.press("Tab");
  await expect(topicButton(page, "閉じる")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(back).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(hints(page)).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expectCanvasUnchanged(page, drawn);
  await trigger.click();
  await expect(topicButton(page, "基礎")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.press("Escape");
  await expect(hints(page)).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.getByRole("button", { name: "取り消し", exact: true }).click();
  expect((await canvasPixel(page))[3]).toBe(0);
});
