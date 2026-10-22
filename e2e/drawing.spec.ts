import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function start(page: Page) {
  await page.goto("#/new");
  await page
    .getByRole("button", { name: "テーマを決めずに進む", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/draw\/(?!new$)[^/]+$/);
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  return page.url();
}
async function line(page: Page, y = 0.5, x1 = 0.2, x2 = 0.8) {
  await page.getByLabel("お絵描きキャンバス").scrollIntoViewIfNeeded();
  const box = (await page.getByLabel("お絵描きキャンバス").boundingBox())!;
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x2, box.y + box.height * y, {
    steps: 8,
  });
  await page.mouse.up();
}
async function pixel(page: Page, x = 0.5, y = 0.5) {
  return page
    .getByLabel("お絵描きキャンバス")
    .evaluate(
      (node, p) =>
        Array.from(
          (node as HTMLCanvasElement)
            .getContext("2d")!
            .getImageData(Math.floor(p.x * 960), Math.floor(p.y * 960), 1, 1)
            .data,
        ),
      { x, y },
    );
}
async function save(page: Page) {
  await page.getByRole("button", { name: "途中で保存", exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText("保存済み");
}
async function stored(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{
        artworks: Array<{
          id: string;
          revision: number;
          canvasAssetId?: string;
          thumbnailAssetId?: string;
        }>;
        assets: Array<{ id: string; kind: string; size: number }>;
      }>((resolve, reject) => {
        const request = indexedDB.open("suki-sketch");
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(["artworks", "assets"]);
          const artworks = tx.objectStore("artworks").getAll(),
            assets = tx.objectStore("assets").getAll();
          tx.oncomplete = () => {
            resolve({
              artworks: artworks.result,
              assets: assets.result.map((a) => ({
                id: a.id,
                kind: a.kind,
                size: a.size,
              })),
            });
            db.close();
          };
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      }),
  );
}
async function png(page: Page, color = "#e02020", width = 80, height = 40) {
  return Buffer.from(
    await page.evaluate(
      ({ color, width, height }) => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, width, height);
        return canvas.toDataURL("image/png").split(",")[1];
      },
      { color, width, height },
    ),
    "base64",
  );
}
async function importFile(page: Page, buffer: Buffer) {
  await page.getByText("紙や他のアプリの絵を取り込む", { exact: true }).click();
  await page
    .getByLabel("作品画像を選ぶ", { exact: true })
    .setInputFiles({ name: "paper.png", mimeType: "image/png", buffer });
}

test("ペン・消しゴム・取り消しで画素が変わる", async ({ page }) => {
  await start(page);
  await page.getByLabel("ペンの色", { exact: true }).fill("#ff0000");
  await page.getByRole("slider", { name: "線の太さ" }).press("End");
  await line(page);
  expect(await pixel(page)).toEqual([255, 0, 0, 255]);
  await page.getByRole("button", { name: "消しゴム", exact: true }).click();
  await line(page);
  expect((await pixel(page))[3]).toBe(0);
  await page.getByRole("button", { name: "取り消し", exact: true }).click();
  expect(await pixel(page)).toEqual([255, 0, 0, 255]);
  await page.getByRole("button", { name: "取り消し", exact: true }).click();
  expect((await pixel(page))[3]).toBe(0);
  await save(page);
});

test("自動保存して再開すると画像・道具が戻り取り消し履歴はリセットされる", async ({
  page,
}) => {
  await start(page);
  await page.getByLabel("ペンの色", { exact: true }).fill("#1234ab");
  await line(page);
  await expect(page.locator(".save-status")).toHaveText("保存済み");
  expect((await stored(page)).artworks[0].canvasAssetId).toBeTruthy();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  expect(await pixel(page)).toEqual([18, 52, 171, 255]);
  await expect(page.getByLabel("ペンの色", { exact: true })).toHaveValue(
    "#1234ab",
  );
  await expect(
    page.getByRole("button", { name: "取り消し", exact: true }),
  ).toBeDisabled();
});

