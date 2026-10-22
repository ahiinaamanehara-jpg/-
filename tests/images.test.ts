import { describe, expect, it } from "vitest";
import {
  inspectImageDimensions,
  prepareReferenceImage,
  MAX_REFERENCE_BYTES,
} from "../src/data/images";

function png(width: number, height: number) {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([73, 72, 68, 82], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes.buffer;
}
function jpeg(width: number, height: number, app1 = false) {
  const bytes = [255, 216];
  if (app1) bytes.push(255, 225, 0, 10, 69, 120, 105, 102, 0, 0, 0, 0);
  bytes.push(
    255,
    192,
    0,
    11,
    8,
    height >> 8,
    height & 255,
    width >> 8,
    width & 255,
    1,
    1,
    17,
    0,
    255,
    218,
    0,
    8,
    1,
    1,
    0,
    0,
    63,
    0,
    255,
    217,
  );
  return new Uint8Array(bytes).buffer;
}
function webp(chunk: string, payload: Uint8Array) {
  const bytes = new Uint8Array(20 + payload.length + (payload.length % 2));
  bytes.set([82, 73, 70, 70]);
  bytes.set([87, 69, 66, 80], 8);
  bytes.set(
    [...chunk].map((c) => c.charCodeAt(0)),
    12,
  );
  const view = new DataView(bytes.buffer);
  view.setUint32(4, bytes.length - 8, true);
  view.setUint32(16, payload.length, true);
  bytes.set(payload, 20);
  return bytes.buffer;
}

describe("画像をデコードする前のヘッダー検証", () => {
  it("PNGの寸法を取得する", () =>
    expect(inspectImageDimensions(png(320, 480), "image/png")).toEqual({
      width: 320,
      height: 480,
    }));
  it.each([false, true])(
    "JPEGのSOF寸法を取得しEXIFセグメントを安全に飛ばす (%s)",
    (app1) =>
      expect(
        inspectImageDimensions(jpeg(640, 480, app1), "image/jpeg"),
      ).toEqual({ width: 640, height: 480 }),
  );
  it("WebP VP8の寸法を取得する", () => {
    const payload = new Uint8Array([0, 0, 0, 0x9d, 1, 0x2a, 0x80, 2, 0xe0, 1]);
    expect(inspectImageDimensions(webp("VP8 ", payload), "image/webp")).toEqual(
      { width: 640, height: 480 },
    );
  });
  it("WebP VP8Lのビットに格納された寸法を取得する", () => {
    const payload = new Uint8Array(5);
    payload[0] = 0x2f;
    new DataView(payload.buffer).setUint32(1, (639 | (479 << 14)) >>> 0, true);
    expect(inspectImageDimensions(webp("VP8L", payload), "image/webp")).toEqual(
      { width: 640, height: 480 },
    );
  });
  it("WebP VP8Xの24bit寸法を取得する", () => {
    const payload = new Uint8Array(10);
    payload.set([127, 2, 0], 4);
    payload.set([223, 1, 0], 7);
    expect(inspectImageDimensions(webp("VP8X", payload), "image/webp")).toEqual(
      { width: 640, height: 480 },
    );
  });
  it("MIME偽装を拒否する", () =>
    expect(() => inspectImageDimensions(png(10, 10), "image/jpeg")).toThrow(
      /読み取れません/,
    ));
  it.each(["image/svg+xml", "image/heic", "image/gif", ""])(
    "非対応MIMEを拒否する (%s)",
    (mime) =>
      expect(() => inspectImageDimensions(png(10, 10), mime)).toThrow(
        /PNG・JPEG・WebP/,
      ),
  );
  it.each([0, 1, 2, 10, 20, 32])(
    "途切れたPNGヘッダーを拒否する (%i)",
    (length) =>
      expect(() =>
        inspectImageDimensions(png(10, 10).slice(0, length), "image/png"),
      ).toThrow(/読み取れません/),
  );
  it("JPEGセグメント長の偽装を拒否する", () => {
    const bytes = new Uint8Array(jpeg(10, 10, true));
    bytes[4] = 255;
    bytes[5] = 255;
    expect(() => inspectImageDimensions(bytes.buffer, "image/jpeg")).toThrow(
      /読み取れません/,
    );
  });
  it("寸法のないJPEGを拒否する", () =>
    expect(() =>
      inspectImageDimensions(
        new Uint8Array([255, 216, 255, 217]).buffer,
        "image/jpeg",
      ),
    ).toThrow(/読み取れません/));
  it("途切れたWebPを拒否する", () =>
    expect(() =>
      inspectImageDimensions(
        webp("VP8X", new Uint8Array(10)).slice(0, 25),
        "image/webp",
      ),
    ).toThrow(/読み取れません/));
  it.each([
    [0, 50],
    [50, 0],
  ])("ゼロの寸法を拒否する (%i x %i)", (w, h) =>
    expect(() => inspectImageDimensions(png(w, h), "image/png")).toThrow(
      /読み取れません/,
    ),
  );
  it("16メガピクセルを超える画像をデコード前に拒否する", () =>
    expect(() => inspectImageDimensions(png(5000, 4000), "image/png")).toThrow(
      /1,600万画素/,
    ));
  it("16メガピクセル境界を受け付ける", () =>
    expect(inspectImageDimensions(png(4000, 4000), "image/png")).toEqual({
      width: 4000,
      height: 4000,
    }));
});

describe("ファイルの事前検証", () => {
  it("10MiB超を読込・デコード前に拒否する", async () => {
    const file = { type: "image/png", size: MAX_REFERENCE_BYTES + 1 } as File;
    await expect(prepareReferenceImage(file)).rejects.toThrow(/10MiB/);
  });
  it("空ファイルを拒否する", async () =>
    await expect(
      prepareReferenceImage(new File([], "empty.png", { type: "image/png" })),
    ).rejects.toThrow(/読み取れません/));
  it("HEICは変換案内を表示する", async () =>
    await expect(
      prepareReferenceImage(
        new File(["test"], "photo.heic", { type: "image/heic" }),
      ),
    ).rejects.toThrow(/変換してから/));
});
