import { test, expect, type Page } from "@playwright/test";

type Draft = {
  id: string;
  characterId?: string;
  theme: string;
  themeCategory: string | null;
  status: string;
  width: number;
  height: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
type Character = {
  id: string;
  name: string;
  memo: string;
  referenceAssetId?: string;
};

async function stored(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{
        version: number;
        characters: Character[];
        drafts: Draft[];
        settings: Array<{ key: string; value: string }>;
        assets: Array<{
          id: string;
          width: number;
          height: number;
          blob: Blob;
        }>;
      }>((resolve, reject) => {
        const request = indexedDB.open("suki-sketch");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction([
            "characters",
            "artworks",
            "settings",
            "assets",
          ]);
          const characters = tx.objectStore("characters").getAll();
          const drafts = tx.objectStore("artworks").getAll();
          const settings = tx.objectStore("settings").getAll();
          const assets = tx.objectStore("assets").getAll();
          tx.oncomplete = () => {
            resolve({
              version: db.version,
              characters: characters.result,
              drafts: drafts.result,
              settings: settings.result,
              assets: assets.result,
            });
            db.close();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
  );
}

async function register(page: Page, name: string) {
  await page.goto("#/characters/new");
  await page
    .getByRole("textbox", { name: "キャラクター名", exact: true })
    .fill(name);
  await page.getByRole("button", { name: "登録して保存", exact: true }).click();
  await expect(page).toHaveURL(/#\/characters$/);
  await expect(
    page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name, exact: true }) }),
  ).toBeVisible();
  const record = (await stored(page)).characters.find(
    (character) => character.name === name,
  )!;
  expect(record).toBeTruthy();
  return record.id;
}