test("画面サイズと縦横を変えても絵を消さない", async ({ page }, info) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await start(page);
  await line(page);
  await save(page);
  const before = await page
    .getByLabel("お絵描きキャンバス")
    .evaluate((c) => (c as HTMLCanvasElement).toDataURL());
  await page.setViewportSize({ width: 812, height: 375 });
  expect(
    await page
      .getByLabel("お絵描きキャンバス")
      .evaluate((c) => (c as HTMLCanvasElement).toDataURL()),
  ).toBe(before);
  await page.setViewportSize({ width: 320, height: 720 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("drawing-320.png"),
    fullPage: true,
  });
});

test("画像取り込みは別作品で比率を保ち、元の絵を上書きしない", async ({
  page,
}) => {
  const original = await start(page);
  await line(page);
  await save(page);
  const source = (await stored(page)).artworks[0];
  const image = await png(page);
  await importFile(page, image);
  await expect(page).not.toHaveURL(original);
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  expect(await pixel(page)).toEqual([224, 32, 32, 255]);
  expect((await pixel(page, 0.5, 0.1))[3]).toBe(0);
  expect((await stored(page)).artworks).toHaveLength(2);
  expect(
    (await stored(page)).artworks.find((a) => a.id === source.id)
      ?.canvasAssetId,
  ).toBe(source.canvasAssetId);
  await page.getByRole("button", { name: "取り消し", exact: true }).click();
  expect((await pixel(page))[3]).toBe(0);
  await save(page);
  await page.goto(original);
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  expect((await pixel(page))[3]).toBe(255);
});

test("非対応画像は取り込まず現在の絵を保持する", async ({ page }) => {
  const url = await start(page);
  await line(page);
  await save(page);
  await page.getByText("紙や他のアプリの絵を取り込む", { exact: true }).click();
  await page.getByLabel("作品画像を選ぶ", { exact: true }).setInputFiles({
    name: "no.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
  });
  await expect(page.getByRole("alert")).toContainText("PNG");
  await expect(page).toHaveURL(url);
  expect((await pixel(page))[3]).toBe(255);
  expect((await stored(page)).artworks).toHaveLength(1);
});

test("保存中に増えた線も最後まで保存し古い画像へ戻さない", async ({ page }) => {
  await start(page);
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      original.call(
        this,
        (blob) => setTimeout(() => callback(blob), 500),
        type,
        quality,
      );
    };
  });
  await line(page, 0.3);
  await expect(page.locator(".save-status")).toHaveText("保存中…");
  await line(page, 0.7);
  await expect(page.locator(".save-status")).toHaveText("保存済み", {
    timeout: 10000,
  });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  expect((await pixel(page, 0.5, 0.3))[3]).toBe(255);
  expect((await pixel(page, 0.5, 0.7))[3]).toBe(255);
});

test("容量不足でも既存画像を保ち現在の絵を書き出して再試行できる", async ({
  page,
}) => {
  await start(page);
  await line(page, 0.3);
  await save(page);
  const before = await stored(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as unknown as { restorePut: () => void }).restorePut = () => {
      IDBObjectStore.prototype.put = original;
    };
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "artworks")
        throw new DOMException("quota", "QuotaExceededError");
      return original.apply(this, args);
    };
  });
  await line(page, 0.7);
  await page.getByRole("button", { name: "途中で保存", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("保存領域");
  expect(await stored(page)).toEqual(before);
  expect((await pixel(page, 0.5, 0.7))[3]).toBe(255);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "PNGを書き出す", exact: true })
    .click();
  const file = await download;
  const bytes = Array.from(await readFile((await file.path())!));
  const corner = await page.evaluate(async (bytes) => {
    const blob = new Blob([new Uint8Array(bytes)], { type: "image/png" });
    const bitmap = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    c.width = c.height = 960;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return Array.from(ctx.getImageData(0, 0, 1, 1).data);
  }, bytes);
  expect(corner).toEqual([255, 255, 255, 255]);
  await page.evaluate(() =>
    (window as unknown as { restorePut: () => void }).restorePut(),
  );
  await save(page);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  expect((await pixel(page, 0.5, 0.7))[3]).toBe(255);
});

