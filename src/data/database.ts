import { openDB, type DBSchema } from "idb";
interface WorkshopDB extends DBSchema {
  settings: { key: string; value: { key: string; value: string } };
}

export class StorageSchemaError extends Error {
  constructor() {
    super("保存データの構造を確認できません");
    this.name = "StorageSchemaError";
  }
}

// M1は設定ストアのみ。以降の工程で非破壊のバージョン移行を追加する。
export async function openWorkshopDB(name = "suki-sketch") {
  const db = await openDB<WorkshopDB>(name, 1, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) db.createObjectStore("settings", { keyPath: "key" });
    },
    // 将来別タブで非破壊移行を実行する際、古い接続で移行を妨げない。
    blocking() {
      db.close();
    },
  });
  try {
    if (!db.objectStoreNames.contains("settings"))
      throw new StorageSchemaError();
    const tx = db.transaction("settings");
    const valid = tx.store.keyPath === "key" && !tx.store.autoIncrement;
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
    if (setting.key !== key || typeof setting.value !== "string") {
      throw new StorageSchemaError();
    }
    return setting.value;
  } finally {
    db.close();
  }
}
export async function writeSetting(key: string, value: string) {
  const db = await openWorkshopDB();
  try {
    const tx = db.transaction("settings", "readwrite");
    // 書込要求が失敗しても、tx.doneの拒否を未処理にしない。
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
