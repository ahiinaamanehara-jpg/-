import { test, expect } from "@playwright/test";

const screens = [
  ["#/", "好き、からはじめよう。"],
  ["#/characters", "推しのノート"],
  ["#/characters/new", "推しを迎える"],
  ["#/new", "今日は、どんな姿に？"],
  ["#/draw/new", "あなたの創作スペース"],
  ["#/settings/data", "データと安心のこと"],
  ["#/characters/missing", "推しが見つかりません"],
  ["#/works/missing", "作品が見つかりません"],
  ["#/unknown", "ページが見つかりません"],
] as const;

test.describe("モバイル入力の現在の対応範囲", () => {
  test.use({
    viewport: { width: 320, height: 720 },
    hasTouch: true,
    isMobile: true,
  });

  test("タップで準備画面へ移動し保存説明を開閉できる（描画は未実装）", async ({
    page,
  }, testInfo) => {
    await page.goto("");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      screens[0][1],
    );
    await page.screenshot({
      path: testInfo.outputPath("home-320.png"),
      fullPage: true,
    });

    await page.getByRole("button", { name: "端末内保存について" }).tap();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "閉じる", exact: true }).tap();
    await expect(page.getByRole("dialog")).not.toBeVisible();

    await page.getByRole("link", { name: "自由に落書きする準備" }).tap();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      screens[3][1],
    );
    await page.getByRole("link", { name: "制作画面の準備を見る" }).tap();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      screens[4][1],
    );
    await expect(
      page.getByText("キャンバスはM4で追加します。まだ描画できません。", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator("canvas")).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath("draw-preparation-320.png"),
      fullPage: true,
    });
  });
});

test("320px・文字200%の各画面で横スクロールを要求しない", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  for (const [hash, title] of screens) {
    await page.goto(hash);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    // 実ブラウザーのズーム検証ではなく、ルート文字サイズ拡大のシミュレーション。
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      hash,
    ).toBe(true);
  }
  await page.goto("#/settings/data");
  await page.getByRole("button", { name: "保存の仕組みを読む" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page
      .getByRole("dialog")
      .evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth),
  ).toBe(true);
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
});

test("キーボードで本文へ移動してもルートを書き換えない", async ({ page }) => {
  await page.goto("#/characters/new");
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  const skip = page.getByRole("link", { name: "本文へ移動" });
  for (let index = 0; index < 5; index += 1)
    await page.keyboard.press("Shift+Tab");
  await expect(skip).toBeFocused();
  const originalURL = page.url();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  await expect(page).toHaveURL(originalURL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    screens[2][1],
  );
});

test("各画面の操作で不要な外部リクエストと未処理エラーがない", async ({
  page,
}, testInfo) => {
  const external: string[] = [];
  const pageErrors: string[] = [];
  const appOrigin = new URL(String(testInfo.project.use.baseURL)).origin;
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== appOrigin)
      external.push(request.url());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  for (const [hash, title] of screens) {
    await page.goto(hash);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    if (hash === "#/characters/new") {
      await page.getByLabel("キャラクター名").fill("私の好きなキャラクター");
      await page
        .getByLabel("好きな特徴・描きたいところ")
        .fill("笑っている表情を描いてみたい");
      page.once("dialog", (dialog) => dialog.accept());
    }
    if (hash === "#/settings/data") {
      await expect(page.getByRole("status")).toContainText(
        "端末内保存を利用できます",
      );
      await page.getByRole("button", { name: "保存の仕組みを読む" }).click();
      await page.getByRole("button", { name: "閉じる", exact: true }).click();
    }
  }
  expect(external).toEqual([]);
  expect(pageErrors).toEqual([]);
});
