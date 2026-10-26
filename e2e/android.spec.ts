import {
  expect,
  test,
  devices,
  type Page,
  type BrowserContext,
} from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PNG_ENCODING_TIMEOUT_MS } from "../src/images/png";
import type { StoredAsset } from "../src/data/database";

test.use({ ...devices["Pixel 7"], viewport: { width: 360, height: 800 } });

async function start(page: Page) {
  await page.goto("#/new");
  await page
    .getByRole("button", { name: "テーマを決めずに進む", exact: true })
    .tap();
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
}
async function line(
  page: Page,
  context: BrowserContext,
  y = 0.5,
  x1 = 0.2,
  x2 = 0.8,
) {
  const canvas = page.getByLabel("お絵描きキャンバス");
  await canvas.scrollIntoViewIfNeeded();
  const b = (await canvas.boundingBox())!,
    cdp = await context.newCDPSession(page);
  const point = (x: number) => ({
    id: 1,
    x: b.x + b.width * x,
    y: b.y + b.height * y,
  });
  try {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [point(x1)],
    });
    // 保存エラーが消える場合も、描き始めにキャンバスの位置を動かさない。
    await expect.poll(() => canvas.boundingBox()).toEqual(b);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [point((x1 + x2) / 2)],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [point(x2)],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } finally {
    await cdp.detach();
  }
  // pointerup後に道具が有効へ戻ってから、次の操作を送る。
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
}
const bitmap = (page: Page) =>
  page
    .getByLabel("お絵描きキャンバス")
    .evaluate((c) => (c as HTMLCanvasElement).toDataURL());
async function alpha(page: Page, y: number) {
  return page
    .getByLabel("お絵描きキャンバス")
    .evaluate(
      (c, y) =>
        (c as HTMLCanvasElement)
          .getContext("2d")!
          .getImageData(480, Math.round(960 * y), 1, 1).data[3],
      y,
    );
}
// この環境のシステムChromiumではCDPドラッグ後のtapがclickを生成しない。
// 描画はCDPのtouchイベント（エミュレーション）、描画後のUIはマウスclickとして区別する。
async function saved(page: Page) {
  await page.getByRole("button", { name: "途中で保存", exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText("保存済み");
}
async function snapshot(page: Page) {
  return page.evaluate(
    () =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const r = indexedDB.open("suki-sketch");
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction([
              "artworks",
              "characters",
              "reflections",
              "assets",
            ]);
          const artworks = tx.objectStore("artworks").getAll(),
            characters = tx.objectStore("characters").getAll(),
            reflections = tx.objectStore("reflections").getAll(),
            assets = tx.objectStore("assets").getAll();
          tx.oncomplete = async () => {
            db.close();
            resolve({
              artworks: artworks.result,
              characters: characters.result,
              reflections: reflections.result,
              assets: await Promise.all(
                (assets.result as StoredAsset[]).map(async (a) => {
                  const { blob, ...metadata } = a;
                  return {
                    ...metadata,
                    digest: Array.from(
                      new Uint8Array(
                        await crypto.subtle.digest(
                          "SHA-256",
                          await blob.arrayBuffer(),
                        ),
                      ),
                    ),
                  };
                }),
              ),
            });
          };
          tx.onabort = () => reject(tx.error);
        };
        r.onerror = () => reject(r.error);
      }),
  );
}
async function picture(page: Page, color: string) {
  const base64 = await page.evaluate((color) => {
    const c = document.createElement("canvas");
    c.width = c.height = 16;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 16, 16);
    return c.toDataURL().split(",")[1];
  }, color);
  return {
    name: "reference.png",
    mimeType: "image/png",
    buffer: Buffer.from(base64, "base64"),
  };
}

