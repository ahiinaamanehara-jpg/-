import { describe, expect, it } from "vitest";
import { isTracingSettings } from "../src/drawing/tracing";
import { referencesAsset, validateArtworkDraft } from "../src/data/database";
import { validateManifest } from "../src/data/backup";

const settings = { assetId: "guide", opacity: 30, visible: true };
const artwork = {
  id: "work",
  theme: "",
  themeCategory: null,
  status: "in-progress" as const,
  width: 960 as const,
  height: 960 as const,
  revision: 1,
  createdAt: "2026-10-24",
  updatedAt: "2026-10-24",
};
const manifest = () => ({
  format: "suki-sketch",
  version: 2,
  createdAt: "2026-10-24",
  characters: [],
  artworks: [{ ...artwork, tracing: settings }],
  reflections: [],
  settings: [],
  assets: [
    {
      id: "guide",
      kind: "guide",
      mime: "image/png",
      size: 100,
      width: 16,
      height: 8,
      file: "assets/0.png",
    },
  ],
});

describe("下絵の設定と旧作品", () => {
  it("下絵のない旧作品と、非表示・濃さの両端を受け入れる", () => {
    expect(validateArtworkDraft(artwork)).toBe(artwork);
    for (const opacity of [10, 30, 70])
      for (const visible of [false, true]) {
        expect(isTracingSettings({ ...settings, opacity, visible })).toBe(true);
      }
  });
  it.each([
    null,
    {},
    { ...settings, assetId: "" },
    { ...settings, assetId: "a".repeat(201) },
    { ...settings, opacity: 0 },
    { ...settings, opacity: 71 },
    { ...settings, opacity: 30.5 },
    { ...settings, opacity: NaN },
    { ...settings, visible: "true" },
  ])("不正な下絵設定を拒否する: %#", (value) =>
    expect(isTracingSettings(value)).toBe(false),
  );
  it("作品画像と同じIDを下絵に指定させない", () => {
    expect(() =>
      validateArtworkDraft({
        ...artwork,
        canvasAssetId: "guide",
        thumbnailAssetId: "thumb",
        tracing: settings,
      }),
    ).toThrow();
  });
  it("別作品の下絵の参照も削除防止の対象にする", () => {
    expect(referencesAsset({ ...artwork, tracing: settings }, "guide")).toBe(
      true,
    );
    expect(referencesAsset(artwork, "guide")).toBe(false);
  });
});

describe("下絵を含むバックアップ", () => {
  it("旧v1と、下絵・濃さ・表示状態を含むv2を読む", () => {
    const v2 = manifest();
    expect(validateManifest(v2).artworks[0].tracing).toEqual(settings);
    expect(
      validateManifest({ ...v2, version: 1, artworks: [artwork], assets: [] })
        .version,
    ).toBe(1);
  });
  it("旧版への下絵の混入と欠けた・別種の参照を拒否する", () => {
    expect(() => validateManifest({ ...manifest(), version: 1 })).toThrow();
    expect(() => validateManifest({ ...manifest(), assets: [] })).toThrow();
    expect(() =>
      validateManifest({
        ...manifest(),
        assets: [{ ...manifest().assets[0], kind: "reference" }],
      }),
    ).toThrow();
  });
  it("複数作品が同じ下絵を所有するバックアップを拒否する", () => {
    const m = manifest();
    expect(() =>
      validateManifest({
        ...m,
        artworks: [...m.artworks, { ...m.artworks[0], id: "other" }],
      }),
    ).toThrow();
  });
});
