import { test, expect, type Page } from "@playwright/test";

const card = (page: Page, name: string) =>
  page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });

async function register(page: Page, name: string, memo = "") {
  await page.goto("#/characters/new");
  await page.getByLabel("キャラクター名", { exact: true }).fill(name);
  await page
    .getByRole("textbox", { name: "好きな特徴・描きたいところ", exact: true })
    .fill(memo);
  await page.getByRole("button", { name: "登録して保存", exact: true }).click();
  await expect(page).toHaveURL(/#\/characters$/);
  await expect(card(page, name)).toBeVisible();
}

async function imageFile(
  page: Page,
  mime = "image/png",
  width = 80,
  height = 40,
) {
  const data = await page.evaluate(
    ({ mime, width, height }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#ee2020";
      context.fillRect(0, 0, width / 2, height);
      context.fillStyle = "#2020ee";
      context.fillRect(width / 2, 0, width / 2, height);
      return canvas.toDataURL(mime).split(",")[1];
    },
    { mime, width, height },
  );
  return Buffer.from(data, "base64");
}

async function records(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{
        characters: unknown[];
        assets: Array<{
          id: string;
          size: number;
          width: number;
          height: number;
          type: string;
        }>;
      }>((resolve, reject) => {
        const request = indexedDB.open("suki-sketch");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(["characters", "assets"]);
          const characters = tx.objectStore("characters").getAll();
          const assets = tx.objectStore("assets").getAll();
          tx.oncomplete = () => {
            db.close();
            resolve({
              characters: characters.result,
              assets: assets.result.map((asset) => ({
                id: asset.id,
                size: asset.blob.size,
                width: asset.width,
                height: asset.height,
                type: asset.blob.type,
              })),
            });
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
}

test("画像なしで2人を登録・編集・選択し再読込して復元する", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await register(page, "空の旅人", "帽子と笑顔を描きたい");
  await register(page, "森の案内人", "長い耳が好き");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("characters-list-320.png"),
    fullPage: true,
  });
  await card(page, "空の旅人")
    .getByRole("button", { name: "この推しを選ぶ" })
    .click();
  await expect(card(page, "空の旅人")).toContainText("選択中");
  await page.reload();
  await expect(card(page, "空の旅人")).toContainText("選択中");
  await card(page, "空の旅人").getByRole("link", { name: "編集する" }).click();
  await expect(page.getByLabel("キャラクター名", { exact: true })).toHaveValue(
    "空の旅人",
  );
  await expect(
    page.getByRole("textbox", {
      name: "好きな特徴・描きたいところ",
      exact: true,
    }),
  ).toHaveValue("帽子と笑顔を描きたい");
  await page.screenshot({
    path: testInfo.outputPath("character-edit-320.png"),
    fullPage: true,
  });
  await page.getByLabel("キャラクター名", { exact: true }).fill("空の旅人さん");
  await page
    .getByRole("textbox", { name: "好きな特徴・描きたいところ", exact: true })
    .fill("楽しく描けなくても、少し試したい");
  await page.getByRole("button", { name: "変更を保存" }).click();
  await expect(card(page, "空の旅人さん")).toBeVisible();
  await page.reload();
  await expect(card(page, "空の旅人さん")).toContainText("選択中");
  await page.getByRole("link", { name: "推しを選ばずに進む" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "今日は、どんな姿に？",
  );
  // テーマ選択を追加した後も、推しを未選択で進む導線が保たれる。
  expect((await records(page)).characters).toHaveLength(2);
});

test("名前の空白を拒否し、入力と保存済みデータを保つ", async ({ page }) => {
  await register(page, "先に登録した推し");
  await page.goto("#/characters/new");
  await page.getByLabel("キャラクター名", { exact: true }).fill("   ");
  await page
    .getByRole("textbox", { name: "好きな特徴・描きたいところ", exact: true })
    .fill("消さないメモ");
  await page.getByRole("button", { name: "登録して保存" }).click();
  await expect(page.getByRole("alert")).toContainText("キャラクター名");
  await expect(
    page.getByRole("textbox", {
      name: "好きな特徴・描きたいところ",
      exact: true,
    }),
  ).toHaveValue("消さないメモ");
  expect((await records(page)).characters).toHaveLength(1);
});

for (const mime of ["image/png", "image/jpeg", "image/webp"]) {
  test(`${mime}の参考画像を登録し再読込後も表示する`, async ({ page }) => {
    const external: string[] = [];
    page.on("request", (request) => {
      if (
        new URL(request.url()).protocol.startsWith("http") &&
        new URL(request.url()).hostname !== "127.0.0.1"
      )
        external.push(request.url());
    });
    await page.goto("#/characters/new");
    const buffer = await imageFile(page, mime);
    await page
      .getByLabel("キャラクター名", { exact: true })
      .fill("参考画像の推し");
    await page.getByLabel("参考画像（任意）", { exact: true }).setInputFiles({
      name: `reference.${mime.split("/")[1]}`,
      mimeType: mime,
      buffer,
    });
    await expect(
      page.getByRole("img", { name: "参考画像", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "登録して保存" }).click();
    await expect(card(page, "参考画像の推し")).toBeVisible();
    await page.reload();
    await card(page, "参考画像の推し")
      .getByRole("link", { name: "編集する" })
      .click();
    const preview = page.getByRole("img", { name: "参考画像", exact: true });
    await expect(preview).toBeVisible();
    expect(
      await preview.evaluate((image) => ({
        width: (image as HTMLImageElement).naturalWidth,
        height: (image as HTMLImageElement).naturalHeight,
      })),
    ).toEqual({ width: 80, height: 40 });
    const stored = await records(page);
    expect(stored.characters).toHaveLength(1);
    expect(stored.assets).toMatchObject([
      { width: 80, height: 40, type: "image/png" },
    ]);
    expect(external).toEqual([]);
  });
}

test("回転JPEGの向きを補正し長辺を1600px以内に縮小する", async ({ page }) => {
  await page.goto("#/characters/new");
  const jpeg = await imageFile(page, "image/jpeg", 1800, 900);
  // 独自の2色画像へEXIF Orientation=6を付ける。公式画像・位置情報を使わない。
  const exif = Buffer.from([
    0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x49, 0x49, 0x2a, 0,
    8, 0, 0, 0, 1, 0, 0x12, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0,
  ]);
  const rotated = Buffer.concat([jpeg.subarray(0, 2), exif, jpeg.subarray(2)]);
  await page.getByLabel("キャラクター名", { exact: true }).fill("回転画像");
  await page.getByLabel("参考画像（任意）", { exact: true }).setInputFiles({
    name: "rotated.jpg",
    mimeType: "image/jpeg",
    buffer: rotated,
  });
  const preview = page.getByRole("img", { name: "参考画像", exact: true });
  await expect(preview).toBeVisible();
  await expect
    .poll(() =>
      preview.evaluate((image) => (image as HTMLImageElement).naturalHeight),
    )
    .toBe(1600);
  expect(
    await preview.evaluate((image) => (image as HTMLImageElement).naturalWidth),
  ).toBe(800);
  await page.getByRole("button", { name: "登録して保存" }).click();
  await expect(card(page, "回転画像")).toBeVisible();
  expect((await records(page)).assets).toMatchObject([
    { width: 800, height: 1600, type: "image/png" },
  ]);
});

test("参考画像の置換・削除と推しの削除を確認付きで行う", async ({ page }) => {
  await page.goto("#/characters/new");
  await page
    .getByLabel("キャラクター名", { exact: true })
    .fill("画像を変える推し");
  await page.getByLabel("参考画像（任意）", { exact: true }).setInputFiles({
    name: "first.png",
    mimeType: "image/png",
    buffer: await imageFile(page),
  });
  await page.getByRole("button", { name: "登録して保存" }).click();
  await card(page, "画像を変える推し")
    .getByRole("link", { name: "編集する" })
    .click();
  await page.getByLabel("参考画像（任意）", { exact: true }).setInputFiles({
    name: "next.png",
    mimeType: "image/png",
    buffer: await imageFile(page, "image/png", 60, 90),
  });
  await page.getByRole("button", { name: "変更を保存" }).click();
  await expect(card(page, "画像を変える推し")).toBeVisible();
  expect((await records(page)).assets).toMatchObject([
    { width: 60, height: 90 },
  ]);
  await card(page, "画像を変える推し")
    .getByRole("link", { name: "編集する" })
    .click();
  await page.getByRole("button", { name: "参考画像を外す" }).click();
  await page.getByRole("button", { name: "変更を保存" }).click();
  await expect(card(page, "画像を変える推し")).toBeVisible();
  expect((await records(page)).assets).toHaveLength(0);
  await card(page, "画像を変える推し")
    .getByRole("link", { name: "編集する" })
    .click();
  await page
    .getByRole("button", { name: "この推しを削除", exact: true })
    .click();
  await expect(page.locator("dialog:modal")).toBeVisible();
  await page.keyboard.press("Escape");
  expect((await records(page)).characters).toHaveLength(1);
  await page
    .getByRole("button", { name: "この推しを削除", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "削除する", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/characters$/);
  expect((await records(page)).characters).toHaveLength(0);
});

test("非対応・破損画像を拒否して既存参考画像を保持する", async ({ page }) => {
  await page.goto("#/characters/new");
  await page
    .getByLabel("キャラクター名", { exact: true })
    .fill("元の画像を保つ");
  await page.getByLabel("参考画像（任意）", { exact: true }).setInputFiles({
    name: "safe.png",
    mimeType: "image/png",
    buffer: await imageFile(page),
  });
  await page.getByRole("button", { name: "登録して保存" }).click();
  await card(page, "元の画像を保つ")
    .getByRole("link", { name: "編集する" })
    .click();
  const before = await records(page);
  for (const invalid of [
    {
      name: "unsupported.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    },
    {
      name: "broken.png",
      mimeType: "image/png",
      buffer: Buffer.from("not an image"),
    },
  ]) {
    await page
      .getByLabel("参考画像（任意）", { exact: true })
      .setInputFiles(invalid);
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(
      page.getByRole("img", { name: "参考画像", exact: true }),
    ).toBeVisible();
    expect(await records(page)).toEqual(before);
  }
});

test("容量不足の更新失敗で旧データ・画像と編集内容を保つ", async ({ page }) => {
  await page.goto("#/characters/new");
  await page.getByLabel("キャラクター名", { exact: true }).fill("保存前の名前");
  await page
    .getByRole("textbox", { name: "好きな特徴・描きたいところ", exact: true })
    .fill("保存前のメモ");
  await page.getByLabel("参考画像（任意）", { exact: true }).setInputFiles({
    name: "original.png",
    mimeType: "image/png",
    buffer: await imageFile(page),
  });
  await page.getByRole("button", { name: "登録して保存" }).click();
  await card(page, "保存前の名前")
    .getByRole("link", { name: "編集する" })
    .click();
  await page.getByLabel("キャラクター名", { exact: true }).fill("未保存の名前");
  const before = await records(page);
  await page.getByLabel("参考画像（任意）", { exact: true }).setInputFiles({
    name: "replacement.png",
    mimeType: "image/png",
    buffer: await imageFile(page, "image/png", 30, 60),
  });
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "characters")
        throw new DOMException("容量不足", "QuotaExceededError");
      return original.apply(this, args);
    };
  });
  await page.getByRole("button", { name: "変更を保存" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("キャラクター名", { exact: true })).toHaveValue(
    "未保存の名前",
  );
  expect(await records(page)).toEqual(before);
  expect((await records(page)).characters).toMatchObject([
    { name: "保存前の名前", memo: "保存前のメモ" },
  ]);
});

test("v1の設定を保ったままv4へ移行する", async ({ page }) => {
  await page.goto("#/settings/data");
  await expect(page.getByRole("status")).toContainText("利用できます");
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.deleteDatabase("suki-sketch");
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open("suki-sketch", 1);
      r.onupgradeneeded = () =>
        r.result
          .createObjectStore("settings", { keyPath: "key" })
          .put({ key: "legacy-setting", value: "残す設定" });
      r.onsuccess = () => {
        r.result.close();
        resolve();
      };
      r.onerror = () => reject(r.error);
    });
  });
  await page.reload();
  await expect(page.getByRole("status")).toContainText("利用できます");
  const migrated = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open("suki-sketch");
        r.onsuccess = () => {
          const db = r.result;
          const tx = db.transaction("settings");
          const value = tx.objectStore("settings").get("legacy-setting");
          tx.oncomplete = () => {
            resolve({
              version: db.version,
              stores: Array.from(db.objectStoreNames),
              setting: value.result.value,
            });
            db.close();
          };
          tx.onerror = () => reject(tx.error);
        };
        r.onerror = () => reject(r.error);
      }),
  );
  expect(migrated).toEqual({
    version: 4,
    stores: ["artworks", "assets", "characters", "reflections", "settings"],
    setting: "残す設定",
  });
  await register(page, "移行後に登録");
});

