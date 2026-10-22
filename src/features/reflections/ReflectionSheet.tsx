import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { Sheet } from "../../components/Sheet";
import { loadDrawingBitmap } from "../../data/drawings";
import { loadDraft } from "../../data/drafts";
import {
  loadReflectionContext,
  saveReflection,
  deleteReflection,
  type Reflection,
  type ReflectionContext,
} from "../../data/reflections";
import {
  firstQuestion,
  nextQuestion,
  questionById,
  type QuestionId,
} from "../../data/reflectionQuestions";

export interface ReflectionExitGuard {
  pending: boolean;
  canLeave: () => boolean;
}
interface Form {
  questionId: QuestionId;
  text: string;
  choice: string | null;
  comparedArtworkId?: string;
  existing?: Reflection;
  initialComparedId?: string;
}
function message(error: unknown) {
  if (error instanceof DOMException && error.name === "QuotaExceededError")
    return "保存領域が不足しています。絵は保存済みです。回答はこの画面に残っています。入力を控えるか、保存を再試行できます。";
  return error instanceof Error && /[ぁ-んァ-ヶ一-龠]/.test(error.message)
    ? error.message
    : "振り返りを読み書きできませんでした。入力と既存データは保持しています。もう一度お試しください。";
}
function ComparisonPreview({ artworkId }: { artworkId: string }) {
  const ref = useRef<HTMLImageElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true,
      url: string | undefined;
    void loadDraft(artworkId)
      .then(async (draft) => {
        if (!draft) throw new Error("missing");
        const blob = await loadDrawingBitmap(draft);
        if (!blob) throw new Error("missing");
        if (active && ref.current) {
          url = URL.createObjectURL(blob);
          ref.current.src = url;
        }
      })
      .catch(() => {
        if (active)
          setError("前の絵を表示できません。元の作品は変更していません。");
      });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [artworkId]);
  return (
    <div className="comparison-preview">
      <p>選んだ前の作品</p>
      {error ? (
        <p role="status">{error}</p>
      ) : (
        <img
          ref={ref}
          alt="比べてみる前の作品"
          onError={() =>
            setError("前の絵を表示できません。元の作品は変更していません。")
          }
        />
      )}
    </div>
  );
}
export function ReflectionSheet({
  artworkId,
  onClose,
  registerExitGuard,
  returnFocusRef,
}: {
  artworkId: string;
  onClose: () => void;
  registerExitGuard: (guard?: ReflectionExitGuard) => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const [context, setContext] = useState<ReflectionContext>();
  const [view, setView] = useState<"question" | "history" | "delete">(
    "history",
  );
  const [form, setForm] = useState<Form>();
  const [candidate, setCandidate] = useState<Reflection>();
  const [seen, setSeen] = useState<QuestionId[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const id = useId();
  const dirty =
    view === "question" &&
    !!form &&
    (form.text !== (form.existing?.text ?? "") ||
      form.choice !== (form.existing?.choice ?? null) ||
      form.comparedArtworkId !== form.initialComparedId);
  const canLeave = () =>
    !busyRef.current &&
    (!dirty ||
      window.confirm(
        "入力した振り返りは保存されていません。入力を破棄しますか？",
      ));
  const close = () => {
    if (canLeave()) onClose();
  };
  useEffect(() => {
    const guard = {
      pending: dirty || busy,
      canLeave: () =>
        !busyRef.current &&
        (!dirty ||
          window.confirm(
            "入力した振り返りは保存されていません。入力を破棄しますか？",
          )),
    };
    registerExitGuard(guard);
    return () => registerExitGuard(undefined);
  }, [dirty, busy, registerExitGuard]);
  useEffect(() => {
    let active = true;
    loadReflectionContext(artworkId)
      .then((loaded) => {
        if (!active) return;
        setContext(loaded);
        setError("");
        setNotice("");
        const questionId = firstQuestion(
          loaded.artwork.status === "in-progress",
        );
        setSeen(loaded.reflections.map((record) => record.questionId));
        if (loaded.reflections.length) {
          setView("history");
          setForm(undefined);
        } else {
          setView("question");
          setForm({ questionId, text: "", choice: null });
          setSeen([questionId]);
        }
      })
      .catch((error) => {
        if (active) setError(message(error));
      });
    return () => {
      active = false;
    };
  }, [artworkId, attempt]);
  useEffect(() => {
    heading.current?.focus();
  }, [view, form?.questionId, context]);
  const openQuestion = (questionId: QuestionId, existing?: Reflection) => {
    const comparedArtworkId =
      existing?.comparedArtworkId ??
      (questionId === "change" ? context?.previous[0]?.id : undefined);
    setForm({
      questionId,
      text: existing?.text ?? "",
      choice: existing?.choice ?? null,
      existing,
      comparedArtworkId,
      initialComparedId: comparedArtworkId,
    });
    setSeen((old) => [...new Set([...old, questionId])]);
    setView("question");
    setError("");
    setNotice("");
  };
  const save = async () => {
    if (!form || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = await saveReflection({
        artworkId,
        questionId: form.questionId,
        text: form.text,
        choice: form.choice,
        comparedArtworkId: form.comparedArtworkId,
        expectedRevision: form.existing?.revision,
      });
      setContext(
        (old) =>
          old && {
            ...old,
            reflections: [
              ...old.reflections.filter(
                (r) => r.questionId !== saved.questionId,
              ),
              saved,
            ],
          },
      );
      setForm(undefined);
      setView("history");
      setNotice("保存しました。");
    } catch (error) {
      setError(message(error));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!candidate || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await deleteReflection(candidate.id, candidate.revision);
      setContext(
        (old) =>
          old && {
            ...old,
            reflections: old.reflections.filter((r) => r.id !== candidate.id),
          },
      );
      setCandidate(undefined);
      setView("history");
      setNotice("削除しました。");
    } catch (error) {
      setError(message(error));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const additional =
    context &&
    nextQuestion(
      [...seen, ...context.reflections.map((r) => r.questionId)],
      !!context.artwork.characterId,
    );
  const skip = () => {
    if (
      busyRef.current ||
      (dirty &&
        !window.confirm(
          "入力した回答は保存されていません。この質問をスキップしますか？",
        ))
    )
      return;
    if (additional) openQuestion(additional.id);
    else {
      setForm(undefined);
      setView("history");
      setError("");
      setNotice(
        "この質問への回答は保存していません。用意した質問はここまでです。",
      );
    }
  };
  const comparisonAvailable =
    context &&
    context.previous.length > 0 &&
    !seen.includes("change") &&
    !context.reflections.some((r) => r.questionId === "change");
  const question = form && questionById(form.questionId)!;
  return (
    <Sheet
      title="振り返り（任意）"
      onClose={close}
      closeDisabled={busy}
      returnFocusRef={returnFocusRef}
    >
      <p>
        絵は保存済みです。答えずに閉じても残ります。今の気持ちのまま、空欄でも保存できます。
      </p>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <div className="error" role="alert">
          <p>{error}</p>
          <button
            disabled={busy}
            onClick={() => {
              if (canLeave()) {
                setContext(undefined);
                setForm(undefined);
                setCandidate(undefined);
                setAttempt((n) => n + 1);
              }
            }}
          >
            一覧を読み直す
          </button>
        </div>
      )}
      {!context && !error && <p role="status">振り返りを読み込んでいます…</p>}
      {context && view === "question" && form && question && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={busy} className="reflection-form">
            <legend className="sr-only">今回の質問</legend>
            <h3 ref={heading} tabIndex={-1} className="reflection-question">
              {question.text}
            </h3>
            {form.questionId === "change" && (
              <>
                <label htmlFor={`${id}-previous`}>比べてみる前の作品</label>
                <select
                  id={`${id}-previous`}
                  value={form.comparedArtworkId ?? ""}
                  onChange={(event) =>
                    setForm({ ...form, comparedArtworkId: event.target.value })
                  }
                >
                  {form.comparedArtworkId &&
                    !context.previous.some(
                      (a) => a.id === form.comparedArtworkId,
                    ) && (
                      <option value={form.comparedArtworkId}>
                        以前選んだ作品（現在は参照できません）
                      </option>
                    )}
                  {context.previous.map((a) => (
                    <option key={a.id} value={a.id}>
                      {new Date(a.createdAt).toLocaleDateString("ja-JP")}：
                      {a.theme || "テーマなし"}
                    </option>
                  ))}
                </select>
                {form.comparedArtworkId && (
                  <ComparisonPreview
                    key={form.comparedArtworkId}
                    artworkId={form.comparedArtworkId}
                  />
                )}
                <p className="note">
                  上達や良い変化を答える必要はありません。変わらない・わからないも選べます。
                </p>
              </>
            )}
            <div
              className="reflection-choices"
              role="group"
              aria-label="短く答える"
            >
              {question.choices.map((choice) => (
                <button
                  type="button"
                  key={choice}
                  aria-pressed={form.choice === choice}
                  onClick={() =>
                    setForm({
                      ...form,
                      choice: form.choice === choice ? null : choice,
                    })
                  }
                >
                  {choice}
                </button>
              ))}
            </div>
            <label htmlFor={`${id}-answer`}>自由に書く（任意）</label>
            <p id={`${id}-help`} className="note">
              2,000文字まで。選択肢と文章はどちらかだけでも、両方でも使えます。選んだ項目をもう一度押すと外せます。
            </p>
            <textarea
              id={`${id}-answer`}
              rows={4}
              maxLength={2000}
              value={form.text}
              aria-describedby={`${id}-help ${id}-count`}
              onChange={(event) =>
                setForm({ ...form, text: event.target.value })
              }
            />
            <p id={`${id}-count`} className="note">
              {form.text.length} / 2000文字
            </p>
            <div className="actions">
              <button className="primary" type="submit">
                {busy ? "保存しています…" : "回答を保存"}
              </button>
              <button type="button" onClick={skip}>
                この質問をスキップ
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {context && view === "history" && (
        <>
          <h3 ref={heading} tabIndex={-1}>
            保存した振り返り
          </h3>
          {context.reflections.length === 0 && (
            <p>保存した回答はまだありません。</p>
          )}
          <ul className="reflection-history">
            {context.reflections.map((record) => (
              <li key={record.id}>
                <h4>{questionById(record.questionId)!.text}</h4>
                {record.choice && <p>{record.choice}</p>}
                <p className="reflection-answer">
                  {record.text || (!record.choice ? "（空欄で保存）" : "")}
                </p>
                <div className="actions">
                  <button
                    disabled={busy}
                    onClick={() => openQuestion(record.questionId, record)}
                  >
                    回答を編集
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      setCandidate(record);
                      setView("delete");
                      setNotice("");
                    }}
                  >
                    回答を削除
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <div className="actions">
            {additional && (
              <button
                disabled={busy}
                onClick={() => openQuestion(additional.id)}
              >
                もう1問（任意）
              </button>
            )}
            {comparisonAvailable && (
              <button disabled={busy} onClick={() => openQuestion("change")}>
                前の作品との違いを考える（任意）
              </button>
            )}
          </div>
          {!additional && (
            <p>用意した質問はここまでです。回答はいつでも編集できます。</p>
          )}
        </>
      )}
      {context && view === "delete" && candidate && (
        <>
          <h3 ref={heading} tabIndex={-1}>
            この振り返りを削除しますか？
          </h3>
          <p>{questionById(candidate.questionId)!.text}</p>
          <p>この回答を削除します。作品の絵は残ります。</p>
          <div className="actions">
            <button
              disabled={busy}
              onClick={() => {
                setCandidate(undefined);
                setView("history");
                setError("");
              }}
            >
              キャンセル
            </button>
            <button
              disabled={busy}
              onClick={() => {
                void remove();
              }}
            >
              削除する
            </button>
          </div>
        </>
      )}
      {busy && <p role="status">振り返りを保存しています…</p>}
      <button className="reflection-return" disabled={busy} onClick={close}>
        振り返りを終える
      </button>
    </Sheet>
  );
}
