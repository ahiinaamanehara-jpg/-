import { expect, type Page } from "@playwright/test";
import { test } from "./support/persistentTest";
import {
  observeStorageErrors,
  expectSaved,
} from "./support/storageDiagnostics";
import { expectCanvasUnchanged } from "./support/canvasSnapshot";
import { readFile } from "node:fs/promises";
import { PNG } from "pngjs";
import { unzipSync, zipSync, strToU8 } from "fflate";
import AxeBuilder from "@axe-core/playwright";
import type {
  ArtworkDraft,
  Character,
  StoredAsset,
} from "../src/data/database";

test.use({ viewport: { width: 360, height: 800 } });
test.beforeEach(async ({ page }) => observeStorageErrors(page));

async function quota(page: Page, enabled: boolean) {
  await page.evaluate((enabled) => {
    const state = window as unknown as { restoreGuideWrites?: () => void };
    if (!enabled) {
      state.restoreGuideWrites?.();
      return;
    }
    const original = IDBObjectStore.prototype.add;
    state.restoreGuideWrites = () => {
      IDBObjectStore.prototype.add = original;
    };
    IDBObjectStore.prototype.add = function (value, key) {
      if (this.name === "assets" && value?.kind === "guide")
        throw new DOMException("test quota", "QuotaExceededError");
      return original.call(this, value, key);
    };
  }, enabled);
}

async function image(page: Page, color = "#ff0000") {
  const base64 = await page.evaluate((color) => {
    const c = document.createElement("canvas");
    c.width = 32;
    c.height = 16;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 32, 16);
    return c.toDataURL().split(",")[1];
  }, color);
  return {
    name: "guide.png",
    mimeType: "image/png",
    buffer: Buffer.from(base64, "base64"),
  };
}
async function start(page: Page) {
  await page.goto("#/new");
  await page
    .getByRole("radio", { name: "下絵をなぞって描く", exact: true })
    .check();
  await page
    .getByLabel("下絵にする画像を選ぶ", { exact: true })
    .setInputFiles(await image(page));
  await expect(
    page.getByRole("img", { name: "選んだ下絵", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "この下絵で描きはじめる", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".tracing-underlay")).toBeVisible();
  return page.url();
}
async function stroke(page: Page) {
  const canvas = page.getByLabel("お絵描きキャンバス");
  await canvas.scrollIntoViewIfNeeded();
  const b = (await canvas.boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.2, b.y + b.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.8, b.y + b.height * 0.5, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
}
const bitmap = (page: Page) =>
  page
    .getByLabel("お絵描きキャンバス")
    .evaluate((c) => (c as HTMLCanvasElement).toDataURL());
const center = (page: Page) =>
  page
    .getByLabel("お絵描きキャンバス")
    .evaluate((c) =>
      Array.from(
        (c as HTMLCanvasElement).getContext("2d")!.getImageData(480, 480, 1, 1)
          .data,
      ),
    );
async function save(page: Page) {
  await page.getByRole("button", { name: "途中で保存", exact: true }).click();
  await expectSaved(page);
}
async function controls(page: Page) {
  const button = page.getByRole("button", {
    name: "下絵をなぞる",
    exact: true,
  });
  if ((await button.getAttribute("aria-expanded")) === "false")
    await button.click();
}
async function records(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{
        artworks: ArtworkDraft[];
        characters: Character[];
        assets: { id: string; kind: string; hash: string }[];
        settings: { key: string; value: string }[];
      }>((resolve, reject) => {
        const readBytes = (asset: StoredAsset) =>
          new Promise<ArrayBuffer>((resolveBytes, rejectBytes) => {
            const timer = setTimeout(
              () =>
                rejectBytes(
                  new Error(
                    `Blob読出しが完了しません: ${asset.kind} ${asset.id}`,
                  ),
                ),
              10000,
            );
            asset.blob.arrayBuffer().then(
              (bytes) => {
                clearTimeout(timer);
                resolveBytes(bytes);
              },
              (error) => {
                clearTimeout(timer);
                rejectBytes(
                  new Error(`Blob読出し失敗: ${asset.kind} ${String(error)}`),
                );
              },
            );
          });
        const r = indexedDB.open("suki-sketch");
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction([
              "artworks",
              "characters",
              "assets",
              "settings",
            ]);
          const artworks = tx.objectStore("artworks").getAll(),
            characters = tx.objectStore("characters").getAll(),
            assets = tx.objectStore("assets").getAll(),
            settings = tx.objectStore("settings").getAll();
          tx.oncomplete = async () => {
            db.close();
            try {
              resolve({
                artworks: artworks.result,
                characters: characters.result,
                settings: settings.result,
                assets: await Promise.all(
                  (assets.result as StoredAsset[]).map(async (a) => ({
                    id: a.id,
                    kind: a.kind,
                    hash: Array.from(
                      new Uint8Array(
                        await crypto.subtle.digest(
                          "SHA-256",
                          await readBytes(a),
                        ),
                      ),
                    )
                      .map((n) => n.toString(16).padStart(2, "0"))
                      .join(""),
                  })),
                ),
              });
            } catch (error) {
              reject(error);
            }
          };
          tx.onabort = () => reject(tx.error);
        };
        r.onerror = () => reject(r.error);
      }),
  );
}
const pixel = (png: PNG, x: number, y: number) =>
  Array.from(
    png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4),
  );

