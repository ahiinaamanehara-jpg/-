import { expect, type Page } from "@playwright/test";
import { test } from "./support/persistentTest";
import { bitmap, canvasPixel, paintLine } from "./support/canvasView";
import { expectCanvasUnchanged } from "./support/canvasSnapshot";
import {
  expectSaved,
  observeStorageErrors,
  DRAWING_SAVE_TIMEOUT_MS,
} from "./support/storageDiagnostics";
import { PNG } from "pngjs";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import AxeBuilder from "@axe-core/playwright";

test.use({ viewport: { width: 360, height: 800 } });
// 5種類のPNG準備、保存・バックアップの各段階の期限はそのまま保つ。
test.setTimeout(60_000);
test.beforeEach(async ({ page }) => observeStorageErrors(page));
const names = ["正面", "左横顔", "右横顔", "左斜め", "右斜め"];
const picker = (page: Page) =>
  page.getByRole("group", { name: "用意したあたり（5種類）", exact: true });
const preset = (page: Page, name: string) =>
  picker(page).getByRole("button", { name: `${name}を使う`, exact: true });
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
async function previewBytes(page: Page, selector: string) {
  return Buffer.from(
    await page
      .locator(selector)
      .evaluate(async (image) =>
        Array.from(
          new Uint8Array(
            await (await fetch((image as HTMLImageElement).src)).arrayBuffer(),
          ),
        ),
      ),
  );
}
async function save(page: Page) {
  await page.getByRole("button", { name: "途中で保存", exact: true }).click();
  await expectSaved(page);
}
async function records(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{
        artworks: import("../src/data/database").ArtworkDraft[];
        assets: Array<{ id: string; kind: string; hash: string }>;
      }>((resolve, reject) => {
        const request = indexedDB.open("suki-sketch");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(["artworks", "assets"]);
          const works = tx.objectStore("artworks").getAll();
          const assets = tx.objectStore("assets").getAll();
          tx.onabort = () => reject(tx.error);
          tx.oncomplete = async () => {
            db.close();
            resolve({
              artworks: works.result,
              assets: await Promise.all(
                assets.result.map(async (asset) => ({
                  id: asset.id,
                  kind: asset.kind,
                  hash: Array.from(
                    new Uint8Array(
                      await crypto.subtle.digest(
                        "SHA-256",
                        await asset.blob.arrayBuffer(),
                      ),
                    ),
                  )
                    .map((v) => v.toString(16).padStart(2, "0"))
                    .join(""),
                })),
              ),
            });
          };
        };
      }),
  );
}
async function startPreset(page: Page, name = "正面") {
  await page.goto("#/new");
  await page
    .getByRole("radio", { name: "下絵をなぞって描く", exact: true })
    .check();
  await preset(page, name).click();
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
}
function inkIn(png: PNG, x0: number, x1: number, y0: number, y1: number) {
  let total = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++)
      if (png.data[(y * png.width + x) * 4 + 3] > 0) total++;
  return total;
}
function faceDetailsCenter(png: PNG) {
  let total = 0,
    xsum = 0;
  for (let y = 285; y < 440; y++)
    for (let x = 0; x < png.width; x++) {
      const p = (y * png.width + x) * 4;
      if (
        png.data[p] < 80 &&
        png.data[p + 1] < 80 &&
        png.data[p + 2] < 80 &&
        png.data[p + 3] > 240
      ) {
        total++;
        xsum += x;
      }
    }
  expect(total).toBeGreaterThan(10);
  return xsum / total;
}

