import {
  openWorkshopDB,
  StorageSchemaError,
  validateArtworkDraft,
  type ArtworkDraft,
} from "./database";
import { questionById, type QuestionId } from "./reflectionQuestions";
import type { Reflection } from "./reflectionTypes";
export type { Reflection } from "./reflectionTypes";

export class ReflectionConflictError extends Error {
  constructor() {
    super(
      "別の画面で振り返りが変更されています。上書きしていません。入力を控えてから一覧を読み直してください。",
    );
    this.name = "ReflectionConflictError";
  }
}
export function validateReflection(value: Reflection): Reflection {
  const question =
    value &&
    typeof value.questionId === "string" &&
    questionById(value.questionId);
  if (
    !value ||
    typeof value.id !== "string" ||
    !value.id ||
    typeof value.artworkId !== "string" ||
    !value.artworkId ||
    !question ||
    (value.comparisonUnavailable !== undefined &&
      (value.comparisonUnavailable !== true ||
        value.questionId !== "change")) ||
    typeof value.text !== "string" ||
    value.text.length > 2000 ||
    !(
      value.choice === null ||
      (typeof value.choice === "string" &&
        (question.choices as readonly string[]).includes(value.choice))
    ) ||
    (value.questionId === "change"
      ? typeof value.comparedArtworkId !== "string" ||
        !value.comparedArtworkId ||
        value.comparedArtworkId === value.artworkId
      : value.comparedArtworkId !== undefined) ||
    typeof value.createdAt !== "string" ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    typeof value.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(value.updatedAt)) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1
  )
    throw new StorageSchemaError();
  return value;
}
export function isPreviousArtwork(
  current: ArtworkDraft,
  previous: ArtworkDraft,
) {
  return Boolean(
    current.characterId &&
    current.characterId === previous.characterId &&
    current.id !== previous.id &&
    previous.canvasAssetId &&
    Date.parse(previous.createdAt) < Date.parse(current.createdAt),
  );
}
export async function loadReflectionContext(artworkId: string) {
  const db = await openWorkshopDB();
  try {
    const tx = db.transaction(["artworks", "reflections"]);
    const operation = (async () => {
      const raw = await tx.objectStore("artworks").get(artworkId);
      if (!raw)
        throw new Error("作品が見つかりません。振り返りの保存を止めています。");
      const artwork = validateArtworkDraft(raw);
      if (artwork.id !== artworkId) throw new StorageSchemaError();
      const reflections = (
        await tx
          .objectStore("reflections")
          .index("by-artwork")
          .getAll(artworkId)
      ).map(validateReflection);
      if (reflections.some((record) => record.artworkId !== artworkId))
        throw new StorageSchemaError();
      // 不正な別作品は候補に出さない。元データは変更しない。
      const previous: ArtworkDraft[] = [];
      for (const candidate of await tx.objectStore("artworks").getAll()) {
        try {
          if (isPreviousArtwork(artwork, validateArtworkDraft(candidate)))
            previous.push(candidate);
        } catch {
          /* 壊れた他作品を自動削除・修復しない */
        }
      }
      previous.sort(
        (a, b) =>
          Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
          a.id.localeCompare(b.id),
      );
      reflections.sort(
        (a, b) =>
          Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
          a.id.localeCompare(b.id),
      );
      return { artwork, reflections, previous };
    })();
    const [context] = await Promise.all([operation, tx.done]);
    return context;
  } finally {
    db.close();
  }
}
export type ReflectionContext = Awaited<
  ReturnType<typeof loadReflectionContext>
>;
export interface SaveReflectionInput {
  artworkId: string;
  questionId: QuestionId;
  text: string;
  choice: string | null;
  comparedArtworkId?: string;
  expectedRevision?: number;
}
export async function saveReflection(
  input: SaveReflectionInput,
): Promise<Reflection> {
  const now = new Date().toISOString();
  // 容量と選択肢をDBへ触れる前にも検証する。空の回答は保存できる。
  validateReflection({
    ...input,
    id: "validation",
    createdAt: now,
    updatedAt: now,
    revision: 1,
  });
  const db = await openWorkshopDB();
  try {
    const tx = db.transaction(["artworks", "reflections"], "readwrite");
    const operation = (async () => {
      const raw = await tx.objectStore("artworks").get(input.artworkId);
      if (!raw)
        throw new Error(
          "作品が見つかりません。振り返りは保存していません。入力はこの画面に残っています。",
        );
      const artwork = validateArtworkDraft(raw);
      const store = tx.objectStore("reflections");
      const stored = await store
        .index("by-question")
        .get([input.artworkId, input.questionId]);
      const previous = stored && validateReflection(stored);
      if ((previous ? previous.revision : undefined) !== input.expectedRevision)
        throw new ReflectionConflictError();
      if (
        input.questionId === "change" &&
        input.comparedArtworkId !== previous?.comparedArtworkId
      ) {
        const compared = await tx
          .objectStore("artworks")
          .get(input.comparedArtworkId!);
        if (
          !compared ||
          !isPreviousArtwork(artwork, validateArtworkDraft(compared))
        )
          throw new Error(
            "同じ推しの前の作品が見つかりません。作品を選び直すか、この質問をスキップできます。",
          );
      }
      const next: Reflection = {
        id: previous?.id ?? crypto.randomUUID(),
        artworkId: input.artworkId,
        questionId: input.questionId,
        text: input.text,
        choice: input.choice,
        ...(input.comparedArtworkId
          ? { comparedArtworkId: input.comparedArtworkId }
          : {}),
        ...(previous?.comparisonUnavailable &&
        previous.comparedArtworkId === input.comparedArtworkId
          ? { comparisonUnavailable: true as const }
          : {}),
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
        revision: (previous?.revision ?? 0) + 1,
      };
      await store.put(next);
      return next;
    })();
    const [saved] = await Promise.all([
      operation.catch((error) => {
        try {
          tx.abort();
        } catch {
          /* 終了済み */
        }
        throw error;
      }),
      tx.done,
    ]);
    return saved;
  } finally {
    db.close();
  }
}
export async function deleteReflection(id: string, expectedRevision: number) {
  const db = await openWorkshopDB();
  try {
    const tx = db.transaction("reflections", "readwrite");
    const operation = (async () => {
      const raw = await tx.store.get(id);
      if (!raw || validateReflection(raw).revision !== expectedRevision)
        throw new ReflectionConflictError();
      await tx.store.delete(id);
    })();
    await Promise.all([
      operation.catch((error) => {
        try {
          tx.abort();
        } catch {
          /* 終了済み */
        }
        throw error;
      }),
      tx.done,
    ]);
  } finally {
    db.close();
  }
}