test("Android相当の小画面で推し・テーマ・タッチ描画・消しゴム・取消・保存再開・書き出しを操作できる", async ({
  page,
  context,
}, info) => {
  await page.goto("#/characters/new");
  await page.getByLabel("キャラクター名", { exact: true }).fill("星の案内人");
  await page.getByRole("button", { name: "登録して保存", exact: true }).tap();
  await page.getByRole("button", { name: "この推しを選ぶ", exact: true }).tap();
  await page
    .getByRole("link", { name: "選んだ推しと次へ進む", exact: true })
    .tap();
  await page
    .getByRole("textbox", { name: "描きたいテーマ", exact: true })
    .fill("眠そうな顔を描いてみる");
  await page
    .getByRole("button", { name: "このテーマで進む", exact: true })
    .tap();
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("ペンの色", { exact: true }).fill("#1234ab");
  await line(page, context);
  expect(await alpha(page, 0.5)).toBe(255);
  await page.getByRole("button", { name: "消しゴム", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "消しゴム", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await line(page, context, 0.5, 0.4, 0.6);
  expect(await alpha(page, 0.5)).toBe(0);
  await page.getByRole("button", { name: "取り消し", exact: true }).click();
  expect(await alpha(page, 0.5)).toBe(255);
  const before = await bitmap(page);
  await page
    .getByRole("button", { name: "描くヒント（任意）", exact: true })
    .click();
  await page
    .getByRole("button", { name: "描く画面に戻る", exact: true })
    .click();
  expect(await bitmap(page)).toBe(before);
  await saved(page);
  await expect(page.locator("dialog:modal")).toHaveCount(0);
  await page
    .getByRole("button", { name: "振り返る（任意）", exact: true })
    .click();
  const d = page.locator("dialog:modal");
  await d
    .getByRole("button", { name: "この質問をスキップ", exact: true })
    .click();
  await expect(d).toBeVisible();
  await d
    .getByRole("button", { name: "振り返りを終える", exact: true })
    .click();
  await page.getByRole("link", { name: "作品の棚", exact: true }).click();
  await page.locator(".work-card").getByRole("link").click();
  await page.getByRole("link", { name: "続きを描く", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  expect(await bitmap(page)).toBe(before);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  expect(await bitmap(page)).toBe(before);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "PNGを書き出す", exact: true })
    .click();
  const png = await readFile((await (await download).path())!);
  const center = await page.evaluate(async (bytes) => {
    const image = await createImageBitmap(
      new Blob([new Uint8Array(bytes)], { type: "image/png" }),
    );
    const c = document.createElement("canvas");
    c.width = c.height = 960;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(image, 0, 0);
    image.close();
    return Array.from(ctx.getImageData(480, 480, 1, 1).data);
  }, Array.from(png));
  expect(center).toEqual([18, 52, 171, 255]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("android-360.png"),
    fullPage: true,
  });
});

test("画像生成の応答が止まっても旧保存と画面の絵を残し、再試行後に遅い通知が来ても上書きしない", async ({
  page,
  context,
}) => {
  await start(page);
  await line(page, context, 0.3);
  await saved(page);
  const before = await snapshot(page);
  await page.clock.install();
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob,
      held: Array<() => void> = [];
    (
      window as unknown as {
        encoding: {
          restore: () => void;
          release: () => void;
          count: () => number;
        };
      }
    ).encoding = {
      restore: () => {
        HTMLCanvasElement.prototype.toBlob = original;
      },
      release: () => {
        held.splice(0).forEach((deliver) => deliver());
      },
      count: () => held.length,
    };
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      if (this.width === 960)
        original.call(
          this,
          (blob) => held.push(() => callback(blob)),
          type,
          quality,
        );
      else original.call(this, callback, type, quality);
    };
  });
  await line(page, context, 0.7);
  await page.getByRole("button", { name: "途中で保存", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { encoding: { count: () => number } }
        ).encoding.count(),
      ),
    )
    .toBeGreaterThan(0);
  await page.clock.fastForward(PNG_ENCODING_TIMEOUT_MS + 1);
  await expect(page.getByRole("alert")).toContainText(
    "画像の準備に時間がかかっています",
  );
  await expect(page.locator(".save-status")).toHaveText("保存できません");
  expect(await snapshot(page)).toEqual(before);
  expect(await alpha(page, 0.7)).toBe(255);
  await page.evaluate(() =>
    (
      window as unknown as { encoding: { restore: () => void } }
    ).encoding.restore(),
  );
  await line(page, context, 0.85);
  expect(await alpha(page, 0.85)).toBe(255);
  await saved(page);
  const latest = await snapshot(page);
  await page.evaluate(() =>
    (
      window as unknown as { encoding: { release: () => void } }
    ).encoding.release(),
  );
  expect(await snapshot(page)).toEqual(latest);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  expect(await alpha(page, 0.3)).toBe(255);
  expect(await alpha(page, 0.7)).toBe(255);
  expect(await alpha(page, 0.85)).toBe(255);
});

test("参考画像の準備が応答しなくても入力と既存画像を保ち、選び直せる", async ({
  page,
}) => {
  await page.goto("#/characters/new");
  await page.getByLabel("キャラクター名", { exact: true }).fill("残す推し");
  await page
    .getByLabel("参考画像（任意）", { exact: true })
    .setInputFiles(await picture(page, "red"));
  await expect(
    page.getByRole("img", { name: "参考画像", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "登録して保存", exact: true }).tap();
  await page.getByRole("link", { name: "編集する", exact: true }).tap();
  await expect(
    page.getByRole("img", { name: "参考画像", exact: true }),
  ).toBeVisible();
  const before = await snapshot(page),
    next = await picture(page, "blue");
  await page
    .getByRole("textbox", { name: "好きな特徴・描きたいところ", exact: true })
    .fill("この入力も残す");
  await page.clock.install();
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    (window as unknown as { restoreEncoder: () => void }).restoreEncoder =
      () => {
        HTMLCanvasElement.prototype.toBlob = original;
      };
    (window as unknown as { encodingStarted: boolean }).encodingStarted = false;
    HTMLCanvasElement.prototype.toBlob = function () {
      (window as unknown as { encodingStarted: boolean }).encodingStarted =
        true;
    };
  });
  await page
    .getByLabel("参考画像（任意）", { exact: true })
    .setInputFiles(next);
  await expect(
    page.getByText("画像を準備しています…", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { encodingStarted: boolean }).encodingStarted,
      ),
    )
    .toBe(true);
  await page.clock.fastForward(PNG_ENCODING_TIMEOUT_MS + 1);
  await expect(page.getByRole("alert")).toContainText(
    "画像の準備に時間がかかっています",
  );
  await expect(
    page.getByRole("textbox", {
      name: "好きな特徴・描きたいところ",
      exact: true,
    }),
  ).toHaveValue("この入力も残す");
  await expect(
    page.getByRole("button", { name: "変更を保存", exact: true }),
  ).toBeEnabled();
  expect(await snapshot(page)).toEqual(before);
  await page.evaluate(() =>
    (window as unknown as { restoreEncoder: () => void }).restoreEncoder(),
  );
  await page
    .getByLabel("参考画像（任意）", { exact: true })
    .setInputFiles(next);
  await expect(
    page.getByText("画像を準備しています…", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "変更を保存", exact: true }).tap();
  await page.getByRole("link", { name: "編集する", exact: true }).tap();
  await expect(
    page.getByRole("textbox", {
      name: "好きな特徴・描きたいところ",
      exact: true,
    }),
  ).toHaveValue("この入力も残す");
});
