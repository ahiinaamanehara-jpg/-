import type { Page } from "@playwright/test";

interface EncodingTiming {
  width: number;
  height: number;
  started: number;
  completed?: number;
  bytes?: number;
  error?: string;
}

// 保存待ちの失敗時に、PNG準備の開始・完了だけを記録する。画像は記録しない。
// 元のAPIの完了通知・例外・タイミングを待つ条件は変更しない。
export async function observePngEncoding(page: Page) {
  await page.addInitScript(() => {
    const timings: EncodingTiming[] = [];
    (
      window as unknown as { pngEncodingTimings: EncodingTiming[] }
    ).pngEncodingTimings = timings;
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      const timing: EncodingTiming = {
        width: this.width,
        height: this.height,
        started: performance.now(),
      };
      timings.push(timing);
      try {
        original.call(
          this,
          (blob) => {
            timing.completed = performance.now();
            timing.bytes = blob?.size;
            callback(blob);
          },
          type,
          quality,
        );
      } catch (error) {
        timing.error = error instanceof Error ? error.name : String(error);
        throw error;
      }
    };
  });
}

export async function pngEncodingTimings(page: Page) {
  return page.evaluate(() => ({
    observed: performance.now(),
    visibility: document.visibilityState,
    timings: (window as unknown as { pngEncodingTimings: EncodingTiming[] })
      .pngEncodingTimings,
  }));
}
