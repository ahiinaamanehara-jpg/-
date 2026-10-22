import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { comparePngPixels } from "../e2e/support/pngComparison";

function image(rgba: number[], width = 1) {
  const png = new PNG({ width, height: 1 });
  png.data.set(rgba);
  return png;
}

describe("保存画像の内容の比較", () => {
  it("PNGのフィルターが異なっても同じ画素を同一と扱う", () => {
    const png = image([18, 52, 171, 255, 0, 0, 0, 0], 2);
    const a = PNG.sync.write(png, { filterType: 0 }),
      b = PNG.sync.write(png, { filterType: 4 });
    expect(a.equals(b)).toBe(false);
    expect(comparePngPixels(a, b).visibleChangedPixels).toBe(0);
  });
  it("線の透明化を見逃さない", () => {
    const difference = comparePngPixels(
      PNG.sync.write(image([18, 52, 171, 255])),
      PNG.sync.write(image([18, 52, 171, 0])),
    );
    expect(difference.visibleChangedPixels).toBe(1);
    expect(difference.maxAlphaDifference).toBe(255);
  });
  it("不透明な画素の1段階の色変化も検出する", () => {
    const difference = comparePngPixels(
      PNG.sync.write(image([18, 52, 171, 255])),
      PNG.sync.write(image([19, 52, 171, 255])),
    );
    expect(difference.visibleChangedPixels).toBe(1);
    expect(difference.maxVisibleDifference).toBe(1);
  });
  it("完全に透明な画素の未使用RGBだけの差を区別する", () => {
    const difference = comparePngPixels(
      PNG.sync.write(image([0, 0, 0, 0])),
      PNG.sync.write(image([200, 100, 50, 0])),
    );
    expect(difference.changedPixels).toBe(1);
    expect(difference.visibleChangedPixels).toBe(0);
  });
  it("画像の寸法が違う場合は不一致とする", () => {
    expect(
      comparePngPixels(
        PNG.sync.write(image([0, 0, 0, 0])),
        PNG.sync.write(image([0, 0, 0, 0, 0, 0, 0, 0], 2)),
      ).sameSize,
    ).toBe(false);
  });
});
