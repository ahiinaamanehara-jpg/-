import { expect, type Page } from "@playwright/test";
import { test } from "./support/persistentTest";
import {
  bitmap,
  canvasPixel,
  paintLine,
  paperPosition,
} from "./support/canvasView";
import { expectCanvasUnchanged } from "./support/canvasSnapshot";
import {
  expectSaved,
  observeStorageErrors,
  DRAWING_SAVE_TIMEOUT_MS,
} from "./support/storageDiagnostics";
import { readFile } from "node:fs/promises";
import { PNG } from "pngjs";
import { unzipSync } from "fflate";
import AxeBuilder from "@axe-core/playwright";

test.setTimeout(60_000);
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await observeStorageErrors(page);
});
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
async function begin(page: Page, shape = "portrait") {
  await page.goto("#/new");
  await page.getByLabel("キャンバスの形", { exact: true }).selectOption(shape);
  await button(page, "テーマを決めずに進む").click();
  await expect(button(page, "ペン")).toBeEnabled();
}
async function save(page: Page) {
  await button(page, "途中で保存").click();
  await expectSaved(page);
}
async function color(page: Page, value = "#1234ab") {
  await button(page, "ペン").click();
  await page.getByLabel("ペンの色", { exact: true }).fill(value);
  await page
    .getByRole("slider", { name: "線の太さ", exact: true })
    .press("End");
}
const dimensions = (page: Page) =>
  page.getByLabel("お絵描きキャンバス").evaluate((c) => {
    const el = c as HTMLCanvasElement;
    return [el.width, el.height];
  });
async function stored(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{
        version: number;
        artworks: import("../src/data/database").ArtworkDraft[];
        assets: Array<{
          id: string;
          kind: string;
          width: number;
          height: number;
          bytes: number[];
        }>;
      }>((resolve, reject) => {
        const r = indexedDB.open("suki-sketch");
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction(["artworks", "assets"]);
          const works = tx.objectStore("artworks").getAll(),
            assets = tx.objectStore("assets").getAll();
          tx.oncomplete = async () => {
            const version = db.version;
            db.close();
            resolve({
              version,
              artworks: works.result,
              assets: await Promise.all(
                assets.result.map(async (a) => ({
                  id: a.id,
                  kind: a.kind,
                  width: a.width,
                  height: a.height,
                  bytes: Array.from(new Uint8Array(await a.blob.arrayBuffer())),
                })),
              ),
            });
          };
          tx.onabort = () => reject(tx.error);
        };
      }),
  );
}
async function downloadPNG(page: Page) {
  const pending = page.waitForEvent("download");
  await button(page, "PNGを書き出す").click();
  return PNG.sync.read(await readFile((await (await pending).path())!));
}
const pixel = (png: PNG, x: number, y: number) =>
  Array.from(
    png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4),
  );
function image(width = 40, height = 60) {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4)
    png.data.set([240, 20, 20, 255], i);
  return {
    name: "reference.png",
    mimeType: "image/png",
    buffer: PNG.sync.write(png),
  };
}