function faceSpan(png: PNG, y0: number, y1: number) {
  let left = png.width,
    right = -1;
  for (let y = y0; y < y1; y++)
    for (let x = 0; x < png.width; x++)
      if (png.data[(y * png.width + x) * 4 + 3] > 240) {
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
  expect(right).toBeGreaterThan(left);
  return { left, right };
}

test("画像なしで5方向の顔から胸元のあたりを選び、PNGを描画・保存再開できる", async ({
  page,
}, info) => {
  const external: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.protocol.startsWith("http") &&
      url.origin !== new URL(String(info.project.use.baseURL)).origin
    )
      external.push(request.url());
  });
  await page.goto("#/new");
  await expect(
    page.getByRole("radio", { name: "白紙から描く", exact: true }),
  ).toBeChecked();
  await expect(picker(page)).toHaveCount(0);
  await page
    .getByRole("radio", { name: "下絵をなぞって描く", exact: true })
    .check();
  await expect(picker(page).getByRole("button")).toHaveCount(5);
  const pictures = new Map<string, PNG>(),
    hashes = new Set<string>();
  for (const name of names) {
    const image = page.getByRole("img", { name: "選んだ下絵", exact: true });
    const old = (await image.count()) ? await image.getAttribute("src") : null;
    await preset(page, name).click();
    await expect(
      page.getByRole("status").filter({ hasText: "選んだ下絵：" }),
    ).toContainText(`選んだ下絵：${name}のあたり`);
    await expect(image).toBeVisible();
    await expect.poll(() => image.getAttribute("src")).not.toBe(old);
    const bytes = await previewBytes(page, ".tracing-preview"),
      png = PNG.sync.read(bytes);
    await writeFile(info.outputPath(`${name}.png`), bytes);
    hashes.add(hash(bytes));
    pictures.set(name, png);
    expect([png.width, png.height]).toEqual([960, 960]);
    expect(inkIn(png, 100, 860, 60, 590)).toBeGreaterThan(1000);
    expect(inkIn(png, 80, 880, 620, 910)).toBeGreaterThan(500);
    expect(inkIn(png, 0, 960, 920, 960)).toBe(0);
  }
  expect(hashes.size).toBe(5);
  // A profile's nose projects beyond its forehead on the labelled side.
  const leftProfile = pictures.get("左横顔")!,
    rightProfile = pictures.get("右横顔")!;
  expect(faceSpan(leftProfile, 400, 460).left).toBeLessThan(
    faceSpan(leftProfile, 250, 300).left - 8,
  );
  expect(faceSpan(rightProfile, 400, 460).right).toBeGreaterThan(
    faceSpan(rightProfile, 250, 300).right + 8,
  );
  expect(faceDetailsCenter(pictures.get("正面")!)).toBeGreaterThan(460);
  expect(faceDetailsCenter(pictures.get("正面")!)).toBeLessThan(500);
  expect(faceDetailsCenter(pictures.get("左斜め")!)).toBeLessThan(442);
  expect(faceDetailsCenter(pictures.get("右斜め")!)).toBeGreaterThan(518);
  const chosen = hash(await previewBytes(page, ".tracing-preview"));
  await page
    .getByRole("button", { name: "この下絵で描きはじめる", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  expect((await canvasPixel(page))[3]).toBe(0);
  expect(hash(await previewBytes(page, ".tracing-underlay"))).toBe(chosen);
  await page.getByLabel("ペンの色", { exact: true }).fill("#1234ab");
  await page
    .getByRole("slider", { name: "線の太さ", exact: true })
    .press("End");
  await paintLine(page);
  expect(await canvasPixel(page)).toEqual([18, 52, 171, 255]);
  const drawn = await bitmap(page);
  await save(page);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  await expectCanvasUnchanged(page, drawn);
  expect(hash(await previewBytes(page, ".tracing-underlay"))).toBe(chosen);
  await page.getByRole("button", { name: "下絵をなぞる", exact: true }).click();
  await picker(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("preset-picker-360.png") });
  expect(external).toEqual([]);
});

