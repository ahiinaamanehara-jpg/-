import {
  openWorkshopDB,
  StorageSchemaError,
  validateArtworkDraft,
  type ArtworkDraft,
  type ThemeCategory,
} from "./database";
export type { ArtworkDraft, ThemeCategory } from "./database";

const LAST_ARTWORK_KEY = "lastArtworkId";
const categories = new Set<ThemeCategory>([
  "expression",
  "costume",
  "pose",
  "free",
]);

export class DraftValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftValidationError";
  }
}

export interface CreateDraftInput {
  characterId?: string;
  theme: string;
  themeCategory: ThemeCategory | null;
}

export async function createDraft(
  input: CreateDraftInput,
): Promise<ArtworkDraft> {
  if (typeof input.theme !== "string" || input.theme.length > 500) {
    throw new DraftValidationError("テーマは500文字以内で入力してください。");
  }
  if (input.themeCategory !== null && !categories.has(input.themeCategory)) {
    throw new DraftValidationError("テーマの種類を選び直してください。");
  }
  if (
    input.characterId !== undefined &&
    (typeof input.characterId !== "string" || !input.characterId)
  ) {
    throw new DraftValidationError("推しを選び直してください。");
  }
  const db = await openWorkshopDB();
  try {
    const tx = db.transaction(
      ["characters", "artworks", "settings"],
      "readwrite",
    );
    const operation = (async () => {
      if (input.characterId !== undefined) {
        const character = await tx
          .objectStore("characters")
          .get(input.characterId);
        if (!character)
          throw new DraftValidationError(
            "選んだ推しは削除されています。推しを選び直すか、推しを選ばずに進んでください。",
          );
        if (
          character.id !== input.characterId ||
          typeof character.name !== "string" ||
          !character.name.trim()
        )
          throw new StorageSchemaError();
      }
      const now = new Date().toISOString();
      const draft: ArtworkDraft = {
        id: crypto.randomUUID(),
        ...(input.characterId !== undefined
          ? { characterId: input.characterId }
          : {}),
        theme: input.theme.trim(),
        themeCategory: input.themeCategory,
        status: "in-progress",
        width: 960,
        height: 960,
        createdAt: now,
        updatedAt: now,
        revision: 1,
      };
      await tx.objectStore("artworks").add(draft);
      await tx
        .objectStore("settings")
        .put({ key: LAST_ARTWORK_KEY, value: draft.id });
      return draft;
    })();
    const [draft] = await Promise.all([
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
    return draft;
  } finally {
    db.close();
  }
}

export async function loadDraft(id: string): Promise<ArtworkDraft | undefined> {
  const db = await openWorkshopDB();
  try {
    const raw = await db.get("artworks", id);
    if (raw === undefined) return undefined;
    const draft = validateArtworkDraft(raw);
    if (draft.id !== id) throw new StorageSchemaError();
    return draft;
  } finally {
    db.close();
  }
}

export async function getLastDraft(): Promise<ArtworkDraft | undefined> {
  const db = await openWorkshopDB();
  try {
    const tx = db.transaction(["settings", "artworks"]);
    const operation = (async () => {
      const setting = await tx.objectStore("settings").get(LAST_ARTWORK_KEY);
      if (setting === undefined) return undefined;
      if (
        !setting ||
        setting.key !== LAST_ARTWORK_KEY ||
        typeof setting.value !== "string" ||
        !setting.value
      )
        throw new StorageSchemaError();
      const raw = await tx.objectStore("artworks").get(setting.value);
      if (raw === undefined) return undefined;
      const draft = validateArtworkDraft(raw);
      if (draft.id !== setting.value) throw new StorageSchemaError();
      return draft;
    })();
    const [draft] = await Promise.all([operation, tx.done]);
    return draft;
  } finally {
    db.close();
  }
}

/** 開いたドラフトを記録する。作品そのものの更新日時・revisionは変更しない。 */
export async function markDraftOpened(id: string): Promise<void> {
  const db = await openWorkshopDB();
  try {
    const tx = db.transaction(["artworks", "settings"], "readwrite");
    const operation = (async () => {
      const raw = await tx.objectStore("artworks").get(id);
      if (raw === undefined)
        throw new DraftValidationError(
          "途中データが見つかりません。ホームから選び直してください。",
        );
      const draft = validateArtworkDraft(raw);
      if (draft.id !== id) throw new StorageSchemaError();
      await tx
        .objectStore("settings")
        .put({ key: LAST_ARTWORK_KEY, value: draft.id });
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