test("下絵の上を描き、消しゴム・取消・濃さ・表示を操作し、本人の線だけを保存復帰・PNG出力できる", async ({
  page,
}, info) => {
  const requests: string[] = [];
  const origin = new URL(String(info.project.use.baseURL)).origin;
  page.on("request", (request) => {
    const url = request.url();
    if (
      /^https?:/.test(url) &&
      (new URL(url).origin !== origin || request.method() !== "GET")
    )
      requests.push(`${request.method()} ${url}`);
  });
  await start(page);
  expect(await center(page)).toEqual([0, 0, 0, 0]);
  const canvas = page.getByLabel("お絵描きキャンバス");
  await expect
    .poll(() =>
      page
        .locator(".tracing-underlay")
        .evaluate((el) => (el as HTMLImageElement).naturalWidth),
    )
    .toBe(32);
  const scene = PNG.sync.read(await canvas.screenshot());
  const sample = pixel(
    scene,
    Math.floor(scene.width / 2),
    Math.floor(scene.height / 2),
  );
  expect(sample[0]).toBe(255);
  expect(sample[1]).toBeGreaterThan(150);
  expect(sample[1]).toBeLessThan(220);
  expect(pixel(scene, Math.floor(scene.width / 2), 5)).toEqual([
    255, 255, 255, 255,
  ]);
  await page.getByLabel("ペンの色", { exact: true }).fill("#1234ab");
  await page
    .getByRole("slider", { name: "線の太さ", exact: true })
    .press("End");
  await stroke(page);
  expect(await center(page)).toEqual([18, 52, 171, 255]);
  const drawn = await bitmap(page);
  await page.getByRole("button", { name: "消しゴム", exact: true }).click();
  await stroke(page);
  expect((await center(page))[3]).toBe(0);
  await page.getByRole("button", { name: "取り消し", exact: true }).click();
  await expectCanvasUnchanged(page, drawn);
  await controls(page);
  await page
    .getByRole("slider", { name: "下絵の濃さ", exact: true })
    .press("End");
  await expect(page.locator(".tracing-underlay")).toHaveCSS("opacity", "0.7");
  await page.getByRole("button", { name: "下絵を隠す", exact: true }).click();
  await expect(page.locator(".tracing-underlay")).toHaveCount(0);
  await save(page);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  await expectCanvasUnchanged(page, drawn);
  await expect(page.locator(".tracing-underlay")).toHaveCount(0);
  await controls(page);
  await expect(
    page.getByRole("slider", { name: "下絵の濃さ", exact: true }),
  ).toHaveValue("70");
  await page
    .getByRole("button", { name: "下絵を表示する", exact: true })
    .click();
  await expect(page.locator(".tracing-underlay")).toHaveCSS("opacity", "0.7");
  await save(page);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "PNGを書き出す", exact: true })
    .click();
  const png = PNG.sync.read(await readFile((await (await download).path())!));
  expect(png.width).toBe(960);
  expect(png.height).toBe(960);
  expect(pixel(png, 480, 480)).toEqual([18, 52, 171, 255]);
  expect(pixel(png, 480, 300)).toEqual([255, 255, 255, 255]);
  await canvas.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath("tracing-mobile.png"),
    fullPage: true,
  });
  const data = await records(page);
  expect(data.assets.filter((a) => a.kind === "guide")).toHaveLength(1);
  expect(requests).toEqual([]);
});

