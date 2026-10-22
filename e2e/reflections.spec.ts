import { test, expect, type Page } from "@playwright/test";

async function start(page: Page, theme = "") {
  await page.goto("#/new");
  if (theme)
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
async function draw(page: Page, y = 0.5) {
  const canvas = page.getByLabel("お絵描きキャンバス");
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * y, {
    steps: 6,
  });
  await page.mouse.up();
}
async function image(page: Page) {
  return page
    .getByLabel("お絵描きキャンバス")
    .evaluate((c) => (c as HTMLCanvasElement).toDataURL());
}
async function saved(page: Page) {
  await page.getByRole("button", { name: "途中で保存", exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText("保存済み");
}
async function open(page: Page) {
  await page
    .getByRole("button", { name: "振り返る（任意）", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "振り返り（任意）",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("振り返りを読み込んでいます…")).toHaveCount(0);
  return dialog;
}
async function records(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{
        version: number;
        reflections: Array<{
          id: string;
          artworkId: string;
          questionId: string;
          text: string;
          choice: string | null;
          comparedArtworkId?: string;
          revision: number;
        }>;
        artworks: Array<{
          id: string;
          revision: number;
          canvasAssetId?: string;
          characterId?: string;
        }>;
        assets: Array<{ id: string; kind: string; size: number }>;
      }>((resolve, reject) => {
        const request = indexedDB.open("suki-sketch");
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(["reflections", "artworks", "assets"]);
          const reflections = tx.objectStore("reflections").getAll(),
            artworks = tx.objectStore("artworks").getAll(),
            assets = tx.objectStore("assets").getAll();
          tx.oncomplete = () => {
            resolve({
              version: db.version,
              reflections: reflections.result,
              artworks: artworks.result,
              assets: assets.result.map((a) => ({
                id: a.id,
                kind: a.kind,
                size: a.size,
              })),
            });
            db.close();
          };
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      }),
  );
}
async function register(page: Page, name: string) {
  await page.goto("#/characters/new");
  await page.getByLabel("キャラクター名", { exact: true }).fill(name);
  await page.getByRole("button", { name: "登録して保存", exact: true }).click();
  await page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name, exact: true }) })
    .getByRole("button", { name: "この推しを選ぶ" })
    .click();
}

