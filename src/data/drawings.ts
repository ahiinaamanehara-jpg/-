import {
  openWorkshopDB,
  referencesAsset,
  StorageSchemaError,
  validateArtworkDraft,
  type ArtworkAsset,
  type ArtworkDraft,
  type StoredAsset,
} from "./database";
import {
  cloneGuideAsset,
  validateGuideAsset,
  validateGuideImage,
} from "./tracing";
import { isTracingSettings, type TracingUpdate } from "../drawing/tracing";
import { isDrawingTools, type DrawingTools } from "../drawing/tools";
import { inspectImageDimensions } from "./images";
import {
  makeLayerAssets,
  validateLayerAsset,
  validateLayerBitmaps,
} from "./layers";
import type { LayerStack, BitmapLayer } from "../drawing/layers";

import {
  isCanvasDimensions,
  SQUARE_CANVAS,
  sameDimensions,
  thumbnailDimensions,
  type CanvasDimensions,
} from "../drawing/dimensions";

export interface DrawingBundle {
  bitmap: Blob;
  thumbnail: Blob;
  layers?: LayerStack<BitmapLayer> | null;
}
export class DrawingConflictError extends Error {
  constructor() {
    super(
      "別の画面で作品が変更されています。上書きはしていません。PNGを書き出すか、今の絵を別の作品として保存してください。",
    );
    this.name = "DrawingConflictError";
  }
}
async function validateBundle(
  bundle: DrawingBundle,
  tools: DrawingTools,
): Promise<CanvasDimensions> {
  if (!isDrawingTools(tools)) throw new StorageSchemaError();
  for (const blob of [bundle.bitmap, bundle.thumbnail]) {
    if (
      !(blob instanceof Blob) ||
      blob.type !== "image/png" ||
      !blob.size ||
      blob.size > 10 * 1024 * 1024
    )
      throw new Error(
        "作品の画像を確認できません。PNGを書き出してからもう一度お試しください。",
      );
  }
  const size = inspectImageDimensions(
    await bundle.bitmap.arrayBuffer(),
    "image/png",
  );
  if (!isCanvasDimensions(size)) throw new StorageSchemaError();
  const thumb = inspectImageDimensions(
    await bundle.thumbnail.arrayBuffer(),
    "image/png",
  );
  if (!sameDimensions(thumb, thumbnailDimensions(size)))
    throw new StorageSchemaError();
  if (bundle.layers !== undefined && bundle.layers !== null)
    await validateLayerBitmaps(bundle.layers, size);
  return size;
}
function makeAssets(
  bundle: DrawingBundle,
  size: CanvasDimensions,
): ArtworkAsset[] {
  return (
    [
      ["canvas", bundle.bitmap, size],
      ["thumbnail", bundle.thumbnail, thumbnailDimensions(size)],
    ] as const
  ).map(([kind, blob, dimensions]) => ({
    id: crypto.randomUUID(),
    kind,
    blob,
    mime: "image/png",
    size: blob.size,
    width: dimensions.width,
    height: dimensions.height,
  }));
}
export function validateStoredImage(
  asset: StoredAsset | undefined,
  id: string,
  kind: ArtworkAsset["kind"],
  size: CanvasDimensions = SQUARE_CANVAS,
): asserts asset is ArtworkAsset {
  const dimensions = kind === "canvas" ? size : thumbnailDimensions(size);
  if (
    !asset ||
    asset.id !== id ||
    asset.kind !== kind ||
    !(asset.blob instanceof Blob) ||
    asset.mime !== "image/png" ||
    asset.blob.type !== "image/png" ||
    asset.size < 1 ||
    asset.size > 10 * 1024 * 1024 ||
    asset.blob.size !== asset.size ||
    !sameDimensions(asset, dimensions)
  )
    throw new StorageSchemaError();
}
export async function loadDrawingBitmap(
  draft: ArtworkDraft,
): Promise<Blob | undefined> {
  if (!draft.canvasAssetId) return undefined;
  const db = await openWorkshopDB();
  try {
    const [asset, thumbnail] = await Promise.all([
      db.get("assets", draft.canvasAssetId),
      db.get("assets", draft.thumbnailAssetId!),
    ]);
    validateStoredImage(asset, draft.canvasAssetId, "canvas", draft);
    validateStoredImage(thumbnail, draft.thumbnailAssetId!, "thumbnail", draft);
    const size = inspectImageDimensions(
      await asset.blob.arrayBuffer(),
      "image/png",
    );
    if (!sameDimensions(size, draft)) throw new StorageSchemaError();
    return asset.blob;
  } finally {
    db.close();
  }
}
export async function saveDrawing(
  id: string,
  expectedRevision: number,
  bundle: DrawingBundle,
  tools: DrawingTools,
  tracing?: TracingUpdate,
): Promise<ArtworkDraft> {
  const size = await validateBundle(bundle, tools);
  if (tracing?.settings && !isTracingSettings(tracing.settings))
    throw new StorageSchemaError();
  if (tracing?.asset) {
    if (tracing.settings?.assetId !== tracing.asset.id)
      throw new StorageSchemaError();
    await validateGuideImage(tracing.asset);
  }
  const db = await openWorkshopDB();
  try {
    const tx = db.transaction(
      ["artworks", "assets", "characters"],
      "readwrite",
    );
    const operation = (async () => {
      const raw = await tx.objectStore("artworks").get(id);
      if (!raw) throw new DrawingConflictError();
      const previous = validateArtworkDraft(raw);
      if (previous.revision !== expectedRevision)
        throw new DrawingConflictError();
      if (!sameDimensions(previous, size)) throw new StorageSchemaError();
      // 壊れた参照をたどって、参考画像など別種のデータを削除しない。
      if (previous.canvasAssetId && previous.thumbnailAssetId) {
        validateStoredImage(
          await tx.objectStore("assets").get(previous.canvasAssetId),
          previous.canvasAssetId,
          "canvas",
          previous,
        );
        validateStoredImage(
          await tx.objectStore("assets").get(previous.thumbnailAssetId),
          previous.thumbnailAssetId,
          "thumbnail",
          previous,
        );
      }
      if (previous.layers && bundle.layers === undefined)
        throw new StorageSchemaError();
      for (const layer of previous.layers?.items ?? [])
        validateLayerAsset(
          await tx.objectStore("assets").get(layer.assetId),
          layer.assetId,
          previous,
        );
      const layerAssets = makeLayerAssets(bundle.layers, size);
      for (const asset of layerAssets.assets)
        await tx.objectStore("assets").add(asset);
      const [bitmap, thumbnail] = makeAssets(bundle, size);
      await tx.objectStore("assets").add(bitmap);
      await tx.objectStore("assets").add(thumbnail);
      const next: ArtworkDraft = {
        ...previous,
        canvasAssetId: bitmap.id,
        thumbnailAssetId: thumbnail.id,
        tools: { ...tools },
        updatedAt: new Date().toISOString(),
        revision: previous.revision + 1,
      };
      if (layerAssets.state) next.layers = layerAssets.state;
      else delete next.layers;
      if (tracing) {
        if (tracing.settings) {
          const id = tracing.settings.assetId;
          const existing = await tx.objectStore("assets").get(id);
          if (existing) {
            if (id !== previous.tracing?.assetId)
              throw new StorageSchemaError();
            validateGuideAsset(existing, id);
          } else if (tracing.asset) {
            await tx.objectStore("assets").add(tracing.asset);
          } else throw new StorageSchemaError();
          next.tracing = { ...tracing.settings };
        } else delete next.tracing;
      }
      await tx.objectStore("artworks").put(next);
      const previousGuideId = previous.tracing?.assetId;
      if (previousGuideId && previousGuideId !== next.tracing?.assetId) {
        const others = (await tx.objectStore("artworks").getAll()).filter(
          (a) => a.id !== id,
        );
        const characters = await tx.objectStore("characters").getAll();
        if (
          ![...others, ...characters].some((a) =>
            referencesAsset(a, previousGuideId),
          )
        ) {
          const old = await tx.objectStore("assets").get(previousGuideId);
          if (old?.kind === "guide")
            await tx.objectStore("assets").delete(previousGuideId);
        }
      }
      if (previous.layers) {
        const artworks = await tx.objectStore("artworks").getAll();
        const characters = await tx.objectStore("characters").getAll();
        for (const layer of previous.layers.items) {
          if (
            ![...artworks, ...characters].some((record) =>
              referencesAsset(record, layer.assetId),
            )
          )
            await tx.objectStore("assets").delete(layer.assetId);
        }
      }
      if (previous.canvasAssetId)
        await tx.objectStore("assets").delete(previous.canvasAssetId);
      if (previous.thumbnailAssetId)
        await tx.objectStore("assets").delete(previous.thumbnailAssetId);
      return next;
    })();
    const [result] = await Promise.all([
      operation.catch((error) => {
        try {
          tx.abort();
        } catch {
          /* already ended */
        }
        throw error;
      }),
      tx.done,
    ]);
    return result;
  } finally {
    db.close();
  }
}
/** コピー／取込は別作品。元の画像・テーマを上書きしない。 */
export async function createDrawingCopy(
  sourceId: string,
  bundle: DrawingBundle,
  tools: DrawingTools,
  expectedRevision?: number,
  fallback?: ArtworkDraft,
  tracingOverride?: TracingUpdate,
): Promise<ArtworkDraft> {
  const size = await validateBundle(bundle, tools);
  const db = await openWorkshopDB();
  try {
    // Blobの実体コピーは書込TXの外で終え、非同期読出しによるTX失効を避ける。
    const initialSource = (await db.get("artworks", sourceId)) ?? fallback;
    const settings = tracingOverride
      ? tracingOverride.settings
      : initialSource?.tracing;
    let copiedGuide;
    if (settings) {
      if (!isTracingSettings(settings)) throw new StorageSchemaError();
      const original =
        tracingOverride?.asset ?? (await db.get("assets", settings.assetId));
      validateGuideAsset(original, settings.assetId);
      copiedGuide = await cloneGuideAsset(original);
    }
    const tx = db.transaction(
      ["artworks", "assets", "settings", "characters"],
      "readwrite",
    );
    const operation = (async () => {
      const raw = await tx.objectStore("artworks").get(sourceId);
      if (
        !raw &&
        (!fallback ||
          expectedRevision !== undefined ||
          fallback.id !== sourceId)
      )
        throw new DrawingConflictError();
      const source = validateArtworkDraft(raw ?? fallback!);
      if (!sameDimensions(source, size)) throw new StorageSchemaError();
      if (
        !tracingOverride &&
        source.tracing?.assetId !== initialSource?.tracing?.assetId
      )
        throw new DrawingConflictError();
      if (
        expectedRevision !== undefined &&
        source.revision !== expectedRevision
      )
        throw new DrawingConflictError();
      const layerAssets = makeLayerAssets(bundle.layers, size);
      for (const asset of layerAssets.assets)
        await tx.objectStore("assets").add(asset);
      const [bitmap, thumbnail] = makeAssets(bundle, size);
      await tx.objectStore("assets").add(bitmap);
      await tx.objectStore("assets").add(thumbnail);
      const now = new Date().toISOString();
      const draft: ArtworkDraft = {
        ...source,
        id: crypto.randomUUID(),
        canvasAssetId: bitmap.id,
        thumbnailAssetId: thumbnail.id,
        tools: { ...tools },
        status: "in-progress",
        createdAt: now,
        updatedAt: now,
        revision: 1,
      };
      if (layerAssets.state) draft.layers = layerAssets.state;
      else delete draft.layers;
      if (settings && copiedGuide) {
        await tx.objectStore("assets").add(copiedGuide);
        draft.tracing = { ...settings, assetId: copiedGuide.id };
      } else delete draft.tracing;
      if (
        draft.characterId &&
        !(await tx.objectStore("characters").get(draft.characterId))
      )
        delete draft.characterId;
      await tx.objectStore("artworks").add(draft);
      await tx
        .objectStore("settings")
        .put({ key: "lastArtworkId", value: draft.id });
      return draft;
    })();
    const [result] = await Promise.all([
      operation.catch((error) => {
        try {
          tx.abort();
        } catch {
          /* already ended */
        }
        throw error;
      }),
      tx.done,
    ]);
    return result;
  } finally {
    db.close();
  }
}
