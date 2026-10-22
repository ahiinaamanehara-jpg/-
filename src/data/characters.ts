import {
  openWorkshopDB,
  StorageSchemaError,
  validateArtworkDraft,
  type Character,
  type ReferenceAsset,
  type StoredAsset,
} from "./database";
export type { Character, ReferenceAsset } from "./database";

const SELECTED_CHARACTER_KEY = "selectedCharacterId";
export class CharacterConflictError extends Error {
  constructor() {
    super(
      "別の画面で変更または削除されています。再読み込みしてから編集してください。",
    );
    this.name = "CharacterConflictError";
  }
}
export class CharacterValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CharacterValidationError";
  }
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
function validateCharacter(value: Character): Character {
  if (
    !value ||
    typeof value.id !== "string" ||
    !value.id ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    value.name.length > 100 ||
    typeof value.memo !== "string" ||
    value.memo.length > 2000 ||
    !validDate(value.createdAt) ||
    !validDate(value.updatedAt) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    (value.referenceAssetId !== undefined &&
      (typeof value.referenceAssetId !== "string" || !value.referenceAssetId))
  )
    throw new StorageSchemaError();
  return value;
}
function validateImage(image: { blob: Blob; width: number; height: number }) {
  if (
    !(image.blob instanceof Blob) ||
    image.blob.type !== "image/png" ||
    image.blob.size === 0 ||
    image.blob.size > 10 * 1024 * 1024 ||
    !Number.isInteger(image.width) ||
    !Number.isInteger(image.height) ||
    image.width < 1 ||
    image.height < 1 ||
    Math.max(image.width, image.height) > 1600 ||
    image.width * image.height > 16_000_000
  )
    throw new CharacterValidationError(
      "参考画像を確認できません。画像を選び直してください。",
    );
}
function validateAsset(value: StoredAsset, id: string) {
  if (
    !value ||
    value.id !== id ||
    value.kind !== "reference" ||
    value.mime !== "image/png" ||
    value.size !== value.blob?.size
  )
    throw new StorageSchemaError();
  try {
    validateImage(value);
  } catch {
    throw new StorageSchemaError();
  }
  return value;
}

export async function listCharacters(): Promise<Character[]> {
  const db = await openWorkshopDB();
  try {
    return (await db.getAll("characters"))
      .map(validateCharacter)
      .sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
      );
  } finally {
    db.close();
  }
}

export async function loadCharacter(
  id: string,
): Promise<{ character: Character; asset?: ReferenceAsset } | undefined> {
  const db = await openWorkshopDB();
  try {
    const tx = db.transaction(["characters", "assets"]);
    const operation = (async () => {
      const raw = await tx.objectStore("characters").get(id);
      if (!raw) return undefined;
      const character = validateCharacter(raw);
      const storedAsset = character.referenceAssetId
        ? await tx.objectStore("assets").get(character.referenceAssetId)
        : undefined;
      // 画像だけの欠落・不整合でも名前・メモを救済し、差替えを可能にする。
      // 保存済みの参照や画像は、本人が明示的に変更するまで保持する。
      let asset: ReferenceAsset | undefined;
      if (storedAsset && character.referenceAssetId) {
        try {
          asset = validateAsset(storedAsset, character.referenceAssetId);
        } catch (error) {
          if (!(error instanceof StorageSchemaError)) throw error;
        }
      }
      return { character, asset };
    })();
    const [result] = await Promise.all([operation, tx.done]);
    return result;
  } finally {
    db.close();
  }
}