test("任意のヒントを開閉しても絵・道具・取消履歴を保持し描き続けられる", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 720 });
  const errors: string[] = [],
    external: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (
      u.protocol.startsWith("http") &&
      u.origin !== new URL(String(info.project.use.baseURL)).origin
    )
      external.push(r.url());
  });
  await start(page);
  await page.getByLabel("ペンの色", { exact: true }).fill("#1234ab");
  await draw(page);
  const before = await image(page);
  const trigger = page.getByRole("button", {
    name: "描くヒント（任意）",
    exact: true,
  });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "描くヒント", exact: true });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "閉じる", exact: true }),
  ).toBeFocused();
  for (const topic of ["表情", "顔の形", "簡単なポーズ"]) {
    await dialog.getByRole("button", { name: topic, exact: true }).click();
    await expect(
      dialog.getByRole("heading", { name: `${topic}のヒント`, exact: true }),
    ).toBeVisible();
    await expect(dialog.getByRole("img")).toBeVisible();
  }
  await page.screenshot({
    path: info.outputPath("hints-320.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect(await image(page)).toBe(before);
  await expect(page.getByLabel("ペンの色", { exact: true })).toHaveValue(
    "#1234ab",
  );
  await expect(
    page.getByRole("button", { name: "取り消し", exact: true }),
  ).toBeEnabled();
  await draw(page, 0.7);
  expect(await image(page)).not.toBe(before);
  await saved(page);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test("通常保存では質問を強制せず、1問をスキップしても絵は保存される", async ({
  page,
}) => {
  await start(page);
  await draw(page);
  await saved(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const before = await image(page);
  const dialog = await open(page);
  await expect(
    dialog.getByRole("group", { name: "今回の質問", exact: true }),
  ).toHaveCount(1);
  await expect(dialog.getByRole("heading", { level: 3 })).toHaveText(
    "今回はどんなイラストが描けた？",
  );
  await dialog
    .getByRole("button", { name: "この質問をスキップ", exact: true })
    .click();
  await expect(dialog.getByRole("heading", { level: 3 })).toHaveText(
    "今回、描いていて一番楽しかったのは？",
  );
  expect((await records(page)).reflections).toHaveLength(0);
  await dialog
    .getByRole("button", { name: "振り返りを終える", exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  expect(await image(page)).toBe(before);
});

test("スキップを繰り返しても質問を循環せず、最後は閉じずに終了を案内する", async ({
  page,
}) => {
  await start(page);
  const dialog = await open(page);
  const questions = new Set<string>();
  for (let i = 0; i < 6; i++) {
    const text = (await dialog
      .getByRole("heading", { level: 3 })
      .textContent())!;
    expect(questions.has(text)).toBe(false);
    questions.add(text);
    await dialog
      .getByRole("button", { name: "この質問をスキップ", exact: true })
      .click();
  }
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("group", { name: "今回の質問", exact: true }),
  ).toHaveCount(0);
  await expect(dialog.getByRole("status")).toContainText("ここまで");
  expect((await records(page)).reflections).toHaveLength(0);
  await dialog
    .getByRole("button", { name: "振り返りを終える", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
});

test("入力済みの質問をスキップするか本人が選べ、未保存の回答を次へ持ち越さない", async ({
  page,
}) => {
  await start(page);
  const dialog = await open(page);
  await dialog
    .getByLabel("自由に書く（任意）", { exact: true })
    .fill("まだ答えかけ");
  page.once("dialog", (d) => d.dismiss());
  await dialog
    .getByRole("button", { name: "この質問をスキップ", exact: true })
    .click();
  await expect(
    dialog.getByLabel("自由に書く（任意）", { exact: true }),
  ).toHaveValue("まだ答えかけ");
  page.once("dialog", (d) => d.accept());
  await dialog
    .getByRole("button", { name: "この質問をスキップ", exact: true })
    .click();
  await expect(dialog.getByRole("heading", { level: 3 })).toHaveText(
    "今回、描いていて一番楽しかったのは？",
  );
  await expect(
    dialog.getByLabel("自由に書く（任意）", { exact: true }),
  ).toHaveValue("");
  expect((await records(page)).reflections).toHaveLength(0);
});

test("絵の保存が失敗したら質問を開かず、絵を保って保存を再試行できる", async ({
  page,
}) => {
  await start(page);
  await draw(page);
  const before = await image(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as unknown as { restoreArtworkPut: () => void }).restoreArtworkPut =
      () => {
        IDBObjectStore.prototype.put = original;
      };
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "artworks")
        throw new DOMException("quota", "QuotaExceededError");
      return original.apply(this, args);
    };
  });
  await page
    .getByRole("button", { name: "振り返る（任意）", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("保存領域");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await image(page)).toBe(before);
  expect((await records(page)).reflections).toHaveLength(0);
  await expect(
    page.getByRole("button", { name: "PNGを書き出す", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() =>
    (
      window as unknown as { restoreArtworkPut: () => void }
    ).restoreArtworkPut(),
  );
  const dialog = await open(page);
  await expect(dialog.getByRole("heading", { level: 3 })).toHaveText(
    "今回はどんなイラストが描けた？",
  );
});

test("空欄を保存でき、追加は希望時だけで否定的な回答も受け入れる", async ({
  page,
}) => {
  await start(page);
  const dialog = await open(page);
  await dialog.getByRole("button", { name: "回答を保存", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("保存しました");
  await expect(
    dialog.getByText("（空欄で保存）", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("group", { name: "今回の質問", exact: true }),
  ).toHaveCount(0);
  expect((await records(page)).reflections[0]).toMatchObject({
    text: "",
    choice: null,
    questionId: "summary",
  });
  await dialog
    .getByRole("button", { name: "もう1問（任意）", exact: true })
    .click();
  await expect(dialog.getByRole("heading", { level: 3 })).toHaveText(
    "今回、描いていて一番楽しかったのは？",
  );
  await dialog
    .getByRole("button", { name: "楽しくなかった", exact: true })
    .click();
  await dialog
    .getByLabel("自由に書く（任意）", { exact: true })
    .fill("今日は思ったように描けなかった");
  await dialog.getByRole("button", { name: "回答を保存", exact: true }).click();
  await expect(
    dialog.getByText("楽しくなかった", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("group", { name: "今回の質問", exact: true }),
  ).toHaveCount(0);
  expect((await records(page)).reflections).toHaveLength(2);
});

test("2000文字とHTML風入力を保持し、後日編集・削除しても作品を変えない", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await start(page);
  await draw(page);
  let dialog = await open(page);
  const before = await records(page),
    bitmap = await image(page);
  const prefix = '<img src=x onerror="alert(1)">';
  const text = prefix + "あ".repeat(2000 - prefix.length);
  const input = dialog.getByLabel("自由に書く（任意）", { exact: true });
  await expect(input).toHaveAttribute("maxlength", "2000");
  await input.fill(text);
  expect(text.length).toBe(2000);
  await page.screenshot({
    path: info.outputPath("reflection-320.png"),
    fullPage: true,
  });
  expect(await dialog.evaluate((d) => d.scrollWidth <= d.clientWidth)).toBe(
    true,
  );
  await dialog.getByRole("button", { name: "回答を保存", exact: true }).click();
  await expect(dialog.getByText(text, { exact: true })).toBeVisible();
  await expect(dialog.locator("img")).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "振り返りを終える", exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
  expect(await image(page)).toBe(bitmap);
  dialog = await open(page);
  await dialog.getByRole("button", { name: "回答を編集", exact: true }).click();
  await expect(
    dialog.getByLabel("自由に書く（任意）", { exact: true }),
  ).toHaveValue(text);
  await dialog
    .getByLabel("自由に書く（任意）", { exact: true })
    .fill("後から書き直したメモ");
  await dialog.getByRole("button", { name: "特にない", exact: true }).click();
  await dialog.getByRole("button", { name: "回答を保存", exact: true }).click();
  await expect(
    dialog.getByText("後から書き直したメモ", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("group", { name: "今回の質問", exact: true }),
  ).toHaveCount(0);
  expect((await records(page)).reflections[0].revision).toBe(2);
  await dialog.getByRole("button", { name: "回答を削除", exact: true }).click();
  await dialog.getByRole("button", { name: "キャンセル", exact: true }).click();
  expect((await records(page)).reflections).toHaveLength(1);
  await dialog.getByRole("button", { name: "回答を削除", exact: true }).click();
  await dialog.getByRole("button", { name: "削除する", exact: true }).click();
  await expect(
    dialog.getByText("保存した回答はまだありません。", { exact: true }),
  ).toBeVisible();
  const after = await records(page);
  expect(after.reflections).toHaveLength(0);
  expect(after.artworks).toEqual(before.artworks);
  expect(after.assets).toEqual(before.assets);
});

test("振り返りの容量不足では入力・既存回答・作品を保持して再試行できる", async ({
  page,
}) => {
  await start(page);
  await draw(page);
  const dialog = await open(page),
    before = await records(page);
  await dialog
    .getByLabel("自由に書く（任意）", { exact: true })
    .fill("失敗しても残す回答");
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as unknown as { restorePut: () => void }).restorePut = () => {
      IDBObjectStore.prototype.put = original;
    };
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "reflections")
        throw new DOMException("quota", "QuotaExceededError");
      return original.apply(this, args);
    };
  });
  await dialog.getByRole("button", { name: "回答を保存", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("保存領域");
  expect(await records(page)).toEqual(before);
  await expect(
    dialog.getByLabel("自由に書く（任意）", { exact: true }),
  ).toHaveValue("失敗しても残す回答");
  await page.evaluate(() =>
    (window as unknown as { restorePut: () => void }).restorePut(),
  );
  await dialog.getByRole("button", { name: "回答を保存", exact: true }).click();
  await expect(
    dialog.getByText("失敗しても残す回答", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("group", { name: "今回の質問", exact: true }),
  ).toHaveCount(0);
  expect((await records(page)).reflections[0].text).toBe("失敗しても残す回答");
});

test("回答削除の失敗でも絵と回答を保持して再試行できる", async ({ page }) => {
  await start(page);
  await draw(page);
  const dialog = await open(page);
  await dialog.getByRole("button", { name: "回答を保存", exact: true }).click();
  await expect(
    dialog.getByRole("group", { name: "今回の質問", exact: true }),
  ).toHaveCount(0);
  const before = await records(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.delete;
    (window as unknown as { restoreDelete: () => void }).restoreDelete = () => {
      IDBObjectStore.prototype.delete = original;
    };
    IDBObjectStore.prototype.delete = function (...args) {
      if (this.name === "reflections")
        throw new DOMException("quota", "QuotaExceededError");
      return original.apply(this, args);
    };
  });
  await dialog.getByRole("button", { name: "回答を削除", exact: true }).click();
  await dialog.getByRole("button", { name: "削除する", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("保存領域");
  expect(await records(page)).toEqual(before);
  await page.evaluate(() =>
    (window as unknown as { restoreDelete: () => void }).restoreDelete(),
  );
  await dialog.getByRole("button", { name: "削除する", exact: true }).click();
  await expect(
    dialog.getByText("保存した回答はまだありません。", { exact: true }),
  ).toBeVisible();
  expect((await records(page)).reflections).toHaveLength(0);
});

test("不正な保存回答を自動削除せず、閉じて描画を続けられる", async ({
  page,
}) => {
  await start(page);
  await draw(page);
  let dialog = await open(page);
  await dialog.getByRole("button", { name: "回答を保存", exact: true }).click();
  await expect(
    dialog.getByRole("group", { name: "今回の質問", exact: true }),
  ).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "振り返りを終える", exact: true })
    .click();
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const r = indexedDB.open("suki-sketch");
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction("reflections", "readwrite"),
            all = tx.objectStore("reflections").getAll();
          all.onsuccess = () =>
            tx
              .objectStore("reflections")
              .put({ ...all.result[0], questionId: "unknown-question" });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  const before = await records(page),
    bitmap = await image(page);
  dialog = await open(page);
  await expect(dialog.getByRole("alert")).toContainText("保存データ");
  await dialog.getByRole("button", { name: "閉じる", exact: true }).click();
  expect(await image(page)).toBe(bitmap);
  expect(await records(page)).toEqual(before);
  await draw(page, 0.7);
  await saved(page);
  expect((await records(page)).reflections).toEqual(before.reflections);
});

test("別作品に回答を引き継がず、振り返り後も競合せず描画を保存できる", async ({
  page,
}) => {
  const original = await start(page);
  await draw(page);
  let dialog = await open(page);
  await dialog
    .getByLabel("自由に書く（任意）", { exact: true })
    .fill("元の作品の振り返り");
  await dialog.getByRole("button", { name: "回答を保存", exact: true }).click();
  await expect(
    dialog.getByRole("group", { name: "今回の質問", exact: true }),
  ).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "振り返りを終える", exact: true })
    .click();
  await draw(page, 0.7);
  await saved(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await start(page, "別の作品");
  dialog = await open(page);
  await expect(dialog.getByRole("heading", { level: 3 })).toHaveText(
    "今回はどんなイラストが描けた？",
  );
  await expect(
    dialog.getByText("元の作品の振り返り", { exact: true }),
  ).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "この質問をスキップ", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "振り返りを終える", exact: true })
    .click();
  await page.goto(original);
  dialog = await open(page);
  await expect(
    dialog.getByText("元の作品の振り返り", { exact: true }),
  ).toBeVisible();
});

test.describe("スマートフォンの振り返り操作", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 375, height: 812 },
  });
  test("タップで質問を開き、回答を送信せず端末内へ保存して戻る", async ({
    page,
  }, info) => {
    const external: string[] = [],
      errors: string[] = [];
    page.on("request", (r) => {
      const url = new URL(r.url());
      if (
        url.protocol.startsWith("http") &&
        url.origin !== new URL(String(info.project.use.baseURL)).origin
      )
        external.push(r.url());
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await start(page);
    const canvas = page.getByLabel("お絵描きキャンバス");
    await canvas.scrollIntoViewIfNeeded();
    const box = (await canvas.boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page
      .getByRole("button", { name: "振り返る（任意）", exact: true })
      .tap();
    const dialog = page.getByRole("dialog", {
      name: "振り返り（任意）",
      exact: true,
    });
    await dialog.getByRole("button", { name: "特にない", exact: true }).tap();
    await dialog
      .getByLabel("自由に書く（任意）", { exact: true })
      .fill("スマホで残した言葉");
    await dialog.getByRole("button", { name: "回答を保存", exact: true }).tap();
    await expect(
      dialog.getByRole("group", { name: "今回の質問", exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByText("スマホで残した言葉", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("reflection-history-375.png"),
      fullPage: true,
    });
    await dialog
      .getByRole("button", { name: "振り返りを終える", exact: true })
      .tap();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "ペン", exact: true }),
    ).toBeEnabled();
    expect((await records(page)).reflections[0].text).toBe(
      "スマホで残した言葉",
    );
    expect(external).toEqual([]);
    expect(errors).toEqual([]);
  });
});

test("別タブの回答を上書きせず、入力を保持して読み直せる", async ({
  page,
  context,
}) => {
  const url = await start(page);
  const first = await open(page);
  await first.getByRole("button", { name: "回答を保存", exact: true }).click();
  await expect(
    first.getByText("（空欄で保存）", { exact: true }),
  ).toBeVisible();
  const other = await context.newPage();
  await other.goto(url);
  const second = await open(other);
  await first.getByRole("button", { name: "回答を編集", exact: true }).click();
  await second.getByRole("button", { name: "回答を編集", exact: true }).click();
  await first
    .getByLabel("自由に書く（任意）", { exact: true })
    .fill("先のタブの回答");
  await first.getByRole("button", { name: "回答を保存", exact: true }).click();
  await expect(
    first.getByText("先のタブの回答", { exact: true }),
  ).toBeVisible();
  await second
    .getByLabel("自由に書く（任意）", { exact: true })
    .fill("後のタブの未保存回答");
  await second.getByRole("button", { name: "回答を保存", exact: true }).click();
  await expect(second.getByRole("alert")).toContainText("別の画面");
  await expect(
    second.getByLabel("自由に書く（任意）", { exact: true }),
  ).toHaveValue("後のタブの未保存回答");
  expect((await records(other)).reflections[0].text).toBe("先のタブの回答");
  other.once("dialog", (d) => d.accept());
  await second
    .getByRole("button", { name: "一覧を読み直す", exact: true })
    .click();
  await expect(
    second.getByText("先のタブの回答", { exact: true }),
  ).toBeVisible();
  await other.close();
});

test("未保存回答の閉じる・Backを取り消すと回答と絵が残る", async ({ page }) => {
  const url = await start(page);
  await draw(page);
  const dialog = await open(page),
    bitmap = await image(page);
  await dialog
    .getByLabel("自由に書く（任意）", { exact: true })
    .fill("まだ保存していない言葉");
  page.once("dialog", (d) => d.dismiss());
  await page.keyboard.press("Escape");
  await expect(
    dialog.getByLabel("自由に書く（任意）", { exact: true }),
  ).toHaveValue("まだ保存していない言葉");
  page.once("dialog", (d) => d.dismiss());
  await page.goBack();
  await expect(page).toHaveURL(url);
  await expect(dialog).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await dialog.getByRole("button", { name: "閉じる", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "振り返る（任意）", exact: true }),
  ).toBeFocused();
  expect(await image(page)).toBe(bitmap);
  expect((await records(page)).reflections).toHaveLength(0);
});

test("過去の同じ推しの作品を本人が選ぶ場合だけ比較質問を出す", async ({
  page,
}) => {
  await register(page, "同じ推し");
  const previousURL = await start(page, "前の一枚");
  await draw(page);
  await saved(page);
  await register(page, "別の推し");
  await start(page, "別の推しの絵");
  await draw(page);
  await saved(page);
  await page.goto("#/characters");
  await page
    .locator("article")
    .filter({
      has: page.getByRole("heading", { name: "同じ推し", exact: true }),
    })
    .getByRole("button", { name: "この推しを選ぶ" })
    .click();
  await start(page, "今回の一枚");
  await draw(page);
  const dialog = await open(page);
  await expect(
    dialog.getByText("前回と比べて変わったところは？", { exact: true }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "回答を保存", exact: true }).click();
  await dialog
    .getByRole("button", {
      name: "前の作品との違いを考える（任意）",
      exact: true,
    })
    .click();
  const selector = dialog.getByLabel("比べてみる前の作品", { exact: true });
  await expect(selector.locator("option")).toHaveCount(1);
  await expect(selector.locator("option")).toContainText("前の一枚");
  await expect(
    dialog.getByRole("img", { name: "比べてみる前の作品", exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "特に変わらない", exact: true })
    .click();
  await dialog.getByRole("button", { name: "回答を保存", exact: true }).click();
  await expect(
    dialog.getByText("特に変わらない", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("group", { name: "今回の質問", exact: true }),
  ).toHaveCount(0);
  const response = (await records(page)).reflections.find(
    (r) => r.questionId === "change",
  )!;
  expect(response.comparedArtworkId).toBe(
    new URL(previousURL).hash.split("/").at(-1),
  );
});

test("過去作品なし・推しなしでは比較を勧めず、ヒントは一時描画でも使える", async ({
  page,
}) => {
  await start(page);
  const dialog = await open(page);
  await dialog.getByRole("button", { name: "回答を保存", exact: true }).click();
  await expect(
    dialog.getByRole("button", {
      name: "前の作品との違いを考える（任意）",
      exact: true,
    }),
  ).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "振り返りを終える", exact: true })
    .click();
  await page.goto("#/draw/new");
  await expect(
    page.getByRole("button", { name: "振り返る（任意）", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "描くヒント（任意）", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "描くヒント", exact: true }),
  ).toBeVisible();
});
