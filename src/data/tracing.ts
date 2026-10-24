import {
  openWorkshopDB,
  StorageSchemaError,
  type ArtworkDraft,
  type GuideAsset,
  type StoredAsset,
} from "./database";
import { inspectImageDimensions, type PreparedImage } from "./images";
import { decodePNG } from "../drawing/surface";

export function validateGuideAsset(
  asset: StoredAsset | undefined,
  id: string,
): asserts asset is GuideAsset {
  if (
    !asset ||
    asset.id !== id ||
    asset.kind !== "guide" ||
    !(asset.blob instanceof Blob) ||
    asset.mime !== "image/png" ||
    asset.blob.type !== "image/png" ||
    asset.size !== asset.blob.size ||
    asset.size < 1 ||
    asset.size > 10 * 1024 * 1024 ||
    !Number.isSafeInteger(asset.width) ||
    !Number.isSafeInteger(asset.height) ||
    asset.width < 1 ||
    asset.height < 1 ||
    Math.max(asset.width, asset.height) > 1600
  )
    throw new StorageSchemaError();
}

export async function validateGuideImage(asset: GuideAsset) {
  validateGuideAsset(asset, asset.id);
  const size = inspectImageDimensions(
    await asset.blob.arrayBuffer(),
    "image/png",
  );
  if (size.width !== asset.width || size.height !== asset.height)
    throw new StorageSchemaError();
  const decoded = await decodePNG(asset.blob);
  decoded.close();
}

export async function makeGuideAsset(
  image: PreparedImage,
): Promise<GuideAsset> {
  const asset: GuideAsset = {
    id: crypto.randomUUID(),
    kind: "guide",
    mime: "image/png",
    blob: image.blob,
    size: image.blob.size,
    width: image.width,
    height: image.height,
  };
  const independent = await independentGuide(asset);
  await validateGuideImage(independent);
  return independent;
}

async function independentGuide(asset: GuideAsset): Promise<GuideAsset> {
  validateGuideAsset(asset, asset.id);
  // 保存済みBlobの参照を再利用せず、元画像の差替え・削除から独立させる。
  const bytes = await asset.blob.arrayBuffer();
  return { ...asset, blob: new Blob([bytes], { type: "image/png" }) };
}

export async function cloneGuideAsset(asset: GuideAsset): Promise<GuideAsset> {
  return { ...(await independentGuide(asset)), id: crypto.randomUUID() };
}

export async function loadTracingGuide(draft: ArtworkDraft) {
  if (!draft.tracing) return undefined;
  const db = await openWorkshopDB();
  try {
    const asset = await db.get("assets", draft.tracing.assetId);
    validateGuideAsset(asset, draft.tracing.assetId);
    const independent = await independentGuide(asset);
    await validateGuideImage(independent);
    return independent;
  } finally {
    db.close();
  }
}
