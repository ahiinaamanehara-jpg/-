import {
  useEffect,
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type SetStateAction,
} from "react";
import { loadDraft, markDraftOpened } from "../../data/drafts";
import {
  loadCharacter,
  type Character,
  type ReferenceAsset,
} from "../../data/characters";
import { loadDrawingBitmap, createDrawingCopy } from "../../data/drawings";
import type { ArtworkDraft, GuideAsset } from "../../data/database";
import { prepareReferenceImage } from "../../data/images";
import { loadTracingGuide, makeGuideAsset } from "../../data/tracing";
import {
  DEFAULT_TRACING_OPACITY,
  type TracingSettings,
} from "../../drawing/tracing";
import { BlobImage } from "../../components/BlobImage";
import { TracingControls } from "./TracingControls";
import { CanvasViewport } from "./CanvasViewport";
import {
  DrawingSurface,
  type Point,
  captureDrawing,
  consumeImport,
  rememberImport,
  importToBundle,
  exportWhitePNG,
} from "../../drawing/surface";
import { DEFAULT_TOOLS, type DrawingTools } from "../../drawing/tools";
import {
  DrawingSession,
  drawingError,
  type SaveState,
} from "../../drawing/session";
import { registerNavigationGuard } from "../../navigation";
import { HintSheet } from "../hints/HintSheet";
import {
  ReflectionSheet,
  type ReflectionExitGuard,
} from "../reflections/ReflectionSheet";

interface DrawingData {
  draft?: ArtworkDraft;
  bitmap?: Blob;
  character?: Character;
  reference?: ReferenceAsset;
  guide?: GuideAsset;
  guideWarning?: string;
  warning?: string;
}
const SCRATCH: DrawingData = {};
export function DrawingPage({
  id,
  onMissing,
}: {
  id?: string;
  onMissing: Dispatch<SetStateAction<string | undefined>>;
}) {
  const [data, setData] = useState<DrawingData | null>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    if (!id) return;
    loadDraft(id)
      .then(async (draft) => {
        if (!draft) return null;
        const bitmap = await loadDrawingBitmap(draft);
        let guide: GuideAsset | undefined,
          guideWarning = "";
        try {
          guide = await loadTracingGuide(draft);
        } catch {
          guideWarning =
            "下絵を読み込めません。描いた線は保持しています。下絵を選び直すか、外して続けられます。";
        }
        let character: Character | undefined,
          reference: ReferenceAsset | undefined,
          warning = "";
        if (draft.characterId) {
          try {
            const record = await loadCharacter(draft.characterId);
            character = record?.character;
            reference = record?.asset;
            if (!character)
              warning = "推しの情報が見つかりません。作品は保持しています。";
          } catch {
            warning = "推しの情報を読み込めません。作品は保持しています。";
          }
        }
        if (active) {
          try {
            await markDraftOpened(draft.id);
          } catch (error) {
            warning = drawingError(error);
          }
        }
        return {
          draft,
          bitmap,
          character,
          reference,
          warning,
          guide,
          guideWarning,
        };
      })
      .then((result) => {
        if (active) {
          setData(result);
          setError("");
          onMissing(result ? undefined : id);
        }
      })
      .catch((error) => {
        if (active) setError(drawingError(error));
      });
    return () => {
      active = false;
    };
  }, [id, attempt, onMissing]);
  if (!id) return <DrawingEditor data={SCRATCH} />;
  if (error)
    return (
      <section className="card">
        <p role="alert" className="error">
          {error}
        </p>
        <p>元の絵を白紙で上書きしないよう、編集を止めています。</p>
        <button onClick={() => setAttempt((n) => n + 1)}>
          もう一度読み込む
        </button>
        <p>
          <a href="#/draw/new">保存せずに別の落書きを試す</a>
        </p>
      </section>
    );
  if (data === undefined) return <p role="status">作品を読み込んでいます…</p>;
  if (data === null)
    return (
      <section className="card">
        <p>保存されていないか、削除された作品です。</p>
        <a className="button" href="#/new">
          テーマを決める
        </a>
      </section>
    );
  return <DrawingEditor key={data.draft!.id} data={data} />;
}

