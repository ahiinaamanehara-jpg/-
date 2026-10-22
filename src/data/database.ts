import { openDB, type DBSchema, type IDBPDatabase } from "idb";

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

export type ThemeCategory = "expression" | "costume" | "pose" | "free";

export interface ArtworkDraft {
  id: string;
  characterId?: string;
  theme: string;
  themeCategory: ThemeCategory | null;
  status: "in-progress";
  width: 960;
  height: 960;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface WorkshopDB extends DBSchema {
  settings: { key: string; value: { key: string; value: string } };
  characters: { key: string; value: Character };
  assets: { key: string; value: ReferenceAsset };
  artworks: { key: string; value: ArtworkDraft };
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
    value.status !== "in-progress" ||
    value.width !== 960 ||
    value.height !== 960 ||
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

export async function openWorkshopDB(name = "suki-sketch") {
  const connection: { current?: IDBPDatabase<WorkshopDB> } = {};
  let abandoned = false;
  let upgradeFailure: unknown;
  let rejectBlocked: (error: Error) => void = () => {};
  const blocked = new Promise<never>((_, reject) => {
    rejectBlocked = reject;
  });
  const opening = openDB<WorkshopDB>(name, 3, {
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
        }
      } catch (error) {
        upgradeFailure = error;
        tx.abort();
      }
    },
    blocked() {
      abandoned = true;
      rejectBlocked(new StorageBlockedError());
    },
    blocking() {
      connection.current?.close();
    },
  });
  // blockedで戻った後に接続が開いても保持しない。遅延した移行も上で中止する。
  void opening.then(
    (db) => {
      if (abandoned) db.close();
    },
    () => {},
  );
  let db: IDBPDatabase<WorkshopDB>;
  try {
    db = await Promise.race([opening, blocked]);
  } catch (error) {
    throw upgradeFailure ?? error;
  }
  connection.current = db;
  try {
    const names = ["settings", "characters", "assets", "artworks"] as const;
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
    await tx.done;
    if (!valid) throw new StorageSchemaError();
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