async function begin(page: Page, theme: string, characterId?: string) {
  await page.goto("#/new");
  await expect(
    page.getByRole("combobox", { name: "描くキャラクター" }),
  ).toBeVisible();
  if (characterId)
    await page
      .getByRole("combobox", { name: "描くキャラクター" })
      .selectOption(characterId);
  await page
    .getByRole("textbox", { name: "描きたいテーマ", exact: true })
    .fill(theme);
  await page
    .getByRole("button", { name: "このテーマで進む", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/draw\/(?!new$)[^/]+$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "あなたの創作スペース",
  );
  return page.url();
}

test("3件以下のお題を選び直し、気に入った候補を自分の言葉に変えて保存する", async ({
  page,
}) => {
  await page.goto("#/new");
  await page.getByRole("radio", { name: "表情", exact: true }).check();
  const candidates = page
    .getByRole("group", { name: "お題の候補", exact: true })
    .getByRole("button");
  await expect(candidates).toHaveCount(3);
  const before = await candidates.allTextContents();
  expect(new Set(before).size).toBe(3);
  await candidates.first().click();
  const chosen = before[0].trim();
  await expect(
    page.getByRole("textbox", { name: "描きたいテーマ", exact: true }),
  ).toHaveValue(chosen);
  await page
    .getByRole("button", { name: "別のお題を見る", exact: true })
    .click();
  await expect(candidates).toHaveCount(3);
  const after = await candidates.allTextContents();
  expect(after.every((candidate) => !before.includes(candidate))).toBe(true);
  await expect(
    page.getByRole("textbox", { name: "描きたいテーマ", exact: true }),
  ).toHaveValue(chosen);
  const custom = `${chosen}。好きな帽子も添えてみたい`;
  await page
    .getByRole("textbox", { name: "描きたいテーマ", exact: true })
    .fill(custom);
  await page
    .getByRole("button", { name: "このテーマで進む", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/draw\/(?!new$)[^/]+$/);
  await expect(page.getByRole("main")).toContainText(custom);
  expect((await stored(page)).drafts).toMatchObject([
    { theme: custom, status: "in-progress", width: 960, height: 960 },
  ]);
});

test("カテゴリを変更しても自由な入力を尊重し、自由入力では候補を強制しない", async ({
  page,
}) => {
  await page.goto("#/new");
  const theme = page.getByRole("textbox", {
    name: "描きたいテーマ",
    exact: true,
  });
  await theme.fill("何も思い浮かばないけれど、線を引いてみたい");
  for (const category of ["衣装・小物", "ポーズ・場面", "表情"]) {
    await page.getByRole("radio", { name: category, exact: true }).check();
    await expect(
      page
        .getByRole("group", { name: "お題の候補", exact: true })
        .getByRole("button"),
    ).toHaveCount(3);
    await expect(theme).toHaveValue(
      "何も思い浮かばないけれど、線を引いてみたい",
    );
  }
  await page.getByRole("radio", { name: "自由入力", exact: true }).check();
  await expect(
    page.getByRole("group", { name: "お題の候補", exact: true }),
  ).toHaveCount(0);
  await expect(theme).toHaveValue("何も思い浮かばないけれど、線を引いてみたい");
  await page
    .getByRole("button", { name: "このテーマで進む", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/draw\/(?!new$)[^/]+$/);
  expect((await stored(page)).drafts).toMatchObject([
    {
      themeCategory: "free",
      theme: "何も思い浮かばないけれど、線を引いてみたい",
    },
  ]);
});

test("500文字の自由テーマを保存し、入力の上限を示す", async ({ page }) => {
  await page.goto("#/new");
  const theme = page.getByRole("textbox", {
    name: "描きたいテーマ",
    exact: true,
  });
  await expect(theme).toHaveAttribute("maxlength", "500");
  const text = "あ".repeat(500);
  await theme.fill(text);
  await page
    .getByRole("button", { name: "このテーマで進む", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/draw\/(?!new$)[^/]+$/);
  expect((await stored(page)).drafts[0].theme).toBe(text);
});

test("推しとテーマを引き継ぎ、再読み込み・ホームの続きから同じ途中データを開く", async ({
  page,
}) => {
  const characterId = await register(page, "星を眺める旅人");
  const url = await begin(page, "窓辺で一息ついているところ", characterId);
  await expect(page.getByRole("main")).toContainText("星を眺める旅人");
  await expect(page.getByRole("main")).toContainText(
    "窓辺で一息ついているところ",
  );
  const first = (await stored(page)).drafts[0];
  expect(first.characterId).toBe(characterId);
  await page.reload();
  await expect(page.getByRole("main")).toContainText(
    "窓辺で一息ついているところ",
  );
  await expect(page.getByRole("main")).toContainText("星を眺める旅人");
  await page
    .getByRole("link", { name: "すきのスケッチ ホーム", exact: true })
    .click();
  await page.getByRole("link", { name: "続きから描く", exact: true }).click();
  await expect(page).toHaveURL(url);
  expect((await stored(page)).drafts).toHaveLength(1);
  expect((await stored(page)).drafts[0]).toEqual(first);
  await expect(page.getByLabel("お絵描きキャンバス")).toBeVisible();
});

test("テーマなしでも開始でき、スキップは推しを保って入力テーマだけを外す", async ({
  page,
}) => {
  const characterId = await register(page, "自由に描く推し");
  await page.goto("#/new");
  await page
    .getByRole("combobox", { name: "描くキャラクター" })
    .selectOption(characterId);
  await page
    .getByRole("textbox", { name: "描きたいテーマ", exact: true })
    .fill("あとで決めたいテーマ");
  await page
    .getByRole("button", { name: "テーマを決めずに進む", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/draw\/(?!new$)[^/]+$/);
  expect((await stored(page)).drafts).toMatchObject([
    { theme: "", characterId },
  ]);
  await expect(page.getByRole("main")).toContainText("自由に描く推し");
  await page
    .getByRole("link", { name: "別のテーマで準備する", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "描くキャラクター" })
    .selectOption({ label: "推しを選ばずに描く" });
  await page
    .getByRole("button", { name: "このテーマで進む", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/draw\/(?!new$)[^/]+$/);
  const drafts = (await stored(page)).drafts;
  expect(drafts).toHaveLength(2);
  expect(drafts.every((draft) => draft.theme === "")).toBe(true);
  expect(drafts.some((draft) => draft.characterId === undefined)).toBe(true);
  await expect(page.getByRole("main")).toContainText("自由な落書き");
});

test("別のテーマで準備しても前の途中データを上書きしない", async ({ page }) => {
  const oldURL = await begin(page, "最初の小さな落書き");
  const first = (await stored(page)).drafts[0];
  await page
    .getByRole("link", { name: "別のテーマで準備する", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "描きたいテーマ", exact: true })
    .fill("次は髪飾りだけ描く");
  await page
    .getByRole("button", { name: "このテーマで進む", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/draw\/(?!new$)[^/]+$/);
  await expect(page).not.toHaveURL(oldURL);
  const next = await stored(page);
  expect(next.drafts).toHaveLength(2);
  expect(next.drafts.find((draft) => draft.id === first.id)).toEqual(first);
  const lastId = next.settings.find(
    (setting) => setting.key === "lastArtworkId",
  )?.value;
  expect(lastId).not.toBe(first.id);
  expect(next.drafts.find((draft) => draft.id === lastId)?.theme).toBe(
    "次は髪飾りだけ描く",
  );
});

test("推しを削除しても途中データのテーマを残し未分類へ移す", async ({
  page,
}) => {
  const characterId = await register(page, "あとで消す推し");
  const url = await begin(page, "大きなマフラーを添える", characterId);
  const first = (await stored(page)).drafts[0];
  await page.goto(`#/characters/${characterId}`);
  await page
    .getByRole("button", { name: "この推しを削除", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "削除する", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/characters$/);
  await page.goto(url);
  await expect(page.getByRole("main")).toContainText("自由な落書き");
  await expect(page.getByRole("main")).toContainText("大きなマフラーを添える");
  const saved = (await stored(page)).drafts[0];
  expect(saved.characterId).toBeUndefined();
  expect(saved.theme).toBe(first.theme);
  expect(saved.createdAt).toBe(first.createdAt);
  expect(saved.revision).toBeGreaterThan(first.revision);
});

test("v2の推し・画像・設定を削除せずv4へ移行する", async ({ page }) => {
  await page.goto("#/settings/data");
  await expect(page.getByRole("status")).toContainText(
    "端末内保存を利用できます",
  );
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const remove = indexedDB.deleteDatabase("suki-sketch");
      remove.onsuccess = () => resolve();
      remove.onerror = () => reject(remove.error);
      remove.onblocked = () => reject(new Error("test database remained open"));
    });
    const canvas = document.createElement("canvas");
    canvas.width = 4;
    canvas.height = 2;
    canvas.getContext("2d")!.fillRect(0, 0, 4, 2);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!), "image/png"),
    );
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("suki-sketch", 2);
      request.onupgradeneeded = () => {
        const db = request.result;
        const settings = db.createObjectStore("settings", { keyPath: "key" });
        settings.put({ key: "sentinel", value: "移行で消さない" });
        settings.put({ key: "selectedCharacterId", value: "legacy-character" });
        const characters = db.createObjectStore("characters", {
          keyPath: "id",
        });
        characters.put({
          id: "legacy-character",
          name: "以前の推し",
          memo: "好きなところ",
          referenceAssetId: "legacy-image",
          createdAt: "2026-10-20T00:00:00.000Z",
          updatedAt: "2026-10-20T00:00:00.000Z",
          revision: 1,
        });
        db.createObjectStore("assets", { keyPath: "id" }).put({
          id: "legacy-image",
          kind: "reference",
          blob,
          mime: "image/png",
          size: blob.size,
          width: 4,
          height: 2,
        });
      };
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  });
  await page.reload();
  await expect(page.getByRole("status")).toContainText(
    "端末内保存を利用できます",
  );
  await page.goto("#/new");
  await expect(
    page.getByRole("combobox", { name: "描くキャラクター" }),
  ).toHaveValue("legacy-character");
  await page
    .getByRole("textbox", { name: "描きたいテーマ", exact: true })
    .fill("以前の推しを描く準備");
  await page
    .getByRole("button", { name: "このテーマで進む", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/draw\/(?!new$)[^/]+$/);
  const saved = await stored(page);
  expect(saved.version).toBe(4);
  expect(saved.settings).toContainEqual({
    key: "sentinel",
    value: "移行で消さない",
  });
  expect(saved.characters).toMatchObject([
    {
      id: "legacy-character",
      name: "以前の推し",
      memo: "好きなところ",
      referenceAssetId: "legacy-image",
    },
  ]);
  expect(saved.assets).toMatchObject([
    { id: "legacy-image", width: 4, height: 2 },
  ]);
  expect(saved.drafts).toMatchObject([
    { characterId: "legacy-character", theme: "以前の推しを描く準備" },
  ]);
});

test("容量不足で作成に失敗しても入力と既存ドラフト・最後の作品IDを保持する", async ({
  page,
}) => {
  await begin(page, "残しておくテーマ");
  const before = await stored(page);
  await page
    .getByRole("link", { name: "別のテーマで準備する", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "描きたいテーマ", exact: true })
    .fill("保存に失敗しても残る入力");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "artworks")
        throw new DOMException("容量不足", "QuotaExceededError");
      return original.apply(this, args);
    };
    const originalAdd = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args) {
      if (this.name === "artworks")
        throw new DOMException("容量不足", "QuotaExceededError");
      return originalAdd.apply(this, args);
    };
  });
  await page
    .getByRole("button", { name: "このテーマで進む", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("保存");
  await expect(page).toHaveURL(/#\/new$/);
  await expect(
    page.getByRole("textbox", { name: "描きたいテーマ", exact: true }),
  ).toHaveValue("保存に失敗しても残る入力");
  const after = await stored(page);
  expect(after.drafts).toEqual(before.drafts);
  expect(
    after.settings.find((setting) => setting.key === "lastArtworkId"),
  ).toEqual(before.settings.find((setting) => setting.key === "lastArtworkId"));
  expect(errors).toEqual([]);
});

test("選択した推しが直前に削除されたら黙って別の作品を作らない", async ({
  page,
}) => {
  const id = await register(page, "消える推し");
  await page.goto("#/new");
  await page
    .getByRole("combobox", { name: "描くキャラクター" })
    .selectOption(id);
  await page
    .getByRole("textbox", { name: "描きたいテーマ", exact: true })
    .fill("この推しの笑顔");
  await page.evaluate(
    (id) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("suki-sketch");
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("characters", "readwrite");
          tx.objectStore("characters").delete(id);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
        request.onerror = () => reject(request.error);
      }),
    id,
  );
  await page
    .getByRole("button", { name: "このテーマで進む", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/#\/new$/);
  await expect(
    page.getByRole("textbox", { name: "描きたいテーマ", exact: true }),
  ).toHaveValue("この推しの笑顔");
  expect((await stored(page)).drafts).toHaveLength(0);
});

test.describe("テーマのモバイル入力", () => {
  test.use({
    viewport: { width: 320, height: 720 },
    hasTouch: true,
    isMobile: true,
  });
  test("タップで候補を選んで保存し、外部へ入力を送信しない", async ({
    page,
  }, testInfo) => {
    const external: string[] = [];
    const errors: string[] = [];
    const appOrigin = new URL(String(testInfo.project.use.baseURL)).origin;
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.protocol.startsWith("http") && url.origin !== appOrigin)
        external.push(request.url());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("#/new");
    await page.getByRole("radio", { name: "衣装・小物", exact: true }).tap();
    const candidate = page
      .getByRole("group", { name: "お題の候補", exact: true })
      .getByRole("button")
      .first();
    const text = (await candidate.textContent())!.trim();
    await candidate.tap();
    await expect(
      page.getByRole("textbox", { name: "描きたいテーマ", exact: true }),
    ).toHaveValue(text);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("theme-selection-320.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "このテーマで進む", exact: true })
      .tap();
    await expect(page).toHaveURL(/#\/draw\/(?!new$)[^/]+$/);
    await expect(page.getByRole("main")).toContainText(text);
    await expect(
      page.getByRole("button", { name: "ペン", exact: true }),
    ).toBeEnabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("draft-preparation-320.png"),
      fullPage: true,
    });
    expect(external).toEqual([]);
    expect(errors).toEqual([]);
  });
});

