import { describe, expect, it, vi } from "vitest";
import {
  FIT_VIEW,
  boundedView,
  drawingPoint,
  gestureView,
  normalizeAngle,
  paperToView,
  viewAround,
  viewToPaper,
} from "../src/drawing/view";
import { DrawingSurface } from "../src/drawing/surface";
import { DrawingSession } from "../src/drawing/session";
import { DEFAULT_TOOLS } from "../src/drawing/tools";
import type { ArtworkDraft } from "../src/data/database";

describe("キャンバスの表示座標", () => {
  it("拡縮・回転・移動した点の逆変換が一致する", () => {
    for (const scale of [0.5, 1, 3.75, 8])
      for (const rotation of [-Math.PI, -1.2, 0, Math.PI / 2, 3.1]) {
        const view = boundedView({ scale, rotation, x: 0.13, y: -0.17 });
        for (const point of [
          { x: 0, y: 0 },
          { x: 0.23, y: 0.72 },
          { x: 1, y: 1 },
        ]) {
          const restored = viewToPaper(paperToView(point, view), view);
          expect(restored.x).toBeCloseTo(point.x, 10);
          expect(restored.y).toBeCloseTo(point.y, 10);
        }
      }
  });
  it("表示の倍率・移動を制限し、回転していても紙を見失わない", () => {
    for (const rotation of [0, Math.PI / 4, Math.PI / 2, -2.8]) {
      const view = boundedView({ scale: 100, rotation, x: 1e9, y: -1e9 });
      expect(view.scale).toBe(8);
      const center = viewToPaper({ x: 0.5, y: 0.5 }, view);
      expect(center.x).toBeGreaterThanOrEqual(-1e-10);
      expect(center.x).toBeLessThanOrEqual(1 + 1e-10);
      expect(center.y).toBeGreaterThanOrEqual(-1e-10);
      expect(center.y).toBeLessThanOrEqual(1 + 1e-10);
    }
    expect(boundedView({ ...FIT_VIEW, scale: 0.01 }).scale).toBe(0.5);
    expect(
      boundedView({ scale: NaN, rotation: Infinity, x: NaN, y: Infinity }),
    ).toEqual(FIT_VIEW);
  });
  it("2本指の中心を保って拡大・回転し、中心の移動も反映する", () => {
    const next = gestureView(
      FIT_VIEW,
      [
        { x: 0.3, y: 0.5 },
        { x: 0.7, y: 0.5 },
      ],
      [
        { x: 0.6, y: 0.2 },
        { x: 0.6, y: 0.8 },
      ],
    );
    expect(next.scale).toBeCloseTo(1.5);
    expect(next.rotation).toBeCloseTo(Math.PI / 2);
    expect(paperToView({ x: 0.5, y: 0.5 }, next).x).toBeCloseTo(0.6);
    expect(paperToView({ x: 0.5, y: 0.5 }, next).y).toBeCloseTo(0.5);
  });
  it("任意の指の位置をアンカーにして表示を変えられる", () => {
    const from = { x: 0.4, y: 0.45 },
      to = { x: 0.55, y: 0.52 };
    const point = viewToPaper(from, FIT_VIEW);
    const next = viewAround(FIT_VIEW, 2, 0.7, from, to);
    const mapped = paperToView(point, next);
    expect(mapped.x).toBeCloseTo(to.x);
    expect(mapped.y).toBeCloseTo(to.y);
  });
  it("指の距離が0でも有限値と倍率上限を保つ", () => {
    const next = gestureView(
      FIT_VIEW,
      [
        { x: 0.5, y: 0.5 },
        { x: 0.5, y: 0.5 },
      ],
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    );
    expect(Object.values(next).every(Number.isFinite)).toBe(true);
    expect(next.scale).toBe(8);
  });
  it("角度の境界を連続させ、描画座標だけを960pxへ収める", () => {
    expect(normalizeAngle(Math.PI * 4 + 0.2)).toBeCloseTo(0.2);
    expect(normalizeAngle(-Math.PI * 4 - 0.2)).toBeCloseTo(-0.2);
    expect(drawingPoint({ x: -1, y: 2 }, FIT_VIEW)).toEqual({ x: 0, y: 960 });
    expect(drawingPoint({ x: 0.5, y: 0.5 }, FIT_VIEW)).toEqual({
      x: 480,
      y: 480,
    });
  });
});

function fakeSurface() {
  let value = 0;
  const context = {
    getImageData: () => {
      const data = new Uint8ClampedArray(960 * 960 * 4);
      data[0] = value;
      return { data, width: 960, height: 960 } as ImageData;
    },
    putImageData: (image: ImageData) => {
      value = image.data[0];
    },
    beginPath: () => {},
    arc: () => {},
    fill: () => {
      value++;
    },
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
  };
  const canvas = document.createElement("canvas");
  vi.spyOn(canvas, "getContext").mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  return { surface: new DrawingSurface(canvas), value: () => value };
}

describe("表示ジェスチャーに切り替えた線の保護", () => {
  it("描きかけだけを戻し、完了済み9操作の取り消し履歴を消費しない", () => {
    const { surface, value } = fakeSurface();
    for (let i = 0; i < 9; i++) {
      surface.begin({ x: 1, y: 1 }, DEFAULT_TOOLS);
      surface.end();
    }
    expect(value()).toBe(9);
    surface.begin({ x: 2, y: 2 }, DEFAULT_TOOLS);
    expect(value()).toBe(10);
    surface.cancel();
    expect(value()).toBe(9);
    expect(surface.history.length).toBe(9);
    for (let i = 0; i < 9; i++) surface.undo();
    expect(value()).toBe(0);
    expect(surface.history.length).toBe(0);
    vi.restoreAllMocks();
  });
  it("描きかけの取消だけでは保存を作らず、保存済み状態に戻る", async () => {
    const { surface } = fakeSurface();
    const draft: ArtworkDraft = {
      id: "work",
      theme: "",
      themeCategory: null,
      status: "in-progress",
      width: 960,
      height: 960,
      createdAt: "2026-10-24",
      updatedAt: "2026-10-24",
      revision: 1,
    };
    const notify = vi.fn(),
      session = new DrawingSession(surface, draft, DEFAULT_TOOLS, notify);
    surface.begin({ x: 10, y: 10 }, DEFAULT_TOOLS);
    session.started();
    surface.cancel();
    session.cancelled();
    expect(session.dirty).toBe(false);
    expect(await session.flush()).toBe(true);
    expect(notify.mock.lastCall?.[0]).toEqual({
      status: "saved",
      error: "",
      dirty: false,
    });
    session.dispose();
    vi.restoreAllMocks();
  });
});