test("別タブの更新を古い編集内容で上書きしない", async ({ page, context }) => {
  await register(page, "競合前の推し", "最初のメモ");
  await card(page, "競合前の推し")
    .getByRole("link", { name: "編集する" })
    .click();
  const editURL = page.url();
  const other = await context.newPage();
  await other.goto(editURL);
  await expect(other.getByLabel("キャラクター名", { exact: true })).toHaveValue(
    "競合前の推し",
  );
  await other
    .getByLabel("キャラクター名", { exact: true })
    .fill("別タブで保存した推し");
  await other.getByRole("button", { name: "変更を保存" }).click();
  await expect(card(other, "別タブで保存した推し")).toBeVisible();
  await page
    .getByLabel("キャラクター名", { exact: true })
    .fill("古い画面での入力");
  await page.getByRole("button", { name: "変更を保存" }).click();
  await expect(page.getByRole("alert")).toContainText("別の画面");
  await expect(page.getByLabel("キャラクター名", { exact: true })).toHaveValue(
    "古い画面での入力",
  );
  expect((await records(page)).characters).toMatchObject([
    { name: "別タブで保存した推し" },
  ]);
  await other.close();
});

test("欠けた参考画像でも名前とメモを保ち、画像を外して回復できる", async ({
  page,
}) => {
  await page.goto("#/characters/new");
  await page
    .getByLabel("キャラクター名", { exact: true })
    .fill("画像だけ欠けた推し");
  await page
    .getByRole("textbox", { name: "好きな特徴・描きたいところ", exact: true })
    .fill("消してはいけないメモ");
  await page.getByLabel("参考画像（任意）", { exact: true }).setInputFiles({
    name: "reference.png",
    mimeType: "image/png",
    buffer: await imageFile(page),
  });
  await page.getByRole("button", { name: "登録して保存" }).click();
  await expect(card(page, "画像だけ欠けた推し")).toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("suki-sketch");
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("assets", "readwrite");
          tx.objectStore("assets").clear();
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      }),
  );
  await card(page, "画像だけ欠けた推し")
    .getByRole("link", { name: "編集する" })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "参考画像を読み込めません",
  );
  await expect(page.getByLabel("キャラクター名", { exact: true })).toHaveValue(
    "画像だけ欠けた推し",
  );
  await expect(
    page.getByRole("textbox", {
      name: "好きな特徴・描きたいところ",
      exact: true,
    }),
  ).toHaveValue("消してはいけないメモ");
  await page.getByRole("button", { name: "参考画像を外す" }).click();
  await page.getByRole("button", { name: "変更を保存" }).click();
  await expect(card(page, "画像だけ欠けた推し")).toBeVisible();
  const saved = await records(page);
  expect(saved.assets).toHaveLength(0);
  expect(saved.characters).toMatchObject([
    { name: "画像だけ欠けた推し", memo: "消してはいけないメモ" },
  ]);
  expect(saved.characters[0]).not.toHaveProperty("referenceAssetId");
});

