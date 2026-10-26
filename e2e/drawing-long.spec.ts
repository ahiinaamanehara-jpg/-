import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { DRAWING_SAVE_TIMEOUT_MS } from "./support/storageDiagnostics";
import { paperPosition, viewState, paintLine } from "./support/canvasView";

const withGuide = process.env.PLAYWRIGHT_TRACING_STRESS === "1";
const withView = process.env.PLAYWRIGHT_VIEW_STRESS === "1";
const withWorkspace = process.env.PLAYWRIGHT_WORKSPACE_STRESS === "1";
const withLayers = process.env.PLAYWRIGHT_LAYER_STRESS === "1";

test(`5分間の反復描画・定期保存・履歴上限・再開${withGuide ? "（1600pxの下絵あり）" : ""}${withView ? "（表示156%・30度）" : ""}${withWorkspace ? "（専用画面）" : ""}${withLayers ? "（5レイヤー）" : ""}`, async ({
  page,
}, info) => {
  test.setTimeout(380_000);
  await page.setViewportSize({ width: 375, height: 812 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("#/new");
  if (withGuide) {
    await page
      .getByRole("radio", { name: "下絵をなぞって描く", exact: true })
      .check();
    const png = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 1600;
      c.height = 800;
      const ctx = c.getContext("2d")!;
      ctx.strokeStyle = "#aa3322";
      ctx.lineWidth = 12;
      ctx.strokeRect(200, 120, 1200, 560);
      return c.toDataURL().split(",")[1];
    });
    await page
      .getByLabel("下絵にする画像を選ぶ", { exact: true })
      .setInputFiles({
        name: "guide.png",
        mimeType: "image/png",
        buffer: Buffer.from(png, "base64"),
      });
    await expect(
      page.getByRole("img", { name: "選んだ下絵", exact: true }),
    ).toBeVisible();
  }
  await page
    .getByRole("button", { name: "テーマを決めずに進む", exact: true })
    .click();
  const pen = page.getByRole("button", { name: "ペン", exact: true });
  await expect(pen).toBeEnabled();
  if (withLayers) {
    await paintLine(page, 0.2);
    await page.locator(".layer-controls summary").click();
    for (let i = 0; i < 4; i++) {
      await page
        .getByRole("button", { name: "レイヤーを追加", exact: true })
        .click();
      await paintLine(page, 0.3 + i * 0.1);
    }
    await page.locator(".layer-controls summary").click();
  }
  if (withWorkspace)
    await page
      .getByRole("button", { name: "画面いっぱいで描く", exact: true })
      .click();
  if (withView) {
    if (withWorkspace)
      await page.getByRole("button", { name: "道具設定", exact: true }).click();
    await page.locator(".canvas-view-controls summary").click();
    for (let i = 0; i < 2; i++)
      await page
        .getByRole("button", { name: "表示を拡大", exact: true })
        .click();
    for (let i = 0; i < 2; i++)
      await page.getByRole("button", { name: "右に回す", exact: true }).click();
    await page.locator(".canvas-view-controls summary").click();
    if (withWorkspace)
      await page
        .getByRole("button", { name: "設定を閉じる", exact: true })
        .click();
  }
  const saveStatus = page.locator(
    withWorkspace ? ".workspace-status" : ".save-status",
  );
  const canvas = page.getByLabel("お絵描きキャンバス");
  const viewport = page.getByRole("group", {
    name: "キャンバスの表示範囲",
    exact: true,
  });
  await viewport.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await viewport.evaluate((node) => {
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
    const from = withView
      ? await paperPosition(page, 0.35, 0.3 + (strokes % 20) * 0.02)
      : { x: box.x + box.width * 0.12, y };
    const to = withView
      ? await paperPosition(page, 0.65, 0.3 + (strokes % 20) * 0.02)
      : { x: box.x + box.width * 0.88, y };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 5 });
    await page.mouse.up();
    strokes++;
    if (Date.now() - checkpoint > 20_000) {
      const saved = await snapshot();
      expect(saved.revision).toBeGreaterThan(revision);
      expect(saved.assets).toBe(2 + (withGuide ? 1 : 0) + (withLayers ? 5 : 0));
      revision = saved.revision;
      checkpoint = Date.now();
    }
    // 入力間隔を一定に近づけ、5分間の保存・メモリー挙動を確認する。
    await page.waitForTimeout(180);
  }
  const elapsedMs = Date.now() - started;
  expect(strokes).toBeGreaterThan(300);
  await page.getByRole("button", { name: "途中で保存", exact: true }).click();
  await expect(saveStatus).toHaveText("保存済み", {
    timeout: DRAWING_SAVE_TIMEOUT_MS,
  });
  const frames = await page.evaluate(
    () => (window as unknown as { drawingFrames: number[] }).drawingFrames,
  );
  frames.sort((a, b) => a - b);
  const stats = {
    withLayers,
    withWorkspace,
    withView,
    withGuide,
    elapsedMs,
    strokes,
    saved: await snapshot(),
    frameSamples: frames.length,
    eventToNextFrameP95Ms: frames[Math.floor(frames.length * 0.95)],
    note: "Chromiumのイベント受信から次のrequestAnimationFrameまで。実機の入力から画面表示までの遅延ではない。",
  };
  const report = info.outputPath("drawing-stress.json");
  await writeFile(report, JSON.stringify(stats, null, 2));
  await info.attach("drawing-stress.json", {
    path: report,
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
  await expect(saveStatus).toHaveText("保存済み", {
    timeout: DRAWING_SAVE_TIMEOUT_MS,
  });
  const before = await canvas.evaluate((node) =>
    (node as HTMLCanvasElement).toDataURL(),
  );
  await page.reload();
  if (withView)
    expect(await viewState(page)).toEqual({
      scale: 1,
      rotation: 0,
      x: 0,
      y: 0,
    });
  await expect(pen).toBeEnabled();
  if (withGuide) await expect(page.locator(".tracing-underlay")).toBeVisible();
  expect(
    await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL()),
  ).toBe(before);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: info.outputPath("drawing-long-375.png"),
    fullPage: true,
  });
});