test("キーボードでカテゴリを切り替え、自由入力から保存できる", async ({
  page,
}) => {
  await page.goto("#/new");
  const category = page.getByRole("radio", { name: "表情", exact: true });
  await expect(category).toBeEnabled();
  await category.focus();
  await expect(category).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("radio", { name: "衣装・小物", exact: true }),
  ).toBeChecked();
  const input = page.getByRole("textbox", {
    name: "描きたいテーマ",
    exact: true,
  });
  await input.focus();
  await page.keyboard.type("keyboard idea");
  await page
    .getByRole("button", { name: "このテーマで進む", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/draw\/(?!new$)[^/]+$/);
  expect((await stored(page)).drafts[0].theme).toBe("keyboard idea");
});

test("最後に開き直した準備データをホームの続きから再開する", async ({
  page,
}) => {
  const firstURL = await begin(page, "先に作った準備を見返す");
  const secondURL = await begin(page, "あとで作った別の準備");
  expect(secondURL).not.toBe(firstURL);
  await page.goto(firstURL);
  await expect(page.getByRole("main")).toContainText("先に作った準備を見返す");
  await page
    .getByRole("link", { name: "すきのスケッチ ホーム", exact: true })
    .click();
  await page.getByRole("link", { name: "続きから描く", exact: true }).click();
  await expect(page).toHaveURL(firstURL);
  await expect(page.getByRole("main")).toContainText("先に作った準備を見返す");
  expect((await stored(page)).drafts).toHaveLength(2);
});

