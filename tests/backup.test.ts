import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { crc32, readBackupZip, MAX_ZIP } from "../src/data/backupZip";
import { validateManifest } from "../src/data/backup";
const base = () => ({
  format: "suki-sketch",
  version: 1,
  createdAt: "2026-10-22T00:00:00Z",
  characters: [],
  artworks: [],
  reflections: [],
  assets: [],
  settings: [],
});
describe("限定ZIP形式", () => {
  it("CRC32の標準ベクトルとSTORE形式を読む", () => {
    expect(crc32(strToU8("123456789"))).toBe(0xcbf43926);
    const archive = zipSync(
      { "manifest.json": strToU8(JSON.stringify(base())) },
      { level: 0 },
    );
    expect(
      JSON.parse(
        new TextDecoder().decode(readBackupZip(archive).get("manifest.json")),
      ),
    ).toEqual(base());
  });
  it.each([
    "../manifest.json",
    "/manifest.json",
    "assets/../0.png",
    "assets\\0.png",
    "script.js",
  ])("不正パスや余分なファイルを拒否: %s", (name) => {
    const archive = zipSync(
      { "manifest.json": strToU8("{}"), [name]: strToU8("x") },
      { level: 0 },
    );
    expect(() => readBackupZip(archive)).toThrow();
  });
  it("Deflate・破損・容量超過を拒否する", () => {
    expect(() =>
      readBackupZip(
        zipSync({ "manifest.json": strToU8("x".repeat(500)) }, { level: 9 }),
      ),
    ).toThrow();
    const archive = zipSync({ "manifest.json": strToU8("{}") }, { level: 0 });
    archive[43] ^= 1;
    expect(() => readBackupZip(archive)).toThrow();
    expect(() => readBackupZip(new Uint8Array(MAX_ZIP + 1))).toThrow();
  });
  it("偽の長さ・多重ディスク・切断されたアーカイブを拒否する", () => {
    const a = zipSync({ "manifest.json": strToU8("{}") }, { level: 0 });
    const b = a.slice();
    new DataView(b.buffer).setUint16(b.length - 18, 1, true);
    expect(() => readBackupZip(b)).toThrow();
    expect(() => readBackupZip(a.slice(0, -1))).toThrow();
    const c = a.slice();
    const v = new DataView(c.buffer);
    const d = v.getUint32(c.length - 6, true);
    v.setUint32(d + 24, 0xffffffff, true);
    expect(() => readBackupZip(c)).toThrow();
  });
});
describe("バックアップの関係と上限", () => {
  it("空データと現在の形式を受け入れる", () =>
    expect(validateManifest(base()).version).toBe(1));
  it.each([
    { version: 3 },
    { format: "other" },
    { createdAt: "invalid" },
    { characters: null },
    { assets: [{}] },
    { artworks: [{}] },
    { reflections: [{}] },
    { settings: [{ key: "lastArtworkId", value: "missing" }] },
  ])("未対応版・不正データを拒否: %#", (patch) =>
    expect(() => validateManifest({ ...base(), ...patch })).toThrow(),
  );
  it("推し・作品・画像の壊れた参照を拒否する", () => {
    const c = {
      id: "c",
      name: "推し",
      memo: "",
      revision: 1,
      createdAt: "2026-10-22",
      updatedAt: "2026-10-22",
      referenceAssetId: "missing",
    };
    expect(() => validateManifest({ ...base(), characters: [c] })).toThrow();
    expect(() =>
      validateManifest({
        ...base(),
        characters: [
          { ...c, referenceAssetId: undefined },
          { ...c, referenceAssetId: undefined },
        ],
      }),
    ).toThrow();
  });
});