test("別タブの更新を上書きせず今の絵をコピー保存できる", async ({
  page,
  context,
}) => {
  const url = await start(page);
  await line(page, 0.2);
  await save(page);
  const other = await context.newPage();
  await other.goto(url);
  await expect(
    other.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  await line(page, 0.4);
  await save(page);
  const original = (await stored(page)).artworks[0];
  await line(other, 0.7);
  await other.getByRole("button", { name: "途中で保存", exact: true }).click();
  await expect(other.getByRole("alert")).toContainText("別の画面");
  await other
    .getByRole("button", { name: "今の絵を別の作品として保存" })
    .click();
  await expect(other).not.toHaveURL(url);
  await expect(
    other.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  expect((await pixel(other, 0.5, 0.7))[3]).toBe(255);
  expect(
    (await stored(other)).artworks.find((a) => a.id === original.id),
  ).toEqual(original);
  await other.close();
});

test("保存前の画面移動は保存を待ってから再開できる", async ({ page }) => {
  await start(page);
  await line(page);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "作品の棚" })
    .click();
  await expect(page).toHaveURL(/#\/$/);
  await page.getByRole("link", { name: "続きから描く" }).click();
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  expect((await pixel(page))[3]).toBe(255);
});

test("ブラウザーの戻るでも保存を待ち、元の作品へ復帰できる", async ({
  page,
}) => {
  const url = await start(page);
  await line(page);
  await page.goBack();
  await expect(page).toHaveURL(/#\/new$/);
  expect((await stored(page)).artworks[0].canvasAssetId).toBeTruthy();
  await page.goto(url);
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  expect((await pixel(page))[3]).toBe(255);
  expect((await stored(page)).artworks).toHaveLength(1);
});

test("枠外まで引いた線を端で止め、指を離した後は描画しない", async ({
  page,
}) => {
  await start(page);
  const canvas = page.getByLabel("お絵描きキャンバス");
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width + 20, box.y + box.height * 0.5, {
    steps: 8,
  });
  await page.mouse.up();
  expect((await pixel(page, 0.99, 0.5))[3]).toBe(255);
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.7);
  expect((await pixel(page, 0.5, 0.7))[3]).toBe(0);
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  await save(page);
});

