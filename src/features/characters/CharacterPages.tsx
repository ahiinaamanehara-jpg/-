import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  listCharacters,
  loadCharacter,
  saveCharacter,
  deleteCharacter,
  selectCharacter,
  getSelectedCharacterId,
  type Character,
  type ReferenceAsset,
} from "../../data/characters";
import { prepareReferenceImage, type PreparedImage } from "../../data/images";
import { Field } from "../../components/Field";
import { registerNavigationGuard } from "../../navigation";
import { Sheet } from "../../components/Sheet";

function describeError(error: unknown) {
  if (error instanceof DOMException && error.name === "QuotaExceededError")
    return "保存領域が不足しています。入力と既存のデータは保持しています。不要なデータを整理して、もう一度保存してください。";
  if (error instanceof Error && /[ぁ-んァ-ヶ一-龠]/.test(error.message))
    return error.message;
  return "データを読み書きできませんでした。既存のデータは削除していません。もう一度お試しください。";
}

function ReferenceImage({
  blob,
  name = "",
  onError,
}: {
  blob: Blob;
  name?: string;
  onError?: () => void;
}) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const next = URL.createObjectURL(blob);
    if (ref.current) ref.current.src = next;
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return (
    <img
      ref={ref}
      className="reference-image"
      alt={name ? `${name}の参考画像` : "参考画像"}
      onError={onError}
    />
  );
}

export function FreeStartLink({
  children,
  className = "button",
}: {
  children: ReactNode;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <a
        className={className}
        href="#/new"
        aria-disabled={busy}
        onClick={(event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          selectCharacter(null)
            .then(() => {
              window.location.hash = "/new";
            })
            .catch((error) => setError(describeError(error)))
            .finally(() => setBusy(false));
        }}
      >
        {children}
      </a>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </>
  );
}

function CharacterCard({
  character,
  selected,
  onSelect,
}: {
  character: Character;
  selected: boolean;
  onSelect: () => void;
}) {
  const [asset, setAsset] = useState<ReferenceAsset>();
  const [imageError, setImageError] = useState(false);
  useEffect(() => {
    let active = true;
    if (character.referenceAssetId)
      loadCharacter(character.id)
        .then((data) => {
          if (active) {
            setAsset(data?.asset);
            setImageError(!data?.asset);
          }
        })
        .catch(() => {
          if (active) setImageError(true);
        });
    return () => {
      active = false;
    };
  }, [character.id, character.referenceAssetId]);
  return (
    <article className={`character-card ${selected ? "is-selected" : ""}`}>
      {asset && (
        <ReferenceImage
          blob={asset.blob}
          name={character.name}
          onError={() => setImageError(true)}
        />
      )}
      <div className="character-card-body">
        <h2>{character.name}</h2>
        {selected && <span className="selected-label">選択中</span>}
        {character.memo && <p className="memo">{character.memo}</p>}
        {imageError && (
          <p className="note">
            参考画像を読み込めません。編集から選び直せます。
          </p>
        )}
        <div className="actions">
          <button disabled={selected} onClick={onSelect}>
            この推しを選ぶ
          </button>
          <a
            className="button"
            href={`#/characters/${encodeURIComponent(character.id)}`}
          >
            編集する
          </a>
        </div>
      </div>
    </article>
  );
}