for (const [shape, width, height] of [
  ["portrait", 720, 960],
  ["landscape", 960, 720],
] as const) {
  test(`${shape}: 長方形で描画・消去・取消・レイヤー・拡大回転・全画面・PNG・再開が一致する`, async ({
    page,
  }, info) => {
    await begin(page, shape);
    expect(await dimensions(page)).toEqual([width, height]);
    await color(page);
    await paintLine(page);
    expect(await canvasPixel(page, width / 2, height / 2)).toEqual([
      18, 52, 171, 255,
    ]);
    const ink = await bitmap(page);
    await button(page, "消しゴム").click();
    await paintLine(page);
    expect((await canvasPixel(page, width / 2, height / 2))[3]).toBe(0);
    await button(page, "取り消し").click();
    await expectCanvasUnchanged(page, ink);
    await button(page, "レイヤー").click();
    await button(page, "レイヤーを追加").click();
    await color(page, "#228833");
    await paintLine(page, 0.65);
    expect(await canvasPixel(page, width / 2, height * 0.65)).toEqual([
      34, 136, 51, 255,
    ]);
    await button(page, "拡大・回転").click();
    await button(page, "表示を拡大").click();
    await button(page, "右に回す").click();
    await button(page, "画面いっぱいで描く").click();
    const element = await page.getByLabel("お絵描きキャンバス").elementHandle();
    await button(page, "ボタンを隠す").click();
    const frame = (await page.locator(".canvas-frame").boundingBox())!;
    expect(frame.width).toBeCloseTo(360, 0);
    expect(frame.height).toBeCloseTo(800, 0);
    const paper = await page.locator(".canvas-transform").evaluate((el) => {
      const s = getComputedStyle(el);
      return parseFloat(s.width) / parseFloat(s.height);
    });
    expect(paper).toBeCloseTo(width / height, 5);
    // 別色の縁を重ねず、PNG復元とレイヤー合成の丸めを入力座標の検査へ混ぜない。
    const target = await paperPosition(page, 0.55, 0.8);
    await page.mouse.click(target.x, target.y);
    expect(await canvasPixel(page, width * 0.55, height * 0.8)).toEqual([
      34, 136, 51, 255,
    ]);
    expect(
      await element!.evaluate((el) => el === document.querySelector("canvas")),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath(`${shape}-hidden.png`) });
    await button(page, "ボタンを表示").click();
    await button(page, "途中で保存").click();
    await expect(page.locator(".workspace-status")).toHaveText("保存済み", {
      timeout: DRAWING_SAVE_TIMEOUT_MS,
    });
    await button(page, "通常画面に戻る").click();
    const before = await bitmap(page);
    await page.reload();
    await expect(button(page, "ペン")).toBeEnabled();
    await expectCanvasUnchanged(page, before);
    expect(await dimensions(page)).toEqual([width, height]);
    const state = await stored(page);
    expect(state.artworks[0].layers!.items).toHaveLength(2);
    expect(
      state.assets
        .filter((a) => a.kind === "layer")
        .every((a) => a.width === width && a.height === height),
    ).toBe(true);
    const png = await downloadPNG(page);
    expect([png.width, png.height]).toEqual([width, height]);
    expect(pixel(png, width / 2, height / 2)).toEqual([18, 52, 171, 255]);
    expect(pixel(png, 0, 0)).toEqual([255, 255, 255, 255]);
    await page.goto(`#/works/${state.artworks[0].id}`);
    await expect(button(page, "PNGを書き出す")).toBeEnabled();
    const detailPNG = await downloadPNG(page);
    expect([detailPNG.width, detailPNG.height]).toEqual([width, height]);
    expect(pixel(detailPNG, width / 2, height / 2)).toEqual([18, 52, 171, 255]);
  });
}