test("未保存の編集を戻る・画面移動で失わず、破棄は本人が選べる", async ({
  page,
}) => {
  await register(page, "変更前の推し", "元のメモ");
  await card(page, "変更前の推し")
    .getByRole("link", { name: "編集する" })
    .click();
  const editURL = page.url();
  await page
    .getByRole("textbox", { name: "好きな特徴・描きたいところ", exact: true })
    .fill("まだ保存していないメモ");
  const cancelDialog = page.waitForEvent("dialog");
  const canceledClick = page
    .getByRole("navigation")
    .getByRole("link", { name: "データ管理" })
    .click();
  await (await cancelDialog).dismiss();
  await canceledClick;
  await expect(page).toHaveURL(editURL);
  await expect(
    page.getByRole("textbox", {
      name: "好きな特徴・描きたいところ",
      exact: true,
    }),
  ).toHaveValue("まだ保存していないメモ");
  const backDialog = page.waitForEvent("dialog");
  const back = page.goBack();
  await (await backDialog).dismiss();
  await back;
  await expect(page).toHaveURL(editURL);
  await expect(
    page.getByRole("textbox", {
      name: "好きな特徴・描きたいところ",
      exact: true,
    }),
  ).toHaveValue("まだ保存していないメモ");
  const discardDialog = page.waitForEvent("dialog");
  const acceptedClick = page
    .getByRole("navigation")
    .getByRole("link", { name: "データ管理" })
    .click();
  await (await discardDialog).accept();
  await acceptedClick;
  await expect(page).toHaveURL(/#\/settings\/data$/);
  expect((await records(page)).characters).toMatchObject([
    { name: "変更前の推し", memo: "元のメモ" },
  ]);
});

test("推しを選ばず進むと選択状態も解除され、再読込しても戻らない", async ({
  page,
}) => {
  await register(page, "選択を外す推し");
  await card(page, "選択を外す推し")
    .getByRole("button", { name: "この推しを選ぶ" })
    .click();
  await expect(card(page, "選択を外す推し")).toContainText("選択中");
  await page.getByRole("link", { name: "推しを選ばずに進む" }).click();
  await expect(page).toHaveURL(/#\/new$/);
  await page.reload();
  await expect(page.getByRole("main")).not.toContainText(
    "選んだ推し：選択を外す推し",
  );
  const selected = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("suki-sketch");
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("settings");
          const value = tx.objectStore("settings").get("selectedCharacterId");
          tx.oncomplete = () => {
            db.close();
            resolve(value.result);
          };
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      }),
  );
  expect(selected).toBeUndefined();
  await page.goto("#/characters");
  await expect(card(page, "選択を外す推し")).not.toContainText("選択中");
  await expect(
    card(page, "選択を外す推し").getByRole("button", {
      name: "この推しを選ぶ",
    }),
  ).toBeEnabled();
});

