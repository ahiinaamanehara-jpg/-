import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  listCharacters,
  getSelectedCharacterId,
  loadCharacter,
  type Character,
  type ReferenceAsset,
} from "../../data/characters";
import {
  CANVAS_PRESETS,
  canvasForImage,
  type CanvasPresetId,
} from "../../drawing/dimensions";
import {
  createDraft,
  getLastDraft,
  type ArtworkDraft,
} from "../../data/drafts";
import {
  THEME_CATEGORIES,
  suggestThemes,
  type ThemeCategory,
} from "../../data/themes";
import { registerNavigationGuard } from "../../navigation";
import { prepareReferenceImage, type PreparedImage } from "../../data/images";
import { BlobImage } from "../../components/BlobImage";
import { GuidePresetPicker } from "../drawing/GuidePresetPicker";
import {
  getGuidePreset,
  prepareGuidePreset,
  type PresetGuideSource,
} from "../../drawing/guidePresets";

function describeError(error: unknown) {
  if (error instanceof DOMException && error.name === "QuotaExceededError")
    return "保存領域が不足しています。既存のデータは削除していません。";
  if (error instanceof Error && /[ぁ-んァ-ヶ一-龠]/.test(error.message))
    return error.message;
  return "データを読み書きできませんでした。既存のデータは削除していません。";
}