test("推しの参考画像に初期サイズを合わせ、手動選択と推し切替、下絵の比率・保存を保つ", async ({
  page,
}) => {
  await page.goto("#/characters/new");
  await page
    .getByLabel("キャラクター名", { exact: true })
    .fill("サイズを合わせる推し");
  await page
    .getByLabel("参考画像（任意）", { exact: true })
    .setInputFiles(image());
  await expect(
    page.getByRole("img", { name: "参考画像", exact: true }),
  ).toBeVisible();
  await button(page, "登録して保存").click();
  await expect(
    page.getByRole("heading", { name: "サイズを合わせる推し", exact: true }),
  ).toBeVisible();
  await button(page, "この推しを選ぶ").click();
  await expect(button(page, "この推しを選ぶ")).toBeDisabled();
  await page.goto("#/new");
  const select = page.getByLabel("キャンバスの形", { exact: true });
  await expect(select).toHaveValue("reference");
  await expect(page.locator("#canvas-size-result")).toHaveText("640 × 960px");
  await select.selectOption("landscape");
  await expect(page.locator("#canvas-size-result")).toHaveText("960 × 720px");
  const character = page.getByLabel("描くキャラクター", { exact: true });
  const id = await character.inputValue();
  await character.selectOption("");
  await expect(select).toHaveValue("square");
  await character.selectOption(id);
  await expect(select).toHaveValue("reference");
  await page
    .getByRole("radio", { name: "下絵をなぞって描く", exact: true })
    .check();
  await button(page, "推しの参考画像を使う").click();
  await expect(
    page.getByRole("img", { name: "選んだ下絵", exact: true }),
  ).toBeVisible();
  await button(page, "この下絵で描きはじめる").click();
  await expect(button(page, "ペン")).toBeEnabled();
  expect(await dimensions(page)).toEqual([640, 960]);
  await expect(page.locator(".tracing-underlay")).toBeVisible();
  await color(page);
  await paintLine(page);
  expect(await canvasPixel(page, 320, 480)).toEqual([18, 52, 171, 255]);
  await save(page);
  const ink = await bitmap(page),
    state = await stored(page);
  expect(state.assets.find((a) => a.kind === "guide")).toMatchObject({
    width: 40,
    height: 60,
  });
  await page.reload();
  await expect(button(page, "ペン")).toBeEnabled();
  await expectCanvasUnchanged(page, ink);
  expect(await dimensions(page)).toEqual([640, 960]);
  const png = await downloadPNG(page);
  expect([png.width, png.height]).toEqual([640, 960]);
  expect(pixel(png, 320, 480)).toEqual([18, 52, 171, 255]);
  expect(pixel(png, 1, 1)).toEqual([255, 255, 255, 255]);
  // 参考画像だけが欠けても新規制作を止めず、既存作品と独立した下絵を残す。
  const referenceId = state.assets.find((a) => a.kind === "reference")!.id;
  await page.evaluate(
    (assetId) =>
      new Promise<void>((resolve, reject) => {
        const r = indexedDB.open("suki-sketch");
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction("assets", "readwrite");
          tx.objectStore("assets").delete(assetId);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => reject(tx.error);
        };
      }),
    referenceId,
  );
  await page.goto("#/new");
  await expect(select).toBeEnabled();
  await expect(select).toHaveValue("square");
  await expect(
    page.getByText(
      "参考画像のサイズを読み込めません。正方形・縦長・横長を選んで進めます。",
      { exact: true },
    ),
  ).toBeVisible();
  expect((await stored(page)).artworks).toEqual(state.artworks);
});