test("別タブの推し変更を反映しても入力テーマを保ち、削除した推しを選び直せる", async ({
  page,
  context,
}) => {
  const originalId = await register(page, "別タブで変わる推し");
  await page.goto("#/new");
  const selector = page.getByRole("combobox", { name: "描くキャラクター" });
  const theme = page.getByRole("textbox", {
    name: "描きたいテーマ",
    exact: true,
  });
  await selector.selectOption(originalId);
  await theme.fill("編集中のテーマを消さずに残したい");

  const other = await context.newPage();
  await other.goto(`#/characters/${originalId}`);
  await other
    .getByRole("textbox", { name: "キャラクター名", exact: true })
    .fill("名前を変えた推し");
  await other.getByRole("button", { name: "変更を保存", exact: true }).click();
  await expect(other).toHaveURL(/#\/characters$/);
  const addedId = await register(other, "あとから追加した推し");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    selector.getByRole("option", { name: "名前を変えた推し", exact: true }),
  ).toHaveAttribute("value", originalId);
  await expect(
    selector.getByRole("option", { name: "あとから追加した推し", exact: true }),
  ).toBeEnabled();
  await expect(selector).toHaveValue(originalId);
  await expect(theme).toHaveValue("編集中のテーマを消さずに残したい");
  await selector.selectOption(addedId);
  await expect(selector).toHaveValue(addedId);
  await selector.selectOption(originalId);

  await other.goto(`#/characters/${originalId}`);
  await other
    .getByRole("button", { name: "この推しを削除", exact: true })
    .click();
  await other
    .getByRole("dialog")
    .getByRole("button", { name: "削除する", exact: true })
    .click();
  await expect(other).toHaveURL(/#\/characters$/);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(selector).toHaveValue(originalId);
  await expect(
    selector.locator(`option[value="${originalId}"]`),
  ).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText(
    "選んだ推しは別の画面で削除された可能性があります",
  );
  await expect(theme).toHaveValue("編集中のテーマを消さずに残したい");
  await selector.selectOption({ label: "推しを選ばずに描く" });
  await expect(selector).toHaveValue("");
  await selector.selectOption(addedId);
  await page
    .getByRole("button", { name: "このテーマで進む", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/draw\/(?!new$)[^/]+$/);
  expect((await stored(page)).drafts).toMatchObject([
    { characterId: addedId, theme: "編集中のテーマを消さずに残したい" },
  ]);
  await other.close();
});