export interface SaveCharacterInput {
  id?: string;
  name: string;
  memo: string;
  image?: { blob: Blob; width: number; height: number } | null;
  expectedRevision?: number;
}
export async function saveCharacter(
  input: SaveCharacterInput,
): Promise<Character> {
  const name = input.name.trim();
  if (!name)
    throw new CharacterValidationError("キャラクター名を入力してください。");
  if (name.length > 100)
    throw new CharacterValidationError(
      "キャラクター名は100文字以内で入力してください。",
    );
  if (input.memo.length > 2000)
    throw new CharacterValidationError(
      "メモは2,000文字以内で入力してください。",
    );
  if (input.image) validateImage(input.image);
  const db = await openWorkshopDB();
  const tx = db.transaction(["characters", "assets"], "readwrite");
  try {
    const operation = (async () => {
      const existing = input.id
        ? await tx.objectStore("characters").get(input.id)
        : undefined;
      if (
        input.id &&
        (!existing ||
          input.expectedRevision !== validateCharacter(existing).revision)
      )
        throw new CharacterConflictError();
      const now = new Date().toISOString();
      const character: Character = {
        id: existing?.id ?? crypto.randomUUID(),
        name,
        memo: input.memo,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        revision: (existing?.revision ?? 0) + 1,
      };
      if (existing?.referenceAssetId && input.image === undefined)
        character.referenceAssetId = existing.referenceAssetId;
      if (input.image) {
        const id = crypto.randomUUID();
        const asset: ReferenceAsset = {
          id,
          kind: "reference",
          blob: input.image.blob,
          mime: input.image.blob.type,
          size: input.image.blob.size,
          width: input.image.width,
          height: input.image.height,
        };
        await tx.objectStore("assets").add(asset);
        character.referenceAssetId = id;
      }
      if (existing?.referenceAssetId && input.image !== undefined) {
        const asset = await tx
          .objectStore("assets")
          .get(existing.referenceAssetId);
        // 不整合な推しの参照から作品画像を削除しない。
        if (asset?.kind === "reference")
          await tx.objectStore("assets").delete(existing.referenceAssetId);
      }
      await tx.objectStore("characters").put(character);
      return character;
    })();
    const [result] = await Promise.all([
      operation.catch((error) => {
        try {
          tx.abort();
        } catch {
          /* transaction already ended */
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

export async function deleteCharacter(
  id: string,
  expectedRevision: number,
): Promise<void> {
  const db = await openWorkshopDB();
  const tx = db.transaction(
    ["characters", "assets", "settings", "artworks"],
    "readwrite",
  );
  try {
    const operation = (async () => {
      const character = await tx.objectStore("characters").get(id);
      if (
        !character ||
        validateCharacter(character).revision !== expectedRevision
      )
        throw new CharacterConflictError();
      if (character.referenceAssetId) {
        const asset = await tx
          .objectStore("assets")
          .get(character.referenceAssetId);
        if (asset?.kind === "reference")
          await tx.objectStore("assets").delete(character.referenceAssetId);
      }
      await tx.objectStore("characters").delete(id);
      const selected = await tx
        .objectStore("settings")
        .get(SELECTED_CHARACTER_KEY);
      if (selected?.value === id)
        await tx.objectStore("settings").delete(SELECTED_CHARACTER_KEY);
      // 推しを消しても作品ドラフトは残し、同じトランザクションで未分類へ移す。
      const artworks = tx.objectStore("artworks");
      const drafts = await artworks.getAll();
      const now = new Date().toISOString();
      for (const draft of drafts) {
        if (draft?.characterId !== id) continue;
        validateArtworkDraft(draft);
        const detached = {
          ...draft,
          updatedAt: now,
          revision: draft.revision + 1,
        };
        delete detached.characterId;
        await artworks.put(detached);
      }
    })();
    await Promise.all([
      operation.catch((error) => {
        try {
          tx.abort();
        } catch {
          /* transaction already ended */
        }
        throw error;
      }),
      tx.done,
    ]);
  } finally {
    db.close();
  }
}

export async function selectCharacter(id: string | null): Promise<void> {
  const db = await openWorkshopDB();
  const tx = db.transaction(["characters", "settings"], "readwrite");
  try {
    const operation = (async () => {
      if (id === null) {
        await tx.objectStore("settings").delete(SELECTED_CHARACTER_KEY);
        return;
      }
      const character = await tx.objectStore("characters").get(id);
      if (!character) throw new CharacterConflictError();
      validateCharacter(character);
      await tx
        .objectStore("settings")
        .put({ key: SELECTED_CHARACTER_KEY, value: id });
    })();
    await Promise.all([
      operation.catch((error) => {
        try {
          tx.abort();
        } catch {
          /* transaction already ended */
        }
        throw error;
      }),
      tx.done,
    ]);
  } finally {
    db.close();
  }
}

export async function getSelectedCharacterId(): Promise<string | undefined> {
  const db = await openWorkshopDB();
  try {
    const tx = db.transaction(["characters", "settings"]);
    const operation = (async () => {
      const selected = await tx
        .objectStore("settings")
        .get(SELECTED_CHARACTER_KEY);
      if (!selected) return undefined;
      if (typeof selected.value !== "string") throw new StorageSchemaError();
      const character = await tx.objectStore("characters").get(selected.value);
      if (!character) return undefined; // 壊れた選択参照で他の推しまで利用不能にしない。
      validateCharacter(character);
      return character.id;
    })();
    const [result] = await Promise.all([operation, tx.done]);
    return result;
  } finally {
    db.close();
  }
}