function DrawingEditor({ data }: { data: DrawingData }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const session = useRef<DrawingSession>(undefined);
  const pointer = useRef<number | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [fatal, setFatal] = useState("");
  const [tools, setTools] = useState<DrawingTools>(() => ({
    ...(data.draft?.tools ?? DEFAULT_TOOLS),
  }));
  const [saveState, setSaveState] = useState<SaveState>({
    status: data.draft ? "saved" : "scratch",
    error: "",
    dirty: false,
  });
  const [undoCount, setUndoCount] = useState(0);
  const [drawing, setDrawing] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const importingRef = useRef(false);
  const [actionError, setActionError] = useState("");
  const [leaving, setLeaving] = useState(false);
  const leavingRef = useRef(false);
  const destination = useRef<string | undefined>(undefined);
  const allowLeave = useRef(false);
  const [exportFile, setExportFile] = useState<{ url: string; file: File }>();
  const exportRef = useRef<string | undefined>(undefined);
  const [exporting, setExporting] = useState(false);
  const [showReference, setShowReference] = useState(false);
  const [guide, setGuide] = useState(data.guide);
  const [tracing, setTracing] = useState(data.draft?.tracing);
  const [guideWarning, setGuideWarning] = useState(data.guideWarning ?? "");
  const reference = useRef<HTMLImageElement>(null);
  const [overlay, setOverlay] = useState<"hints" | "reflection">();
  const [openingReflection, setOpeningReflection] = useState(false);
  const openingReflectionRef = useRef(false);
  const reflectionTrigger = useRef<HTMLButtonElement>(null);
  const reflectionGuard = useRef<ReflectionExitGuard>(undefined);
  const registerReflectionGuard = useCallback((guard?: ReflectionExitGuard) => {
    reflectionGuard.current = guard;
  }, []);
  useEffect(() => {
    let active = true;
    let controller: DrawingSession | undefined;
    void Promise.resolve()
      .then(async () => {
        if (!active) return;
        const surface = new DrawingSurface(canvas.current!);
        controller = new DrawingSession(
          surface,
          data.draft,
          { ...(data.draft?.tools ?? DEFAULT_TOOLS) },
          setSaveState,
          data.guide,
        );
        session.current = controller;
        if (data.bitmap) await surface.load(data.bitmap);
        if (!active) return;
        if (data.draft && consumeImport(data.draft.id))
          surface.seedImportUndo();
        setUndoCount(surface.history.length);
        setReady(true);
      })
      .catch((error) => {
        if (active) setFatal(drawingError(error));
      });
    return () => {
      active = false;
      controller?.dispose();
      if (session.current === controller) session.current = undefined;
    };
  }, [data]);
  useEffect(() => {
    if (!data.reference || !showReference || !reference.current) return;
    const url = URL.createObjectURL(data.reference.blob);
    reference.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [data.reference, showReference]);
  useEffect(
    () => () => {
      if (exportRef.current) URL.revokeObjectURL(exportRef.current);
    },
    [],
  );
  const finishStroke = () => {
    const controller = session.current;
    if (pointer.current === undefined || !controller) return;
    pointer.current = undefined;
    controller.surface.end();
    controller.ended();
    setDrawing(false);
    setUndoCount(controller.surface.history.length);
  };
  const cancelStroke = (id: number) => {
    const controller = session.current;
    if (!controller || pointer.current !== id) return;
    pointer.current = undefined;
    controller.surface.cancel();
    controller.cancelled();
    setDrawing(false);
    setUndoCount(controller.surface.history.length);
  };
  useEffect(() => {
    const unregister = registerNavigationGuard((target) => {
      const controller = session.current;
      if (allowLeave.current) return true;
      if (
        openingReflectionRef.current ||
        (reflectionGuard.current && !reflectionGuard.current.canLeave())
      )
        return false;
      if (!controller?.dirty) return !importingRef.current;
      if (importingRef.current) return false;
      if (target) destination.current = target;
      if (leavingRef.current) return false;
      leavingRef.current = true;
      setLeaving(true);
      if (controller.strokeActive) {
        controller.surface.end();
        controller.ended();
        pointer.current = undefined;
        setDrawing(false);
      }
      void controller
        .flush()
        .then((ok) => {
          if (
            !ok &&
            !window.confirm(
              "保存できていません。絵はこの画面からPNGを書き出せます。保存せずに移動しますか？",
            )
          ) {
            leavingRef.current = false;
            setLeaving(false);
            destination.current = undefined;
            return;
          }
          allowLeave.current = true;
          const next = destination.current;
          if (next) window.location.hash = next;
        })
        .catch(() => {
          leavingRef.current = false;
          setLeaving(false);
        });
      return false;
    });
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (
        !allowLeave.current &&
        (session.current?.dirty ||
          importingRef.current ||
          openingReflectionRef.current ||
          reflectionGuard.current?.pending)
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      unregister();
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, []);
  const begin = (point: Point, id: number) => {
    if (
      !ready ||
      fatal ||
      importingRef.current ||
      openingReflectionRef.current ||
      leavingRef.current ||
      pointer.current !== undefined
    )
      return;
    pointer.current = id;
    const controller = session.current!;
    controller.surface.begin(point, controller.tools);
    controller.started();
    setDrawing(true);
  };
  const move = (point: Point, id: number) => {
    if (pointer.current !== id) return;
    session.current?.surface.move(point);
  };
  const changeTools = (next: DrawingTools) => {
    setTools(next);
    session.current?.setTools(next);
  };
  const undo = () => {
    const controller = session.current;
    if (controller?.surface.undo()) {
      controller.changed();
      setUndoCount(controller.surface.history.length);
    }
  };
  const save = async () => {
    finishStroke();
    await session.current?.flush(true);
  };
  const changeTracing = (settings?: TracingSettings) => {
    setTracing(settings);
    session.current?.setTracing({
      settings,
      asset: settings ? guide : undefined,
    });
    if (!settings) {
      setGuide(undefined);
      setGuideWarning("");
    }
  };
  const chooseGuide = async (source: File | ReferenceAsset) => {
    const controller = session.current;
    if (!controller || importingRef.current) return;
    if (
      tracing &&
      !window.confirm("下絵を入れ替えますか？描いた線はそのまま残ります。")
    )
      return;
    finishStroke();
    importingRef.current = true;
    setImporting(true);
    setActionError("");
    try {
      const image =
        source instanceof File ? await prepareReferenceImage(source) : source;
      const asset = await makeGuideAsset(image);
      const settings = {
        assetId: asset.id,
        opacity: DEFAULT_TRACING_OPACITY,
        visible: true,
      };
      setGuide(asset);
      setTracing(settings);
      setGuideWarning("");
      controller.setTracing({ settings, asset });
    } catch (error) {
      setActionError(drawingError(error));
    } finally {
      importingRef.current = false;
      setImporting(false);
    }
  };
  const openReflection = async () => {
    const controller = session.current;
    if (!controller?.draft || openingReflectionRef.current) return;
    finishStroke();
    openingReflectionRef.current = true;
    setOpeningReflection(true);
    setActionError("");
    try {
      if (await controller.flush(true)) setOverlay("reflection");
    } catch (error) {
      setActionError(drawingError(error));
    } finally {
      openingReflectionRef.current = false;
      setOpeningReflection(false);
    }
  };
  const copy = async () => {
    const controller = session.current;
    if (!controller?.draft || importingRef.current) return;
    finishStroke();
    importingRef.current = true;
    setImporting(true);
    setActionError("");
    try {
      const bundle = await captureDrawing(controller.surface.canvas);
      const next = await createDrawingCopy(
        controller.draft.id,
        bundle,
        controller.tools,
        undefined,
        controller.draft,
        controller.tracing,
      );
      allowLeave.current = true;
      window.location.hash = `/draw/${next.id}`;
    } catch (error) {
      setActionError(drawingError(error));
      importingRef.current = false;
      setImporting(false);
    }
  };
  const importImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    const controller = session.current;
    if (!file || !controller?.draft || importingRef.current) return;
    finishStroke();
    importingRef.current = true;
    setImporting(true);
    setActionError("");
    try {
      const image = await prepareReferenceImage(file);
      const bundle = await importToBundle(image.blob);
      if (controller.dirty && !(await controller.flush()))
        throw new Error(
          "今の絵を保存できなかったため、画像の取り込みを止めました。PNGを書き出すか、保存を再試行してください。",
        );
      const next = await createDrawingCopy(
        controller.draft.id,
        bundle,
        controller.tools,
        controller.draft.revision,
        undefined,
        {},
      );
      rememberImport(next.id);
      allowLeave.current = true;
      window.location.hash = `/draw/${next.id}`;
    } catch (error) {
      setActionError(drawingError(error));
      importingRef.current = false;
      setImporting(false);
    }
  };
  const exportImage = async () => {
    if (!canvas.current || exporting) return;
    finishStroke();
    setExporting(true);
    setActionError("");
    try {
      const blob = await exportWhitePNG(canvas.current);
      const file = new File([blob], "すきのスケッチ.png", {
        type: "image/png",
      });
      if (exportRef.current) URL.revokeObjectURL(exportRef.current);
      const url = URL.createObjectURL(blob);
      exportRef.current = url;
      setExportFile({ url, file });
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name;
      link.click();
    } catch (error) {
      setActionError(drawingError(error));
    } finally {
      setExporting(false);
    }
  };
  const share = async () => {
    if (!exportFile) return;
    try {
      await navigator.share({
        files: [exportFile.file],
        title: "すきのスケッチ",
      });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        setActionError(
          "端末の共有を利用できませんでした。PNGのダウンロードか画像を開く操作をお試しください。",
        );
    }
  };
  const viewBlocked =
    !ready || Boolean(fatal) || importing || leaving || openingReflection;
  const disabled = viewBlocked || drawing || viewing;
  const statusText = {
    saved: "保存済み",
    pending: "未保存の変更があります",
    saving: "保存中…",
    error: "保存できません",
    scratch: "一時的な落書き（端末内保存なし）",
  }[saveState.status];
  return (
    <section className="drawing-editor">
      <div className="drawing-heading">
        <div>
          <p className="drawing-character">
            {data.character?.name ?? "自由な落書き"}
          </p>
          <p className="drawing-theme">
            {data.draft?.theme || "テーマはまだ決めていません"}
          </p>
        </div>
        <p
          className={`save-status ${saveState.status}`}
          role="status"
          aria-live="polite"
        >
          {statusText}
        </p>
      </div>
      {!data.draft && (
        <p className="note">
          この落書きは再読み込みで消えます。残したいときはPNGを書き出してください。端末内保存を使うには、テーマ画面から始めてください。
        </p>
      )}
      {data.warning && (
        <p className="error" role="alert">
          {data.warning}
        </p>
      )}
      {fatal && (
        <p className="error" role="alert">
          {fatal} 元の画像は変更していません。
        </p>
      )}
      {data.reference && (
        <button
          className="reference-toggle"
          disabled={disabled}
          onClick={() => setShowReference((v) => !v)}
          aria-expanded={showReference}
        >
          {showReference ? "参考画像を閉じる" : "参考画像を見る"}
        </button>
      )}
      {showReference && data.reference && (
        <img
          ref={reference}
          className="drawing-reference"
          alt={`${data.character?.name ?? "推し"}の参考画像`}
        />
      )}
      <TracingControls
        settings={tracing}
        guide={guide}
        hasReference={Boolean(data.reference)}
        disabled={disabled}
        warning={guideWarning}
        onFile={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void chooseGuide(file);
        }}
        onReference={() => {
          if (data.reference) void chooseGuide(data.reference);
        }}
        onSettings={changeTracing}
        onRemove={() => {
          if (window.confirm("下絵を外しますか？描いた線はそのまま残ります。"))
            changeTracing();
        }}
      />
      <CanvasViewport
        blocked={viewBlocked}
        tracingVisible={Boolean(guide && tracing?.visible)}
        onBegin={begin}
        onMove={move}
        onEnd={(id) => {
          if (pointer.current === id) finishStroke();
        }}
        onCancel={cancelStroke}
        onManipulating={setViewing}
      >
        {guide && tracing?.visible && (
          <BlobImage
            blob={guide.blob}
            alt=""
            aria-hidden="true"
            className="tracing-underlay"
            style={{ opacity: tracing.opacity / 100 }}
          />
        )}
        <canvas
          ref={canvas}
          width={960}
          height={960}
          aria-label="お絵描きキャンバス"
          aria-describedby="canvas-help canvas-view-help"
        >
          描画にはCanvasに対応したブラウザーが必要です。
        </canvas>
      </CanvasViewport>
      <fieldset className="drawing-tools" disabled={disabled}>
        <legend className="sr-only">描画の道具</legend>
        <div role="group" aria-label="道具" className="drawing-tool-buttons">
          <button
            type="button"
            aria-pressed={tools.tool === "pen"}
            onClick={() => changeTools({ ...tools, tool: "pen" })}
          >
            ペン
          </button>
          <button
            type="button"
            aria-pressed={tools.tool === "eraser"}
            onClick={() => changeTools({ ...tools, tool: "eraser" })}
          >
            消しゴム
          </button>
          <button type="button" disabled={undoCount === 0} onClick={undo}>
            取り消し
          </button>
        </div>
        <div className="drawing-options">
          <label>
            ペンの色
            <input
              type="color"
              value={tools.color}
              onChange={(event) =>
                changeTools({ ...tools, color: event.target.value })
              }
            />
          </label>
          <label>
            線の太さ：{tools.width}px
            <input
              aria-label="線の太さ"
              type="range"
              min={1}
              max={40}
              value={tools.width}
              onChange={(event) =>
                changeTools({ ...tools, width: Number(event.target.value) })
              }
            />
          </label>
        </div>
      </fieldset>
      {saveState.error && (
        <div role="alert" className="error">
          <p>{saveState.error}</p>
          {data.draft && (
            <>
              <button
                disabled={disabled}
                onClick={() => {
                  void copy();
                }}
              >
                今の絵を別の作品として保存
              </button>
              <button
                disabled={disabled}
                onClick={() => {
                  if (
                    window.confirm(
                      "画面の未保存の絵を破棄して、最新の保存内容を読み直しますか？必要な絵は先にPNGを書き出してください。",
                    )
                  ) {
                    allowLeave.current = true;
                    window.location.reload();
                  }
                }}
              >
                最新の保存を読み直す
              </button>
            </>
          )}
        </div>
      )}
      {actionError && (
        <p role="alert" className="error">
          {actionError}
        </p>
      )}
      {(importing || leaving) && (
        <p role="status">
          {leaving
            ? "絵を保存してから移動しています…"
            : "画像を準備しています…"}
        </p>
      )}
      <div className="actions drawing-actions">
        <button
          className="primary"
          disabled={disabled || !data.draft}
          onClick={() => {
            void save();
          }}
        >
          途中で保存
        </button>
        <button
          disabled={disabled || exporting}
          onClick={() => {
            void exportImage();
          }}
        >
          {exporting ? "PNGを準備中…" : "PNGを書き出す"}
        </button>
      </div>
      <p id="canvas-help" className="note">
        指・ペン・マウスで描けます。自由描画はポインター操作が必要です。キャンバスの外は通常どおりスクロールできます。
      </p>
      <div className="actions drawing-support">
        <button
          disabled={disabled}
          aria-haspopup="dialog"
          onClick={() => setOverlay("hints")}
        >
          描くヒント（任意）
        </button>
        <button
          ref={reflectionTrigger}
          disabled={disabled || !data.draft}
          aria-haspopup="dialog"
          onClick={() => {
            void openReflection();
          }}
        >
          {openingReflection ? "絵を保存しています…" : "振り返る（任意）"}
        </button>
      </div>
      {exportFile && (
        <div className="export-result">
          <p>PNGを用意しました。取得できない場合はこちらから開けます。</p>
          <div className="actions">
            <a
              className="button"
              href={exportFile.url}
              download={exportFile.file.name}
            >
              PNGをダウンロード
            </a>
            <a
              className="button"
              href={exportFile.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              画像を開く
            </a>
            {typeof navigator.share === "function" &&
              navigator.canShare?.({ files: [exportFile.file] }) && (
                <button
                  onClick={() => {
                    void share();
                  }}
                >
                  端末の機能で共有する
                </button>
              )}
          </div>
        </div>
      )}
      <details className="drawing-import">
        <summary>紙や他のアプリの絵を取り込む</summary>
        <p>
          元の作品を残して、別の作品として開きます。PNG・JPEG・WebP、10MiB・1,600万画素まで。正方形の枠内に比率を保って収めます。
        </p>
        <label htmlFor="drawing-import-file">作品画像を選ぶ</label>
        <input
          id="drawing-import-file"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={disabled || !data.draft}
          onChange={importImage}
        />
        {!data.draft && (
          <p>取り込みには、先にテーマ画面で準備データを保存してください。</p>
        )}
      </details>
      <p className="note">
        取り消しはこの画面での直前の操作に対応します（960pxでは最大9操作）。再開時に履歴は戻りません。白紙や途中の絵も保存できます。
      </p>
      <a className="button" href="#/new">
        別のテーマで準備する
      </a>
      {data.draft && (
        <p>
          <a
            className="button"
            href={`#/works/${encodeURIComponent(data.draft.id)}`}
          >
            作品の詳細を見る
          </a>
        </p>
      )}
      {overlay === "hints" && (
        <HintSheet onClose={() => setOverlay(undefined)} />
      )}
      {overlay === "reflection" && data.draft && (
        <ReflectionSheet
          artworkId={data.draft.id}
          returnFocusRef={reflectionTrigger}
          registerExitGuard={registerReflectionGuard}
          onClose={() => setOverlay(undefined)}
        />
      )}
    </section>
  );
}