test("参考画像メタデータが壊れていても推しを編集し画像を外せる", async ({
  page,
}) => {
  await page.goto("#/characters/new");
  await page
    .getByLabel("キャラクター名", { exact: true })
    .fill("画像情報が壊れた推し");
  await page
    .getByRole("textbox", { name: "好きな特徴・描きたいところ", exact: true })
    .fill("残したい特徴メモ");
  await page.getByLabel("参考画像（任意）", { exact: true }).setInputFiles({
    name: "reference.png",
    mimeType: "image/png",
    buffer: await imageFile(page),
  });
  await page.getByRole("button", { name: "登録して保存" }).click();
  await expect(card(page, "画像情報が壊れた推し")).toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("suki-sketch");
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("assets", "readwrite");
          const store = tx.objectStore("assets");
          const all = store.getAll();
          all.onsuccess = () => store.put({ ...all.result[0], width: -1 });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      }),
  );
  await card(page, "画像情報が壊れた推し")
    .getByRole("link", { name: "編集する" })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "参考画像を読み込めません",
  );
  await expect(
    page.getByRole("textbox", {
      name: "好きな特徴・描きたいところ",
      exact: true,
    }),
  ).toHaveValue("残したい特徴メモ");
  await page.getByRole("button", { name: "参考画像を外す" }).click();
  await page.getByLabel("キャラクター名", { exact: true }).fill("回復した推し");
  await page.getByRole("button", { name: "変更を保存" }).click();
  await expect(card(page, "回復した推し")).toBeVisible();
  const saved = await records(page);
  expect(saved.characters).toMatchObject([
    { name: "回復した推し", memo: "残したい特徴メモ" },
  ]);
  expect(saved.assets).toHaveLength(0);
});