test("旧下絵の入替取消・読込失敗・生成失敗・保存不足でも元の絵を保ち、再試行できる", async ({
  page,
}) => {
  // A bitmap saved by M14 has no dependency on the new bundled assets.
  await page.goto("#/new");
  await page
    .getByRole("radio", { name: "下絵をなぞって描く", exact: true })
    .check();
  await page
    .getByLabel("下絵にする画像を選ぶ", { exact: true })
    .setInputFiles("e2e/fixtures/legacy-guide.png");
  await expect(
    page.getByRole("img", { name: "選んだ下絵", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "この下絵で描きはじめる", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("ペンの色", { exact: true }).fill("#1234ab");
  await page
    .getByRole("slider", { name: "線の太さ", exact: true })
    .press("End");
  await paintLine(page);
  await save(page);
  const before = await records(page),
    drawn = await bitmap(page),
    original = hash(await previewBytes(page, ".tracing-underlay"));
  await page.reload();
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  await expectCanvasUnchanged(page, drawn);
  expect(hash(await previewBytes(page, ".tracing-underlay"))).toBe(original);
  await page.getByRole("button", { name: "下絵をなぞる", exact: true }).click();
  page.once("dialog", (dialog) => dialog.dismiss());
  await preset(page, "左横顔").click();
  expect(await records(page)).toEqual(before);
  expect(hash(await previewBytes(page, ".tracing-underlay"))).toBe(original);
  const brokenAsset = "**/guide-profile-right-*.png";
  await page.route(brokenAsset, (route) => route.abort());
  page.once("dialog", (dialog) => dialog.accept());
  await preset(page, "左横顔").click();
  await expect(page.getByRole("alert")).toContainText(
    "用意したあたりを読み込めませんでした",
  );
  await expectCanvasUnchanged(page, drawn);
  expect(hash(await previewBytes(page, ".tracing-underlay"))).toBe(original);
  expect(await records(page)).toEqual(before);
  await page.unroute(brokenAsset);
  await page.evaluate(() => {
    const originalBlob = HTMLCanvasElement.prototype.toBlob;
    const originalAdd = IDBObjectStore.prototype.add;
    (
      window as unknown as { restorePresetCanvas: () => void }
    ).restorePresetCanvas = () => {
      HTMLCanvasElement.prototype.toBlob = originalBlob;
    };
    (
      window as unknown as { restorePresetWrites: () => void }
    ).restorePresetWrites = () => {
      IDBObjectStore.prototype.add = originalAdd;
    };
    HTMLCanvasElement.prototype.toBlob = function (callback) {
      callback(null);
    };
  });
  page.once("dialog", (dialog) => dialog.accept());
  await preset(page, "左横顔").click();
  await expect(page.getByRole("alert")).toContainText(
    "画像を準備できませんでした",
  );
  await expectCanvasUnchanged(page, drawn);
  expect(hash(await previewBytes(page, ".tracing-underlay"))).toBe(original);
  expect(await records(page)).toEqual(before);
  await page.evaluate(() => {
    (
      window as unknown as { restorePresetCanvas: () => void }
    ).restorePresetCanvas();
    const original = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (value, key) {
      if (this.name === "assets" && value?.kind === "guide")
        throw new DOMException("test quota", "QuotaExceededError");
      return original.call(this, value, key);
    };
  });
  page.once("dialog", (dialog) => dialog.accept());
  await preset(page, "左横顔").click();
  await expect
    .poll(async () => hash(await previewBytes(page, ".tracing-underlay")))
    .not.toBe(original);
  await page
    .getByRole("button", { name: "サポートを閉じる", exact: true })
    .click();
  await page.getByRole("button", { name: "途中で保存", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("保存領域", {
    timeout: DRAWING_SAVE_TIMEOUT_MS,
  });
  expect(await records(page)).toEqual(before);
  await expectCanvasUnchanged(page, drawn);
  await page.evaluate(() =>
    (
      window as unknown as { restorePresetWrites: () => void }
    ).restorePresetWrites(),
  );
  await save(page);
  const after = await records(page);
  expect(after.artworks[0].revision).toBeGreaterThan(
    before.artworks[0].revision,
  );
  expect(after.assets).toHaveLength(3);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  await expectCanvasUnchanged(page, drawn);
  expect(hash(await previewBytes(page, ".tracing-underlay"))).not.toBe(
    original,
  );
});

test("下絵はPNGに混ぜずZIPで残し、専用画面・文字200%と顔や練習のヒントを使える", async ({
  page,
}, info) => {
  await startPreset(page, "左斜め");
  const blank = await bitmap(page),
    guide = hash(await previewBytes(page, ".tracing-underlay"));
  await save(page);
  const work = (await records(page)).artworks[0];
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "PNGを書き出す", exact: true })
    .click();
  const png = PNG.sync.read(await readFile((await (await download).path())!));
  expect([png.width, png.height]).toEqual([960, 960]);
  for (let p = 0; p < png.data.length; p += 4)
    if (
      png.data[p] !== 255 ||
      png.data[p + 1] !== 255 ||
      png.data[p + 2] !== 255 ||
      png.data[p + 3] !== 255
    )
      throw new Error("下絵がPNGに混ざっています");
  await page
    .getByRole("button", { name: "画面いっぱいで描く", exact: true })
    .click();
  await page.getByRole("button", { name: "下絵をなぞる", exact: true }).click();
  await page.setViewportSize({ width: 320, height: 640 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  for (const button of await picker(page).getByRole("button").all()) {
    await button.scrollIntoViewIfNeeded();
    const box = (await button.boundingBox())!;
    expect(box.width + 0.001).toBeGreaterThanOrEqual(44);
    expect(box.height + 0.001).toBeGreaterThanOrEqual(44);
  }
  expect(
    await page
      .locator(".support-panel")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    audit.violations.map((v) => ({
      id: v.id,
      targets: v.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
  await page.screenshot({
    path: info.outputPath("preset-picker-text-200.png"),
  });
  await page.getByRole("button", { name: "下絵を隠す", exact: true }).click();
  await page
    .getByRole("slider", { name: "下絵の濃さ", exact: true })
    .press("End");
  await page
    .getByRole("button", { name: "サポートを閉じる", exact: true })
    .click();
  await page
    .getByRole("button", { name: "通常画面に戻る", exact: true })
    .click();
  await page
    .getByRole("button", { name: "描くヒント（任意）", exact: true })
    .click();
  const hints = page.getByRole("dialog", { name: "描くヒント", exact: true });
  await hints.getByRole("button", { name: "顔の形", exact: true }).click();
  await expect(hints).toContainText("顔から胸元");
  await expect(hints).toContainText("左右の斜め");
  for (const name of ["模写", "トレース"]) {
    await hints.getByRole("button", { name, exact: true }).click();
    await expect(hints).toContainText("練習になります");
    await expect(hints).toContainText("公開前");
  }
  await page.keyboard.press("Escape");
  await save(page);
  await page.goto("#/settings/data");
  const zipDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "全データをバックアップ", exact: true })
    .click();
  const zipped = await readFile((await (await zipDownload).path())!),
    files = unzipSync(zipped);
  const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"]));
  expect(manifest.version).toBe(3);
  const asset = manifest.assets.find(
    (asset: { id: string }) => asset.id === work.tracing!.assetId,
  );
  expect(hash(files[asset.file])).toBe(guide);
  await page.reload();
  await page.goto(`#/draw/${work.id}`);
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  await expectCanvasUnchanged(page, blank);
  await expect(page.locator(".tracing-underlay")).toHaveCount(0);
  await page.getByRole("button", { name: "下絵をなぞる", exact: true }).click();
  await expect(
    page.getByRole("slider", { name: "下絵の濃さ", exact: true }),
  ).toHaveValue("70");
  await page
    .getByRole("button", { name: "下絵を表示する", exact: true })
    .click();
  expect(hash(await previewBytes(page, ".tracing-underlay"))).toBe(guide);
});