test("下絵と設定をZIPで追加復元し、旧v1も既存作品を変えずに読み込める", async ({
  page,
}) => {
  const originalUrl = await start(page);
  await stroke(page);
  await save(page);
  const drawn = await bitmap(page),
    before = await records(page);
  await page.goto("#/settings/data");
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "全データをバックアップ", exact: true })
    .click();
  const archive = await readFile((await (await download).path())!);
  const files = unzipSync(archive),
    manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"]));
  expect(manifest.version).toBe(3);
  expect(
    manifest.assets.filter((a: { kind: string }) => a.kind === "guide"),
  ).toHaveLength(1);
  await page
    .getByLabel("バックアップZIPを選ぶ", { exact: true })
    .setInputFiles({
      name: "backup.zip",
      mimeType: "application/zip",
      buffer: archive,
    });
  await page
    .getByRole("button", { name: "この内容を追加する", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "この内容を追加する", exact: true }),
  ).toHaveCount(0);
  const restored = await records(page),
    originalId = before.artworks[0].id;
  expect(restored.artworks.find((a) => a.id === originalId)).toEqual(
    before.artworks[0],
  );
  const copy = restored.artworks.find((a) => a.id !== originalId)!;
  expect(copy.tracing!.assetId).not.toBe(before.artworks[0].tracing!.assetId);
  expect(
    restored.assets.find((a) => a.id === copy.tracing!.assetId)!.hash,
  ).toBe(before.assets.find((a) => a.kind === "guide")!.hash);
  await page.goto(`#/draw/${copy.id}`);
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  await expectCanvasUnchanged(page, drawn);
  await expect(page.locator(".tracing-underlay")).toBeVisible();
  await page.goto("#/settings/data");
  const legacy = {
    format: "suki-sketch",
    version: 1,
    createdAt: "2026-10-22",
    characters: [],
    artworks: [
      {
        id: "legacy",
        theme: "昔の落書き",
        themeCategory: null,
        status: "in-progress",
        width: 960,
        height: 960,
        revision: 1,
        createdAt: "2026-10-22",
        updatedAt: "2026-10-22",
      },
    ],
    assets: [],
    reflections: [],
    settings: [],
  };
  await page
    .getByLabel("バックアップZIPを選ぶ", { exact: true })
    .setInputFiles({
      name: "old.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(
        zipSync(
          { "manifest.json": strToU8(JSON.stringify(legacy)) },
          { level: 0 },
        ),
      ),
    });
  await page
    .getByRole("button", { name: "この内容を追加する", exact: true })
    .click();
  await expect.poll(async () => (await records(page)).artworks.length).toBe(3);
  await page.goto(originalUrl);
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  await expectCanvasUnchanged(page, drawn);
});

