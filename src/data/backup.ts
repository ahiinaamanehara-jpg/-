import {
  openWorkshopDB,
  validateArtworkDraft,
  type ArtworkDraft,
  type Character,
  type StoredAsset,
} from "./database";
import { validateCharacter } from "./characters";
import { validateReflection, type Reflection } from "./reflections";
import { inspectImageDimensions } from "./images";
import { decodePNG } from "../drawing/surface";
import {
  backupError,
  MAX_MANIFEST,
  MAX_ZIP,
  readBackupZip,
  writeBackupZip,
} from "./backupZip";
export interface Snapshot {
  characters: Character[];
  artworks: ArtworkDraft[];
  reflections: Reflection[];
  assets: StoredAsset[];
  settings: Array<{ key: string; value: string }>;
}
interface AssetRecord {
  id: string;
  kind: StoredAsset["kind"];
  mime: string;
  size: number;
  width: number;
  height: number;
  file: string;
}
interface Manifest {
  format: "suki-sketch";
  version: 1;
  createdAt: string;
  characters: Character[];
  artworks: ArtworkDraft[];
  reflections: Reflection[];
  assets: AssetRecord[];
  settings: Snapshot["settings"];
}
const textEncoder = new TextEncoder();
function pick<T>(raw: T, fields: string[]): T {
  return Object.fromEntries(
    fields
      .filter((key) => Object.hasOwn(raw as object, key))
      .map((key) => [key, (raw as Record<string, unknown>)[key]]),
  ) as T;
}
const characterKeys = [
  "id",
  "name",
  "memo",
  "referenceAssetId",
  "createdAt",
  "updatedAt",
  "revision",
];
const artworkKeys = [
  "id",
  "characterId",
  "theme",
  "themeCategory",
  "status",
  "canvasAssetId",
  "thumbnailAssetId",
  "tools",
  "width",
  "height",
  "createdAt",
  "updatedAt",
  "revision",
];
const reflectionKeys = [
  "id",
  "artworkId",
  "questionId",
  "text",
  "choice",
  "comparedArtworkId",
  "comparisonUnavailable",
  "createdAt",
  "updatedAt",
  "revision",
];
const assetKeys = ["id", "kind", "mime", "size", "width", "height", "file"];
function unique<T extends { id: string }>(rows: T[]) {
  if (rows.length > 10000) throw backupError();
  const map = new Map<string, T>();
  for (const row of rows) {
    if (
      !row ||
      typeof row.id !== "string" ||
      !row.id ||
      row.id.length > 200 ||
      map.has(row.id)
    )
      throw backupError();
    map.set(row.id, row);
  }
  return map;
}
function validateGraph(
  data: Omit<Snapshot, "assets"> & { assets: Array<Omit<StoredAsset, "blob">> },
) {
  const characters = unique(data.characters.map(validateCharacter)),
    artworks = unique(data.artworks.map(validateArtworkDraft)),
    assets = unique(data.assets),
    reflections = unique(data.reflections.map(validateReflection));
  if (assets.size > 1000) throw backupError();
  const owned = new Set<string>(),
    pairs = new Set<string>();
  const link = (id: string | undefined, kind: StoredAsset["kind"]) => {
    if (!id) return;
    if (assets.get(id)?.kind !== kind || owned.has(id)) throw backupError();
    owned.add(id);
  };
  for (const c of characters.values()) link(c.referenceAssetId, "reference");
  for (const a of artworks.values()) {
    if (a.characterId && !characters.has(a.characterId)) throw backupError();
    link(a.canvasAssetId, "canvas");
    link(a.thumbnailAssetId, "thumbnail");
  }
  for (const r of reflections.values()) {
    if (
      !artworks.has(r.artworkId) ||
      (r.comparedArtworkId &&
        !r.comparisonUnavailable &&
        !artworks.has(r.comparedArtworkId))
    )
      throw backupError();
    const pair = JSON.stringify([r.artworkId, r.questionId]);
    if (pairs.has(pair)) throw backupError();
    pairs.add(pair);
  }
  for (const a of assets.values()) {
    if (
      !["canvas", "thumbnail", "reference"].includes(a.kind) ||
      a.mime !== "image/png" ||
      !Number.isSafeInteger(a.size) ||
      a.size < 1 ||
      a.size > 10 * 1024 * 1024 ||
      !Number.isSafeInteger(a.width) ||
      !Number.isSafeInteger(a.height) ||
      a.width < 1 ||
      a.height < 1
    )
      throw backupError();
    const side =
      a.kind === "canvas" ? 960 : a.kind === "thumbnail" ? 192 : undefined;
    if (
      side
        ? a.width !== side || a.height !== side
        : Math.max(a.width, a.height) > 1600
    )
      throw backupError();
  }
  if (data.settings.length > 1000) throw backupError();
  const keys = new Set<string>();
  for (const s of data.settings) {
    if (
      !s ||
      typeof s.key !== "string" ||
      !s.key ||
      s.key.length > 200 ||
      keys.has(s.key) ||
      typeof s.value !== "string" ||
      s.value.length > 2000 ||
      (s.key === "lastArtworkId" && !artworks.has(s.value)) ||
      (s.key === "selectedCharacterId" && !characters.has(s.value))
    )
      throw backupError();
    keys.add(s.key);
  }
}
export async function snapshotWorkshop(): Promise<Snapshot> {
  const db = await openWorkshopDB();
  try {
    const tx = db.transaction([
      "characters",
      "artworks",
      "assets",
      "reflections",
      "settings",
    ]);
    const [characters, artworks, assets, reflections, settings] =
      await Promise.all([
        tx.objectStore("characters").getAll(),
        tx.objectStore("artworks").getAll(),
        tx.objectStore("assets").getAll(),
        tx.objectStore("reflections").getAll(),
        tx.objectStore("settings").getAll(),
        tx.done,
      ]);
    return { characters, artworks, assets, reflections, settings };
  } finally {
    db.close();
  }
}
export function validateManifest(raw: unknown): Manifest {
  if (!raw || typeof raw !== "object") throw backupError();
  const m = raw as Manifest;
  if (
    m.format !== "suki-sketch" ||
    m.version !== 1 ||
    typeof m.createdAt !== "string" ||
    !Number.isFinite(Date.parse(m.createdAt)) ||
    ![m.characters, m.artworks, m.reflections, m.assets, m.settings].every(
      Array.isArray,
    )
  )
    throw backupError();
  try {
    const data: Manifest = {
      format: "suki-sketch",
      version: 1,
      createdAt: m.createdAt,
      characters: m.characters.map((r) => pick(r, characterKeys)),
      artworks: m.artworks.map((r) => pick(r, artworkKeys)),
      reflections: m.reflections.map((r) => pick(r, reflectionKeys)),
      assets: m.assets.map((r) => pick(r, assetKeys)),
      settings: m.settings.map((r) => pick(r, ["key", "value"])),
    };
    validateGraph(data);
    const files = new Set<string>();
    for (const a of data.assets) {
      if (
        !/^assets\/(?:0|[1-9][0-9]{0,3})\.png$/.test(a.file) ||
        files.has(a.file)
      )
        throw backupError();
      files.add(a.file);
    }
    return data;
  } catch {
    throw backupError();
  }
}
async function checkImages(assets: StoredAsset[]) {
  for (let i = 0; i < assets.length; i++) {
    const a = assets[i];
    if (
      !(a.blob instanceof Blob) ||
      a.blob.type !== "image/png" ||
      a.size !== a.blob.size
    )
      throw backupError();
    const size = inspectImageDimensions(
      await a.blob.arrayBuffer(),
      "image/png",
    );
    if (size.width !== a.width || size.height !== a.height) throw backupError();
    const decoded = await decodePNG(a.blob);
    decoded.close();
    if (i % 8 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
export async function exportBackup() {
  const source = await snapshotWorkshop();
  const manifest = validateManifest({
    ...source,
    format: "suki-sketch",
    version: 1,
    createdAt: new Date().toISOString(),
    assets: source.assets.map((a, i) => ({ ...a, file: `assets/${i}.png` })),
  });
  const json = textEncoder.encode(JSON.stringify(manifest));
  if (json.byteLength > MAX_MANIFEST)
    throw new Error(
      "文字情報が多いためバックアップを作れません。個別にPNGを書き出して残してください。",
    );
  if (
    source.assets.reduce((n, a) => n + a.size, json.length) >
    MAX_ZIP - 512 * (source.assets.length + 1)
  )
    throw new Error(
      "バックアップが50MiBを超えます。個別にPNGを書き出して残してください。",
    );
  await checkImages(source.assets);
  return writeBackupZip([
    { name: "manifest.json", blob: new Blob([json]) },
    ...source.assets.map((a, i) => ({ name: `assets/${i}.png`, blob: a.blob })),
  ]);
}
export interface RestorePlan {
  data: Snapshot;
  createdAt: string;
}
const validated = new WeakSet<RestorePlan>();
async function parseArchive(
  buffer: ArrayBuffer,
): Promise<Map<string, Uint8Array>> {
  if (typeof Worker === "undefined")
    return readBackupZip(new Uint8Array(buffer));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./backupWorker.ts", import.meta.url), {
      type: "module",
    });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(backupError());
    }, 30000);
    worker.onmessage = (
      event: MessageEvent<{
        entries?: Map<string, Uint8Array>;
        error?: boolean;
      }>,
    ) => {
      clearTimeout(timer);
      worker.terminate();
      if (event.data.entries) resolve(event.data.entries);
      else reject(backupError());
    };
    worker.onerror = () => {
      clearTimeout(timer);
      worker.terminate();
      reject(backupError());
    };
    worker.postMessage(buffer, [buffer]);
  });
}
export async function inspectBackup(file: Blob): Promise<RestorePlan> {
  if (!file.size || file.size > MAX_ZIP)
    throw new Error("バックアップは50MiB以下のZIPを選んでください。");
  const entries = await parseArchive(await file.arrayBuffer());
  let manifest: Manifest;
  try {
    manifest = validateManifest(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          entries.get("manifest.json")!,
        ),
      ),
    );
  } catch {
    throw backupError();
  }
  if (entries.size !== manifest.assets.length + 1) throw backupError();
  const assets = manifest.assets.map((a): StoredAsset => {
    const bytes = entries.get(a.file);
    if (!bytes || bytes.length !== a.size) throw backupError();
    const { file: _file, ...metadata } = a;
    void _file;
    return {
      ...metadata,
      blob: new Blob([new Uint8Array(bytes)], { type: "image/png" }),
    };
  });
  await checkImages(assets);
  const plan = {
    data: {
      characters: manifest.characters,
      artworks: manifest.artworks,
      reflections: manifest.reflections,
      assets,
      settings: manifest.settings,
    },
    createdAt: manifest.createdAt,
  };
  validated.add(plan);
  return plan;
}
/** IDを全件割り当て直し、1トランザクションで追加。既存ID・設定を上書きしない。 */
export async function restoreBackup(plan: RestorePlan) {
  if (!validated.has(plan)) throw backupError();
  const source = plan.data;
  validateGraph(source);
  const ids = new Map<string, string>();
  const mapId = (kind: string, id: string) => {
    const key = `${kind}:${id}`;
    if (!ids.has(key)) ids.set(key, crypto.randomUUID());
    return ids.get(key)!;
  };
  const characters = source.characters.map((c) => ({
    ...c,
    id: mapId("c", c.id),
    ...(c.referenceAssetId
      ? { referenceAssetId: mapId("s", c.referenceAssetId) }
      : {}),
  }));
  const artworks = source.artworks.map((a) => ({
    ...a,
    id: mapId("a", a.id),
    ...(a.characterId ? { characterId: mapId("c", a.characterId) } : {}),
    ...(a.canvasAssetId
      ? {
          canvasAssetId: mapId("s", a.canvasAssetId),
          thumbnailAssetId: mapId("s", a.thumbnailAssetId!),
        }
      : {}),
  }));
  const reflections = source.reflections.map((r) => ({
    ...r,
    id: mapId("r", r.id),
    artworkId: mapId("a", r.artworkId),
    ...(r.comparedArtworkId
      ? { comparedArtworkId: mapId("a", r.comparedArtworkId) }
      : {}),
  }));
  const db = await openWorkshopDB();
  try {
    const tx = db.transaction(
      ["characters", "artworks", "assets", "reflections", "settings"],
      "readwrite",
    );
    const operation = (async () => {
      for (const a of source.assets)
        await tx.objectStore("assets").add({ ...a, id: mapId("s", a.id) });
      for (const c of characters) await tx.objectStore("characters").add(c);
      for (const a of artworks) await tx.objectStore("artworks").add(a);
      for (const r of reflections) await tx.objectStore("reflections").add(r);
      for (const s of source.settings)
        if (!(await tx.objectStore("settings").get(s.key)))
          await tx.objectStore("settings").add({
            key: s.key,
            value:
              s.key === "lastArtworkId"
                ? mapId("a", s.value)
                : s.key === "selectedCharacterId"
                  ? mapId("c", s.value)
                  : s.value,
          });
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
  return {
    characters: characters.length,
    artworks: artworks.length,
    reflections: reflections.length,
  };
}
