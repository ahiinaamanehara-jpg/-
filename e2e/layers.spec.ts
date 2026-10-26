import { expect, type Page } from "@playwright/test";
import { test } from "./support/persistentTest";
import {
  startDrawing,
  bitmap,
  canvasPixel,
  paintLine,
  revision,
} from "./support/canvasView";
import { expectCanvasUnchanged } from "./support/canvasSnapshot";
import {
  expectSaved,
  observeStorageErrors,
  DRAWING_SAVE_TIMEOUT_MS,
} from "./support/storageDiagnostics";
import { readFile } from "node:fs/promises";
import { PNG } from "pngjs";
import { comparePngPixels } from "./support/pngComparison";
import { unzipSync } from "fflate";
import AxeBuilder from "@axe-core/playwright";

test.use({ viewport: { width: 360, height: 800 } });
// 5枚の画像とZIPを連続処理する。各PNGの15秒の期限とエラー検査は保つ。
test.setTimeout(60_000);
test.beforeEach(async ({ page }) => observeStorageErrors(page));
const panel = (page: Page) => page.locator(".layer-controls");
async function openLayers(page: Page) {
  await panel(page).locator("summary").click();
}
async function add(page: Page) {
  await panel(page)
    .getByRole("button", { name: "レイヤーを追加", exact: true })
    .click();
}
async function color(page: Page, value: string) {
  await page.getByRole("button", { name: "ペン", exact: true }).click();
  await page.getByLabel("ペンの色", { exact: true }).fill(value);
  await page
    .getByRole("slider", { name: "線の太さ", exact: true })
    .press("End");
}
async function save(page: Page) {
  await page.getByRole("button", { name: "途中で保存", exact: true }).click();
  await expectSaved(page);
}
async function setup(page: Page, tracing = false) {
  await startDrawing(page, tracing);
  await color(page, "#dd2211");
  await paintLine(page);
  await save(page);
  await openLayers(page);
  await add(page);
  await color(page, "#1234ab");
  await paintLine(page);
  await save(page);
}
async function stored(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{
        artworks: import("../src/data/database").ArtworkDraft[];
        assets: Array<{ id: string; kind: string; bytes: number[] }>;
        version: number;
      }>((resolve, reject) => {
        const r = indexedDB.open("suki-sketch");
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction(["artworks", "assets"]),
            works = tx.objectStore("artworks").getAll(),
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

test("1枚のまま始め、選択中だけを消去し、重なり・非表示・削除と取り消しを操作できる", async ({
  page,
}) => {
  await startDrawing(page);
  await expect(panel(page)).not.toHaveAttribute("open", "");
  await color(page, "#dd2211");
  await paintLine(page);
  await save(page);
  const old = await stored(page);
  expect(old.artworks[0].layers).toBeUndefined();
  expect(old.assets).toHaveLength(2);
  await openLayers(page);
  await add(page);
  await color(page, "#1234ab");
  await paintLine(page);
  await save(page);
  expect(await canvasPixel(page)).toEqual([18, 52, 171, 255]);
  const top = await bitmap(page);
  await page.getByRole("button", { name: "消しゴム", exact: true }).click();
  await paintLine(page);
  expect(await canvasPixel(page)).toEqual([221, 34, 17, 255]);
  await page.getByRole("button", { name: "取り消し", exact: true }).click();
  await expectCanvasUnchanged(page, top);
  await panel(page)
    .getByRole("button", { name: "レイヤー2を隠す", exact: true })
    .click();
  await save(page);
  const hidden = await bitmap(page),
    saved = await revision(page);
  await paintLine(page, 0.7);
  await expectCanvasUnchanged(page, hidden);
  expect(await revision(page)).toEqual(saved);
  await expect(page.locator(".layer-current")).toContainText("非表示");
  await page.getByRole("button", { name: "表示して描く", exact: true }).click();
  await expectCanvasUnchanged(page, top);
  await panel(page)
    .getByRole("button", { name: "レイヤー2を下へ", exact: true })
    .click();
  expect(await canvasPixel(page)).toEqual([221, 34, 17, 255]);
  await page.getByRole("button", { name: "取り消し", exact: true }).click();
  await expectCanvasUnchanged(page, top);
  page.once("dialog", (d) => d.dismiss());
  await panel(page)
    .getByRole("button", { name: "レイヤー2を削除", exact: true })
    .click();
  await expectCanvasUnchanged(page, top);
  page.once("dialog", (d) => d.accept());
  await panel(page)
    .getByRole("button", { name: "レイヤー2を削除", exact: true })
    .click();
  expect(await canvasPixel(page)).toEqual([221, 34, 17, 255]);
  await page.getByRole("button", { name: "取り消し", exact: true }).click();
  await expectCanvasUnchanged(page, top);
  // 保存済みのレイヤー追加も戻せ、元の1枚として再保存できる。
  while (
    await page
      .getByRole("button", { name: "取り消し", exact: true })
      .isEnabled()
  )
    await page.getByRole("button", { name: "取り消し", exact: true }).click();
  await save(page);
  expect((await stored(page)).artworks[0].layers).toBeUndefined();
  expect((await canvasPixel(page))[3]).toBe(0);
});

test("最大5枚を保存再開し、PNGは表示分だけ、ZIPは非表示も含めて独立した画像へ復元できる", async ({
  page,
}) => {
  await setup(page, true);
  await panel(page)
    .getByRole("button", { name: "レイヤー2を隠す", exact: true })
    .click();
  for (let i = 0; i < 3; i++) await add(page);
  await expect(
    panel(page).getByRole("button", { name: "レイヤーを追加", exact: true }),
  ).toBeDisabled();
  await panel(page)
    .getByRole("button", { name: "レイヤー2に描く", exact: true })
    .click();
  await save(page);
  const before = await stored(page),
    original = before.artworks[0];
  expect(original.layers!.items).toHaveLength(5);
  expect(before.assets).toHaveLength(8);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".layer-current")).toContainText("レイヤー2");
  await expect(page.locator(".layer-current")).toContainText("非表示");
  expect(await canvasPixel(page)).toEqual([221, 34, 17, 255]);
  const pngDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "PNGを書き出す", exact: true })
    .click();
  const png = PNG.sync.read(
    await readFile((await (await pngDownload).path())!),
  );
  expect([png.width, png.height]).toEqual([960, 960]);
  expect(Array.from(png.data.subarray(0, 4))).toEqual([255, 255, 255, 255]);
  const i = (480 * 960 + 480) * 4;
  expect(Array.from(png.data.subarray(i, i + 4))).toEqual([221, 34, 17, 255]);
  await page.getByRole("link", { name: "データ管理", exact: true }).click();
  const zipDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "全データをバックアップ", exact: true })
    .click();
  const bytes = await readFile((await (await zipDownload).path())!);
  const archive = unzipSync(bytes),
    manifest = JSON.parse(new TextDecoder().decode(archive["manifest.json"]));
  expect(manifest.version).toBe(3);
  expect(manifest.artworks[0].layers.items).toHaveLength(5);
  await page
    .getByLabel("バックアップZIPを選ぶ", { exact: true })
    .setInputFiles({
      name: "layers.zip",
      mimeType: "application/zip",
      buffer: bytes,
    });
  await page
    .getByRole("button", { name: "この内容を追加する", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "追加復元しました" }),
  ).toBeVisible();
  const after = await stored(page),
    restored = after.artworks.find((a) => a.id !== original.id)!;
  expect(
    restored.layers!.items.map((l) => ({ name: l.name, visible: l.visible })),
  ).toEqual(
    original.layers!.items.map((l) => ({ name: l.name, visible: l.visible })),
  );
  for (let n = 0; n < 5; n++) {
    const old = before.assets.find(
        (a) => a.id === original.layers!.items[n].assetId,
      )!,
      next = after.assets.find(
        (a) => a.id === restored.layers!.items[n].assetId,
      )!;
    expect(next.id).not.toBe(old.id);
    expect(next.bytes).toEqual(old.bytes);
  }
  await page.goto(`#/draw/${restored.id}`);
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "表示して描く", exact: true }).click();
  expect(await canvasPixel(page)).toEqual([18, 52, 171, 255]);
});

