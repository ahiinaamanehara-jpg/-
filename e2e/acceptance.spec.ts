import { expect, test, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

async function picture(page: Page) {
  return Buffer.from(
    await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = c.height = 16;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#de5735";
      ctx.fillRect(0, 0, 16, 16);
      return c.toDataURL("image/png").split(",")[1];
    }),
    "base64",
  );
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
}
async function pixels(page: Page) {
  return page
    .getByLabel("お絵描きキャンバス")
    .evaluate((c) => (c as HTMLCanvasElement).toDataURL());
}
async function counts(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ artworks: number; reflections: number }>(
        (resolve, reject) => {
          const r = indexedDB.open("suki-sketch");
          r.onsuccess = () => {
            const db = r.result,
              tx = db.transaction(["artworks", "reflections"]);
            const a = tx.objectStore("artworks").count(),
              answers = tx.objectStore("reflections").count();
            tx.oncomplete = () => {
              db.close();
              resolve({ artworks: a.result, reflections: answers.result });
            };
            tx.onabort = () => reject(tx.error);
          };
          r.onerror = () => reject(r.error);
        },
      ),
  );
}

for (const withReference of [false, true]) {
  test(`初回登録から描画・任意回答・一覧・再開・書き出し・復元まで（参考画像${withReference ? "あり" : "なし"}）`, async ({
    page,
    context,
  }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const requests: Array<{ url: string; method: string; type: string }> = [],
      errors: string[] = [];
    const origin = new URL(String(info.project.use.baseURL)).origin;
    context.on("request", (r) =>
      requests.push({
        url: r.url(),
        method: r.method(),
        type: r.resourceType(),
      }),
    );
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("websocket", (socket) =>
      errors.push(`想定外のWebSocket: ${socket.url()}`),
    );
    await page.goto("");
    await page
      .getByRole("link", { name: "好きなキャラクターを選ぶ", exact: true })
      .click();
    await page
      .getByRole("link", { name: "推しを登録する", exact: true })
      .click();
    await page.getByLabel("キャラクター名", { exact: true }).fill("森の案内人");
    await page
      .getByRole("textbox", { name: "好きな特徴・描きたいところ", exact: true })
      .fill("大きな帽子と、眠そうな顔");
    if (withReference) {
      await page.getByLabel("参考画像（任意）", { exact: true }).setInputFiles({
        name: "reference.png",
        mimeType: "image/png",
        buffer: await picture(page),
      });
      await expect(
        page.getByRole("img", { name: "参考画像", exact: true }),
      ).toBeVisible();
    }
    await page
      .getByRole("button", { name: "登録して保存", exact: true })
      .click();
    await page
      .getByRole("button", { name: "この推しを選ぶ", exact: true })
      .click();
    await page
      .getByRole("link", { name: "選んだ推しと次へ進む", exact: true })
      .click();
    const candidates = page
      .getByRole("group", { name: "お題の候補", exact: true })
      .getByRole("button");
    await expect(candidates).toHaveCount(3);
    await candidates.first().click();
    await page
      .getByRole("textbox", { name: "描きたいテーマ", exact: true })
      .fill("眠そうな顔で、お茶を飲む");
    await page
      .getByRole("button", { name: "このテーマで進む", exact: true })
      .click();
    const pen = page.getByRole("button", { name: "ペン", exact: true });
    await expect(pen).toBeEnabled();
    const url = page.url();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await stroke(page);
    const drawn = await pixels(page);
    if (withReference) {
      await page
        .getByRole("button", { name: "参考画像を見る", exact: true })
        .click();
      await expect(
        page.getByRole("img", { name: "森の案内人の参考画像", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "参考画像を閉じる", exact: true })
        .click();
      await page
        .getByRole("button", { name: "描くヒント（任意）", exact: true })
        .click();
      await page
        .getByRole("button", { name: "描く画面に戻る", exact: true })
        .click();
      expect(await pixels(page)).toBe(drawn);
    }
    await page.getByRole("button", { name: "途中で保存", exact: true }).click();
    await expect(page.locator(".save-status")).toHaveText("保存済み");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page
      .getByRole("button", { name: "振り返る（任意）", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    if (withReference) {
      await dialog
        .getByLabel("自由に書く（任意）", { exact: true })
        .fill("楽しくなかった。帽子だけは描いてみた");
      await dialog
        .getByRole("button", { name: "回答を保存", exact: true })
        .click();
      await expect(
        dialog.getByText("楽しくなかった。帽子だけは描いてみた", {
          exact: true,
        }),
      ).toBeVisible();
    } else {
      await dialog
        .getByRole("button", { name: "この質問をスキップ", exact: true })
        .click();
      await expect(dialog).toBeVisible();
    }
    await dialog
      .getByRole("button", { name: "振り返りを終える", exact: true })
      .click();
    await page.getByRole("link", { name: "作品の棚", exact: true }).click();
    await page.locator(".work-card").getByRole("link").click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "作品を見返す",
    );
    await expect(
      page.getByText("大きな帽子と、眠そうな顔", { exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "続きを描く", exact: true }).click();
    await expect(page).toHaveURL(url);
    await expect(pen).toBeEnabled();
    expect(await pixels(page)).toBe(drawn);
    await page.reload();
    await expect(pen).toBeEnabled();
    expect(await pixels(page)).toBe(drawn);
    await page
      .getByRole("link", { name: "作品の詳細を見る", exact: true })
      .click();
    const pngDownload = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "PNGを書き出す", exact: true })
      .click();
    const png = await readFile((await (await pngDownload).path())!);
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    await page.getByRole("link", { name: "データ管理", exact: true }).click();
    const zipDownload = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "全データをバックアップ", exact: true })
      .click();
    const zipPath = (await (await zipDownload).path())!;
    await expect(
      page.getByRole("button", { name: "全データをバックアップ", exact: true }),
    ).toBeEnabled();
    await page
      .getByLabel("バックアップZIPを選ぶ", { exact: true })
      .setInputFiles(zipPath);
    await expect(
      page.getByRole("heading", { name: "追加する内容", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "この内容を追加する", exact: true })
      .click();
    await expect(page.getByText(/追加復元しました。/)).toBeVisible();
    expect(await counts(page)).toEqual({
      artworks: 2,
      reflections: withReference ? 2 : 0,
    });
    const unexpected = requests.filter((r) => {
      const u = new URL(r.url);
      if (u.protocol === "blob:")
        return u.origin !== origin || r.method !== "GET";
      return (
        u.origin !== origin ||
        r.method !== "GET" ||
        u.search !== "" ||
        !/^\/workshop\/(?:assets\/[^/]+)?$/.test(u.pathname)
      );
    });
    expect(unexpected).toEqual([]);
    expect(errors).toEqual([]);
    const report = info.outputPath("network.json");
    await writeFile(report, JSON.stringify(requests, null, 2));
    await info.attach("network.json", {
      path: report,
      contentType: "application/json",
    });
  });
}
