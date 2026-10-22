import { describe, it, expect } from "vitest";
import { canvasPoint, UndoHistory, UNDO_BYTES } from "../src/drawing/surface";
import { isDrawingTools, DEFAULT_TOOLS } from "../src/drawing/tools";
import { validateArtworkDraft, type ArtworkDraft } from "../src/data/database";
const snapshot = (bytes: number) =>
  ({
    data: new Uint8ClampedArray(bytes),
    width: 960,
    height: 960,
    colorSpace: "srgb",
  }) as ImageData;
describe("表示座標と固定キャンバス", () => {
  it("CSS縮小時も960px座標へ変換する", () =>
    expect(
      canvasPoint(210, 120, { left: 10, top: 20, width: 400, height: 200 }),
    ).toEqual({ x: 480, y: 480 }));
  it("枠外入力を端へ収める", () =>
    expect(
      canvasPoint(-20, 500, { left: 0, top: 0, width: 100, height: 100 }),
    ).toEqual({ x: 0, y: 960 }));
  it("非表示サイズでNaNを作らない", () =>
    expect(canvasPoint(0, 0, { left: 0, top: 0, width: 0, height: 0 })).toEqual(
      { x: 0, y: 0 },
    ));
});
describe("取り消しのメモリー予算", () => {
  it("新しい操作から戻り、古い履歴を容量内へ収める", () => {
    const history = new UndoHistory();
    for (let i = 0; i < 12; i++) history.push(snapshot(960 * 960 * 4));
    expect(history.length).toBe(9);
    expect(history.byteLength).toBeLessThanOrEqual(UNDO_BYTES);
    history.pop();
    expect(history.length).toBe(8);
    history.clear();
    expect(history.byteLength).toBe(0);
  });
  it("小さい履歴でも20操作に制限する", () => {
    const history = new UndoHistory();
    for (let i = 0; i < 30; i++) history.push(snapshot(4));
    expect(history.length).toBe(20);
    for (let i = 0; i < 20; i++) expect(history.pop()).toBeDefined();
    expect(history.pop()).toBeUndefined();
  });
  it("予算を超えた履歴を保持しない", () => {
    const history = new UndoHistory();
    history.push(snapshot(UNDO_BYTES + 1));
    expect(history.length).toBe(0);
  });
});
describe("保存する道具", () => {
  it("有効な道具と範囲だけを受け入れる", () => {
    expect(isDrawingTools(DEFAULT_TOOLS)).toBe(true);
    expect(
      isDrawingTools({ ...DEFAULT_TOOLS, tool: "eraser", width: 40 }),
    ).toBe(true);
    for (const value of [
      null,
      {},
      { ...DEFAULT_TOOLS, width: 0 },
      { ...DEFAULT_TOOLS, width: 41 },
      { ...DEFAULT_TOOLS, color: "url(https://example.test)" },
      { ...DEFAULT_TOOLS, tool: "fill" },
    ])
      expect(isDrawingTools(value)).toBe(false);
  });
});
describe("既存作品の画像参照", () => {
  const legacy: ArtworkDraft = {
    id: "existing",
    theme: "笑顔",
    themeCategory: "expression",
    status: "in-progress",
    width: 960,
    height: 960,
    createdAt: "2026-10-22T00:00:00.000Z",
    updatedAt: "2026-10-22T00:00:00.000Z",
    revision: 1,
  };
  it("画像なしの旧データと、画像・サムネイルの揃ったデータを保持する", () => {
    expect(validateArtworkDraft(legacy)).toBe(legacy);
    const saved = {
      ...legacy,
      canvasAssetId: "canvas",
      thumbnailAssetId: "thumb",
      tools: DEFAULT_TOOLS,
    };
    expect(validateArtworkDraft(saved)).toBe(saved);
  });
  it("片方だけの参照と同一画像への二重参照は拒否する", () => {
    for (const refs of [
      { canvasAssetId: "canvas" },
      { thumbnailAssetId: "thumb" },
      { canvasAssetId: "same", thumbnailAssetId: "same" },
    ])
      expect(() => validateArtworkDraft({ ...legacy, ...refs })).toThrow(
        "保存データ",
      );
  });
});