test("レイヤーの書込不足で原子的に保存を止め、今の絵を別作品へ退避し、削除も独立させる", async ({
  page,
}) => {
  await setup(page);
  const before = await stored(page),
    original = before.artworks[0];
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add;
    (window as unknown as { restoreLayerWrite: () => void }).restoreLayerWrite =
      () => {
        IDBObjectStore.prototype.add = original;
      };
    IDBObjectStore.prototype.add = function (value, key) {
      if (this.name === "assets" && value?.kind === "layer")
        throw new DOMException("test quota", "QuotaExceededError");
      return original.call(this, value, key);
    };
  });
  await paintLine(page, 0.7);
  const drawn = await bitmap(page);
  await page.getByRole("button", { name: "途中で保存", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("保存領域", {
    timeout: DRAWING_SAVE_TIMEOUT_MS,
  });
  expect(await stored(page)).toEqual(before);
  await expectCanvasUnchanged(page, drawn);
  const pngDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "PNGを書き出す", exact: true })
    .click();
  expect(await (await pngDownload).path()).toBeTruthy();
  await page.evaluate(() =>
    (
      window as unknown as { restoreLayerWrite: () => void }
    ).restoreLayerWrite(),
  );
  await page
    .getByRole("button", { name: "今の絵を別の作品として保存", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  const copied = await stored(page),
    copy = copied.artworks.find((a) => a.id !== original.id)!;
  expect(copied.artworks.find((a) => a.id === original.id)).toEqual(original);
  expect(copy.layers!.items).toHaveLength(2);
  for (const item of copy.layers!.items)
    expect(original.layers!.items.map((l) => l.assetId)).not.toContain(
      item.assetId,
    );
  const savedLayer = (data: typeof before, assetId: string) =>
    Buffer.from(data.assets.find((asset) => asset.id === assetId)!.bytes);
  // 変更していない下のレイヤーはRGBAまで同じ。上の既存部分も
  // RGBAを厳密に比べ、新しく描いた領域と分けて保全を確かめる。
  const bottom = comparePngPixels(
    savedLayer(before, original.layers!.items[0].assetId),
    savedLayer(copied, copy.layers!.items[0].assetId),
  );
  expect(bottom.sameSize).toBe(true);
  expect(bottom.changedPixels, JSON.stringify(bottom)).toBe(0);
  const oldTop = PNG.sync.read(
    savedLayer(before, original.layers!.items[1].assetId),
  );
  const newTop = PNG.sync.read(
    savedLayer(copied, copy.layers!.items[1].assetId),
  );
  expect(newTop.data.subarray(0, 960 * 600 * 4)).toEqual(
    oldTop.data.subarray(0, 960 * 600 * 4),
  );
  const strokePixel = (672 * 960 + 480) * 4;
  expect(
    Array.from(newTop.data.subarray(strokePixel, strokePixel + 4)),
  ).toEqual([18, 52, 171, 255]);
  const captured = Buffer.from(drawn.split(",")[1], "base64");
  const savedPreview = comparePngPixels(
    captured,
    savedLayer(copied, copy.canvasAssetId!),
  );
  expect(savedPreview.sameSize).toBe(true);
  expect(savedPreview.materialChangedPixels, JSON.stringify(savedPreview)).toBe(
    0,
  );
  // 再開画面は2枚それぞれのPNGの丸めを重ねる。alphaと不透明色は厳密、
  // 半透明の縁の白背景での差だけを2/255以内として個別に検証する。
  const rebuilt = comparePngPixels(
    captured,
    Buffer.from((await bitmap(page)).split(",")[1], "base64"),
    { translucentRounding: 2 },
  );
  expect(rebuilt.sameSize).toBe(true);
  expect(rebuilt.materialChangedPixels, JSON.stringify(rebuilt)).toBe(0);
  await page
    .getByRole("link", { name: "作品の詳細を見る", exact: true })
    .click();
  await page
    .getByRole("button", { name: "この作品を削除", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "作品を削除しますか？", exact: true })
    .getByRole("button", { name: "削除する", exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "好き、からはじめよう。",
  );
  const remaining = await stored(page);
  expect(remaining.artworks).toEqual(before.artworks);
  expect(remaining.assets).toEqual(before.assets);
});

test("5枚でも小画面・文字200%・専用画面で操作でき、壊れたレイヤーでは白紙上書きをしない", async ({
  page,
}, info) => {
  await setup(page);
  for (let i = 0; i < 3; i++) await add(page);
  await save(page);
  const before = await stored(page),
    work = before.artworks[0];
  await page
    .getByRole("button", { name: "画面いっぱいで描く", exact: true })
    .click();
  await page.getByRole("button", { name: "道具設定", exact: true }).click();
  await openLayers(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const small = await panel(page)
    .locator("button")
    .evaluateAll((buttons) =>
      buttons
        .filter((b) => {
          const r = b.getBoundingClientRect();
          return r.width < 43.999 || r.height < 43.999;
        })
        .map((b) => b.textContent),
    );
  expect(small).toEqual([]);
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    audit.violations.map((v) => ({
      id: v.id,
      targets: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  const layerChoice = panel(page).getByRole("button", {
    name: "レイヤー5に描く",
    exact: true,
  });
  await layerChoice.scrollIntoViewIfNeeded();
  await expect(layerChoice).toBeInViewport();
  await page.screenshot({ path: info.outputPath("layers-text-200.png") });
  await page.getByRole("button", { name: "設定を閉じる", exact: true }).click();
  await page
    .getByRole("button", { name: "通常画面に戻る", exact: true })
    .click();
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
    work.layers!.items[4].assetId,
  );
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("保存データ");
  await expect(
    page.getByText("元の絵を白紙で上書きしないよう、編集を止めています。", {
      exact: true,
    }),
  ).toBeVisible();
  expect((await stored(page)).artworks).toEqual(before.artworks);
  await page.goto(`#/works/${work.id}`);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "PNGを書き出す", exact: true })
    .click();
  expect(await (await download).path()).toBeTruthy();
});

test("v4の既存作品と画像を保持してv5へ更新し、旧版からの書込接続を防ぐ", async ({
  page,
}) => {
  await startDrawing(page);
  await color(page, "#dd2211");
  await paintLine(page);
  await save(page);
  const before = await stored(page),
    image = await bitmap(page);
  await page.evaluate(async () => {
    const state = await new Promise<Record<string, unknown[]>>(
      (resolve, reject) => {
        const r = indexedDB.open("suki-sketch");
        r.onsuccess = () => {
          const db = r.result,
            names = Array.from(db.objectStoreNames),
            tx = db.transaction(names),
            result: Record<string, unknown[]> = {};
          for (const name of names) {
            const get = tx.objectStore(name).getAll();
            get.onsuccess = () => {
              result[name] = get.result;
            };
          }
          tx.oncomplete = () => {
            db.close();
            resolve(result);
          };
          tx.onabort = () => reject(tx.error);
        };
        r.onerror = () => reject(r.error);
      },
    );
    for (const raw of state.assets) {
      const asset = raw as { blob: Blob };
      asset.blob = new Blob([await asset.blob.arrayBuffer()], {
        type: "image/png",
      });
    }
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.deleteDatabase("suki-sketch");
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open("suki-sketch", 4);
      r.onupgradeneeded = () => {
        const db = r.result;
        for (const name of Object.keys(state))
          db.createObjectStore(name, {
            keyPath: name === "settings" ? "key" : "id",
          });
        const refs = r.transaction!.objectStore("reflections");
        refs.createIndex("by-artwork", "artworkId");
        refs.createIndex("by-question", ["artworkId", "questionId"], {
          unique: true,
        });
      };
      r.onsuccess = () => {
        const db = r.result,
          tx = db.transaction(Object.keys(state), "readwrite");
        for (const [name, rows] of Object.entries(state))
          for (const row of rows) tx.objectStore(name).add(row);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onabort = () => reject(tx.error);
      };
      r.onerror = () => reject(r.error);
    });
  });
  expect((await stored(page)).version).toBe(4);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  await expectCanvasUnchanged(page, image);
  const after = await stored(page);
  expect(after.version).toBe(5);
  expect(after.assets).toEqual(before.assets);
  expect(after.artworks).toEqual(before.artworks);
  expect(
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          const r = indexedDB.open("suki-sketch", 4);
          r.onerror = () => resolve(r.error?.name);
          r.onsuccess = () => {
            r.result.close();
            resolve("unexpected");
          };
        }),
    ),
  ).toBe("VersionError");
});
