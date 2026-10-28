import { isDrawingTools, type DrawingTools } from "../drawing/tools";
import { isCanvasDimensions } from "../drawing/dimensions";
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Reflection } from "./reflectionTypes";
import type { QuestionId } from "./reflectionQuestions";
import { isTracingSettings, type TracingSettings } from "../drawing/tracing";
import {
  isStoredLayerStack,
  type LayerStack,
  type StoredLayer,
} from "../drawing/layers";

export interface Character {
  id: string;
  name: string;
  memo: string;
  referenceAssetId?: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface ReferenceAsset {
  id: string;
  kind: "reference";
  blob: Blob;
  mime: string;
  size: number;
  width: number;
  height: number;
}

export interface ArtworkAsset {
  id: string;
  kind: "canvas" | "thumbnail";
  blob: Blob;
  mime: string;
  size: number;
  width: number;
  height: number;
}
export interface GuideAsset extends Omit<ReferenceAsset, "kind"> {
  kind: "guide";
}
export interface LayerAsset extends Omit<ArtworkAsset, "kind"> {
  kind: "layer";
}
export type StoredAsset =
  ReferenceAsset | ArtworkAsset | GuideAsset | LayerAsset;

export type ThemeCategory = "expression" | "costume" | "pose" | "free";

export interface ArtworkDraft {
  id: string;
  characterId?: string;
  theme: string;
  themeCategory: ThemeCategory | null;
  status: "in-progress" | "finished";
  canvasAssetId?: string;
  thumbnailAssetId?: string;
  tools?: DrawingTools;
  tracing?: TracingSettings;
  layers?: LayerStack<StoredLayer>;
  width: number;
  height: number;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface WorkshopDB extends DBSchema {
  settings: { key: string; value: { key: string; value: string } };
  characters: { key: string; value: Character };
  assets: { key: string; value: StoredAsset };
  artworks: { key: string; value: ArtworkDraft };
  reflections: {
    key: string;
    value: Reflection;
    indexes: { "by-artwork": string; "by-question": [string, QuestionId] };
  };
}

export function referencesAsset(
  record: ArtworkDraft | { referenceAssetId?: string },
  id: string,
) {
  return (
    ("canvasAssetId" in record && record.canvasAssetId === id) ||
    ("thumbnailAssetId" in record && record.thumbnailAssetId === id) ||
    ("tracing" in record && record.tracing?.assetId === id) ||
    ("layers" in record &&
      record.layers?.items?.some((layer) => layer.assetId === id)) ||
    ("referenceAssetId" in record && record.referenceAssetId === id)
  );
}

export class StorageSchemaError extends Error {
  constructor() {
    super("保存データの構造を確認できません。既存データは変更していません。");
    this.name = "StorageSchemaError";
  }
}

export function validateArtworkDraft(value: ArtworkDraft): ArtworkDraft {
  if (
    !value ||
    typeof value.id !== "string" ||
    !value.id ||
    (value.characterId !== undefined &&
      (typeof value.characterId !== "string" || !value.characterId)) ||
    typeof value.theme !== "string" ||
    value.theme.length > 500 ||
    !(
      value.themeCategory === null ||
      ["expression", "costume", "pose", "free"].includes(value.themeCategory)
    ) ||
    !["in-progress", "finished"].includes(value.status) ||
    (value.canvasAssetId !== undefined &&
      (typeof value.canvasAssetId !== "string" || !value.canvasAssetId)) ||
    (value.thumbnailAssetId !== undefined &&
      (typeof value.thumbnailAssetId !== "string" ||
        !value.thumbnailAssetId)) ||
    Boolean(value.canvasAssetId) !== Boolean(value.thumbnailAssetId) ||
    (value.canvasAssetId !== undefined &&
      value.canvasAssetId === value.thumbnailAssetId) ||
    (value.tools !== undefined && !isDrawingTools(value.tools)) ||
    (value.tracing !== undefined &&
      (!isTracingSettings(value.tracing) ||
        value.tracing.assetId === value.canvasAssetId ||
        value.tracing.assetId === value.thumbnailAssetId)) ||
    (value.layers !== undefined &&
      (!isStoredLayerStack(value.layers) ||
        !value.canvasAssetId ||
        value.layers.items.some((layer) =>
          [
            value.canvasAssetId,
            value.thumbnailAssetId,
            value.tracing?.assetId,
          ].includes(layer.assetId),
        ))) ||
    !isCanvasDimensions(value) ||
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

export class StorageBlockedError extends Error {
  constructor() {
    super(
      "別のタブが保存領域を使用しています。このアプリの他のタブを閉じて再試行してください。",
    );
    this.name = "StorageBlockedError";
  }
}

// IDBは同じDBへのopenを直列に処理するため、先頭がblockedになると
// 後続のopenにはblockedイベントすら届かない。同時に開いている呼出しへ共有する。
const pendingOpens = new Map<
  string,
  {
    error?: StorageBlockedError;
    rejectors: Set<(error: StorageBlockedError) => void>;
  }
>();

export async function openWorkshopDB(name = "suki-sketch") {
  let group = pendingOpens.get(name);
  if (group?.error) throw group.error;
  if (!group) {
    group = { rejectors: new Set() };
    pendingOpens.set(name, group);
  }
  const currentGroup = group;
  const connection: { current?: IDBPDatabase<WorkshopDB> } = {};
  let abandoned = false;
  let upgradeFailure: unknown;
  let rejectBlocked: (error: Error) => void = () => {};
  const blocked = new Promise<never>((_, reject) => {
    rejectBlocked = reject;
  });
  const rejectOpening = (error: StorageBlockedError) => {
    abandoned = true;
    rejectBlocked(error);
  };
  currentGroup.rejectors.add(rejectOpening);
  const release = () => {
    currentGroup.rejectors.delete(rejectOpening);
    if (!currentGroup.rejectors.size) pendingOpens.delete(name);
  };
  const opening = Promise.resolve().then(() =>
    openDB<WorkshopDB>(name, 6, {
      upgrade(db, oldVersion, _newVersion, tx) {
        try {
          if (abandoned) {
            tx.abort();
            return;
          }
          if (oldVersion === 0) {
            db.createObjectStore("settings", { keyPath: "key" });
          } else {
            // 不整合なv1を勝手に初期化せず、移行トランザクションごと中止する。
            if (!db.objectStoreNames.contains("settings"))
              throw new StorageSchemaError();
            const settings = tx.objectStore("settings");
            if (settings.keyPath !== "key" || settings.autoIncrement)
              throw new StorageSchemaError();
          }
          if (oldVersion < 2) {
            if (
              db.objectStoreNames.contains("characters") ||
              db.objectStoreNames.contains("assets")
            )
              throw new StorageSchemaError();
            db.createObjectStore("characters", { keyPath: "id" });
            db.createObjectStore("assets", { keyPath: "id" });
          } else {
            // 旧v2が不整合なら、artworksを追加する前に移行全体を中止する。
            for (const name of ["characters", "assets"] as const) {
              if (!db.objectStoreNames.contains(name))
                throw new StorageSchemaError();
              const store = tx.objectStore(name);
              if (store.keyPath !== "id" || store.autoIncrement)
                throw new StorageSchemaError();
            }
          }
          if (oldVersion < 3) {
            if (db.objectStoreNames.contains("artworks"))
              throw new StorageSchemaError();
            db.createObjectStore("artworks", { keyPath: "id" });
          } else {
            if (!db.objectStoreNames.contains("artworks"))
              throw new StorageSchemaError();
            const artworks = tx.objectStore("artworks");
            if (artworks.keyPath !== "id" || artworks.autoIncrement)
              throw new StorageSchemaError();
          }
          if (oldVersion < 4) {
            if (db.objectStoreNames.contains("reflections"))
              throw new StorageSchemaError();
            const reflections = db.createObjectStore("reflections", {
              keyPath: "id",
            });
            reflections.createIndex("by-artwork", "artworkId");
            reflections.createIndex(
              "by-question",
              ["artworkId", "questionId"],
              {
                unique: true,
              },
            );
          } else {
            // v5・v6はストアを変えず、旧版でレイヤーや長方形作品を上書きさせない。
            if (!db.objectStoreNames.contains("reflections"))
              throw new StorageSchemaError();
            const store = tx.objectStore("reflections");
            if (
              store.keyPath !== "id" ||
              store.autoIncrement ||
              !store.indexNames.contains("by-artwork") ||
              !store.indexNames.contains("by-question")
            )
              throw new StorageSchemaError();
            const artwork = store.index("by-artwork"),
              question = store.index("by-question");
            if (
              artwork.keyPath !== "artworkId" ||
              artwork.unique ||
              !question.unique ||
              !Array.isArray(question.keyPath) ||
              JSON.stringify(question.keyPath) !==
                JSON.stringify(["artworkId", "questionId"])
            )
              throw new StorageSchemaError();
          }
        } catch (error) {
          upgradeFailure = error;
          tx.abort();
        }
      },
      blocked() {
        currentGroup.error ??= new StorageBlockedError();
        for (const reject of currentGroup.rejectors) reject(currentGroup.error);
      },
      blocking() {
        connection.current?.close();
      },
    }),
  );
  // blockedで戻った後に接続が開いても保持しない。遅延した移行も上で中止する。
  void opening.then((db) => {
    if (abandoned) db.close();
    release();
  }, release);
  let db: IDBPDatabase<WorkshopDB>;
  try {
    db = await Promise.race([opening, blocked]);
  } catch (error) {
    throw upgradeFailure ?? error;
  }
  connection.current = db;
  try {
    const names = [
      "settings",
      "characters",
      "assets",
      "artworks",
      "reflections",
    ] as const;
    if (names.some((store) => !db.objectStoreNames.contains(store)))
      throw new StorageSchemaError();
    const tx = db.transaction(names);
    const valid = names.every((name) => {
      const store = tx.objectStore(name);
      return (
        store.keyPath === (name === "settings" ? "key" : "id") &&
        !store.autoIncrement
      );
    });
    const reflections = tx.objectStore("reflections");
    if (
      !reflections.indexNames.contains("by-artwork") ||
      !reflections.indexNames.contains("by-question")
    )
      throw new StorageSchemaError();
    const byArtwork = reflections.index("by-artwork"),
      byQuestion = reflections.index("by-question");
    const questionPath = byQuestion.keyPath;
    const validIndexes =
      byArtwork.keyPath === "artworkId" &&
      !byArtwork.unique &&
      byQuestion.unique &&
      Array.isArray(questionPath) &&
      questionPath.length === 2 &&
      questionPath[0] === "artworkId" &&
      questionPath[1] === "questionId";
    await tx.done;
    if (!valid || !validIndexes) throw new StorageSchemaError();
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

// 開けるだけでは容量不足・書込不可を判断できない。既存キーは上書きせず、
// 一意の検査用キーを同一トランザクション内で追加・削除する。
export async function checkWorkshopStorage() {
  const db = await openWorkshopDB();
  try {
    const tx = db.transaction("settings", "readwrite");
    const key = `storage-check:${crypto.randomUUID()}`;
    await Promise.all([
      (async () => {
        await tx.store.add({ key, value: "check" });
        await tx.store.delete(key);
      })(),
      tx.done,
    ]);
  } finally {
    db.close();
  }
}

export async function readSetting(key: string) {
  const db = await openWorkshopDB();
  try {
    const setting = await db.get("settings", key);
    if (setting === undefined) return undefined;
    if (!setting || setting.key !== key || typeof setting.value !== "string")
      throw new StorageSchemaError();
    return setting.value;
  } finally {
    db.close();
  }
}

export async function writeSetting(key: string, value: string) {
  const db = await openWorkshopDB();
  try {
    const tx = db.transaction("settings", "readwrite");
    await Promise.all([
      (async () => {
        await tx.store.put({ key, value });
      })(),
      tx.done,
    ]);
  } finally {
    db.close();
  }
}
