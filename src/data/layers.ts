import {
  openWorkshopDB,
  StorageSchemaError,
  type ArtworkDraft,
  type StoredAsset,
  type LayerAsset,
} from "./database";
import { inspectImageDimensions } from "./images";
import {
  SQUARE_CANVAS,
  sameDimensions,
  type CanvasDimensions,
} from "../drawing/dimensions";
import {
  isLayerStack,
  type BitmapLayer,
  type LayerStack,
  type StoredLayer,
} from "../drawing/layers";

export function validateLayerAsset(
  asset: StoredAsset | undefined,
  id: string,
  size: CanvasDimensions = SQUARE_CANVAS,
): asserts asset is LayerAsset {
  if (
    !asset ||
    asset.id !== id ||
    asset.kind !== "layer" ||
    !(asset.blob instanceof Blob) ||
    asset.mime !== "image/png" ||
    asset.blob.type !== "image/png" ||
    !asset.size ||
    asset.size > 10 * 1024 * 1024 ||
    asset.blob.size !== asset.size ||
    !sameDimensions(asset, size)
  )
    throw new StorageSchemaError();
}
export async function validateLayerBitmaps(
  layers: LayerStack<BitmapLayer>,
  size: CanvasDimensions = SQUARE_CANVAS,
) {
  if (!isLayerStack(layers)) throw new StorageSchemaError();
  for (const item of layers.items) {
    if (
      !(item.bitmap instanceof Blob) ||
      item.bitmap.type !== "image/png" ||
      !item.bitmap.size ||
      item.bitmap.size > 10 * 1024 * 1024
    )
      throw new StorageSchemaError();
    const dimensions = inspectImageDimensions(
      await item.bitmap.arrayBuffer(),
      "image/png",
    );
    if (!sameDimensions(dimensions, size)) throw new StorageSchemaError();
  }
}
export async function loadDrawingLayers(
  draft: ArtworkDraft,
): Promise<LayerStack<BitmapLayer> | undefined> {
  if (!draft.layers) return undefined;
  const db = await openWorkshopDB();
  try {
    const items: BitmapLayer[] = [];
    for (const layer of draft.layers.items) {
      const asset = await db.get("assets", layer.assetId);
      validateLayerAsset(asset, layer.assetId, draft);
      // 保存済みBlobの参照を編集・複製先と共有しない。
      const bitmap = new Blob([await asset.blob.arrayBuffer()], {
        type: "image/png",
      });
      const { assetId: _assetId, ...info } = layer;
      void _assetId;
      items.push({ ...info, bitmap });
    }
    const result = { activeId: draft.layers.activeId, items };
    await validateLayerBitmaps(result, draft);
    return result;
  } finally {
    db.close();
  }
}
export function makeLayerAssets(
  layers?: LayerStack<BitmapLayer> | null,
  size: CanvasDimensions = SQUARE_CANVAS,
): {
  state?: LayerStack<StoredLayer>;
  assets: LayerAsset[];
} {
  if (!layers) return { assets: [] };
  const assets: LayerAsset[] = [];
  const items = layers.items.map(({ bitmap, ...info }) => {
    const asset: LayerAsset = {
      id: crypto.randomUUID(),
      kind: "layer",
      blob: bitmap,
      mime: "image/png",
      size: bitmap.size,
      width: size.width,
      height: size.height,
    };
    assets.push(asset);
    return { ...info, assetId: asset.id };
  });
  return { state: { activeId: layers.activeId, items }, assets };
}
