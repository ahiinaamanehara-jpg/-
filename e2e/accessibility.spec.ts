import { expect, test, type Page, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { writeFile } from "node:fs/promises";

async function prepare(page: Page) {
  await page.goto("#/characters/new");
  await page
    .getByLabel("キャラクター名", { exact: true })
    .fill("推し" + "A".repeat(80));
  await page.getByRole("button", { name: "登録して保存", exact: true }).click();
  await page
    .getByRole("button", { name: "この推しを選ぶ", exact: true })
    .click();
  await page
    .getByRole("link", { name: "選んだ推しと次へ進む", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "描きたいテーマ", exact: true })
    .fill("好きな顔" + "B".repeat(200));
  await page
    .getByRole("button", { name: "このテーマで進む", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "途中で保存", exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText("保存済み");
  const draw = new URL(page.url()).hash;
  return { draw, detail: draw.replace("#/draw/", "#/works/") };
}
async function audit(page: Page, name: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => n.target),
    })),
    name,
  ).toEqual([]);
  return {
    name,
    violations: results.violations.length,
    incomplete: results.incomplete.map((r) => r.id),
    passedRules: results.passes.length,
  };
}
async function byKeyboard(page: Page, target: Locator) {
  for (let i = 0; i < 80; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

test("主要画面と任意・削除シートのラベル・コントラストを検査する", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const reports = [];
  const { draw, detail } = await prepare(page);
  for (const route of [
    "#/",
    "#/characters",
    "#/characters/new",
    "#/new",
    draw,
    detail,
    "#/settings/data",
  ]) {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    if (route === draw)
      await expect(
        page.getByRole("button", { name: "ペン", exact: true }),
      ).toBeEnabled();
    if (route === detail)
      await expect(
        page.getByRole("button", { name: "この作品を削除", exact: true }),
      ).toBeVisible();
    reports.push(await audit(page, route));
  }
  await page
    .getByRole("button", {
      name: "このブラウザーの全データを削除",
      exact: true,
    })
    .click();
  reports.push(await audit(page, "全消去の確認"));
  await page.getByRole("button", { name: "キャンセル", exact: true }).click();
  await page.goto(draw);
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "描くヒント（任意）", exact: true })
    .click();
  reports.push(await audit(page, "ヒント"));
  await page
    .getByRole("button", { name: "描く画面に戻る", exact: true })
    .click();
  await page
    .getByRole("button", { name: "振り返る（任意）", exact: true })
    .click();
  await expect(
    page.getByLabel("自由に書く（任意）", { exact: true }),
  ).toBeVisible();
  reports.push(await audit(page, "振り返り"));
  const report = info.outputPath("accessibility-audit.json");
  await writeFile(report, JSON.stringify(reports, null, 2));
  await info.attach("accessibility-audit.json", {
    path: report,
    contentType: "application/json",
  });
});

test("7種類の画面幅と文字200%で主要画面・短いシートを操作できる", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const { draw, detail } = await prepare(page);
  for (const width of [320, 375, 390, 768, 810, 1024, 1280]) {
    await page.setViewportSize({ width, height: 812 });
    for (const route of [
      "#/",
      "#/characters",
      "#/new",
      draw,
      detail,
      "#/settings/data",
    ]) {
      await page.goto(route);
      const heading = page.getByRole("heading", { level: 1 });
      await expect(heading).toBeVisible();
      if (route === draw)
        await expect(
          page.getByRole("button", { name: "ペン", exact: true }),
        ).toBeEnabled();
      if (route === detail)
        await expect(
          page.getByRole("button", { name: "この作品を削除", exact: true }),
        ).toBeVisible();
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "100%";
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${width}px ${route} 通常文字`,
      ).toBe(true);
      const initial = await heading.evaluate((el) =>
        parseFloat(getComputedStyle(el).fontSize),
      );
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });
      expect(
        await heading.evaluate((el) =>
          parseFloat(getComputedStyle(el).fontSize),
        ),
        `${width}px ${route} 見出しの文字拡大`,
      ).toBeGreaterThanOrEqual(initial * 1.9);
      const overflow = await page.evaluate(() => ({
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        elements: Array.from(document.querySelectorAll("body *"))
          .filter(
            (el) =>
              el.getBoundingClientRect().right > innerWidth + 1 ||
              (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1),
          )
          .map((el) => `${el.tagName}.${el.className}`)
          .slice(0, 12),
      }));
      expect(
        overflow.scrollWidth <= overflow.width,
        `${width}px ${route} ${JSON.stringify(overflow)}`,
      ).toBe(true);
      const small = await page
        .locator(
          "button:visible, select:visible, input:not([type=radio]):visible, textarea:visible",
        )
        .evaluateAll((elements) =>
          elements
            .filter((el) => {
              const r = el.getBoundingClientRect();
              return r.height < 44 || r.width < 44;
            })
            .map((el) => el.outerHTML.slice(0, 120)),
        );
      expect(small, `${width}px ${route} 操作領域`).toEqual([]);
    }
  }
  await page.goto(draw);
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 360 });
  await page
    .getByRole("button", { name: "振り返る（任意）", exact: true })
    .click();
  const d = page.getByRole("dialog");
  await d
    .getByLabel("自由に書く（任意）", { exact: true })
    .fill("短い画面でも入力できる");
  await d.getByRole("button", { name: "回答を保存", exact: true }).click();
  await expect(
    d.getByText("短い画面でも入力できる", { exact: true }),
  ).toBeVisible();
  expect(await d.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await d
    .getByRole("button", { name: "振り返りを終える", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "振り返る（任意）", exact: true }),
  ).toBeFocused();
  await page.setViewportSize({ width: 320, height: 720 });
  await page.screenshot({
    path: info.outputPath("drawing-text-200.png"),
    fullPage: true,
  });
});

test("キーボードで道具・シート・作品詳細・削除確認を操作しフォーカスが戻る", async ({
  page,
}) => {
  const { draw, detail } = await prepare(page);
  const hint = page.getByRole("button", {
    name: "描くヒント（任意）",
    exact: true,
  });
  await page.goto(draw);
  const pen = page.getByRole("button", { name: "ペン", exact: true });
  await expect(pen).toBeEnabled();
  await byKeyboard(page, pen);
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "消しゴム", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "消しゴム", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await byKeyboard(page, hint);
  await page.keyboard.press("Enter");
  const d = page.getByRole("dialog"),
    close = d.getByRole("button", { name: "閉じる", exact: true });
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    d.getByRole("button", { name: "描く画面に戻る", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(hint).toBeFocused();
  expect(
    await hint.evaluate((el) => getComputedStyle(el).outlineStyle),
  ).not.toBe("none");
  await page.goto(detail);
  const remove = page.getByRole("button", {
    name: "この作品を削除",
    exact: true,
  });
  await expect(remove).toBeVisible();
  await byKeyboard(page, remove);
  await page.keyboard.press("Enter");
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(remove).toBeFocused();
  await expect(
    page.getByRole("link", { name: "続きを描く", exact: true }),
  ).toBeVisible();
});
