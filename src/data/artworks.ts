import {
  openWorkshopDB,
  referencesAsset,
  validateArtworkDraft,
  StorageSchemaError,
  type ArtworkDraft,
  type StoredAsset,
} from "./database";
import { validateCharacter } from "./characters";
import { validateStoredImage, DrawingConflictError } from "./drawings";
import { validateReflection } from "./reflections";

export async function listGallery() {
  const db = await openWorkshopDB();
  try {
    const tx = db.transaction(["artworks", "characters"]);
    const [raw, characters] = await Promise.all([
      tx.objectStore("artworks").getAll(),
      tx.objectStore("characters").getAll(),
      tx.done,
    ]);
    const artworks: ArtworkDraft[] = [];
    let invalid = 0;
    for (const item of raw) {
      try {
        artworks.push(validateArtworkDraft(item));
      } catch {
        invalid++;
      }
    }
    artworks.sort(
      (a, b) =>
        Date.parse(b.updatedAt) - Date.parse(a.updatedAt) ||
        a.id.localeCompare(b.id),
    );
    const validCharacters = [];
    let invalidCharacters = 0;
    for (const character of characters) {
      try {
        validCharacters.push(validateCharacter(character));
      } catch {
        invalidCharacters++;
      }
    }
    return {
      artworks,
      characters: validCharacters,
      invalid,
      invalidCharacters,
    };
  } finally {
    db.close();
  }
}
export async function loadArtworkImage(
  id: string,
  kind: "canvas" | "thumbnail",
) {
  const db = await openWorkshopDB();
  try {
    const tx = db.transaction(["artworks", "assets"]);
    const operation = (async () => {
      const raw = await tx.objectStore("artworks").get(id);
      if (!raw) throw new Error("作品が見つかりません。");
      const work = validateArtworkDraft(raw);
      const assetId =
        kind === "canvas" ? work.canvasAssetId : work.thumbnailAssetId;
      if (!assetId) return undefined;
      const asset = await tx.objectStore("assets").get(assetId);
      validateStoredImage(asset, assetId, kind);
      return asset.blob;
    })();
    const [blob] = await Promise.all([operation, tx.done]);
    return blob;
  } finally {
    db.close();
  }
}
export async function loadArtworkDetail(id: string) {
  const db = await openWorkshopDB();
  try {
    const tx = db.transaction(["artworks", "characters", "reflections"]);
    const operation = (async () => {
      const raw = await tx.objectStore("artworks").get(id);
      if (!raw) return undefined;
      const artwork = validateArtworkDraft(raw);
      const character = artwork.characterId
        ? await tx.objectStore("characters").get(artwork.characterId)
        : undefined;
      const reflections = (
        await tx.objectStore("reflections").index("by-artwork").getAll(id)
      ).map(validateReflection);
      return {
        artwork,
        character: character && validateCharacter(character),
        reflections,
      };
    })();
    const [detail] = await Promise.all([operation, tx.done]);
    return detail;
  } finally {
    db.close();
  }
}
export async function setArtworkStatus(
  id: string,
  expectedRevision: number,
  status: ArtworkDraft["status"],
) {
  if (!["in-progress", "finished"].includes(status))
    throw new StorageSchemaError();
  const db = await openWorkshopDB();
  try {
    const tx = db.transaction("artworks", "readwrite");
    const operation = (async () => {
      const raw = await tx.store.get(id);
      if (!raw) throw new DrawingConflictError();
      const previous = validateArtworkDraft(raw);
      if (previous.revision !== expectedRevision)
        throw new DrawingConflictError();
      const next = {
        ...previous,
        status,
        updatedAt: new Date().toISOString(),
        revision: previous.revision + 1,
      };
      await tx.store.put(next);
      return next;
    })();
    const [next] = await Promise.all([
      operation.catch((e) => {
        try {
          tx.abort();
        } catch {
          /* 終了済み */
        }
        throw e;
      }),
      tx.done,
    ]);
    return next;
  } finally {
    db.close();
  }
}
export async function deleteArtwork(id: string, expectedRevision: number) {
  const db = await openWorkshopDB();
  try {
    const tx = db.transaction(
      ["artworks", "assets", "reflections", "characters", "settings"],
      "readwrite",
    );
    const operation = (async () => {
      const work = await tx.objectStore("artworks").get(id);
      if (!work || validateArtworkDraft(work).revision !== expectedRevision)
        throw new DrawingConflictError();
      const others = (await tx.objectStore("artworks").getAll()).filter(
        (a) => a.id !== id,
      );
      const characters = await tx.objectStore("characters").getAll();
      for (const [assetId, kind] of [
        [work.canvasAssetId, "canvas"],
        [work.thumbnailAssetId, "thumbnail"],
        [work.tracing?.assetId, "guide"],
        ...(work.layers?.items.map(
          (layer) => [layer.assetId, "layer"] as const,
        ) ?? []),
      ] as const) {
        if (
          !assetId ||
          [...others, ...characters].some((a) => referencesAsset(a, assetId))
        )
          continue;
        const asset: StoredAsset | undefined = await tx
          .objectStore("assets")
          .get(assetId);
        if (asset?.kind === kind)
          await tx.objectStore("assets").delete(assetId);
      }
      const refs = tx.objectStore("reflections");
      for (const record of await refs.getAll()) {
        if (record.artworkId === id) await refs.delete(record.id);
        else if (record.comparedArtworkId === id)
          await refs.put({
            ...validateReflection(record),
            comparisonUnavailable: true,
            revision: record.revision + 1,
            updatedAt: new Date().toISOString(),
          });
      }
      await tx.objectStore("artworks").delete(id);
      const last = await tx.objectStore("settings").get("lastArtworkId");
      if (last?.value === id)
        await tx.objectStore("settings").delete("lastArtworkId");
    })();
    await Promise.all([
      operation.catch((e) => {
        try {
          tx.abort();
        } catch {
          /* 終了済み */
        }
        throw e;
      }),
      tx.done,
    ]);
  } finally {
    db.close();
  }
}
export async function clearWorkshop() {
  const db = await openWorkshopDB();
  try {
    const names = [
      "artworks",
      "assets",
      "characters",
      "reflections",
      "settings",
    ] as const;
    const tx = db.transaction(names, "readwrite");
    const operation = (async () => {
      for (const name of names) await tx.objectStore(name).clear();
    })();
    await Promise.all([
      operation.catch((e) => {
        try {
          tx.abort();
        } catch {
          /* 終了済み */
        }
        throw e;
      }),
      tx.done,
    ]);
  } finally {
    db.close();
  }
}
