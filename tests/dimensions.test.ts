import { describe, expect, it } from "vitest";
import {
  canvasForImage,
  isCanvasDimensions,
  thumbnailDimensions,
} from "../src/drawing/dimensions";
import {
  FIT_VIEW,
  boundedView,
  drawingPoint,
  gestureView,
  paperToView,
  viewAround,
  viewToPaper,
} from "../src/drawing/view";
import { validateArtworkDraft } from "../src/data/database";
import { validateManifest } from "../src/data/backup";

describe("作品の寸法と保存保護", () => {
  it.each([
    [600, 800, 720, 960, 144, 192],
    [1200, 800, 960, 640, 192, 128],
    [1000, 1000, 960, 960, 192, 192],
    [333, 1000, 320, 960, 64, 192],
    [1, 1600, 1, 960, 1, 192],
  ])("画像%d×%dから比率と履歴予算を保つ", (w, h, width, height, tw, th) => {
    const size = canvasForImage({ width: w, height: h });
    expect(size).toEqual({ width, height });
    expect(isCanvasDimensions(size)).toBe(true);
    expect(thumbnailDimensions(size)).toEqual({ width: tw, height: th });
  });
  it.each([0, -1, NaN, Infinity, 1601, 12.5])(
    "不正な元画像寸法を拒否: %s",
    (width) => {
      expect(() => canvasForImage({ width, height: 800 })).toThrow();
    },
  );
  const artwork = {
    id: "work",
    theme: "",
    themeCategory: null,
    status: "in-progress",
    width: 720,
    height: 960,
    revision: 1,
    createdAt: "2026-10-28",
    updatedAt: "2026-10-28",
  } as const;
  const manifest = () => ({
    format: "suki-sketch",
    version: 4,
    createdAt: "2026-10-28",
    characters: [],
    reflections: [],
    settings: [],
    artworks: [
      {
        ...artwork,
        canvasAssetId: "canvas",
        thumbnailAssetId: "thumb",
        layers: {
          activeId: "one",
          items: [
            { id: "one", name: "レイヤー1", visible: false, assetId: "layer" },
          ],
        },
      },
    ],
    assets: [
      { id: "canvas", kind: "canvas", width: 720, height: 960 },
      { id: "thumb", kind: "thumbnail", width: 144, height: 192 },
      { id: "layer", kind: "layer", width: 720, height: 960 },
    ].map((a, i) => ({
      ...a,
      size: 20,
      mime: "image/png",
      file: `assets/${i}.png`,
    })),
  });
  it("長方形を受け入れ、過大・小数・長辺の異なる作品を拒否する", () => {
    expect(validateArtworkDraft(artwork)).toBe(artwork);
    for (const size of [
      { width: 961, height: 960 },
      { width: 720, height: 800 },
      { width: 720.5, height: 960 },
      { width: 0, height: 960 },
    ])
      expect(() => validateArtworkDraft({ ...artwork, ...size })).toThrow();
  });
  it("ZIP v4へ長方形と非表示レイヤーを残し、旧版を装った長方形を拒否する", () => {
    expect(validateManifest(manifest()).artworks[0].width).toBe(720);
    for (const version of [1, 2, 3])
      expect(() => validateManifest({ ...manifest(), version })).toThrow();
  });
  it.each(["canvas", "thumb", "layer"])(
    "作品と寸法が合わない%sの参照を拒否する",
    (id) => {
      const m = manifest();
      m.assets = m.assets.map((a) =>
        a.id === id ? { ...a, width: a.height, height: a.width } : a,
      );
      expect(() => validateManifest(m)).toThrow();
    },
  );
});

describe("長方形の回転・拡縮・ジェスチャー", () => {
  it.each([0.75, 4 / 3, 1.5, 0.1])(
    "比率%sで逆変換と画素・移動制限が一致する",
    (aspect) => {
      const size = { width: 960 * aspect, height: 960 };
      for (const rotation of [-2.8, 0, 0.7, Math.PI / 2]) {
        const view = boundedView(
          { scale: 2.5, rotation, x: 0.1, y: -0.13 },
          aspect,
        );
        const point = { x: 0.3, y: 0.67 };
        const mapped = paperToView(point, view, aspect);
        const restored = viewToPaper(mapped, view, aspect);
        expect(restored.x).toBeCloseTo(point.x, 10);
        expect(restored.y).toBeCloseTo(point.y, 10);
        const pixel = drawingPoint(mapped, view, size);
        expect(pixel.x).toBeCloseTo(point.x * size.width, 8);
        expect(pixel.y).toBeCloseTo(point.y * size.height, 8);
        const bounded = boundedView(
          { scale: 100, rotation, x: 1e8, y: -1e8 },
          aspect,
        );
        const center = viewToPaper({ x: 0.5, y: 0.5 }, bounded, aspect);
        expect(center.x).toBeGreaterThanOrEqual(-1e-9);
        expect(center.x).toBeLessThanOrEqual(1 + 1e-9);
        expect(center.y).toBeGreaterThanOrEqual(-1e-9);
        expect(center.y).toBeLessThanOrEqual(1 + 1e-9);
      }
    },
  );
  it("90度の物理回転で倍率が変わらず、指の中心がずれない", () => {
    const aspect = 0.75;
    const next = gestureView(
      FIT_VIEW,
      [
        { x: 0.3, y: 0.5 },
        { x: 0.7, y: 0.5 },
      ],
      [
        { x: 0.5, y: 0.35 },
        { x: 0.5, y: 0.65 },
      ],
      aspect,
    );
    expect(next.scale).toBeCloseTo(1);
    expect(next.rotation).toBeCloseTo(Math.PI / 2);
    expect(next.x).toBeCloseTo(0);
    expect(next.y).toBeCloseTo(0);
    const anchor = { x: 0.4, y: 0.45 },
      destination = { x: 0.55, y: 0.52 };
    const view = viewAround(FIT_VIEW, 2, 0.7, anchor, destination, aspect);
    const mapped = paperToView(anchor, view, aspect);
    expect(mapped.x).toBeCloseTo(destination.x);
    expect(mapped.y).toBeCloseTo(destination.y);
  });
});
