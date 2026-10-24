import {
  devices,
  expect,
  test,
  type Page,
  type BrowserContext,
} from "@playwright/test";
import { DRAWING_SAVE_TIMEOUT_MS } from "./support/storageDiagnostics";
import { expectCanvasUnchanged } from "./support/canvasSnapshot";

test.use({ ...devices["Pixel 7"], viewport: { width: 360, height: 800 } });

async function touchLine(page: Page, context: BrowserContext) {
  const canvas = page.getByLabel("お絵描きキャンバス");
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!,
    cdp = await context.newCDPSession(page);
  const point = (x: number) => ({
    id: 1,
    x: box.x + box.width * x,
    y: box.y + box.height * 0.5,
  });
  try {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [point(0.2)],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [point(0.5)],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [point(0.8)],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } finally {
    await cdp.detach();
  }
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
}

test("Android相当の指入力が下絵を透過してキャンバスへ届き、消しゴム・取消・保存再開できる", async ({
  page,
  context,
}, info) => {
  await page.goto("#/new");
  await page
    .getByRole("radio", { name: "下絵をなぞって描く", exact: true })
    .check();
  const base64 = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 16;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "red";
    ctx.fillRect(0, 0, 16, 16);
    return c.toDataURL().split(",")[1];
  });
  await page.getByLabel("下絵にする画像を選ぶ", { exact: true }).setInputFiles({
    name: "guide.png",
    mimeType: "image/png",
    buffer: Buffer.from(base64, "base64"),
  });
  await expect(
    page.getByRole("img", { name: "選んだ下絵", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "このテーマで進む", exact: true })
    .tap();
  const pen = page.getByRole("button", { name: "ペン", exact: true });
  await expect(pen).toBeEnabled();
  await expect(page.locator(".tracing-underlay")).toHaveCSS(
    "pointer-events",
    "none",
  );
  const canvas = page.getByLabel("お絵描きキャンバス");
  const alpha = () =>
    canvas.evaluate(
      (c) =>
        (c as HTMLCanvasElement).getContext("2d")!.getImageData(480, 480, 1, 1)
          .data[3],
    );
  expect(await alpha()).toBe(0);
  await touchLine(page, context);
  expect(await alpha()).toBe(255);
  const drawn = await canvas.evaluate((c) =>
    (c as HTMLCanvasElement).toDataURL(),
  );
  // システムChromiumのCDPドラッグ後はtapがclickを生成しないため、後続UIはclickで区別する。
  await page.getByRole("button", { name: "消しゴム", exact: true }).click();
  await touchLine(page, context);
  expect(await alpha()).toBe(0);
  await page.getByRole("button", { name: "取り消し", exact: true }).click();
  await expectCanvasUnchanged(page, drawn);
  await page.getByRole("button", { name: "途中で保存", exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText("保存済み", {
    timeout: DRAWING_SAVE_TIMEOUT_MS,
  });
  await page.reload();
  await expect(pen).toBeEnabled();
  await expectCanvasUnchanged(page, drawn);
  await expect(page.locator(".tracing-underlay")).toBeVisible();
  await canvas.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("tracing-touch-360.png") });
});