test("保存画像が破損していても白紙で自動上書きしない", async ({ page }) => {
  await start(page);
  await line(page);
  await save(page);
  const before = await stored(page);
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const r = indexedDB.open("suki-sketch");
        r.onsuccess = () => {
          const db = r.result;
          const tx = db.transaction("assets", "readwrite");
          const req = tx.objectStore("assets").getAll();
          req.onsuccess = () => {
            const asset = req.result.find((a) => a.kind === "canvas");
            asset.blob = new Blob(["broken"], { type: "image/png" });
            asset.size = asset.blob.size;
            tx.objectStore("assets").put(asset);
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await page.reload();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("お絵描きキャンバス")).toHaveCount(0);
  expect((await stored(page)).artworks).toEqual(before.artworks);
});

test("画像の種別が壊れていたら保存を止め、別種の画像を削除しない", async ({
  page,
}) => {
  await start(page);
  await line(page, 0.3);
  await save(page);
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("suki-sketch");
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("assets", "readwrite");
          const all = tx.objectStore("assets").getAll();
          all.onsuccess = () => {
            const thumbnail = all.result.find((a) => a.kind === "thumbnail");
            tx.objectStore("assets").put({ ...thumbnail, kind: "reference" });
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  const before = await stored(page);
  await line(page, 0.7);
  await page.getByRole("button", { name: "途中で保存", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("保存データ");
  expect(await stored(page)).toEqual(before);
  expect((await pixel(page, 0.5, 0.7))[3]).toBe(255);
});

for (const action of ["参考画像を外す", "推しを削除"] as const) {
  test(`推しの不正な参照が作品画像を指していても${action}で作品画像を消さない`, async ({
    page,
  }) => {
    await page.goto("#/characters/new");
    await page
      .getByLabel("キャラクター名", { exact: true })
      .fill("参照を修復する推し");
    await page
      .getByRole("button", { name: "登録して保存", exact: true })
      .click();
    await page
      .getByRole("button", { name: "この推しを選ぶ", exact: true })
      .click();
    const url = await start(page);
    await line(page);
    await save(page);
    const original = (await stored(page)).artworks[0];
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.open("suki-sketch");
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction(["characters", "artworks"], "readwrite");
            const characters = tx.objectStore("characters").getAll();
            characters.onsuccess = () => {
              const artworks = tx.objectStore("artworks").getAll();
              artworks.onsuccess = () =>
                tx.objectStore("characters").put({
                  ...characters.result[0],
                  referenceAssetId: artworks.result[0].canvasAssetId,
                });
            };
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        }),
    );
    await page.goto("#/characters");
    await page.getByRole("link", { name: "編集する", exact: true }).click();
    if (action === "参考画像を外す") {
      await page
        .getByRole("button", { name: "参考画像を外す", exact: true })
        .click();
      await page
        .getByRole("button", { name: "変更を保存", exact: true })
        .click();
    } else {
      await page
        .getByRole("button", { name: "この推しを削除", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "削除する", exact: true })
        .click();
    }
    await expect(page).toHaveURL(/#\/characters$/);
    expect(
      (await stored(page)).assets.some((a) => a.id === original.canvasAssetId),
    ).toBe(true);
    await page.goto(url);
    await expect(
      page.getByRole("button", { name: "ペン", exact: true }),
    ).toBeEnabled();
    expect((await pixel(page))[3]).toBe(255);
  });
}

test("参考画像の開閉で絵を失わず、白背景のPNGに参考画像やUIを含めない", async ({
  page,
}) => {
  await page.goto("#/characters/new");
  await page.getByLabel("キャラクター名", { exact: true }).fill("参考用の推し");
  await page.getByLabel("参考画像（任意）", { exact: true }).setInputFiles({
    name: "reference.png",
    mimeType: "image/png",
    buffer: await png(page, "#ff0000"),
  });
  await expect(
    page.getByRole("img", { name: "参考画像", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "登録して保存", exact: true }).click();
  await page
    .getByRole("button", { name: "この推しを選ぶ", exact: true })
    .click();
  await start(page);
  await line(page);
  const before = await page
    .getByLabel("お絵描きキャンバス")
    .evaluate((n) => (n as HTMLCanvasElement).toDataURL());
  await page
    .getByRole("button", { name: "参考画像を見る", exact: true })
    .click();
  await expect(
    page.getByRole("img", { name: "参考用の推しの参考画像", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "参考画像を閉じる", exact: true })
    .click();
  expect(
    await page
      .getByLabel("お絵描きキャンバス")
      .evaluate((n) => (n as HTMLCanvasElement).toDataURL()),
  ).toBe(before);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "PNGを書き出す", exact: true })
    .click();
  const bytes = Array.from(await readFile((await (await download).path())!));
  const output = await page.evaluate(async (bytes) => {
    const image = await createImageBitmap(
      new Blob([new Uint8Array(bytes)], { type: "image/png" }),
    );
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 960;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const size = [image.width, image.height];
    image.close();
    const rgba = context.getImageData(0, 0, 960, 960).data;
    let red = 0;
    for (let i = 0; i < rgba.length; i += 4)
      if (rgba[i] === 255 && rgba[i + 1] === 0 && rgba[i + 2] === 0) red++;
    return {
      size,
      red,
      corner: Array.from(rgba.slice(0, 4)),
      middle: Array.from(context.getImageData(480, 480, 1, 1).data),
    };
  }, bytes);
  expect(output.size).toEqual([960, 960]);
  expect(output.red).toBe(0);
  expect(output.corner).toEqual([255, 255, 255, 255]);
  expect(output.middle).toEqual([57, 53, 46, 255]);
});

test("保存失敗時の画面移動をキャンセルすると線を保持し、明示的に破棄もできる", async ({
  page,
}) => {
  const url = await start(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "artworks")
        throw new DOMException("quota", "QuotaExceededError");
      return original.apply(this, args);
    };
  });
  await line(page);
  page.once("dialog", (dialog) => dialog.dismiss());
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "作品の棚", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("保存領域");
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  await expect(page).toHaveURL(url);
  expect((await pixel(page))[3]).toBe(255);
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "作品の棚", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/$/);
});

