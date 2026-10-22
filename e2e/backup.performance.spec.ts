import { expect, test } from "@playwright/test";
import { stat, writeFile } from "node:fs/promises";

test("約49MiBのバックアップを作成・検証・追加復元できる", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  await page.goto("#/settings/data");
  await expect(
    page.getByText("推し0件・作品0件・振り返り0件", { exact: true }),
  ).toBeVisible();
  const seeded = await page.evaluate(async () => {
    async function noise(height: number) {
      const canvas = document.createElement("canvas");
      canvas.width = 1600;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!,
        pixels = ctx.createImageData(1600, height);
      const bytes = new Uint8Array(pixels.data.buffer);
      for (let i = 0; i < bytes.length; i += 65536)
        crypto.getRandomValues(bytes.subarray(i, i + 65536));
      ctx.putImageData(pixels, 0, 0);
      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((b) => resolve(b!), "image/png"),
      );
      canvas.width = canvas.height = 0;
      return blob;
    }
    const full = await noise(1600),
      target = 49 * 1024 * 1024;
    const images: Array<{ blob: Blob; height: number }> = [];
    let size = 0;
    while (size + full.size < target) {
      images.push({ blob: full, height: 1600 });
      size += full.size;
    }
    const height = Math.max(
      1,
      Math.floor((1600 * (target - size)) / full.size) - 4,
    );
    const last = await noise(height);
    images.push({ blob: last, height });
    size += last.size;
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("suki-sketch");
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["characters", "assets"], "readwrite"),
        date = new Date().toISOString();
      for (let i = 0; i < images.length; i++) {
        const { blob, height } = images[i];
        tx.objectStore("assets").add({
          id: `large-asset-${i}`,
          kind: "reference",
          mime: "image/png",
          size: blob.size,
          width: 1600,
          height,
          blob,
        });
        tx.objectStore("characters").add({
          id: `large-character-${i}`,
          name: `大きな画像${i}`,
          memo: "容量の検証",
          referenceAssetId: `large-asset-${i}`,
          revision: 1,
          createdAt: date,
          updatedAt: date,
        });
      }
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    const hashes = await Promise.all(
      images.map(async ({ blob }) =>
        Array.from(
          new Uint8Array(
            await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
          ),
        ),
      ),
    );
    return { size, count: images.length, hashes };
  });
  expect(seeded.size).toBeGreaterThan(48 * 1024 * 1024);
  expect(seeded.size).toBeLessThan(50 * 1024 * 1024);
  await page.evaluate(() => {
    const samples: number[] = [];
    let last = performance.now();
    setInterval(() => {
      const now = performance.now();
      samples.push(now - last);
      last = now;
    }, 16);
    (window as unknown as { gaps: number[] }).gaps = samples;
  });
  const start = Date.now(),
    downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "全データをバックアップ", exact: true })
    .click();
  const path = (await (await downloaded).path())!;
  await expect(
    page.getByRole("button", { name: "全データをバックアップ", exact: true }),
  ).toBeEnabled();
  const exportMs = Date.now() - start,
    bytes = await stat(path);
  const inspectStart = Date.now();
  await page
    .getByLabel("バックアップZIPを選ぶ", { exact: true })
    .setInputFiles(path);
  await expect(
    page.getByRole("heading", { name: "追加する内容", exact: true }),
  ).toBeVisible({ timeout: 45000 });
  const inspectMs = Date.now() - inspectStart,
    restoreStart = Date.now();
  await page
    .getByRole("button", { name: "この内容を追加する", exact: true })
    .click();
  await expect(page.getByText(/追加復元しました。/)).toBeVisible({
    timeout: 30000,
  });
  const restoreMs = Date.now() - restoreStart;
  const actual = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("suki-sketch");
      r.onsuccess = () => resolve(r.result);
    });
    const data = await new Promise<{
      characters: Array<{ name: string; referenceAssetId: string }>;
      assets: Array<{ id: string; blob: Blob }>;
    }>((resolve) => {
      const tx = db.transaction(["characters", "assets"]),
        characters = tx.objectStore("characters").getAll(),
        assets = tx.objectStore("assets").getAll();
      tx.oncomplete = () =>
        resolve({ characters: characters.result, assets: assets.result });
    });
    db.close();
    const restored = data.characters
      .filter((c) => !c.referenceAssetId.startsWith("large-asset-"))
      .sort((a, b) => a.name.localeCompare(b.name));
    const hashes = await Promise.all(
      restored.map(async (c) =>
        Array.from(
          new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              await data.assets
                .find((a) => a.id === c.referenceAssetId)!
                .blob.arrayBuffer(),
            ),
          ),
        ),
      ),
    );
    const gaps = (window as unknown as { gaps: number[] }).gaps;
    return {
      hashes,
      count: data.characters.length,
      samples: gaps.length,
      maxGapMs: Math.max(...gaps),
    };
  });
  expect(actual.count).toBe(seeded.count * 2);
  expect(actual.hashes).toEqual(seeded.hashes);
  expect(actual.samples).toBeGreaterThan(5);
  const report = info.outputPath("backup-performance.json");
  await writeFile(
    report,
    JSON.stringify(
      {
        sourceMiB: seeded.size / 1024 / 1024,
        zipMiB: bytes.size / 1024 / 1024,
        exportMs,
        inspectMs,
        restoreMs,
        heartbeatSamples: actual.samples,
        maxGapMs: actual.maxGapMs,
      },
      null,
      2,
    ),
  );
  await info.attach("backup-performance.json", {
    path: report,
    contentType: "application/json",
  });
  expect(actual.maxGapMs).toBeLessThan(2000);
});
