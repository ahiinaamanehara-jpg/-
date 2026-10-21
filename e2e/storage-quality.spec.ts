import { test, expect } from "@playwright/test";

for (const schema of ["missing", "wrong-key", "auto-increment"] as const) {
  test(`不整合DBを保存可能と表示せず既存データを保持する: ${schema}`, async ({
    page,
  }) => {
    await page.goto("#/settings/data");
    await expect(page.getByRole("status")).toContainText("利用できます");
    await page.evaluate(async (schema) => {
      await new Promise<void>((resolve, reject) => {
        const removal = indexedDB.deleteDatabase("suki-sketch");
        removal.onsuccess = () => resolve();
        removal.onerror = () => reject(removal.error);
      });
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("suki-sketch", 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          db.createObjectStore("legacy").put("消さないデータ", "keep");
          if (schema !== "missing")
            db.createObjectStore("settings", {
              keyPath: schema === "wrong-key" ? "id" : "key",
              autoIncrement: schema === "auto-increment",
            });
        };
        request.onsuccess = () => {
          request.result.close();
          resolve();
        };
        request.onerror = () => reject(request.error);
      });
    }, schema);
    await page.reload();
    await expect(page.getByRole("status")).toContainText(
      "保存データの構造を確認できません",
    );
    await expect(page.getByRole("status")).not.toContainText("利用できます");
    expect(
      await page.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const request = indexedDB.open("suki-sketch", 1);
            request.onsuccess = () => {
              const db = request.result;
              const transaction = db.transaction("legacy");
              const value = transaction.objectStore("legacy").get("keep");
              value.onsuccess = () => resolve(value.result);
              value.onerror = () => reject(value.error);
              transaction.oncomplete = () => db.close();
            };
            request.onerror = () => reject(request.error);
          }),
      ),
    ).toBe("消さないデータ");
  });
}

test("書込が容量不足で失敗する環境を保存可能と表示しない", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(IDBObjectStore.prototype, "add", {
      value() {
        throw new DOMException("容量不足", "QuotaExceededError");
      },
    });
  });
  await page.goto("#/settings/data");
  await expect(page.getByRole("status")).toContainText(
    "保存領域が不足しています",
  );
  expect(errors).toEqual([]);
});
