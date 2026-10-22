import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  listCharacters,
  getSelectedCharacterId,
  type Character,
} from "../../data/characters";
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
  const [themeCategory, setThemeCategory] = useState<ThemeCategory | null>(
    null,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState(0);
  const initialized = useRef(false);
  const saving = useRef(false);
  const saved = useRef(false);
  const dirty = theme !== "" || characterId !== initialCharacterId;
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
    if (saving.current || !ready) return;
    if (!skip && theme.length > 500) {
      setError("テーマは500文字以内で入力してください。");
      return;
    }
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const draft = await createDraft({
        characterId: characterId || undefined,
        theme: skip ? "" : theme,
        themeCategory: skip || !theme.trim() ? null : themeCategory,
      });
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
        <fieldset disabled={!ready || busy}>
          <legend className="sr-only">今回の創作テーマ</legend>
          <div className="field">
            <label htmlFor="theme-character">描くキャラクター</label>
            <select
              id="theme-character"
              value={characterId}
              onChange={(event) => setCharacterId(event.target.value)}
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
          {busy && <p role="status">推しとテーマを保存しています…</p>}
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
