import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pngBlob, PNG_ENCODING_TIMEOUT_MS } from "../src/images/png";

describe("PNG生成が応答しない場合の保護", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  it("成功した画像を返して期限のタイマーを残さない", async () => {
    const canvas = document.createElement("canvas"),
      blob = new Blob(["png"], { type: "image/png" });
    vi.spyOn(canvas, "toBlob").mockImplementation((callback) => callback(blob));
    expect(await pngBlob(canvas)).toBe(blob);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("生成失敗を通知し、期限のタイマーを残さない", async () => {
    const canvas = document.createElement("canvas");
    vi.spyOn(canvas, "toBlob").mockImplementation((callback) => callback(null));
    await expect(pngBlob(canvas)).rejects.toThrow("画像を準備できません");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("同期例外でもタイマーを片付ける", async () => {
    const canvas = document.createElement("canvas"),
      error = new DOMException("blocked", "SecurityError");
    vi.spyOn(canvas, "toBlob").mockImplementation(() => {
      throw error;
    });
    await expect(pngBlob(canvas)).rejects.toBe(error);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("完了通知がなくても期限後は失敗として戻り、遅い通知を受け入れない", async () => {
    const canvas = document.createElement("canvas");
    let callback: BlobCallback | undefined,
      settled = false;
    vi.spyOn(canvas, "toBlob").mockImplementation((cb) => {
      callback = cb;
    });
    const result = pngBlob(canvas).then(
      (value) => {
        settled = true;
        return { value, error: undefined };
      },
      (error) => {
        settled = true;
        return { value: undefined, error };
      },
    );
    await vi.advanceTimersByTimeAsync(PNG_ENCODING_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await result).error.message).toContain(
      "画像の準備に時間がかかっています",
    );
    callback!(new Blob(["late png"], { type: "image/png" }));
    expect((await result).value).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
});
