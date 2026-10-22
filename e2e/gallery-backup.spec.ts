import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { unzipSync, zipSync, strToU8 } from "fflate";
import type { ArtworkDraft, Character } from "../src/data/database";
import type { Reflection } from "../src/data/reflections";
async function start(page: Page, theme = "一枚目のテーマ") {
  await page.goto("#/new");
  await page
    .getByRole("textbox", { name: "描きたいテーマ", exact: true })
    .fill(theme);
  await page
    .getByRole("button", { name: "このテーマで進む", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  return page.url();
}
async function line(page: Page, y = 0.5) {
  const canvas = page.getByLabel("お絵描きキャンバス");
  await canvas.scrollIntoViewIfNeeded();
  const b = (await canvas.boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.2, b.y + b.height * y);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.8, b.y + b.height * y, { steps: 5 });
  await page.mouse.up();
}
async function save(page: Page) {
  await page.getByRole("button", { name: "途中で保存", exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText("保存済み");
}
async function snapshot(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{
        artworks: ArtworkDraft[];
        characters: Character[];
        reflections: Reflection[];
        settings: Array<{ key: string; value: string }>;
        assets: Array<{
          id: string;
          kind: string;
          size: number;
          hash: number[];
        }>;
      }>((resolve, reject) => {
        const r = indexedDB.open("suki-sketch");
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction([
              "artworks",
              "characters",
              "reflections",
              "settings",
              "assets",
            ]);
          const artworks = tx.objectStore("artworks").getAll(),
            characters = tx.objectStore("characters").getAll(),
            reflections = tx.objectStore("reflections").getAll(),
            settings = tx.objectStore("settings").getAll(),
            assets = tx.objectStore("assets").getAll();
          tx.oncomplete = async () => {
            db.close();
            resolve({
              artworks: artworks.result,
              characters: characters.result,
              reflections: reflections.result,
              settings: settings.result,
              assets: await Promise.all(
                assets.result.map(async (a) => ({
                  id: a.id,
                  kind: a.kind,
                  size: a.size,
                  hash: Array.from(
                    new Uint8Array(
                      await crypto.subtle.digest(
                        "SHA-256",
                        await a.blob.arrayBuffer(),
                      ),
                    ),
                  ),
                })),
              ),
            });
          };
          tx.onerror = () => reject(tx.error);
        };
        r.onerror = () => reject(r.error);
      }),
  );
}
async function register(page: Page, name: string, image = false) {
  await page.goto("#/characters/new");
  await page.getByLabel("キャラクター名", { exact: true }).fill(name);
  await page
    .getByRole("textbox", { name: "好きな特徴・描きたいところ", exact: true })
    .fill("残したいメモ");
  if (image) {
    const png = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = c.height = 8;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "red";
      ctx.fillRect(0, 0, 8, 8);
      return c.toDataURL().split(",")[1];
    });
    await page.getByLabel("参考画像（任意）", { exact: true }).setInputFiles({
      name: "reference.png",
      mimeType: "image/png",
      buffer: Buffer.from(png, "base64"),
    });
    await expect(
      page.getByRole("img", { name: "参考画像", exact: true }),
    ).toBeVisible();
  }
  await page.getByRole("button", { name: "登録して保存", exact: true }).click();
  await page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name, exact: true }) })
    .getByRole("button", { name: "この推しを選ぶ" })
    .click();
}
async function reflect(page: Page, text = "振り返りのメモ") {
  await page
    .getByRole("button", { name: "振り返る（任意）", exact: true })
    .click();
  const d = page.getByRole("dialog");
  await d.getByLabel("自由に書く（任意）", { exact: true }).fill(text);
  await d.getByRole("button", { name: "回答を保存", exact: true }).click();
  await expect(
    d.getByRole("group", { name: "今回の質問", exact: true }),
  ).toHaveCount(0);
  await d
    .getByRole("button", { name: "振り返りを終える", exact: true })
    .click();
}
const detail = (url: string) => url.replace("#/draw/", "#/works/");
async function backup(page: Page) {
  await page.goto("#/settings/data");
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "全データをバックアップ", exact: true })
    .click();
  const file = await download;
  await expect(
    page.getByRole("button", { name: "全データをバックアップ", exact: true }),
  ).toBeEnabled();
  return readFile((await file.path())!);
}
async function inspect(page: Page, buffer: Buffer) {
  await page.goto("#/settings/data");
  await page
    .getByLabel("バックアップZIPを選ぶ", { exact: true })
    .setInputFiles({ name: "backup.zip", mimeType: "application/zip", buffer });
  await expect(
    page.getByRole("heading", { name: "追加する内容", exact: true }),
  ).toBeVisible();
}
test("一覧・推し絞込・詳細・状態変更・振り返り・再開を操作できる", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await register(page, "推しA", true);
  const url = await start(page);
  await line(page);
  await save(page);
  await reflect(page);
  await register(page, "推しB");
  await start(page, "二枚目のテーマ");
  await line(page);
  await save(page);
  await page.goto("#/");
  await expect(page.locator(".work-card")).toHaveCount(2);
  const a = (await snapshot(page)).characters.find((c) => c.name === "推しA")!;
  await page
    .getByRole("combobox", { name: "推しで絞る", exact: true })
    .selectOption(a.id);
  await expect(page.locator(".work-card")).toHaveCount(1);
  await page
    .getByRole("heading", { name: "一枚目のテーマ", exact: true })
    .click();
  await expect(page).toHaveURL(detail(url));
  await expect(
    page.getByRole("img", { name: "保存した作品", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("残したいメモ", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "ひと区切りにする", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "途中に戻す", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "振り返りを見る・書く（任意）", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByText("振り返りのメモ", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "振り返りを終える", exact: true })
    .click();
  await page.getByRole("link", { name: "続きを描く", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  await line(page, 0.7);
  await save(page);
  await page.goto("#/");
  await page
    .getByRole("combobox", { name: "状態で絞る", exact: true })
    .selectOption("finished");
  await expect(page.locator(".work-card")).toHaveCount(1);
  await page.locator(".work-card").first().scrollIntoViewIfNeeded();
  await expect(page.locator(".work-card img").first()).toBeVisible();
  await page.screenshot({
    path: info.outputPath("gallery-320.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("作品詳細から白背景のPNGを書き出せる", async ({ page }) => {
  const url = await start(page);
  await line(page);
  await save(page);
  await page.goto(detail(url));
  const dl = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "PNGを書き出す", exact: true })
    .click();
  const bytes = Array.from(await readFile((await (await dl).path())!));
  const image = await page.evaluate(async (bytes) => {
    const b = await createImageBitmap(
      new Blob([new Uint8Array(bytes)], { type: "image/png" }),
    );
    const c = document.createElement("canvas");
    c.width = c.height = 960;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(b, 0, 0);
    b.close();
    return [
      Array.from(ctx.getImageData(0, 0, 1, 1).data),
      Array.from(ctx.getImageData(480, 480, 1, 1).data),
    ];
  }, bytes);
  expect(image).toEqual([
    [255, 255, 255, 255],
    [57, 53, 46, 255],
  ]);
});
test("作品削除は確認でき、絵・回答だけを整理し推しと参考画像を残す", async ({
  page,
}) => {
  await register(page, "残す推し", true);
  const url = await start(page);
  await line(page);
  await reflect(page);
  const before = await snapshot(page);
  await page.goto(detail(url));
  await page
    .getByRole("button", { name: "この作品を削除", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "キャンセル", exact: true })
    .click();
  expect(await snapshot(page)).toEqual(before);
  await page
    .getByRole("button", { name: "この作品を削除", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "削除する", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/$/);
  const after = await snapshot(page);
  expect(after.artworks).toHaveLength(0);
  expect(after.reflections).toHaveLength(0);
  expect(after.characters).toEqual(before.characters);
  expect(after.assets).toEqual(
    before.assets.filter((a) => a.kind === "reference"),
  );
  await page.goto(detail(url));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "作品が見つかりません",
  );
});
test("別タブの更新を古い詳細から変更・削除せず、最新を読み直せる", async ({
  page,
  context,
}) => {
  const url = await start(page);
  await line(page);
  await save(page);
  await page.goto(detail(url));
  const other = await context.newPage();
  await other.goto(detail(url));
  await other
    .getByRole("button", { name: "ひと区切りにする", exact: true })
    .click();
  await expect(
    other.getByRole("button", { name: "途中に戻す", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "ひと区切りにする", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("別の画面");
  await page
    .getByRole("button", { name: "最新の内容を読み直す", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "途中に戻す", exact: true }),
  ).toBeVisible();
  await other.close();
});
test("別タブで作品を削除されても編集中の絵を新しい作品として救済保存できる", async ({
  page,
  context,
}) => {
  const url = await start(page);
  await line(page, 0.3);
  await save(page);
  const other = await context.newPage();
  await other.goto(detail(url));
  await other
    .getByRole("button", { name: "この作品を削除", exact: true })
    .click();
  await other
    .getByRole("dialog")
    .getByRole("button", { name: "削除する", exact: true })
    .click();
  await expect(other).toHaveURL(/#\/$/);
  await line(page, 0.7);
  await page.getByRole("button", { name: "途中で保存", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("別の画面");
  await page
    .getByRole("button", { name: "今の絵を別の作品として保存", exact: true })
    .click();
  await expect(page).not.toHaveURL(url);
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  const alpha = await page
    .getByLabel("お絵描きキャンバス")
    .evaluate(
      (c) =>
        (c as HTMLCanvasElement).getContext("2d")!.getImageData(480, 672, 1, 1)
          .data[3],
    );
  expect(alpha).toBe(255);
  expect((await snapshot(page)).artworks).toHaveLength(1);
  await other.close();
});
test("バックアップを別の空領域に追加復元し画像・メモ・日時・回答が一致する", async ({
  page,
  browser,
}, info) => {
  await register(page, "バックアップする推し", true);
  const url = await start(page);
  await line(page);
  await reflect(page);
  await page.goto(detail(url));
  await page
    .getByRole("button", { name: "ひと区切りにする", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "途中に戻す", exact: true }),
  ).toBeVisible();
  const before = await snapshot(page),
    bytes = await backup(page);
  const fresh = await browser.newContext({
    baseURL: String(info.project.use.baseURL),
    viewport: { width: 375, height: 812 },
  });
  const restored = await fresh.newPage();
  await inspect(restored, bytes);
  await restored.screenshot({
    path: info.outputPath("restore-375.png"),
    fullPage: true,
  });
  expect((await snapshot(restored)).artworks).toHaveLength(0);
  await restored
    .getByRole("button", { name: "この内容を追加する", exact: true })
    .click();
  await expect(restored.getByText(/追加復元しました。/)).toBeVisible();
  const after = await snapshot(restored);
  expect(after.artworks[0].id).not.toBe(before.artworks[0].id);
  expect(after.characters[0].id).not.toBe(before.characters[0].id);
  expect(after.artworks[0]).toMatchObject({
    theme: before.artworks[0].theme,
    status: "finished",
    createdAt: before.artworks[0].createdAt,
    updatedAt: before.artworks[0].updatedAt,
    characterId: after.characters[0].id,
  });
  expect(after.characters[0]).toMatchObject({
    name: "バックアップする推し",
    memo: "残したいメモ",
  });
  expect(after.reflections[0]).toMatchObject({
    artworkId: after.artworks[0].id,
    text: "振り返りのメモ",
  });
  expect(
    after.assets.map((a) => JSON.stringify([a.kind, a.hash])).sort(),
  ).toEqual(before.assets.map((a) => JSON.stringify([a.kind, a.hash])).sort());
  expect(after.settings).toContainEqual({
    key: "lastArtworkId",
    value: after.artworks[0].id,
  });
  await restored.goto("#/");
  await expect(restored.locator(".work-card")).toHaveCount(1);
  await fresh.close();
});
test("復元の取消・繰り返し追加でも元の作品を上書きしない", async ({ page }) => {
  await start(page);
  await line(page);
  await save(page);
  const bytes = await backup(page),
    before = await snapshot(page);
  await inspect(page, bytes);
  await page
    .getByRole("button", { name: "復元をキャンセル", exact: true })
    .click();
  expect(await snapshot(page)).toEqual(before);
  await inspect(page, bytes);
  await page
    .getByRole("button", { name: "この内容を追加する", exact: true })
    .click();
  await expect(page.getByText(/追加復元しました。/)).toBeVisible();
  const after = await snapshot(page);
  expect(after.artworks).toHaveLength(2);
  expect(after.artworks.find((a) => a.id === before.artworks[0].id)).toEqual(
    before.artworks[0],
  );
});
test("復元途中の容量不足をロールバックし既存画像・回答を保持して再試行できる", async ({
  page,
}) => {
  await start(page);
  await line(page);
  await reflect(page);
  const bytes = await backup(page);
  await inspect(page, bytes);
  const before = await snapshot(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add;
    (window as unknown as { undoAdd: () => void }).undoAdd = () => {
      IDBObjectStore.prototype.add = original;
    };
    IDBObjectStore.prototype.add = function (...args) {
      if (this.name === "artworks")
        throw new DOMException("quota", "QuotaExceededError");
      return original.apply(this, args);
    };
  });
  await page
    .getByRole("button", { name: "この内容を追加する", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("保存領域");
  expect(await snapshot(page)).toEqual(before);
  await page.evaluate(() =>
    (window as unknown as { undoAdd: () => void }).undoAdd(),
  );
  await page
    .getByRole("button", { name: "この内容を追加する", exact: true })
    .click();
  await expect(page.getByText(/追加復元しました。/)).toBeVisible();
  expect((await snapshot(page)).artworks).toHaveLength(2);
});
test("不正ZIP・未対応版・危険パス・壊れた参照・偽装画像を保存前に拒否する", async ({
  page,
}) => {
  await start(page);
  await line(page);
  await save(page);
  const original = await backup(page),
    files = unzipSync(original);
  const originalManifest = JSON.parse(
    new TextDecoder().decode(files["manifest.json"]),
  );
  const before = await snapshot(page);
  const invalid: Buffer[] = [Buffer.from("not a zip")];
  for (const patch of [
    { version: 999 },
    {
      artworks: [{ ...originalManifest.artworks[0], canvasAssetId: "missing" }],
    },
    { reflections: [{ id: "bad" }] },
  ])
    invalid.push(
      Buffer.from(
        zipSync(
          {
            ...files,
            "manifest.json": strToU8(
              JSON.stringify({ ...originalManifest, ...patch }),
            ),
          },
          { level: 0 },
        ),
      ),
    );
  invalid.push(
    Buffer.from(
      zipSync({ ...files, "../escape.png": strToU8("bad") }, { level: 0 }),
    ),
  );
  const broken = {
    ...files,
    [originalManifest.assets[0].file]: strToU8("bad PNG"),
  };
  invalid.push(Buffer.from(zipSync(broken, { level: 0 })));
  for (const buffer of invalid) {
    await page
      .getByLabel("バックアップZIPを選ぶ", { exact: true })
      .setInputFiles({ name: "bad.zip", mimeType: "application/zip", buffer });
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "全データをバックアップ", exact: true }),
    ).toBeEnabled();
    expect(await snapshot(page)).toEqual(before);
    await expect(
      page.getByRole("button", { name: "この内容を追加する", exact: true }),
    ).toHaveCount(0);
  }
});
test("全消去の取消・途中失敗でデータを残し、明示確認後に全件消去できる", async ({
  page,
}) => {
  await start(page);
  await line(page);
  await reflect(page);
  await page.goto("#/settings/data");
  const before = await snapshot(page);
  await page
    .getByRole("button", {
      name: "このブラウザーの全データを削除",
      exact: true,
    })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "キャンセル", exact: true })
    .click();
  expect(await snapshot(page)).toEqual(before);
  await page
    .getByRole("button", {
      name: "このブラウザーの全データを削除",
      exact: true,
    })
    .click();
  const d = page.getByRole("dialog");
  await expect(
    d.getByRole("button", { name: "全データを削除する", exact: true }),
  ).toBeDisabled();
  await d
    .getByLabel("確認のため「全データを削除」と入力", { exact: true })
    .fill("全データを削除");
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.clear;
    (window as unknown as { undoClear: () => void }).undoClear = () => {
      IDBObjectStore.prototype.clear = original;
    };
    IDBObjectStore.prototype.clear = function () {
      if (this.name === "assets") throw new Error("injected");
      return original.call(this);
    };
  });
  await d
    .getByRole("button", { name: "全データを削除する", exact: true })
    .click();
  await expect(d.getByRole("alert")).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  await page.evaluate(() =>
    (window as unknown as { undoClear: () => void }).undoClear(),
  );
  await d
    .getByRole("button", { name: "全データを削除する", exact: true })
    .click();
  await expect(d).not.toBeVisible();
  const after = await snapshot(page);
  for (const list of Object.values(after)) expect(list).toHaveLength(0);
});

test("作品削除の途中失敗を戻し、削除済みの比較先に対する回答もバックアップに残す", async ({
  page,
}) => {
  await register(page, "比較する推し");
  const previous = await start(page, "前の作品");
  await line(page);
  await reflect(page, "前の絵のメモ");
  const current = await start(page, "今の作品");
  await line(page);
  await reflect(page);
  await page
    .getByRole("button", { name: "振り返る（任意）", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", {
      name: "前の作品との違いを考える（任意）",
      exact: true,
    })
    .click();
  await dialog
    .getByLabel("自由に書く（任意）", { exact: true })
    .fill("違いはまだ分からない");
  await dialog.getByRole("button", { name: "回答を保存", exact: true }).click();
  await expect(
    dialog.getByText("違いはまだ分からない", { exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "振り返りを終える", exact: true })
    .click();
  await page.goto(detail(previous));
  const before = await snapshot(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.delete;
    (window as unknown as { undoDelete: () => void }).undoDelete = () => {
      IDBObjectStore.prototype.delete = original;
    };
    IDBObjectStore.prototype.delete = function (...args) {
      if (this.name === "reflections")
        throw new Error("injected after asset deletions");
      return original.apply(this, args);
    };
  });
  await page
    .getByRole("button", { name: "この作品を削除", exact: true })
    .click();
  await dialog.getByRole("button", { name: "削除する", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  await page.evaluate(() =>
    (window as unknown as { undoDelete: () => void }).undoDelete(),
  );
  await dialog.getByRole("button", { name: "削除する", exact: true }).click();
  await expect(page).toHaveURL(/#\/$/);
  const after = await snapshot(page);
  expect(after.artworks).toHaveLength(1);
  const comparison = after.reflections.find((r) => r.questionId === "change")!;
  expect(comparison.text).toBe("違いはまだ分からない");
  expect(comparison.comparisonUnavailable).toBe(true);
  expect(after.reflections.some((r) => r.text === "前の絵のメモ")).toBe(false);
  await page.goto(detail(current));
  await page
    .getByRole("button", { name: "振り返りを見る・書く（任意）", exact: true })
    .click();
  await expect(
    dialog.getByText("違いはまだ分からない", { exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "振り返りを終える", exact: true })
    .click();
  await inspect(page, await backup(page));
  await page
    .getByRole("button", { name: "この内容を追加する", exact: true })
    .click();
  await expect(page.getByText(/追加復元しました。/)).toBeVisible();
  const restored = await snapshot(page);
  expect(
    restored.reflections.filter(
      (r) =>
        r.questionId === "change" &&
        r.comparisonUnavailable &&
        r.text === comparison.text,
    ),
  ).toHaveLength(2);
});

test("50作品は12件ずつ表示し一覧では原寸画像を読み込まない", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await start(page);
  await line(page);
  await save(page);
  await page.goto("#/settings/data");
  const canvasIds = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("suki-sketch");
      r.onsuccess = () => resolve(r.result);
    });
    const original = await new Promise<{
      work: ArtworkDraft;
      assets: Array<{ id: string }>;
    }>((resolve) => {
      const tx = db.transaction(["artworks", "assets"]),
        works = tx.objectStore("artworks").getAll(),
        assets = tx.objectStore("assets").getAll();
      tx.oncomplete = () =>
        resolve({ work: works.result[0], assets: assets.result });
    });
    const ids = [original.work.canvasAssetId!];
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["artworks", "assets"], "readwrite");
      for (let i = 1; i < 50; i++) {
        const canvasAssetId = `bulk-canvas-${i}`,
          thumbnailAssetId = `bulk-thumb-${i}`;
        ids.push(canvasAssetId);
        tx.objectStore("artworks").add({
          ...original.work,
          id: `bulk-work-${i}`,
          theme: `作品${i}`,
          canvasAssetId,
          thumbnailAssetId,
          updatedAt: new Date(Date.now() + i * 1000).toISOString(),
        });
        tx.objectStore("assets").add({
          ...original.assets.find((a) => a.id === original.work.canvasAssetId),
          id: canvasAssetId,
        });
        tx.objectStore("assets").add({
          ...original.assets.find(
            (a) => a.id === original.work.thumbnailAssetId,
          ),
          id: thumbnailAssetId,
        });
      }
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    const reads: string[] = [];
    (window as unknown as { assetReads: string[] }).assetReads = reads;
    const get = IDBObjectStore.prototype.get,
      getAll = IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.get = function (...args) {
      if (this.name === "assets") reads.push(String(args[0]));
      return get.apply(this, args);
    };
    IDBObjectStore.prototype.getAll = function (...args) {
      if (this.name === "assets") reads.push("ALL");
      return getAll.apply(this, args);
    };
    return ids;
  });
  await page.evaluate(() => {
    window.location.hash = "/";
  });
  await expect(page.locator(".work-card")).toHaveCount(12);
  await page.locator(".work-card").first().scrollIntoViewIfNeeded();
  await expect(page.locator(".work-card img").first()).toBeVisible();
  const firstReads = await page.evaluate(
    () => (window as unknown as { assetReads: string[] }).assetReads,
  );
  expect(firstReads.length).toBeGreaterThan(0);
  expect(firstReads.length).toBeLessThanOrEqual(12);
  expect(firstReads.some((id) => id === "ALL" || canvasIds.includes(id))).toBe(
    false,
  );
  for (const count of [12, 12, 12, 2]) {
    await page.getByRole("button", { name: "次の作品", exact: true }).click();
    await expect(page.locator(".work-card")).toHaveCount(count);
  }
  await expect(
    page.getByRole("button", { name: "次の作品", exact: true }),
  ).toBeDisabled();
  const reads = await page.evaluate(
    () => (window as unknown as { assetReads: string[] }).assetReads,
  );
  expect(reads.some((id) => id === "ALL" || canvasIds.includes(id))).toBe(
    false,
  );
});

test("容量見積りと保持許可は補助情報として扱い、バックアップも同一サイト内で処理する", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as unknown as { persistCalls: number }).persistCalls = 0;
    Object.defineProperty(navigator.storage, "estimate", {
      value: async () => ({ usage: 5 * 1024 * 1024, quota: 100 * 1024 * 1024 }),
    });
    Object.defineProperty(navigator.storage, "persist", {
      value: async () => {
        (window as unknown as { persistCalls: number }).persistCalls++;
        return false;
      },
    });
  });
  const external: string[] = [];
  page.on("request", (r) => {
    if (
      !r.url().startsWith("http://127.0.0.1:4173/") &&
      !r.url().startsWith("blob:")
    )
      external.push(r.url());
  });
  await start(page);
  await line(page);
  await save(page);
  const bytes = await backup(page);
  await expect(
    page.getByText(/使用量の目安：5.0MiB \/ 100.0MiB/),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { persistCalls: number }).persistCalls,
    ),
  ).toBe(0);
  await page
    .getByRole("button", { name: "データを保持する許可を求める", exact: true })
    .click();
  await expect(page.getByText(/保持の許可は得られませんでした/)).toBeVisible();
  await inspect(page, bytes);
  expect(external).toEqual([]);
});

test("不整合なデータが混ざっていても正常な作品を見返せ、勝手に削除しない", async ({
  page,
}) => {
  await start(page);
  await line(page);
  await save(page);
  await page.goto("#/settings/data");
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const r = indexedDB.open("suki-sketch");
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction(["artworks", "characters"], "readwrite");
          tx.objectStore("artworks").add({
            id: "broken-work",
            status: "unknown",
          });
          tx.objectStore("characters").add({ id: "broken-character" });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => reject(tx.error);
        };
      }),
  );
  const before = await snapshot(page);
  await page.goto("#/");
  await expect(page.locator(".work-card")).toHaveCount(1);
  await expect(
    page.getByText(
      "読み込めない作品が1件あります。元データは削除していません。",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      "読み込めない推しが1件あります。元データは削除していません。",
      { exact: true },
    ),
  ).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  await page.goto("#/settings/data");
  await page
    .getByRole("button", { name: "全データをバックアップ", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
});
