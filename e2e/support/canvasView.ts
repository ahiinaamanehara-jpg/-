import { expect, type Page } from "@playwright/test";

export async function startDrawing(page: Page, tracing = false) {
  await page.goto("#/new");
  if (tracing) {
    await page
      .getByRole("radio", { name: "下絵をなぞって描く", exact: true })
      .check();
    const png = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = c.height = 16;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "red";
      ctx.fillRect(0, 0, 16, 16);
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
    .getByRole("button", { name: "このテーマで進む", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
}

/** ブラウザーが計算したCSS行列で、紙の点を実際の画面位置へ写す。 */
export async function paperPosition(page: Page, x: number, y: number) {
  return page.locator(".canvas-transform").evaluate(
    (el, p) => {
      const style = getComputedStyle(el),
        frame = el.parentElement!,
        box = frame.getBoundingClientRect();
      const width = parseFloat(style.width),
        height = parseFloat(style.height);
      const origin = style.transformOrigin.split(" ").map(parseFloat);
      const point = new DOMMatrix(style.transform).transformPoint(
        new DOMPoint(p.x * width - origin[0], p.y * height - origin[1]),
      );
      return {
        x: box.left + frame.clientLeft + origin[0] + point.x,
        y: box.top + frame.clientTop + origin[1] + point.y,
      };
    },
    { x, y },
  );
}

export const bitmap = (page: Page) =>
  page
    .getByLabel("お絵描きキャンバス")
    .evaluate((c) => (c as HTMLCanvasElement).toDataURL());
export const canvasPixel = (page: Page, x = 480, y = 480) =>
  page
    .getByLabel("お絵描きキャンバス")
    .evaluate(
      (c, p) =>
        Array.from(
          (c as HTMLCanvasElement)
            .getContext("2d")!
            .getImageData(p.x, p.y, 1, 1).data,
        ),
      { x, y },
    );

export async function paintLine(page: Page, y = 0.5) {
  await page
    .getByRole("group", { name: "キャンバスの表示範囲", exact: true })
    .scrollIntoViewIfNeeded();
  const from = await paperPosition(page, 0.35, y),
    to = await paperPosition(page, 0.65, y);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await expect(
    page.getByRole("button", { name: "ペン", exact: true }),
  ).toBeEnabled();
}

export const viewState = (page: Page) =>
  page.locator(".canvas-transform").evaluate((el) => {
    const m = new DOMMatrix(getComputedStyle(el).transform);
    return {
      scale: Math.hypot(m.a, m.b),
      rotation: Math.atan2(m.b, m.a),
      x: m.e,
      y: m.f,
    };
  });

export async function revision(page: Page) {
  return page.evaluate(
    () =>
      new Promise<unknown>((resolve, reject) => {
        const r = indexedDB.open("suki-sketch");
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction("artworks"),
            request = tx.objectStore("artworks").getAll();
          tx.oncomplete = () => {
            db.close();
            resolve(request.result);
          };
          tx.onabort = () => reject(tx.error);
        };
      }),
  );
}