test("長方形の画像取込・作品コピーとZIP v4追加復元で寸法・非表示レイヤー・下絵を保持する", async ({
  page,
}) => {
  await begin(page);
  await color(page);
  await paintLine(page);
  await save(page);
  const source = await stored(page),
    original = source.artworks[0];
  await page.getByText("紙や他のアプリの絵を取り込む", { exact: true }).click();
  await page
    .getByLabel("作品画像を選ぶ", { exact: true })
    .setInputFiles(image(60, 40));
  await expect.poll(async () => (await stored(page)).artworks.length).toBe(2);
  await expect(button(page, "ペン")).toBeEnabled();
  expect(await dimensions(page)).toEqual([720, 960]);
  expect(await canvasPixel(page, 360, 480)).toEqual([240, 20, 20, 255]);
  expect((await canvasPixel(page, 1, 1))[3]).toBe(0);
  await button(page, "取り消し").click();
  expect((await canvasPixel(page, 360, 480))[3]).toBe(0);
  await button(page, "レイヤー").click();
  await button(page, "レイヤーを追加").click();
  await color(page);
  await paintLine(page);
  await button(page, "レイヤー2を隠す").click();
  await button(page, "下絵をなぞる").click();
  await button(page, "正面を使う").click();
  await expect(page.locator(".tracing-underlay")).toBeVisible();
  await save(page);
  await page.getByRole("link", { name: "データ管理", exact: true }).click();
  const pending = page.waitForEvent("download");
  await button(page, "全データをバックアップ").click();
  const zip = await readFile((await (await pending).path())!);
  const entries = unzipSync(zip),
    m = JSON.parse(new TextDecoder().decode(entries["manifest.json"]));
  expect(m.version).toBe(4);
  expect(
    m.artworks.every(
      (a: { width: number; height: number }) =>
        a.width === 720 && a.height === 960,
    ),
  ).toBe(true);
  for (const asset of m.assets) {
    const png = PNG.sync.read(Buffer.from(entries[asset.file]));
    expect([png.width, png.height]).toEqual([asset.width, asset.height]);
  }
  await page
    .getByLabel("バックアップZIPを選ぶ", { exact: true })
    .setInputFiles({
      name: "sizes.zip",
      mimeType: "application/zip",
      buffer: zip,
    });
  await button(page, "この内容を追加する").click();
  await expect(
    page.getByRole("status").filter({ hasText: "追加復元しました" }),
  ).toBeVisible();
  const restored = await stored(page);
  expect(restored.artworks).toHaveLength(4);
  expect(restored.artworks.find((a) => a.id === original.id)).toEqual(original);
  expect(
    restored.assets.filter((a) => source.assets.some((b) => b.id === a.id)),
  ).toEqual(source.assets);
  const copy = restored.artworks.find(
    (a) => !m.artworks.some((b: { id: string }) => b.id === a.id) && a.layers,
  )!;
  await page.goto(`#/draw/${copy.id}`);
  await expect(button(page, "ペン")).toBeEnabled();
  expect(await dimensions(page)).toEqual([720, 960]);
  await expect(page.locator(".layer-current")).toContainText("非表示");
  await expect(page.locator(".tracing-underlay")).toBeVisible();
  await button(page, "表示して描く").click();
  expect(await canvasPixel(page, 360, 480)).toEqual([18, 52, 171, 255]);
});

test("長方形の保存失敗を復旧でき、不整合な寸法で既存画像を上書きしない", async ({
  page,
}, info) => {
  await begin(page, "landscape");
  await color(page);
  await paintLine(page);
  await save(page);
  const before = await stored(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    (window as unknown as { restoreSizeWrites: () => void }).restoreSizeWrites =
      () => {
        IDBObjectStore.prototype.put = put;
      };
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === "artworks")
        throw new DOMException("test quota", "QuotaExceededError");
      return put.call(this, value, key);
    };
  });
  await paintLine(page, 0.7);
  await button(page, "途中で保存").click();
  await expect(
    page.getByRole("alert").filter({ hasText: "保存領域" }),
  ).toBeVisible();
  const ink = await bitmap(page);
  expect(await stored(page)).toEqual(before);
  const png = await downloadPNG(page);
  expect([png.width, png.height]).toEqual([960, 720]);
  expect(pixel(png, 480, 504)).toEqual([18, 52, 171, 255]);
  await page.evaluate(() =>
    (
      window as unknown as { restoreSizeWrites: () => void }
    ).restoreSizeWrites(),
  );
  await save(page);
  await expectCanvasUnchanged(page, ink);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.addStyleTag({ content: "html{font-size:200%}" });
  await expect(button(page, "画面いっぱいで描く")).toBeEnabled();
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(axe.violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("landscape-320-text200.png") });
  const saved = await stored(page);
  await page.evaluate(
    (id) =>
      new Promise<void>((resolve, reject) => {
        const r = indexedDB.open("suki-sketch");
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction("artworks", "readwrite"),
            store = tx.objectStore("artworks"),
            get = store.get(id);
          get.onsuccess = () => store.put({ ...get.result, height: 800 });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => reject(tx.error);
        };
      }),
    saved.artworks[0].id,
  );
  const corrupt = await stored(page);
  await page.reload();
  await expect(
    page.getByRole("alert").filter({ hasText: "保存データ" }),
  ).toBeVisible();
  await expect(page.getByLabel("お絵描きキャンバス")).toHaveCount(0);
  expect(await stored(page)).toEqual(corrupt);
  expect(corrupt.assets).toEqual(saved.assets);
});
