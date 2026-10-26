import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import {
  comparePngPixels,
  compositeEdgeMask,
} from "../e2e/support/pngComparison";

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
    expect(difference.materialChangedPixels).toBe(1);
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
  it("alphaを保った半透明色の1段階の丸めを区別する", () => {
    const difference = comparePngPixels(
      PNG.sync.write(image([18, 52, 171, 128])),
      PNG.sync.write(image([19, 52, 171, 128])),
    );
    expect(difference.visibleChangedPixels).toBe(1);
    expect(difference.materialChangedPixels).toBe(0);
  });
  it("半透明のalphaが変わったら1段階でも検出する", () => {
    const difference = comparePngPixels(
      PNG.sync.write(image([18, 52, 171, 128])),
      PNG.sync.write(image([18, 52, 171, 129])),
    );
    expect(difference.materialChangedPixels).toBe(1);
  });
  it("半透明でも白背景で1段階を超える色変化を検出する", () => {
    const difference = comparePngPixels(
      PNG.sync.write(image([18, 52, 171, 128])),
      PNG.sync.write(image([22, 52, 171, 128])),
    );
    expect(difference.maxVisibleDifference).toBe(2);
    expect(difference.materialChangedPixels).toBe(1);
  });
  it("2枚のPNGから再合成した半透明の縁だけは2段階までを区別できる", () => {
    const difference = comparePngPixels(
      PNG.sync.write(image([18, 52, 171, 128])),
      PNG.sync.write(image([22, 52, 171, 128])),
      { translucentRounding: 2 },
    );
    expect(difference.maxVisibleDifference).toBe(2);
    expect(difference.materialChangedPixels).toBe(0);
  });
  it.each([
    [
      [18, 52, 171, 128],
      [24, 52, 171, 128],
    ],
    [
      [18, 52, 171, 128],
      [18, 52, 171, 129],
    ],
    [
      [18, 52, 171, 255],
      [19, 52, 171, 255],
    ],
  ])("再合成でも2段階超過・alpha・不透明色の変化は検出する: %#", (a, b) => {
    expect(
      comparePngPixels(PNG.sync.write(image(a)), PNG.sync.write(image(b)), {
        translucentRounding: 2,
      }).materialChangedPixels,
    ).toBe(1);
  });
  it("入力の半透明部分だけを特定し、上の不透明画素に隠れた縁を除く", () => {
    expect(
      Array.from(
        compositeEdgeMask([
          image([0, 0, 0, 128, 0, 0, 0, 128, 0, 0, 0, 255], 3),
          image([0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 128], 3),
        ]),
      ),
    ).toEqual([1, 0, 1]);
  });
  it("入力から特定した縁だけは不透明な合成結果でも2段階を区別する", () => {
    const difference = comparePngPixels(
      PNG.sync.write(image([18, 52, 171, 255, 18, 52, 171, 255], 2)),
      PNG.sync.write(image([20, 52, 171, 255, 19, 52, 171, 255], 2)),
      { translucentRounding: 2, compositeEdges: new Uint8Array([1, 0]) },
    );
    expect(difference.materialChangedPixels).toBe(1);
    expect(difference.materialSamples[0].x).toBe(1);
  });
  it.each([
    [
      [18, 52, 171, 255],
      [21, 52, 171, 255],
    ],
    [
      [18, 52, 171, 254],
      [18, 52, 171, 255],
    ],
  ])("入力の縁でも2段階超過とalphaの変化は検出する: %#", (a, b) => {
    expect(
      comparePngPixels(PNG.sync.write(image(a)), PNG.sync.write(image(b)), {
        translucentRounding: 2,
        compositeEdges: new Uint8Array([1]),
      }).materialChangedPixels,
    ).toBe(1);
  });
  it("異なる寸法のマスクを誤って適用しない", () => {
    const png = PNG.sync.write(image([18, 52, 171, 255]));
    expect(() =>
      comparePngPixels(png, png, { compositeEdges: new Uint8Array(2) }),
    ).toThrow("寸法");
    expect(() => compositeEdgeMask([])).toThrow("ありません");
    expect(() =>
      compositeEdgeMask([image([0, 0, 0, 0]), image([], 2)]),
    ).toThrow("寸法");
  });
});
