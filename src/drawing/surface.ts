import type { DrawingTools } from "./tools";
import type { DrawingBundle } from "../data/drawings";
import { inspectImageDimensions } from "../data/images";
import { pngBlob } from "../images/png";
export { pngBlob } from "../images/png";

export const CANVAS_SIZE = 960;
export const UNDO_BYTES = 32 * 1024 * 1024;
export const UNDO_LIMIT = 20;
export interface Point {
  x: number;
  y: number;
}
export function canvasPoint(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): Point {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
  return {
    x: Math.max(
      0,
      Math.min(CANVAS_SIZE, ((clientX - rect.left) / rect.width) * CANVAS_SIZE),
    ),
    y: Math.max(
      0,
      Math.min(CANVAS_SIZE, ((clientY - rect.top) / rect.height) * CANVAS_SIZE),
    ),
  };
}
export class UndoHistory {
  private items: ImageData[] = [];
  private bytes = 0;
  get length() {
    return this.items.length;
  }
  get byteLength() {
    return this.bytes;
  }
  push(image: ImageData) {
    if (image.data.byteLength > UNDO_BYTES) return;
    this.items.push(image);
    this.bytes += image.data.byteLength;
    while (this.items.length > UNDO_LIMIT || this.bytes > UNDO_BYTES) {
      this.bytes -= this.items.shift()!.data.byteLength;
    }
  }
  pop() {
    const image = this.items.pop();
    if (image) this.bytes -= image.data.byteLength;
    return image;
  }
  clear() {
    this.items = [];
    this.bytes = 0;
  }
}
export async function decodePNG(blob: Blob): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}> {
  const dimensions = inspectImageDimensions(
    await blob.arrayBuffer(),
    "image/png",
  );
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob);
      if (
        bitmap.width !== dimensions.width ||
        bitmap.height !== dimensions.height
      ) {
        bitmap.close();
        throw new Error("画像のサイズを確認できません。");
      }
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      /* Image fallback */
    }
  }
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      if (
        image.naturalWidth !== dimensions.width ||
        image.naturalHeight !== dimensions.height
      ) {
        URL.revokeObjectURL(url);
        reject(new Error("画像のサイズを確認できません。"));
        return;
      }
      resolve({
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        close: () => URL.revokeObjectURL(url),
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(
        new Error(
          "保存した絵を読み取れませんでした。元のデータは変更していません。",
        ),
      );
    };
    image.src = url;
  });
}
export class DrawingSurface {
  readonly context: CanvasRenderingContext2D;
  readonly history = new UndoHistory();
  private previous?: Point;
  private strokeSnapshot?: ImageData;
  constructor(readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context)
      throw new Error("このブラウザーではキャンバスを利用できません。");
    this.context = context;
  }
  begin(point: Point, tools: DrawingTools) {
    this.strokeSnapshot = this.context.getImageData(0, 0, 960, 960);
    this.context.globalCompositeOperation =
      tools.tool === "eraser" ? "destination-out" : "source-over";
    this.context.fillStyle = tools.color;
    this.context.strokeStyle = tools.color;
    this.context.lineWidth = tools.width;
    this.context.lineCap = "round";
    this.context.lineJoin = "round";
    this.context.beginPath();
    this.context.arc(point.x, point.y, tools.width / 2, 0, Math.PI * 2);
    this.context.fill();
    this.previous = point;
  }
  move(point: Point) {
    if (!this.previous) return;
    this.context.beginPath();
    this.context.moveTo(this.previous.x, this.previous.y);
    this.context.lineTo(point.x, point.y);
    this.context.stroke();
    this.previous = point;
  }
  end() {
    if (this.strokeSnapshot) this.history.push(this.strokeSnapshot);
    this.strokeSnapshot = undefined;
    this.previous = undefined;
    this.context.globalCompositeOperation = "source-over";
  }
  cancel() {
    if (!this.strokeSnapshot) return;
    this.context.putImageData(this.strokeSnapshot, 0, 0);
    this.strokeSnapshot = undefined;
    this.previous = undefined;
    this.context.globalCompositeOperation = "source-over";
  }
  undo() {
    const image = this.history.pop();
    if (!image) return false;
    this.context.putImageData(image, 0, 0);
    return true;
  }
  async load(blob: Blob) {
    const image = await decodePNG(blob);
    try {
      if (image.width !== 960 || image.height !== 960)
        throw new Error("保存した絵のサイズを確認できません。");
      this.context.clearRect(0, 0, 960, 960);
      this.context.drawImage(image.source, 0, 0);
    } finally {
      image.close();
    }
  }
  seedImportUndo() {
    this.history.push(this.context.createImageData(960, 960));
  }
  dispose() {
    this.strokeSnapshot = undefined;
    this.history.clear();
  }
}
export function cloneCanvas(
  canvas: HTMLCanvasElement,
  white = false,
  side = 960,
) {
  const copy = document.createElement("canvas");
  copy.width = copy.height = side;
  const context = copy.getContext("2d");
  if (!context) throw new Error("画像の準備ができませんでした。");
  if (white) {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, side, side);
  }
  context.drawImage(canvas, 0, 0, side, side);
  return copy;
}
export async function captureDrawing(
  canvas: HTMLCanvasElement,
): Promise<DrawingBundle> {
  const bitmap = cloneCanvas(canvas);
  const thumb = cloneCanvas(bitmap, true, 192);
  try {
    const [image, thumbnail] = await Promise.all([
      pngBlob(bitmap),
      pngBlob(thumb),
    ]);
    return { bitmap: image, thumbnail };
  } finally {
    bitmap.width = bitmap.height = 0;
    thumb.width = thumb.height = 0;
  }
}
export async function importToBundle(blob: Blob): Promise<DrawingBundle> {
  const image = await decodePNG(blob);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 960;
  try {
    const scale = Math.min(960 / image.width, 960 / image.height);
    const width = image.width * scale,
      height = image.height * scale;
    canvas
      .getContext("2d")!
      .drawImage(
        image.source,
        (960 - width) / 2,
        (960 - height) / 2,
        width,
        height,
      );
    return await captureDrawing(canvas);
  } finally {
    image.close();
    canvas.width = canvas.height = 0;
  }
}
export async function exportWhitePNG(canvas: HTMLCanvasElement) {
  const image = cloneCanvas(canvas, true);
  try {
    return await pngBlob(image);
  } finally {
    image.width = image.height = 0;
  }
}
const importedSessions = new Set<string>();
export function rememberImport(id: string) {
  importedSessions.add(id);
}
export function consumeImport(id: string) {
  const exists = importedSessions.has(id);
  importedSessions.delete(id);
  return exists;
}