test("下絵の新規保存・差替えが容量不足でも既存データを保ち、不正画像を拒否して再試行できる", async ({
  page,
}) => {
  await page.goto("#/new");
  await page
    .getByRole("button", { name: "テーマを決めずに進む", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  await stroke(page);
  await save(page);
  await page.goto("#/new");
  await page
    .getByRole("radio", { name: "下絵をなぞって描く", exact: true })
    .check();
  await page
    .getByLabel("下絵にする画像を選ぶ", { exact: true })
    .setInputFiles(await image(page));
  await expect(
    page.getByRole("img", { name: "選んだ下絵", exact: true }),
  ).toBeVisible();
  const before = await records(page);
  await quota(page, true);
  await page
    .getByRole("button", { name: "このテーマで進む", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("保存領域");
  expect(await records(page)).toEqual(before);
  await expect(
    page.getByRole("img", { name: "選んだ下絵", exact: true }),
  ).toBeVisible();
  await quota(page, false);
  await page
    .getByRole("button", { name: "このテーマで進む", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  await stroke(page);
  await save(page);
  const drawn = await bitmap(page),
    previous = await records(page);
  await controls(page);
  page.once("dialog", (d) => d.accept());
  await page.getByLabel("下絵の画像を選ぶ", { exact: true }).setInputFiles({
    name: "bad.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
  });
  await expect(page.getByRole("alert")).toContainText("PNG");
  expect(await records(page)).toEqual(previous);
  await expectCanvasUnchanged(page, drawn);
  await quota(page, true);
  page.once("dialog", (d) => d.accept());
  await page
    .getByLabel("下絵の画像を選ぶ", { exact: true })
    .setInputFiles(await image(page, "#0000ff"));
  await page.getByRole("button", { name: "途中で保存", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("保存領域");
  expect(await records(page)).toEqual(previous);
  await expectCanvasUnchanged(page, drawn);
  await quota(page, false);
  await save(page);
  const updated = await records(page);
  expect(updated.assets.filter((a) => a.kind === "guide")).toHaveLength(1);
  expect(updated.assets.find((a) => a.kind === "guide")!.hash).not.toBe(
    previous.assets.find((a) => a.kind === "guide")!.hash,
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  await expectCanvasUnchanged(page, drawn);
});

test("参考画像の編集・推し削除でも下絵を保ち、競合した作品のコピーと削除で画像を共有しない", async ({
  page,
  context,
}) => {
  await page.goto("#/characters/new");
  await page
    .getByLabel("キャラクター名", { exact: true })
    .fill("なぞってみたい推し");
  await page
    .getByLabel("参考画像（任意）", { exact: true })
    .setInputFiles(await image(page));
  await expect(
    page.getByRole("img", { name: "参考画像", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "登録して保存", exact: true }).click();
  await page
    .getByRole("button", { name: "この推しを選ぶ", exact: true })
    .click();
  await page
    .getByRole("link", { name: "選んだ推しと次へ進む", exact: true })
    .click();
  await page
    .getByRole("radio", { name: "下絵をなぞって描く", exact: true })
    .check();
  await page
    .getByRole("button", { name: "推しの参考画像を使う", exact: true })
    .click();
  await expect(
    page.getByRole("img", { name: "選んだ下絵", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "このテーマで進む", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  const url = page.url();
  await stroke(page);
  await save(page);
  const original = await records(page),
    guide = original.assets.find((a) => a.kind === "guide")!;
  expect(guide.id).not.toBe(original.characters[0].referenceAssetId);
  await page.goto(`#/characters/${original.characters[0].id}`);
  await page
    .getByLabel("参考画像（任意）", { exact: true })
    .setInputFiles(await image(page, "#0000ff"));
  await page.getByRole("button", { name: "変更を保存", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "この推しを選ぶ", exact: true }),
  ).toBeVisible();
  expect((await records(page)).assets.find((a) => a.id === guide.id)).toEqual(
    guide,
  );
  await page.goto(`#/characters/${original.characters[0].id}`);
  await page
    .getByRole("button", { name: "この推しを削除", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "削除する", exact: true })
    .click();
  await expect
    .poll(async () => (await records(page)).characters.length)
    .toBe(0);
  await page.goto(url);
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".tracing-underlay")).toBeVisible();
  const other = await context.newPage();
  await observeStorageErrors(other);
  await other.goto(url);
  await expect(
    other.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  await other.getByLabel("ペンの色", { exact: true }).fill("#008800");
  await stroke(other);
  await save(other);
  const latest = await records(other);
  await page.getByLabel("ペンの色", { exact: true }).fill("#0000ff");
  await stroke(page);
  const own = await bitmap(page);
  await page.getByRole("button", { name: "途中で保存", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("別の画面");
  await page
    .getByRole("button", { name: "今の絵を別の作品として保存", exact: true })
    .click();
  await expect(page).not.toHaveURL(url);
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  await expectCanvasUnchanged(page, own);
  const copied = await records(page),
    copy = copied.artworks.find((a) => a.id !== original.artworks[0].id)!;
  expect(copied.artworks.find((a) => a.id === original.artworks[0].id)).toEqual(
    latest.artworks[0],
  );
  expect(copy.tracing!.assetId).not.toBe(guide.id);
  expect(copied.assets.find((a) => a.id === copy.tracing!.assetId)!.hash).toBe(
    guide.hash,
  );
  await page
    .getByRole("link", { name: "作品の詳細を見る", exact: true })
    .click();
  await page
    .getByRole("button", { name: "この作品を削除", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "削除する", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/$/);
  const after = await records(page);
  expect(after.artworks).toEqual(latest.artworks);
  expect(after.assets.find((a) => a.id === guide.id)).toEqual(guide);
  expect(
    after.assets.find((a) => a.id === copy.tracing!.assetId),
  ).toBeUndefined();
  await other.close();
});

test("下絵の保存画像が欠けても線を保持し、下絵だけを外して描き続けられる", async ({
  page,
}) => {
  await start(page);
  await stroke(page);
  await save(page);
  const drawn = await bitmap(page),
    before = await records(page);
  await page.evaluate(
    (id) =>
      new Promise<void>((resolve, reject) => {
        const r = indexedDB.open("suki-sketch");
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction("assets", "readwrite");
          tx.objectStore("assets").delete(id);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => reject(tx.error);
        };
        r.onerror = () => reject(r.error);
      }),
    before.artworks[0].tracing!.assetId,
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole("alert")).toContainText("下絵を読み込めません");
  await expectCanvasUnchanged(page, drawn);
  await controls(page);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "下絵を外す", exact: true }).click();
  await save(page);
  expect((await records(page)).artworks[0].tracing).toBeUndefined();
  await expectCanvasUnchanged(page, drawn);
  await page.getByRole("button", { name: "ペン", exact: true }).click();
  await stroke(page);
  await save(page);
});

test("320px・文字200%でも下絵の設定を操作でき、開いた設定にラベル・コントラスト違反がない", async ({
  page,
}, info) => {
  await start(page);
  await controls(page);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    results.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const small = await page
    .locator("button:visible,input:visible")
    .evaluateAll((elements) =>
      elements
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width < 44 || r.height < 44;
        })
        .map((el) => el.outerHTML.slice(0, 100)),
    );
  expect(small).toEqual([]);
  const opacity = page.getByRole("slider", { name: "下絵の濃さ", exact: true });
  await opacity.focus();
  await page.keyboard.press("Home");
  await expect(opacity).toHaveValue("10");
  await page.keyboard.press("ArrowRight");
  await expect(opacity).toHaveValue("11");
  await page.getByRole("button", { name: "下絵を隠す", exact: true }).click();
  await save(page);
  await page.screenshot({
    path: info.outputPath("tracing-text-200.png"),
    fullPage: true,
  });
});
