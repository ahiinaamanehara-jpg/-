import type { DrawingTools } from "./tools";
import type { DrawingBundle } from "../data/drawings";
import { inspectImageDimensions } from "../data/images";
import { pngBlob } from "../images/png";
import {
  MAX_LAYERS,
  isLayerStack,
  type LayerInfo,
  type LayerView,
  type LayerStack,
  type BitmapLayer,
} from "./layers";
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
export class UndoHistory<T = ImageData> {
  private items: T[] = [];
  constructor(
    private measure: (item: T) => number = (item) =>
      (item as unknown as ImageData).data.byteLength,
  ) {}
  private bytes = 0;
  get length() {
    return this.items.length;
  }
  get byteLength() {
    return this.bytes;
  }
  push(image: T) {
    const size = this.measure(image);
    if (size > UNDO_BYTES) return;
    this.items.push(image);
    this.bytes += size;
    while (this.items.length > UNDO_LIMIT || this.bytes > UNDO_BYTES) {
      this.bytes -= this.measure(this.items.shift()!);
    }
  }
  pop() {
    const image = this.items.pop();
    if (image) this.bytes -= this.measure(image);
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
interface LayerCanvas {
  info: LayerInfo;
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
}
type UndoRecord =
  | { kind: "stroke"; layerId: string; image: ImageData }
  | {
      kind: "layers";
      before: LayerView;
      removed?: { id: string; image: ImageData };
    };

export class DrawingSurface {
  readonly context: CanvasRenderingContext2D;
  readonly history = new UndoHistory<UndoRecord>((record) =>
    record.kind === "stroke"
      ? record.image.data.byteLength
      : (record.removed?.image.data.byteLength ?? 0) + 1024,
  );
  private previous?: Point;
  private strokeSnapshot?: ImageData;
  private strokeLayerId?: string;
  private baseId: string = crypto.randomUUID();
  private activeId: string = this.baseId;
  private entries?: LayerCanvas[];
  constructor(readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context)
      throw new Error("このブラウザーではキャンバスを利用できません。");
    this.context = context;
  }
  get layerView(): LayerView {
    return {
      enabled: Boolean(this.entries),
      activeId: this.activeId,
      items: this.entries
        ? this.entries.map((entry) => ({ ...entry.info }))
        : [{ id: this.baseId, name: "レイヤー1", visible: true }],
    };
  }
  get canDraw() {
    return (
      !this.entries ||
      Boolean(
        this.entries.find((entry) => entry.info.id === this.activeId)?.info
          .visible,
      )
    );
  }
  private get paintContext() {
    return this.entries
      ? this.entries.find((entry) => entry.info.id === this.activeId)!.context
      : this.context;
  }
  private createLayer(info: LayerInfo): LayerCanvas {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = CANVAS_SIZE;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context)
      throw new Error("レイヤーを用意できません。描いた絵は保持しています。");
    return {
      info: { id: info.id, name: info.name, visible: info.visible },
      canvas,
      context,
    };
  }
  private enableLayers() {
    if (this.entries) return;
    const entry = this.createLayer(this.layerView.items[0]);
    entry.context.drawImage(this.canvas, 0, 0);
    this.entries = [entry];
  }
  private composite() {
    if (!this.entries) return;
    this.context.globalCompositeOperation = "source-over";
    this.context.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    for (const entry of this.entries)
      if (entry.info.visible) this.context.drawImage(entry.canvas, 0, 0);
  }
  selectLayer(id: string) {
    if (
      this.strokeSnapshot ||
      id === this.activeId ||
      !this.entries?.some((entry) => entry.info.id === id)
    )
      return false;
    this.activeId = id;
    return true;
  }
  addLayer() {
    const before = this.layerView;
    if (this.strokeSnapshot || before.items.length >= MAX_LAYERS) return false;
    let number = 1;
    while (before.items.some((item) => item.name === `レイヤー${number}`))
      number++;
    const entry = this.createLayer({
      id: crypto.randomUUID(),
      name: `レイヤー${number}`,
      visible: true,
    });
    try {
      this.enableLayers();
    } catch (error) {
      entry.canvas.width = entry.canvas.height = 0;
      throw error;
    }
    this.history.push({ kind: "layers", before });
    this.entries!.push(entry);
    this.activeId = entry.info.id;
    this.composite();
    return true;
  }
  setLayerVisible(id: string, visible: boolean) {
    const before = this.layerView;
    if (
      this.strokeSnapshot ||
      !before.items.some((item) => item.id === id && item.visible !== visible)
    )
      return false;
    this.enableLayers();
    this.history.push({ kind: "layers", before });
    this.entries!.find((entry) => entry.info.id === id)!.info.visible = visible;
    this.composite();
    return true;
  }
  moveLayer(id: string, delta: -1 | 1) {
    const before = this.layerView,
      index = before.items.findIndex((item) => item.id === id),
      next = index + delta;
    if (
      this.strokeSnapshot ||
      !this.entries ||
      index < 0 ||
      next < 0 ||
      next >= this.entries.length
    )
      return false;
    this.history.push({ kind: "layers", before });
    [this.entries[index], this.entries[next]] = [
      this.entries[next],
      this.entries[index],
    ];
    this.composite();
    return true;
  }
  removeLayer(id: string) {
    const before = this.layerView,
      index = before.items.findIndex((item) => item.id === id);
    if (
      this.strokeSnapshot ||
      !this.entries ||
      this.entries.length <= 1 ||
      index < 0
    )
      return false;
    const entry = this.entries[index];
    this.history.push({
      kind: "layers",
      before,
      removed: {
        id,
        image: entry.context.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE),
      },
    });
    this.entries.splice(index, 1);
    if (this.activeId === id)
      this.activeId =
        this.entries[Math.min(index, this.entries.length - 1)].info.id;
    entry.canvas.width = entry.canvas.height = 0;
    this.composite();
    return true;
  }
  begin(point: Point, tools: DrawingTools) {
    if (!this.canDraw || this.strokeSnapshot) return false;
    const context = this.paintContext;
    this.strokeSnapshot = context.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    this.strokeLayerId = this.activeId;
    context.globalCompositeOperation =
      tools.tool === "eraser" ? "destination-out" : "source-over";
    context.fillStyle = context.strokeStyle = tools.color;
    context.lineWidth = tools.width;
    context.lineCap = context.lineJoin = "round";
    context.beginPath();
    context.arc(point.x, point.y, tools.width / 2, 0, Math.PI * 2);
    context.fill();
    this.previous = point;
    this.composite();
    return true;
  }
  move(point: Point) {
    if (!this.previous) return;
    const context = this.paintContext;
    context.beginPath();
    context.moveTo(this.previous.x, this.previous.y);
    context.lineTo(point.x, point.y);
    context.stroke();
    this.previous = point;
    this.composite();
  }
  end() {
    if (this.strokeSnapshot)
      this.history.push({
        kind: "stroke",
        layerId: this.strokeLayerId!,
        image: this.strokeSnapshot,
      });
    this.strokeSnapshot = this.strokeLayerId = this.previous = undefined;
    this.paintContext.globalCompositeOperation = "source-over";
  }
  cancel() {
    if (!this.strokeSnapshot) return;
    this.paintContext.putImageData(this.strokeSnapshot, 0, 0);
    this.strokeSnapshot = this.strokeLayerId = this.previous = undefined;
    this.paintContext.globalCompositeOperation = "source-over";
    this.composite();
  }
  undo() {
    if (this.strokeSnapshot) return false;
    const record = this.history.pop();
    if (!record) return false;
    const previousActive = this.activeId;
    try {
      if (record.kind === "stroke") {
        this.activeId = record.layerId;
        this.paintContext.putImageData(record.image, 0, 0);
        this.composite();
      } else {
        const current = this.entries ?? [];
        const map = new Map(current.map((entry) => [entry.info.id, entry]));
        if (record.removed) {
          const info = record.before.items.find(
            (item) => item.id === record.removed!.id,
          )!;
          const entry = this.createLayer(info);
          entry.context.putImageData(record.removed.image, 0, 0);
          map.set(info.id, entry);
        }
        const restored = record.before.items.map((info) => {
          const entry = map.get(info.id)!;
          entry.info = { ...info };
          return entry;
        });
        for (const entry of current)
          if (!restored.includes(entry))
            entry.canvas.width = entry.canvas.height = 0;
        this.activeId = record.before.activeId;
        if (record.before.enabled) {
          this.entries = restored;
          this.composite();
        } else {
          this.context.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
          this.context.drawImage(restored[0].canvas, 0, 0);
          for (const entry of restored)
            entry.canvas.width = entry.canvas.height = 0;
          this.entries = undefined;
        }
      }
      return true;
    } catch (error) {
      this.activeId = previousActive;
      this.history.push(record);
      throw error;
    }
  }
  async load(blob: Blob, layers?: LayerStack<BitmapLayer>) {
    if (layers) {
      if (!isLayerStack(layers))
        throw new Error(
          "レイヤーの情報を確認できません。元の作品は変更していません。",
        );
      const entries: LayerCanvas[] = [];
      try {
        for (const item of layers.items) {
          const entry = this.createLayer(item);
          entries.push(entry);
          const image = await decodePNG(item.bitmap);
          try {
            if (image.width !== CANVAS_SIZE || image.height !== CANVAS_SIZE)
              throw new Error("レイヤーのサイズを確認できません。");
            entry.context.drawImage(image.source, 0, 0);
          } finally {
            image.close();
          }
        }
        this.entries = entries;
        this.baseId = entries[0].info.id;
        this.activeId = layers.activeId;
        this.composite();
      } catch (error) {
        for (const entry of entries)
          entry.canvas.width = entry.canvas.height = 0;
        throw error;
      }
      return;
    }
    const image = await decodePNG(blob);
    try {
      if (image.width !== CANVAS_SIZE || image.height !== CANVAS_SIZE)
        throw new Error("保存した絵のサイズを確認できません。");
      this.context.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      this.context.drawImage(image.source, 0, 0);
    } finally {
      image.close();
    }
  }
  capture() {
    const layers = this.entries
      ? {
          activeId: this.activeId,
          items: this.entries.map((entry) => ({
            ...entry.info,
            canvas: entry.canvas,
          })),
        }
      : undefined;
    const capture = captureDrawing(this.canvas, layers);
    // undefinedは誤ってレイヤーを省略した保存、nullは1枚へ戻した明示状態。
    return layers
      ? capture
      : capture.then((bundle) => ({ ...bundle, layers: null }));
  }
  seedImportUndo() {
    this.history.push({
      kind: "stroke",
      layerId: this.activeId,
      image: this.context.createImageData(CANVAS_SIZE, CANVAS_SIZE),
    });
  }
  dispose() {
    this.strokeSnapshot = undefined;
    this.history.clear();
    for (const entry of this.entries ?? [])
      entry.canvas.width = entry.canvas.height = 0;
    this.entries = undefined;
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
  layers?: LayerStack<LayerInfo & { canvas: HTMLCanvasElement }>,
): Promise<DrawingBundle> {
  const bitmap = cloneCanvas(canvas);
  const thumb = cloneCanvas(bitmap, true, 192);
  const copies = layers?.items.map(({ canvas, ...info }) => ({
    ...info,
    canvas: cloneCanvas(canvas),
  }));
  try {
    const [image, thumbnail, layerImages] = await Promise.all([
      pngBlob(bitmap),
      pngBlob(thumb),
      copies
        ? Promise.all(
            copies.map(async ({ canvas, ...info }) => ({
              ...info,
              bitmap: await pngBlob(canvas),
            })),
          )
        : undefined,
    ]);
    return {
      bitmap: image,
      thumbnail,
      ...(layers && layerImages
        ? { layers: { activeId: layers.activeId, items: layerImages } }
        : {}),
    };
  } finally {
    bitmap.width = bitmap.height = 0;
    thumb.width = thumb.height = 0;
    for (const entry of copies ?? [])
      entry.canvas.width = entry.canvas.height = 0;
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