test("白紙も保存でき、履歴は予算内の9操作で止まる", async ({ page }) => {
  await start(page);
  await save(page);
  expect(
    (await stored(page)).assets.filter(
      (a) => a.kind === "canvas" || a.kind === "thumbnail",
    ),
  ).toHaveLength(2);
  for (let i = 0; i < 20; i++)
    await line(page, 0.5, 0.05 + i * 0.045, 0.05 + i * 0.045 + 0.01);
  let count = 0;
  while (
    await page
      .getByRole("button", { name: "取り消し", exact: true })
      .isEnabled()
  ) {
    await page.getByRole("button", { name: "取り消し", exact: true }).click();
    count++;
    if (count > 20) throw new Error("取り消し上限が効いていません");
  }
  expect(count).toBe(9);
  expect((await pixel(page, 0.055, 0.5))[3]).toBe(255);
  await save(page);
});

test("保存APIが使えない環境でも一時的に描画しPNGを書き出せる", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "indexedDB", {
      get() {
        throw new Error("disabled");
      },
    }),
  );
  await page.goto("#/draw/new");
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  await line(page);
  expect((await pixel(page))[3]).toBe(255);
  await expect(
    page.getByRole("button", { name: "途中で保存", exact: true }),
  ).toBeDisabled();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "PNGを書き出す", exact: true })
    .click();
  expect((await download).suggestedFilename()).toContain(".png");
});

test.describe("タッチ入力", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 375, height: 812 },
  });
  test("1本指を描画し2本目を無視、取消イベントで線を終了する", async ({
    page,
    context,
  }, testInfo) => {
    await start(page);
    await page.getByLabel("お絵描きキャンバス").scrollIntoViewIfNeeded();
    const box = (await page.getByLabel("お絵描きキャンバス").boundingBox())!;
    const cdp = await context.newCDPSession(page);
    const p = (id: number, x: number, y: number) => ({
      id,
      x: box.x + box.width * x,
      y: box.y + box.height * y,
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [p(1, 0.2, 0.4)],
    });
    await expect.poll(async () => (await pixel(page, 0.2, 0.4))[3]).toBe(255);
    expect(await page.getByLabel("お絵描きキャンバス").boundingBox()).toEqual(
      box,
    );
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [p(1, 0.2, 0.4), p(2, 0.2, 0.8)],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [p(1, 0.8, 0.4), p(2, 0.8, 0.8)],
    });
    await expect.poll(async () => (await pixel(page, 0.5, 0.4))[3]).toBe(255);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchCancel",
      touchPoints: [],
    });
    expect((await pixel(page, 0.5, 0.4))[3]).toBe(255);
    expect((await pixel(page, 0.5, 0.8))[3]).toBe(0);
    await save(page);
    await expect(
      page.getByRole("button", { name: "ペン", exact: true }),
    ).toBeEnabled();
    await page.screenshot({
      path: testInfo.outputPath("drawing-375.png"),
      fullPage: true,
    });
    await cdp.detach();
  });
});
