import { test, expect, type Page } from "@playwright/test";

async function seedV3(page: Page, broken = false) {
  await page.goto("#/settings/data");
  await expect(page.getByRole("status")).toContainText("利用できます");
  await page.evaluate(async (broken) => {
    const makePNG = async (side: number, color: string) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = side;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, side, side);
      return new Promise<Blob>((resolve) =>
        canvas.toBlob((blob) => resolve(blob!), "image/png"),
      );
    };
    const bitmap = await makePNG(960, "#123456"),
      thumb = await makePNG(192, "#123456"),
      reference = await makePNG(8, "#ff0000");
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.deleteDatabase("suki-sketch");
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open("suki-sketch", 3);
      r.onupgradeneeded = () => {
        const db = r.result;
        const settings = db.createObjectStore("settings", { keyPath: "key" });
        const characters = db.createObjectStore("characters", {
          keyPath: "id",
        });
        const assets = db.createObjectStore("assets", { keyPath: "id" });
        const artworks = db.createObjectStore("artworks", {
          keyPath: broken ? "wrong" : "id",
        });
        const now = "2026-10-21T00:00:00.000Z";
        settings.put({ key: "sentinel", value: "消さない設定" });
        settings.put({ key: "lastArtworkId", value: "legacy-work" });
        settings.put({ key: "selectedCharacterId", value: "legacy-character" });
        characters.put({
          id: "legacy-character",
          name: "前からいる推し",
          memo: "好きなところ",
          referenceAssetId: "reference",
          revision: 1,
          createdAt: now,
          updatedAt: now,
        });
        for (const [id, kind, blob, side] of [
          ["bitmap", "canvas", bitmap, 960],
          ["thumb", "thumbnail", thumb, 192],
          ["reference", "reference", reference, 8],
        ] as const)
          assets.put({
            id,
            kind,
            blob,
            mime: "image/png",
            size: blob.size,
            width: side,
            height: side,
          });
        if (broken)
          artworks.put({ wrong: "legacy-work", text: "消さない作品データ" });
        else
          artworks.put({
            id: "legacy-work",
            characterId: "legacy-character",
            theme: "前の工程で保存した絵",
            themeCategory: "free",
            status: "in-progress",
            canvasAssetId: "bitmap",
            thumbnailAssetId: "thumb",
            tools: { tool: "pen", color: "#123456", width: 12 },
            width: 960,
            height: 960,
            revision: 3,
            createdAt: now,
            updatedAt: now,
          });
      };
      r.onsuccess = () => {
        r.result.close();
        resolve();
      };
      r.onerror = () => reject(r.error);
    });
  }, broken);
}
async function raw(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{
        version: number;
        stores: string[];
        artworks: unknown[];
        settings: unknown[];
        assets: Array<{ id: string; size: number; kind: string }>;
        characters: unknown[];
      }>((resolve, reject) => {
        const r = indexedDB.open("suki-sketch");
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction([
              "artworks",
              "settings",
              "assets",
              "characters",
            ]);
          const artworks = tx.objectStore("artworks").getAll(),
            settings = tx.objectStore("settings").getAll(),
            assets = tx.objectStore("assets").getAll(),
            characters = tx.objectStore("characters").getAll();
          tx.oncomplete = () => {
            resolve({
              version: db.version,
              stores: Array.from(db.objectStoreNames),
              artworks: artworks.result,
              settings: settings.result,
              assets: assets.result.map((a) => ({
                id: a.id,
                size: a.size,
                kind: a.kind,
              })),
              characters: characters.result,
            });
            db.close();
          };
          tx.onerror = () => reject(tx.error);
        };
        r.onerror = () => reject(r.error);
      }),
  );
}

