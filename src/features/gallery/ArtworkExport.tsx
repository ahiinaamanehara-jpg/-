import { useEffect, useRef, useState } from "react";
import type { ArtworkDraft } from "../../data/database";
import { loadDrawingBitmap } from "../../data/drawings";
import { DrawingSurface, exportWhitePNG } from "../../drawing/surface";
import { dataError } from "../../data/errors";
export function ArtworkExport({ artwork }: { artwork: ArtworkDraft }) {
  const [result, setResult] = useState<{ url: string; file: File }>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const url = useRef<string>(undefined),
    active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      if (url.current) URL.revokeObjectURL(url.current);
    };
  }, []);
  const output = async () => {
    setBusy(true);
    setError("");
    const canvas = document.createElement("canvas");
    canvas.width = artwork.width;
    canvas.height = artwork.height;
    let surface: DrawingSurface | undefined;
    try {
      surface = new DrawingSurface(canvas);
      const bitmap = await loadDrawingBitmap(artwork);
      if (bitmap) await surface.load(bitmap);
      const blob = await exportWhitePNG(canvas);
      if (!active.current) return;
      if (url.current) URL.revokeObjectURL(url.current);
      url.current = URL.createObjectURL(blob);
      const file = new File([blob], "すきのスケッチ.png", {
        type: "image/png",
      });
      setResult({ url: url.current, file });
      const link = document.createElement("a");
      link.href = url.current;
      link.download = file.name;
      link.click();
    } catch (e) {
      if (active.current) setError(dataError(e));
    } finally {
      surface?.dispose();
      canvas.width = canvas.height = 0;
      if (active.current) setBusy(false);
    }
  };
  return (
    <div className="export-result">
      <button
        disabled={busy}
        onClick={() => {
          void output();
        }}
      >
        {busy ? "PNGを準備中…" : "PNGを書き出す"}
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {result && (
        <div className="actions">
          <a className="button" href={result.url} download={result.file.name}>
            PNGをダウンロード
          </a>
          <a
            className="button"
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            画像を開く
          </a>
          {navigator.canShare?.({ files: [result.file] }) && (
            <button
              onClick={() => {
                void navigator
                  .share({ files: [result.file] })
                  .catch(() =>
                    setError(
                      "端末の共有を終了しました。画像を開く操作も使えます。",
                    ),
                  );
              }}
            >
              端末の機能で共有する
            </button>
          )}
        </div>
      )}
    </div>
  );
}
