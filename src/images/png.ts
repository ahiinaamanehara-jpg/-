// 画像生成の完了通知が戻らない場合でも、入力を残して再試行できるようにする。
// DB書込の前段だけを打ち切り、遅れて届く通知から保存を再開しない。
export const PNG_ENCODING_TIMEOUT_MS = 15_000;

export function pngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (blob: Blob | null, error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else if (blob) resolve(blob);
      else
        reject(
          new Error("画像を準備できませんでした。もう一度お試しください。"),
        );
    };
    const timer = setTimeout(
      () =>
        finish(
          null,
          new Error(
            "画像の準備に時間がかかっています。画面の入力や絵はそのままに、もう一度お試しください。",
          ),
        ),
      PNG_ENCODING_TIMEOUT_MS,
    );
    try {
      canvas.toBlob((blob) => finish(blob), "image/png");
    } catch (error) {
      finish(null, error);
    }
  });
}
