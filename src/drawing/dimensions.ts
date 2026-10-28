export interface CanvasDimensions {
  width: number;
  height: number;
}

export const CANVAS_EDGE = 960;
export const SQUARE_CANVAS: CanvasDimensions = { width: 960, height: 960 };
export const CANVAS_PRESETS = [
  { id: "square", label: "正方形（1:1）", width: 960, height: 960 },
  { id: "portrait", label: "縦長（3:4）", width: 720, height: 960 },
  { id: "landscape", label: "横長（4:3）", width: 960, height: 720 },
] as const;
export type CanvasPresetId = (typeof CANVAS_PRESETS)[number]["id"];

export function isCanvasDimensions(value: CanvasDimensions) {
  return Boolean(
    value &&
    Number.isSafeInteger(value.width) &&
    Number.isSafeInteger(value.height) &&
    value.width >= 1 &&
    value.height >= 1 &&
    Math.max(value.width, value.height) === CANVAS_EDGE,
  );
}

/** 向き補正後の画像の比率を保ち、長辺を固定して描画メモリーを抑える。 */
export function canvasForImage(image: CanvasDimensions): CanvasDimensions {
  if (
    !Number.isSafeInteger(image.width) ||
    !Number.isSafeInteger(image.height) ||
    image.width < 1 ||
    image.height < 1 ||
    Math.max(image.width, image.height) > 1600
  )
    throw new Error(
      "参考画像のサイズを確認できません。画像を選び直してください。",
    );
  return fitDimensions(image, CANVAS_EDGE);
}

export function fitDimensions(
  size: CanvasDimensions,
  edge: number,
): CanvasDimensions {
  const scale = edge / Math.max(size.width, size.height);
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

export function sameDimensions(a: CanvasDimensions, b: CanvasDimensions) {
  return a.width === b.width && a.height === b.height;
}

export function thumbnailDimensions(size: CanvasDimensions) {
  return fitDimensions(size, 192);
}
