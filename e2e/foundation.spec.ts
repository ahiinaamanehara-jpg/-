import { test, expect } from "@playwright/test";
test("320pxで空状態から画面遷移・戻る・再読込", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "好き、からはじめよう。",
  );
  await page.getByRole("link", { name: "好きなキャラクターを選ぶ" }).click();
  await page.getByRole("link", { name: "推しを登録する" }).click();
  await page.getByLabel("キャラクター名").fill("好きな人");
  await page.getByRole("button", { name: "登録して保存" }).click();
  await expect(page).toHaveURL(/#\/characters$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "推しのノート",
  );
  await page.getByRole("link", { name: "推しを選ばずに進む" }).click();
  await expect(page).toHaveURL(/#\/new$/);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "今日は、どんな姿に？",
  );
  await page
    .getByRole("button", { name: "テーマを決めずに進む", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/draw\/(?!new$)[^/]+$/);
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel("お絵描きキャンバス")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("シートのキーボード操作とフォーカス復帰", async ({ page }) => {
  await page.goto("");
  const trigger = page.getByRole("button", { name: "端末内保存について" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "閉じる", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "閉じる", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(trigger).toBeFocused();
});
test("直接URL・見つからないデータ・DBの非破壊再接続", async ({ page }) => {
  await page.goto("#/settings/data");
  await expect(page.getByRole("status")).toContainText(
    "端末内保存を利用できます",
  );
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("suki-sketch");
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("settings", "readwrite");
        tx.objectStore("settings").put({ key: "test", value: "保持する" });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  await page.reload();
  await expect(page.getByRole("status")).toContainText(
    "端末内保存を利用できます",
  );
  expect(
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          const r = indexedDB.open("suki-sketch");
          r.onsuccess = () => {
            const db = r.result;
            const tx = db.transaction("settings");
            const get = tx.objectStore("settings").get("test");
            get.onsuccess = () => resolve(get.result.value);
            tx.oncomplete = () => db.close();
          };
        }),
    ),
  ).toBe("保持する");
  for (const path of ["#/works/missing", "#/characters/missing", "#/unknown"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "見つかりません",
    );
  }
});
test("DB利用不可を示し、外部リクエストを発生させない", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).hostname !== "127.0.0.1") external.push(r.url());
  });
  await page.addInitScript(() =>
    Object.defineProperty(window, "indexedDB", {
      get() {
        throw new Error("unavailable");
      },
    }),
  );
  await page.goto("#/settings/data");
  await expect(page.getByRole("status")).toContainText("利用できません");
  expect(external).toEqual([]);
});
