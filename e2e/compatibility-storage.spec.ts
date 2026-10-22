import { test, expect } from "@playwright/test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { PNG } from "pngjs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  observeStorageErrors,
  expectSaved,
} from "./support/storageDiagnostics";
import { expectCanvasUnchanged } from "./support/canvasSnapshot";

test("独立した永続プロファイルで画像を保存し、再読み込みで復元できる", async ({
  playwright,
  browserName,
  context: isolated,
}, info) => {
  const directory = await mkdtemp(join(tmpdir(), "workshop-compat-"));
  let context;
  try {
    context = await playwright[browserName].launchPersistentContext(directory, {
      ...info.project.use.launchOptions,
      headless: true,
      viewport: { width: 390, height: 844 },
    });
    const page = context.pages()[0] ?? (await context.newPage());
    await observeStorageErrors(page);
    await page.goto(new URL("#/new", String(info.project.use.baseURL)).href);
    await page
      .getByRole("button", { name: "テーマを決めずに進む", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "ペン", exact: true }),
    ).toBeEnabled();
    const canvas = page.getByLabel("お絵描きキャンバス");
    await canvas.scrollIntoViewIfNeeded();
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.5, {
      steps: 5,
    });
    await page.mouse.up();
    const before = await canvas.evaluate((c) =>
      (c as HTMLCanvasElement).toDataURL(),
    );
    await page.getByRole("button", { name: "途中で保存", exact: true }).click();
    await expectSaved(page);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "ペン", exact: true }),
    ).toBeEnabled();
    await expectCanvasUnchanged(page, before);
    if (browserName === "webkit") {
      const privatePage = await isolated.newPage();
      await observeStorageErrors(privatePage);
      await privatePage.goto(
        new URL("#/new", String(info.project.use.baseURL)).href,
      );
      await privatePage
        .getByRole("button", { name: "テーマを決めずに進む", exact: true })
        .click();
      await expect(
        privatePage.getByRole("button", { name: "ペン", exact: true }),
      ).toBeEnabled();
      const privateCanvas = privatePage.getByLabel("お絵描きキャンバス");
      await privateCanvas.scrollIntoViewIfNeeded();
      const box = (await privateCanvas.boundingBox())!;
      await privatePage.mouse.move(
        box.x + box.width * 0.2,
        box.y + box.height * 0.5,
      );
      await privatePage.mouse.down();
      await privatePage.mouse.move(
        box.x + box.width * 0.8,
        box.y + box.height * 0.5,
        { steps: 5 },
      );
      await privatePage.mouse.up();
      const drawing = await privateCanvas.evaluate((c) =>
        (c as HTMLCanvasElement).toDataURL(),
      );
      await privatePage
        .getByRole("button", { name: "途中で保存", exact: true })
        .click();
      await expect
        .poll(() => privatePage.locator(".save-status").textContent())
        .toMatch(/^(保存済み|保存できません)$/);
      if (
        (await privatePage.locator(".save-status").textContent()) === "保存済み"
      ) {
        await privatePage.reload();
        await expect(
          privatePage.getByRole("button", { name: "ペン", exact: true }),
        ).toBeEnabled();
        await expectCanvasUnchanged(privatePage, drawing);
      } else {
        const errors = await privatePage.evaluate(
          () =>
            (
              window as unknown as {
                storageDiagnostics: Array<{ name: string; message: string }>;
              }
            ).storageDiagnostics,
        );
        expect(errors.length).toBeGreaterThan(0);
        expect(
          errors.every(
            (e) => e.name === "UnknownError" && e.message.includes("Blob/File"),
          ),
          JSON.stringify(errors),
        ).toBe(true);
        await expectCanvasUnchanged(privatePage, drawing);
        const download = privatePage.waitForEvent("download");
        await privatePage
          .getByRole("button", { name: "PNGを書き出す", exact: true })
          .click();
        const png = PNG.sync.read(
          await readFile((await (await download).path())!),
        );
        expect([png.width, png.height]).toEqual([960, 960]);
        const center = (480 * 960 + 480) * 4;
        expect(png.data[center + 3]).toBe(255);
        expect(Array.from(png.data.subarray(center, center + 3))).not.toEqual([
          255, 255, 255,
        ]);
      }
    }
  } finally {
    await context?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
