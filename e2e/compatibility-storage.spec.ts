import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  observeStorageErrors,
  expectSaved,
} from "./support/storageDiagnostics";

test("独立した永続プロファイルで画像を保存し、再読み込みで復元できる", async ({
  playwright,
  browserName,
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
    expect(
      await canvas.evaluate((c) => (c as HTMLCanvasElement).toDataURL()),
    ).toBe(before);
  } finally {
    await context?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