export function CharactersPage({ notice }: { notice?: string }) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selected, setSelected] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const mounted = useRef(false);
  const refresh = useCallback(
    () =>
      Promise.all([listCharacters(), getSelectedCharacterId()])
        .then(([items, id]) => {
          if (!mounted.current) return;
          setCharacters(items);
          setSelected(id);
          setError("");
          setLoading(false);
        })
        .catch((error) => {
          if (mounted.current) {
            setError(describeError(error));
            setLoading(false);
          }
        }),
    [],
  );
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const focus = () => {
      void refresh();
    };
    window.addEventListener("focus", focus);
    return () => {
      mounted.current = false;
      window.removeEventListener("focus", focus);
    };
  }, [refresh]);
  const choose = async (id: string | null) => {
    setBusy(true);
    try {
      await selectCharacter(id);
      setSelected(id ?? undefined);
      setError("");
    } catch (error) {
      setError(describeError(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <p>
        好きなところや描きたい表情を、あなたのペースで残せます。参考画像はなくても大丈夫です。
      </p>
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {error && (
        <div role="alert" className="error">
          <p>{error}</p>
          <button
            onClick={() => {
              void refresh();
            }}
          >
            もう一度読み込む
          </button>
        </div>
      )}
      <div className="actions list-actions">
        <a className="button primary" href="#/characters/new">
          推しを登録する
        </a>
        <FreeStartLink>推しを選ばずに進む →</FreeStartLink>
      </div>
      {loading ? (
        <p role="status">ノートを読み込んでいます…</p>
      ) : characters.length === 0 && !error ? (
        <section className="card">
          <div className="empty-icon" aria-hidden="true">
            ♡
          </div>
          <h2>推しのノートは、まだ空です</h2>
          <p>名前だけでも登録できます。好きな呼び名を添えてみませんか。</p>
        </section>
      ) : (
        <div className="character-grid" aria-busy={busy}>
          {characters.map((character) => (
            <CharacterCard
              key={`${character.id}:${character.revision}`}
              character={character}
              selected={selected === character.id}
              onSelect={() => {
                if (!busy) void choose(character.id);
              }}
            />
          ))}
        </div>
      )}
      {selected && (
        <div className="actions list-actions">
          <a className="button primary" href="#/new">
            選んだ推しと次へ進む
          </a>
          <button
            disabled={busy}
            onClick={() => {
              void choose(null);
            }}
          >
            選択を外す
          </button>
        </div>
      )}
      <p className="note">
        画像とメモはこのブラウザーに保存します。描画・お題選択は、これから追加します。
      </p>
    </>
  );
}

export function SelectedCharacter() {
  const [name, setName] = useState<string>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    getSelectedCharacterId()
      .then(async (id) => (id ? loadCharacter(id) : undefined))
      .then((data) => {
        if (active) setName(data?.character.name);
      })
      .catch((error) => {
        if (active) setError(describeError(error));
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <div className="selection-note">
      {error ? (
        <p role="alert">{error}</p>
      ) : (
        <p>
          {name ? (
            <>
              選んだ推し：<strong>{name}</strong>
            </>
          ) : (
            "推しを選ばず、自由な落書きの準備もできます。"
          )}
        </p>
      )}
      <a href="#/characters">推しを選び直す</a>
    </div>
  );
}

export function CharacterEditor({
  id,
  onSaved,
  onMissing,
}: {
  id?: string;
  onSaved: (notice: string) => void;
  onMissing: Dispatch<SetStateAction<string | undefined>>;
}) {
  const [data, setData] = useState<
    { character: Character; asset?: ReferenceAsset } | null | undefined
  >(undefined);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    if (!id) {
      onMissing(undefined);
      return;
    }
    loadCharacter(id)
      .then((data) => {
        if (active) {
          setData(data ?? null);
          onMissing(data ? undefined : id);
          setError("");
        }
      })
      .catch((error) => {
        if (active) setError(describeError(error));
      });
    return () => {
      active = false;
    };
  }, [id, attempt, onMissing]);
  if (id && error)
    return (
      <section className="card">
        <p role="alert">{error}</p>
        <button onClick={() => setAttempt((n) => n + 1)}>
          もう一度読み込む
        </button>
      </section>
    );
  if (id && data === undefined)
    return <p role="status">推しのノートを読み込んでいます…</p>;
  if (id && data === null)
    return (
      <section className="card">
        <p>まだ登録されていないか、削除された推しです。</p>
        <a className="button" href="#/characters">
          推し一覧に戻る
        </a>
      </section>
    );
  return (
    <CharacterForm
      key={id ?? "new"}
      initial={data?.character}
      initialAsset={data?.asset}
      onSaved={onSaved}
    />
  );
}

function CharacterForm({
  initial,
  initialAsset,
  onSaved,
}: {
  initial?: Character;
  initialAsset?: ReferenceAsset;
  onSaved: (notice: string) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [image, setImage] = useState<PreparedImage | null | undefined>();
  const [imageError, setImageError] = useState("");
  const [error, setError] = useState("");
  const [nameError, setNameError] = useState("");
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const generation = useRef(0);
  const saved = useRef(false);
  const dirty =
    name !== (initial?.name ?? "") ||
    memo !== (initial?.memo ?? "") ||
    image !== undefined ||
    preparing;
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if ((dirty || busy) && !saved.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty, busy]);
  useEffect(
    () =>
      registerNavigationGuard(
        () =>
          saved.current ||
          (!busy &&
            (!dirty ||
              window.confirm(
                "変更はまだ保存されていません。保存せずに移動しますか？",
              ))),
      ),
    [dirty, busy],
  );
  const process = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    const version = ++generation.current;
    setPreparing(true);
    setImageError("");
    try {
      const next = await prepareReferenceImage(file);
      if (generation.current === version) {
        setImage(next);
        setPreviewError(false);
      }
    } catch (error) {
      if (generation.current === version) setImageError(describeError(error));
    } finally {
      if (generation.current === version) setPreparing(false);
    }
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || preparing) return;
    if (!name.trim()) {
      setNameError("キャラクター名を入力してください。");
      document.getElementById("character-name")?.focus();
      return;
    }
    setNameError("");
    setError("");
    setBusy(true);
    try {
      await saveCharacter({
        id: initial?.id,
        name,
        memo,
        image,
        expectedRevision: initial?.revision,
      });
      saved.current = true;
      onSaved("保存しました");
      window.location.hash = "/characters";
    } catch (error) {
      setError(
        `保存できませんでした。${describeError(error)} 入力はこの画面に残っています。`,
      );
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!initial || busy) return;
    setBusy(true);
    setError("");
    try {
      await deleteCharacter(initial.id, initial.revision);
      setConfirmDelete(false);
      saved.current = true;
      onSaved("推しを削除しました");
      window.location.hash = "/characters";
    } catch (error) {
      setError(describeError(error));
      setConfirmDelete(false);
      setBusy(false);
    }
  };
  const preview = image === undefined ? initialAsset?.blob : image?.blob;
  const hasReference =
    image === undefined ? Boolean(initial?.referenceAssetId) : image !== null;
  return (
    <section className="card editor-card">
      <p>名前だけでも保存できます。好きなところを、思いついたときに。</p>
      <form onSubmit={save} noValidate>
        <fieldset disabled={busy}>
          <legend className="sr-only">推しの登録内容</legend>
          <Field
            id="character-name"
            label="キャラクター名"
            hint="100文字まで。好きな呼び名でもかまいません。"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setNameError("");
            }}
            maxLength={100}
            required
            aria-invalid={Boolean(nameError)}
            aria-describedby={nameError ? "character-name-error" : undefined}
          />
          {nameError && (
            <p id="character-name-error" className="error" role="alert">
              {nameError}
            </p>
          )}
          <label className="field">
            好きな特徴・描きたいところ
            <textarea
              value={memo}
              onChange={(event) => setMemo(event.target.value)}
              maxLength={2000}
              rows={4}
              aria-describedby="memo-hint"
            />
          </label>
          <p id="memo-hint" className="note">
            2,000文字まで。あとから書き足せます。
          </p>
          <div className="field">
            <label htmlFor="reference-image">参考画像（任意）</label>
            <p id="reference-hint">
              PNG・JPEG・WebP、10MiB・1,600万画素まで。1枚保存できます。画像は端末内で長辺1,600px以下に縮小し、元ファイルや位置情報は保存しません。外部へ送信しません。利用できる画像を選んでください。
            </p>
            <input
              id="reference-image"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={process}
              aria-describedby={`reference-hint${imageError ? " image-error" : ""}`}
            />
          </div>
          {preparing && <p role="status">画像を準備しています…</p>}
          {imageError && (
            <p id="image-error" role="alert" className="error">
              {imageError}
            </p>
          )}
          {preview && (
            <ReferenceImage
              blob={preview}
              onError={() => setPreviewError(true)}
            />
          )}
          {hasReference && (!preview || previewError) && (
            <p role="alert" className="error">
              参考画像を読み込めません。画像を選び直すか、参考画像を外して保存してください。
            </p>
          )}
          {hasReference && (
            <button
              type="button"
              onClick={() => {
                generation.current++;
                setImage(null);
                setImageError("");
                setPreparing(false);
                setPreviewError(false);
              }}
            >
              参考画像を外す
            </button>
          )}
          {busy && (
            <p role="status">
              保存処理中です。完了するまでこの画面でお待ちください。
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="actions form-actions">
            <button className="primary" type="submit" disabled={preparing}>
              {busy
                ? "保存しています…"
                : initial
                  ? "変更を保存"
                  : "登録して保存"}
            </button>
            <a className="button" href="#/characters">
              保存せずに戻る
            </a>
          </div>
        </fieldset>
      </form>
      {initial && (
        <div className="delete-section">
          <button
            className="danger"
            disabled={busy || preparing}
            onClick={() => setConfirmDelete(true)}
          >
            この推しを削除
          </button>
        </div>
      )}
      {confirmDelete && (
        <Sheet
          title="この推しを削除しますか？"
          closeDisabled={busy}
          onClose={() => {
            if (!busy) setConfirmDelete(false);
          }}
        >
          <p>
            「{initial?.name}
            」の名前・メモ・参考画像を、このブラウザーから削除します。この操作は元に戻せません。
          </p>
          {busy && <p role="status">削除しています…</p>}
          <button
            className="danger"
            disabled={busy}
            onClick={() => {
              void remove();
            }}
          >
            削除する
          </button>
        </Sheet>
      )}
      <p className="note">
        保存先はこのブラウザーです。サイトデータの削除で失われる場合があります。
      </p>
    </section>
  );
}
