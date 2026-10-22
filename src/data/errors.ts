export function dataError(error: unknown) {
  return error instanceof DOMException && error.name === "QuotaExceededError"
    ? "保存領域が不足しています。既存データは保持しています。バックアップやPNGを書き出してから再試行してください。"
    : error instanceof Error && /[ぁ-んァ-ヶ一-龠]/.test(error.message)
      ? error.message
      : "データを読み書きできませんでした。既存データは変更していません。再試行できます。";
}
