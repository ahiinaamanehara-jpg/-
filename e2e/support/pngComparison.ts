import { PNG } from "pngjs";

export function comparePngPixels(before: Buffer, after: Buffer) {
  const a = PNG.sync.read(before),
    b = PNG.sync.read(after);
  const sameSize = a.width === b.width && a.height === b.height;
  let changedPixels = 0,
    visibleChangedPixels = 0,
    maxAlphaDifference = 0,
    maxVisibleDifference = 0;
  const samples: Array<{
    x: number;
    y: number;
    before: number[];
    after: number[];
  }> = [];
  if (sameSize) {
    for (let p = 0; p < a.data.length; p += 4) {
      const alphaA = a.data[p + 3],
        alphaB = b.data[p + 3];
      let changed = false,
        visible = alphaA !== alphaB;
      maxAlphaDifference = Math.max(
        maxAlphaDifference,
        Math.abs(alphaA - alphaB),
      );
      for (let c = 0; c < 4; c++) changed ||= a.data[p + c] !== b.data[p + c];
      for (let c = 0; c < 3; c++) {
        const whiteA = Math.round(
          (a.data[p + c] * alphaA + 255 * (255 - alphaA)) / 255,
        );
        const whiteB = Math.round(
          (b.data[p + c] * alphaB + 255 * (255 - alphaB)) / 255,
        );
        const difference = Math.abs(whiteA - whiteB);
        maxVisibleDifference = Math.max(maxVisibleDifference, difference);
        visible ||= difference > 0;
      }
      if (changed) {
        changedPixels++;
        if (samples.length < 8)
          samples.push({
            x: (p / 4) % a.width,
            y: Math.floor(p / 4 / a.width),
            before: Array.from(a.data.subarray(p, p + 4)),
            after: Array.from(b.data.subarray(p, p + 4)),
          });
      }
      if (visible) visibleChangedPixels++;
    }
  }
  return {
    sameSize,
    beforeSize: [a.width, a.height],
    afterSize: [b.width, b.height],
    changedPixels,
    visibleChangedPixels,
    maxAlphaDifference,
    maxVisibleDifference,
    samples,
  };
}