test("v3の絵・道具・推し・参考画像・設定を保持してv4へ移行する", async ({
  page,
}) => {
  await seedV3(page);
  const before = await raw(page);
  await page.reload();
  await expect(page.getByRole("status")).toContainText("利用できます");
  const after = await raw(page);
  expect(after.version).toBe(4);
  expect(after.stores).toContain("reflections");
  expect(after.artworks).toEqual(before.artworks);
  expect(after.settings).toEqual(before.settings);
  expect(after.assets).toEqual(before.assets);
  expect(after.characters).toEqual(before.characters);
  await page.goto("#/draw/legacy-work");
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  const pixel = await page
    .getByLabel("お絵描きキャンバス")
    .evaluate((c) =>
      Array.from(
        (c as HTMLCanvasElement).getContext("2d")!.getImageData(480, 480, 1, 1)
          .data,
      ),
    );
  expect(pixel).toEqual([18, 52, 86, 255]);
  await expect(page.getByLabel("ペンの色", { exact: true })).toHaveValue(
    "#123456",
  );
  await page
    .getByRole("button", { name: "参考画像を見る", exact: true })
    .click();
  await expect(
    page.getByRole("img", { name: "前からいる推しの参考画像", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "振り返る（任意）", exact: true })
    .click();
  await expect(
    page.locator("dialog:modal").getByRole("heading", { level: 3 }),
  ).toHaveText("今回はどんなイラストが描けた？");
});

test("v3の移行元が不正なら移行全体を止め既存データと版を保持する", async ({
  page,
}) => {
  await seedV3(page, true);
  const before = await raw(page);
  await page.reload();
  await expect(page.getByRole("status")).toContainText(
    "保存データの構造を確認できません",
  );
  expect(await raw(page)).toEqual(before);
});

test("別タブがv3を使っている間は待ちを説明し、閉じた後に安全に再試行できる", async ({
  page,
  context,
}) => {
  await seedV3(page);
  const before = await raw(page);
  const blocker = await context.newPage();
  await blocker.route("**/migration-blocker", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<title>migration test</title>",
    }),
  );
  await blocker.goto("migration-blocker");
  await blocker.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const r = indexedDB.open("suki-sketch", 3);
        r.onsuccess = () => {
          (window as unknown as { heldDB: IDBDatabase }).heldDB = r.result;
          resolve();
        };
        r.onerror = () => reject(r.error);
      }),
  );
  await page.reload();
  await expect(page.getByRole("status")).toContainText("別のタブ");
  await blocker.close();
  expect(await raw(page)).toEqual(before);
  await page.reload();
  await expect(page.getByRole("status")).toContainText("利用できます");
  expect((await raw(page)).version).toBe(4);
});

test("v4の回答インデックスが不正でもデータを自動初期化しない", async ({
  page,
}) => {
  await page.goto("#/settings/data");
  await expect(page.getByRole("status")).toContainText("利用できます");
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.deleteDatabase("suki-sketch");
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open("suki-sketch", 4);
      r.onupgradeneeded = () => {
        const db = r.result;
        for (const name of ["settings", "characters", "artworks", "assets"])
          db.createObjectStore(name, {
            keyPath: name === "settings" ? "key" : "id",
          });
        const refs = db.createObjectStore("reflections", { keyPath: "id" });
        refs.createIndex("by-artwork", "artworkId");
        refs.createIndex("by-question", ["artworkId", "questionId"]);
        refs.put({ id: "keep", text: "残す振り返り" });
      };
      r.onsuccess = () => {
        r.result.close();
        resolve();
      };
      r.onerror = () => reject(r.error);
    });
  });
  await page.reload();
  await expect(page.getByRole("status")).toContainText(
    "保存データの構造を確認できません",
  );
  const kept = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open("suki-sketch");
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction("reflections"),
            get = tx.objectStore("reflections").get("keep");
          tx.oncomplete = () => {
            resolve(get.result);
            db.close();
          };
        };
        r.onerror = () => reject(r.error);
      }),
  );
  expect(kept).toEqual({ id: "keep", text: "残す振り返り" });
});
