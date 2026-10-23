import { expect, type Page } from "@playwright/test";
import { PNG_ENCODING_TIMEOUT_MS } from "../../src/images/png";

// PNG準備には15秒の期限がある。完了直前に5秒の既定assertで打ち切らず、
// その後のDB保存も待つ。成功条件・画像比較やアプリの期限は変更しない。
export const DRAWING_SAVE_TIMEOUT_MS = PNG_ENCODING_TIMEOUT_MS + 5_000;

interface StorageDiagnostic {
  store: string;
  operation: string;
  name: string;
  message: string;
}

// テスト用データの保存失敗を、GitHubの失敗注釈からも調べられるようにする。
// リクエストの結果やイベントの既定動作は変更しない。
export async function observeStorageErrors(page: Page) {
  await page.addInitScript(() => {
    const errors: StorageDiagnostic[] = [];
    (
      window as unknown as { storageDiagnostics: StorageDiagnostic[] }
    ).storageDiagnostics = errors;
    for (const operation of ["add", "put"] as const) {
      const original = IDBObjectStore.prototype[operation];
      IDBObjectStore.prototype[operation] = function (
        this: IDBObjectStore,
        ...args: Parameters<IDBObjectStore["add"]>
      ) {
        const record = (error: unknown) => {
          errors.push({
            store: this.name,
            operation,
            name:
              error instanceof DOMException || error instanceof Error
                ? error.name
                : "UnknownError",
            message:
              error instanceof DOMException || error instanceof Error
                ? error.message
                : String(error),
          });
        };
        try {
          const request = original.apply(this, args);
          request.addEventListener("error", () => record(request.error));
          return request;
        } catch (error) {
          record(error);
          throw error;
        }
      };
    }
  });
}

export async function expectSaved(page: Page) {
  await expect
    .poll(
      async () => ({
        status: await page.locator(".save-status").textContent(),
        alerts: await page.getByRole("alert").allTextContents(),
        storageErrors: await page.evaluate(
          () =>
            (window as unknown as { storageDiagnostics: StorageDiagnostic[] })
              .storageDiagnostics,
        ),
      }),
      { timeout: DRAWING_SAVE_TIMEOUT_MS },
    )
    .toEqual({ status: "保存済み", alerts: [], storageErrors: [] });
}

export async function expectCharacterSaved(page: Page) {
  await expect
    .poll(async () => ({
      selectedButton: await page
        .getByRole("button", { name: "この推しを選ぶ", exact: true })
        .count(),
      alerts: await page.getByRole("alert").allTextContents(),
      storageErrors: await page.evaluate(
        () =>
          (window as unknown as { storageDiagnostics: StorageDiagnostic[] })
            .storageDiagnostics,
      ),
    }))
    .toEqual({ selectedButton: 1, alerts: [], storageErrors: [] });
}
