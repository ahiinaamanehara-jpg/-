import { describe, expect, it } from "vitest";
import {
  isLayerStack,
  isStoredLayerStack,
  MAX_LAYERS,
} from "../src/drawing/layers";
import { validateArtworkDraft, type ArtworkDraft } from "../src/data/database";
import { validateManifest } from "../src/data/backup";

const layer = (n: number) => ({
  id: `layer-${n}`,
  name: `レイヤー${n}`,
  visible: true,
  assetId: `image-${n}`,
});
const stack = (count = 2) => ({
  activeId: "layer-1",
  items: Array.from({ length: count }, (_, i) => layer(i + 1)),
});
const artwork: ArtworkDraft = {
  id: "work",
  theme: "",
  themeCategory: null,
  status: "in-progress",
  width: 960,
  height: 960,
  createdAt: "2026-10-26",
  updatedAt: "2026-10-26",
  revision: 1,
  canvasAssetId: "canvas",
  thumbnailAssetId: "thumb",
};
const manifest = () => ({
  format: "suki-sketch",
  version: 3,
  createdAt: "2026-10-26",
  characters: [],
  reflections: [],
  settings: [],
  artworks: [{ ...artwork, layers: stack() }],
  assets: [
    { id: "canvas", kind: "canvas", width: 960, height: 960 },
    { id: "thumb", kind: "thumbnail", width: 192, height: 192 },
    ...stack().items.map((l) => ({
      id: l.assetId,
      kind: "layer",
      width: 960,
      height: 960,
    })),
  ].map((a, i) => ({
    ...a,
    mime: "image/png",
    size: 1,
    file: `assets/${i}.png`,
  })),
});

describe("任意の最大5レイヤーと保存参照", () => {
  it("1枚と5枚、非表示の選択中レイヤーも表現できる", () => {
    expect(MAX_LAYERS).toBe(5);
    expect(isStoredLayerStack(stack(1))).toBe(true);
    const v = stack(5);
    v.items[0].visible = false;
    expect(isStoredLayerStack(v)).toBe(true);
  });
  it.each([0, 6, 100])("範囲外の枚数を拒否: %i", (count) =>
    expect(isLayerStack(stack(count))).toBe(false),
  );
  it.each([
    null,
    { ...stack(), activeId: "missing" },
    { ...stack(), items: [layer(1), layer(1)] },
    { ...stack(), items: [{ ...layer(1), name: " " }] },
    { ...stack(), items: [{ ...layer(1), name: "あ".repeat(41) }] },
    { ...stack(), items: [{ ...layer(1), visible: 1 }] },
    { ...stack(), items: null },
  ])("不正な選択・重複・メタデータを拒否: %#", (value) =>
    expect(isLayerStack(value)).toBe(false),
  );
  it("レイヤー画像の二重参照を拒否する", () => {
    expect(
      isStoredLayerStack({
        ...stack(),
        items: [layer(1), { ...layer(2), assetId: "image-1" }],
      }),
    ).toBe(false);
    expect(
      isStoredLayerStack({
        ...stack(1),
        items: [{ ...layer(1), assetId: "" }],
      }),
    ).toBe(false);
  });
  it("合成画像・下絵への誤参照や画像なしのレイヤー保存を止める", () => {
    for (const assetId of ["canvas", "thumb", "guide"]) {
      expect(() =>
        validateArtworkDraft({
          ...artwork,
          tracing: { assetId: "guide", visible: true, opacity: 30 },
          layers: { ...stack(1), items: [{ ...layer(1), assetId }] },
        }),
      ).toThrow();
    }
    expect(() =>
      validateArtworkDraft({
        ...artwork,
        canvasAssetId: undefined,
        thumbnailAssetId: undefined,
        layers: stack(),
      }),
    ).toThrow();
    expect(
      validateArtworkDraft({ ...artwork, layers: stack() }).layers,
    ).toEqual(stack());
  });
});

describe("レイヤー付きZIPと旧版の保護", () => {
  it("v3で画像と状態を残し、未知の項目は取り込まない", () => {
    const m = manifest();
    const result = validateManifest({
      ...m,
      artworks: [
        {
          ...m.artworks[0],
          layers: {
            ...stack(),
            unknown: true,
            items: stack().items.map((l) => ({ ...l, secret: "unused" })),
          },
        },
      ],
    });
    expect(result.version).toBe(3);
    expect(result.artworks[0].layers).toEqual(stack());
  });
  it.each([1, 2])("v%iではレイヤーを捨てて読まず、拒否する", (version) =>
    expect(() => validateManifest({ ...manifest(), version })).toThrow(),
  );
  it.each([1, 2, 3])("レイヤーのない旧版・新版を読み込める: v%i", (version) =>
    expect(
      validateManifest({ ...manifest(), version, artworks: [], assets: [] })
        .version,
    ).toBe(version),
  );
  it("欠落・別種・共有のレイヤー画像を拒否する", () => {
    const m = manifest();
    expect(() =>
      validateManifest({ ...m, assets: m.assets.slice(0, -1) }),
    ).toThrow();
    const extra = [
      { ...m.assets[0], id: "another-canvas", file: "assets/4.png" },
      { ...m.assets[1], id: "another-thumb", file: "assets/5.png" },
    ];
    expect(() =>
      validateManifest({
        ...m,
        artworks: [
          ...m.artworks,
          {
            ...m.artworks[0],
            id: "shared",
            canvasAssetId: "another-canvas",
            thumbnailAssetId: "another-thumb",
          },
        ],
        assets: [...m.assets, ...extra],
      }),
    ).toThrow();
    expect(() =>
      validateManifest({
        ...m,
        assets: m.assets.map((a) =>
          a.kind === "layer" ? { ...a, kind: "reference" } : a,
        ),
      }),
    ).toThrow();
    expect(() =>
      validateManifest({
        ...m,
        artworks: [
          ...m.artworks,
          {
            ...m.artworks[0],
            id: "another",
            canvasAssetId: undefined,
            thumbnailAssetId: undefined,
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      validateManifest({
        ...m,
        assets: m.assets.map((a) =>
          a.kind === "layer" ? { ...a, width: 192, height: 192 } : a,
        ),
      }),
    ).toThrow();
  });
});
