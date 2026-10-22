import {
  openWorkshopDB,
  StorageSchemaError,
  validateArtworkDraft,
  type ArtworkAsset,
  type ArtworkDraft,
  type StoredAsset,
} from "./database";
import { isDrawingTools, type DrawingTools } from "../drawing/tools";
import { inspectImageDimensions } from "./images";

export interface DrawingBundle {
  bitmap: Blob;
  thumbnail: Blob;
}
export class DrawingConflictError extends Error {
  constructor() {
    super(
      "別の画面で作品が変更されています。上書きはしていません。PNGを書き出すか、今の絵を別の作品として保存してください。",
    );
    this.name = "DrawingConflictError";
  }
}
async function validateBundle(bundle: DrawingBundle, tools: DrawingTools) {
  if (!isDrawingTools(tools)) throw new StorageSchemaError();
  for (const [kind, blob, side] of [
    ["canvas", bundle.bitmap, 960],
    ["thumbnail", bundle.thumbnail, 192],
  ] as const) {
    if (
      !(blob instanceof Blob) ||
      blob.type !== "image/png" ||
      !blob.size ||
      blob.size > 10 * 1024 * 1024
    )
      throw new Error(
        "作品の画像を確認できません。PNGを書き出してからもう一度お試しください。",
      );
    const dimensions = inspectImageDimensions(
      await blob.arrayBuffer(),
      "image/png",
    );
    if (dimensions.width !== side || dimensions.height !== side)
      throw new Error(
        `${kind === "canvas" ? "作品" : "サムネイル"}のサイズを確認できません。`,
      );
  }
}
function makeAssets(bundle: DrawingBundle): ArtworkAsset[] {
  return (
    [
      ["canvas", bundle.bitmap, 960],
      ["thumbnail", bundle.thumbnail, 192],
    ] as const
  ).map(([kind, blob, side]) => ({
    id: crypto.randomUUID(),
    kind,
    blob,
    mime: "image/png",
    size: blob.size,
    width: side,
    height: side,
  }));
}
export function validateStoredImage(
  asset: StoredAsset | undefined,
  id: string,
  kind: ArtworkAsset["kind"],
): asserts asset is ArtworkAsset {
  const side = kind === "canvas" ? 960 : 192;
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
    asset.width !== side ||
    asset.height !== side
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
    validateStoredImage(asset, draft.canvasAssetId, "canvas");
    validateStoredImage(thumbnail, draft.thumbnailAssetId!, "thumbnail");
    const size = inspectImageDimensions(
      await asset.blob.arrayBuffer(),
      "image/png",
    );
    if (size.width !== 960 || size.height !== 960)
      throw new StorageSchemaError();
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
): Promise<ArtworkDraft> {
  await validateBundle(bundle, tools);
  const db = await openWorkshopDB();
  try {
    const tx = db.transaction(["artworks", "assets"], "readwrite");
    const operation = (async () => {
      const raw = await tx.objectStore("artworks").get(id);
      if (!raw) throw new DrawingConflictError();
      const previous = validateArtworkDraft(raw);
      if (previous.revision !== expectedRevision)
        throw new DrawingConflictError();
      // 壊れた参照をたどって、参考画像など別種のデータを削除しない。
      if (previous.canvasAssetId && previous.thumbnailAssetId) {
        validateStoredImage(
          await tx.objectStore("assets").get(previous.canvasAssetId),
          previous.canvasAssetId,
          "canvas",
        );
        validateStoredImage(
          await tx.objectStore("assets").get(previous.thumbnailAssetId),
          previous.thumbnailAssetId,
          "thumbnail",
        );
      }
      const [bitmap, thumbnail] = makeAssets(bundle);
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
      await tx.objectStore("artworks").put(next);
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
): Promise<ArtworkDraft> {
  await validateBundle(bundle, tools);
  const db = await openWorkshopDB();
  try {
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
      if (
        expectedRevision !== undefined &&
        source.revision !== expectedRevision
      )
        throw new DrawingConflictError();
      const [bitmap, thumbnail] = makeAssets(bundle);
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