export function ThemePage() {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [characterId, setCharacterId] = useState("");
  const [initialCharacterId, setInitialCharacterId] = useState("");
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [category, setCategory] = useState<ThemeCategory>("expression");
  const [suggestions, setSuggestions] = useState(() =>
    suggestThemes("expression"),
  );
  const [theme, setTheme] = useState("");
  const [mode, setMode] = useState<"blank" | "trace">("blank");
  const [guide, setGuide] = useState<PreparedImage>();
  const [guideName, setGuideName] = useState("");
  const [sizeChoice, setSizeChoice] = useState<CanvasPresetId | "reference">();
  const [referenceState, setReferenceState] = useState<{
    id: string;
    assetId: string;
    image?: ReferenceAsset;
    warning?: string;
  }>();
  const referenceAssetId = characters.find(
    (c) => c.id === characterId,
  )?.referenceAssetId;
  const referenceReady =
    referenceState?.id === characterId &&
    referenceState.assetId === referenceAssetId;
  const referenceImage = referenceReady ? referenceState.image : undefined;
  const loadingReference = Boolean(referenceAssetId && !referenceReady);
  const selectedSize =
    sizeChoice === "reference" && !referenceImage
      ? "square"
      : (sizeChoice ?? (referenceImage ? "reference" : "square"));
  const canvasSize =
    selectedSize === "reference"
      ? canvasForImage(referenceImage!)
      : CANVAS_PRESETS.find((item) => item.id === selectedSize)!;
  const [preparing, setPreparing] = useState(false);
  const [themeCategory, setThemeCategory] = useState<ThemeCategory | null>(
    null,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState(0);
  const initialized = useRef(false);
  const saving = useRef(false);
  const saved = useRef(false);
  const dirty =
    theme !== "" ||
    characterId !== initialCharacterId ||
    mode === "trace" ||
    sizeChoice !== undefined ||
    Boolean(guide);
  useEffect(() => {
    if (!characterId || !referenceAssetId) return;
    let active = true;
    loadCharacter(characterId)
      .then((record) => {
        if (active)
          setReferenceState({
            id: characterId,
            assetId: referenceAssetId,
            image: record?.asset,
            warning: record?.asset
              ? undefined
              : "参考画像のサイズを読み込めません。正方形・縦長・横長を選んで進めます。",
          });
      })
      .catch(() => {
        if (active)
          setReferenceState({
            id: characterId,
            assetId: referenceAssetId,
            warning:
              "参考画像を読み込めません。正方形・縦長・横長を選んで進めます。",
          });
      });
    return () => {
      active = false;
    };
  }, [characterId, referenceAssetId]);
  useEffect(() => {
    let active = true;
    let sequence = 0;
    const refresh = () => {
      const request = ++sequence;
      Promise.all([listCharacters(), getSelectedCharacterId()])
        .then(([items, selected]) => {
          if (!active || request !== sequence) return;
          setCharacters(items);
          if (!initialized.current) {
            initialized.current = true;
            setCharacterId(selected ?? "");
            setInitialCharacterId(selected ?? "");
          }
          setReady(true);
          setLoadError("");
        })
        .catch((error) => {
          if (active && request === sequence)
            setLoadError(describeError(error));
        });
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
    };
  }, [attempt]);
  useEffect(
    () =>
      registerNavigationGuard(
        () =>
          saved.current ||
          (!saving.current &&
            (!dirty ||
              window.confirm(
                "テーマはまだ保存されていません。保存せずに移動しますか？",
              ))),
      ),
    [dirty],
  );
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (!saved.current && (dirty || saving.current)) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);
  const changeCategory = (next: ThemeCategory) => {
    setCategory(next);
    setSuggestions(suggestThemes(next));
    setRound(0);
  };
  const save = async (skip = false) => {
    if (saving.current || !ready || loadingReference) return;
    if (!skip && theme.length > 500) {
      setError("テーマは500文字以内で入力してください。");
      return;
    }
    if (mode === "trace" && !guide) {
      setError(
        "用意したあたりを使うか、下絵にする画像を選んでください。使わないときは「白紙から描く」で進めます。",
      );
      return;
    }
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const draft = await createDraft(
        {
          characterId: characterId || undefined,
          theme: skip ? "" : theme,
          themeCategory: skip || !theme.trim() ? null : themeCategory,
          canvasSize: { width: canvasSize.width, height: canvasSize.height },
        },
        mode === "trace" ? guide : undefined,
      );
      saved.current = true;
      window.location.hash = `/draw/${encodeURIComponent(draft.id)}`;
    } catch (error) {
      saving.current = false;
      setBusy(false);
      setError(
        `保存できませんでした。${describeError(error)} 入力したテーマはこの画面に残っています。`,
      );
    }
  };
  const prepareGuide = async (
    source: File | "reference" | PresetGuideSource,
  ) => {
    if (saving.current || !ready) return;
    saving.current = true;
    setPreparing(true);
    setError("");
    try {
      if (source === "reference") {
        const record = await loadCharacter(characterId);
        if (!record?.asset)
          throw new Error(
            "参考画像を読み込めません。端末の画像を選び直せます。",
          );
        setGuide(record.asset);
        setGuideName(`${record.character.name}の参考画像`);
      } else if (source instanceof File) {
        const image = await prepareReferenceImage(source);
        setGuide(image);
        setGuideName(source.name);
      } else {
        const image = await prepareGuidePreset(source.presetId);
        setGuide(image);
        setGuideName(`${getGuidePreset(source.presetId).label}のあたり`);
      }
    } catch (error) {
      setError(
        `${describeError(error)} すでに選んだ下絵やテーマは残っています。`,
      );
    } finally {
      saving.current = false;
      setPreparing(false);
    }
  };
  const missingSelection =
    ready &&
    Boolean(characterId) &&
    !characters.some((character) => character.id === characterId);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void save();
  };
  return (
    <section className="card theme-editor">
      <p className="lead">
        顔だけ、小物ひとつからでも。いま描いてみたいことを選べます。
      </p>
      {loadError && (
        <div className="error" role="alert">
          <p>{loadError}</p>
          <button onClick={() => setAttempt((n) => n + 1)}>
            もう一度読み込む
          </button>
        </div>
      )}
      {!ready && !loadError && (
        <p role="status">推しのノートを読み込んでいます…</p>
      )}
      <form onSubmit={submit}>
        <fieldset disabled={!ready || busy || preparing || loadingReference}>
          <legend className="sr-only">今回の創作テーマ</legend>
          <div className="field">
            <label htmlFor="theme-character">描くキャラクター</label>
            <select
              id="theme-character"
              value={characterId}
              onChange={(event) => {
                setCharacterId(event.target.value);
                setSizeChoice(undefined);
              }}
            >
              <option value="">推しを選ばずに描く</option>
              {missingSelection && (
                <option value={characterId} disabled>
                  選んだ推しが見つかりません
                </option>
              )}
              {characters.map((character) => (
                <option value={character.id} key={character.id}>
                  {character.name}
                </option>
              ))}
            </select>
          </div>
          {missingSelection && (
            <p role="alert" className="error">
              選んだ推しは別の画面で削除された可能性があります。選び直すか、推しを選ばずに進めます。入力したテーマは残っています。
            </p>
          )}
          <div className="field canvas-size-picker">
            <label htmlFor="canvas-size">キャンバスの形</label>
            <select
              id="canvas-size"
              value={selectedSize}
              onChange={(event) => {
                setSizeChoice(event.target.value as typeof sizeChoice);
              }}
              aria-describedby="canvas-size-help canvas-size-result"
            >
              {referenceImage && (
                <option value="reference">推しの参考画像に合わせる</option>
              )}
              {CANVAS_PRESETS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <p id="canvas-size-result" role="status" className="note">
              {loadingReference
                ? "参考画像のサイズを読み込んでいます…"
                : `${canvasSize.width} × ${canvasSize.height}px`}
            </p>
            <p id="canvas-size-help" className="note">
              参考画像があれば同じ比率から始めます。画像に合わせる場合も長辺は960pxです。形は描き始める前に選びます。保存済みの作品は変わりません。
            </p>
            {referenceReady && referenceState.warning && (
              <p className="note">{referenceState.warning}</p>
            )}
          </div>
          <fieldset className="start-method">
            <legend>描きはじめ方</legend>
            <div className="start-options">
              <label>
                <input
                  type="radio"
                  name="start-method"
                  checked={mode === "blank"}
                  onChange={() => setMode("blank")}
                />
                白紙から描く
              </label>
              <label>
                <input
                  type="radio"
                  name="start-method"
                  checked={mode === "trace"}
                  onChange={() => setMode("trace")}
                />
                下絵をなぞって描く
              </label>
            </div>
            {mode === "trace" && (
              <div className="tracing-setup">
                <GuidePresetPicker
                  disabled={!ready || busy || preparing}
                  onChoose={(presetId) => {
                    void prepareGuide({ presetId });
                  }}
                />
                <h3 className="tracing-source-title">自分の画像を使う</h3>
                <p>
                  画像を薄く表示し、目印をなぞって自分で線を描きます。顔や好きな部分だけでも、途中でやめても大丈夫です。
                </p>
                {characters.find((c) => c.id === characterId)
                  ?.referenceAssetId && (
                  <button
                    type="button"
                    onClick={() => void prepareGuide("reference")}
                  >
                    推しの参考画像を使う
                  </button>
                )}
                <label className="tracing-file">
                  下絵にする画像を選ぶ
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = "";
                      if (file) void prepareGuide(file);
                    }}
                  />
                </label>
                <p className="note">
                  自分の画像や利用できる画像を選びます。PNG・JPEG・WebP、10MiB・1,600万画素まで。画像は端末内で扱います。
                </p>
                {guide && (
                  <>
                    <BlobImage
                      blob={guide.blob}
                      alt="選んだ下絵"
                      className="tracing-preview"
                    />
                    <p role="status">選んだ下絵：{guideName}</p>
                    <button
                      type="button"
                      className="primary"
                      onClick={() => void save()}
                    >
                      この下絵で描きはじめる
                    </button>
                  </>
                )}
                <p className="note">
                  下絵の濃さは描く画面で変えられます。PNGには自分で描いた線だけを書き出します。
                </p>
              </div>
            )}
          </fieldset>
          <fieldset className="category-fieldset">
            <legend>お題の種類</legend>
            <div className="theme-categories">
              {THEME_CATEGORIES.map((item) => (
                <label
                  className={`category-option ${category === item.id ? "is-active" : ""}`}
                  key={item.id}
                >
                  <input
                    type="radio"
                    name="theme-category"
                    value={item.id}
                    checked={category === item.id}
                    onChange={() => changeCategory(item.id)}
                  />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {category !== "free" && (
            <>
              <p className="note" id="suggestion-help">
                候補を選ぶと下の欄に入ります。選んだあとも自由に書き換えられます。
              </p>
              <div
                role="group"
                aria-label="お題の候補"
                aria-describedby="suggestion-help"
                className="theme-suggestions"
              >
                {suggestions.map((suggestion) => (
                  <button
                    type="button"
                    key={suggestion.id}
                    aria-pressed={theme === suggestion.text}
                    onClick={() => {
                      setTheme(suggestion.text);
                      setThemeCategory(suggestion.category);
                      setError("");
                    }}
                  >
                    {suggestion.text}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="refresh-themes"
                onClick={() => {
                  setSuggestions(
                    suggestThemes(
                      category,
                      suggestions.map((item) => item.id),
                    ),
                  );
                  setRound((n) => n + 1);
                }}
              >
                別のお題を見る
              </button>
              {round > 0 && (
                <p role="status" className="note">
                  別の候補を表示しました（{round}回目）。
                </p>
              )}
            </>
          )}
          <div className="field">
            <label htmlFor="creative-theme">描きたいテーマ</label>
            <p id="theme-help">
              500文字まで。カテゴリを変えても入力は残ります。空欄のままでも進めます。
            </p>
            <textarea
              id="creative-theme"
              value={theme}
              maxLength={500}
              rows={4}
              aria-describedby="theme-help theme-length"
              onChange={(event) => {
                setTheme(event.target.value);
                setThemeCategory("free");
                setError("");
              }}
            />
            <p id="theme-length" className="note">
              {theme.length} / 500文字
            </p>
          </div>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {(busy || preparing) && (
            <p role="status">
              {preparing
                ? "下絵の画像を準備しています…"
                : "推しとテーマを保存しています…"}
            </p>
          )}
          <div className="actions form-actions">
            <button type="submit" className="primary">
              {busy ? "保存しています…" : "このテーマで進む"}
            </button>
            <button
              type="button"
              onClick={() => {
                void save(true);
              }}
            >
              テーマを決めずに進む
            </button>
          </div>
        </fieldset>
      </form>
      <p className="note">
        推しとテーマをこのブラウザーに保存して、描き始めます。
      </p>
    </section>
  );
}

export function ResumePreparation() {
  const [draft, setDraft] = useState<ArtworkDraft>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    getLastDraft()
      .then((draft) => {
        if (active) setDraft(draft);
      })
      .catch((error) => {
        if (active) setError(describeError(error));
      });
    return () => {
      active = false;
    };
  }, []);
  if (error)
    return (
      <p role="alert" className="error">
        続きの作品を読み込めません。{error}
      </p>
    );
  return draft ? (
    <section className="resume-preparation">
      <h2>続きから描ける作品があります</h2>
      <p>{draft.theme || "テーマはまだ決めていません"}</p>
      <a className="button" href={`#/draw/${encodeURIComponent(draft.id)}`}>
        続きから描く
      </a>
    </section>
  ) : null;
}
