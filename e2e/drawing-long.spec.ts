import { test, expect } from "@playwright/test";

test("5分間の反復描画・定期保存・履歴上限・再開", async ({ page }, info) => {
  test.setTimeout(380_000);
  await page.setViewportSize({ width: 375, height: 812 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("#/new");
  await page
    .getByRole("button", { name: "テーマを決めずに進む", exact: true })
    .click();
  const pen = page.getByRole("button", { name: "ペン", exact: true });
  await expect(pen).toBeEnabled();
  const canvas = page.getByLabel("お絵描きキャンバス");
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await canvas.evaluate((node) => {
    const samples: number[] = [];
    (window as unknown as { drawingFrames: number[] }).drawingFrames = samples;
    node.addEventListener(
      "pointermove",
      () => {
        const received = performance.now();
        requestAnimationFrame(() => samples.push(performance.now() - received));
      },
      true,
    );
  });
  const snapshot = () =>
    page.evaluate(
      () =>
        new Promise<{ revision: number; assets: number }>((resolve, reject) => {
          const request = indexedDB.open("suki-sketch");
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction(["artworks", "assets"]);
            const artworks = tx.objectStore("artworks").getAll();
            const assets = tx.objectStore("assets").count();
            tx.oncomplete = () => {
              resolve({
                revision: artworks.result[0].revision,
                assets: assets.result,
              });
              db.close();
            };
            tx.onerror = () => reject(tx.error);
          };
        }),
    );
  const started = Date.now();
  let strokes = 0,
    checkpoint = started,
    revision = 1;
  while (Date.now() - started < 300_000) {
    const y = box.y + box.height * (0.1 + (strokes % 35) * 0.022);
    await page.mouse.move(box.x + box.width * 0.12, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.88, y, { steps: 5 });
    await page.mouse.up();
    strokes++;
    if (Date.now() - checkpoint > 20_000) {
      const saved = await snapshot();
      expect(saved.revision).toBeGreaterThan(revision);
      expect(saved.assets).toBe(2);
      revision = saved.revision;
      checkpoint = Date.now();
    }
    // 入力間隔を一定に近づけ、5分間の保存・メモリー挙動を確認する。
    await page.waitForTimeout(180);
  }
  const elapsedMs = Date.now() - started;
  expect(strokes).toBeGreaterThan(300);
  await page.getByRole("button", { name: "途中で保存", exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText("保存済み");
  const frames = await page.evaluate(
    () => (window as unknown as { drawingFrames: number[] }).drawingFrames,
  );
  frames.sort((a, b) => a - b);
  const stats = {
    elapsedMs,
    strokes,
    saved: await snapshot(),
    frameSamples: frames.length,
    eventToNextFrameP95Ms: frames[Math.floor(frames.length * 0.95)],
    note: "Chromiumのイベント受信から次のrequestAnimationFrameまで。実機の入力から画面表示までの遅延ではない。",
  };
  await info.attach("drawing-stress.json", {
    body: JSON.stringify(stats, null, 2),
    contentType: "application/json",
  });
  console.log(JSON.stringify(stats));
  let undone = 0;
  const undo = page.getByRole("button", { name: "取り消し", exact: true });
  while (await undo.isEnabled()) {
    await undo.click();
    expect(++undone).toBeLessThanOrEqual(9);
  }
  expect(undone).toBe(9);
  await page.getByRole("button", { name: "途中で保存", exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText("保存済み");
  const before = await canvas.evaluate((node) =>
    (node as HTMLCanvasElement).toDataURL(),
  );
  await page.reload();
  await expect(pen).toBeEnabled();
  expect(
    await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL()),
  ).toBe(before);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: info.outputPath("drawing-long-375.png"),
    fullPage: true,
  });
});
