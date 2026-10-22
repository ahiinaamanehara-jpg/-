import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  listGallery,
  loadArtworkDetail,
  loadArtworkImage,
  setArtworkStatus,
  deleteArtwork,
} from "../../data/artworks";
import { Sheet } from "../../components/Sheet";
import {
  ReflectionSheet,
  type ReflectionExitGuard,
} from "../reflections/ReflectionSheet";
import { registerNavigationGuard } from "../../navigation";
import { ArtworkExport } from "./ArtworkExport";
export const statusName = (status: string) =>
  status === "finished" ? "ひと区切り" : "途中";
export const dateLabel = (date: string) =>
  new Date(date).toLocaleString("ja-JP", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
import { dataError } from "../../data/errors";
export function ArtworkImage({
  id,
  kind,
  alt,
}: {
  id: string;
  kind: "canvas" | "thumbnail";
  alt: string;
}) {
  const ref = useRef<HTMLDivElement>(null),
    img = useRef<HTMLImageElement>(null);
  const [state, setState] = useState("画像を読み込んでいます…");
  useEffect(() => {
    let active = true,
      started = false,
      url: string | undefined;
    const load = () => {
      if (started) return;
      started = true;
      loadArtworkImage(id, kind)
        .then((blob) => {
          if (!active) return;
          if (!blob) {
            setState("まだ白紙の作品です");
            return;
          }
          url = URL.createObjectURL(blob);
          if (img.current) img.current.src = url;
          setState("");
        })
        .catch(() => {
          if (active)
            setState("画像を表示できません。元のデータは残しています。");
        });
    };
    let observer: IntersectionObserver | undefined;
    if (kind === "thumbnail" && typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            load();
            observer?.disconnect();
          }
        },
        { rootMargin: "100px" },
      );
      observer.observe(ref.current!);
    } else load();
    return () => {
      active = false;
      observer?.disconnect();
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, kind]);
  return (
    <div className={`artwork-image ${kind}`} ref={ref}>
      <img
        ref={img}
        alt={alt}
        hidden={!!state}
        loading={kind === "thumbnail" ? "lazy" : "eager"}
        onError={() =>
          setState("画像を表示できません。元のデータは残しています。")
        }
      />
      {state && <p>{state}</p>}
    </div>
  );
}
export function Gallery() {
  const [data, setData] = useState<Awaited<ReturnType<typeof listGallery>>>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [character, setCharacter] = useState("all"),
    [status, setStatus] = useState("all"),
    [page, setPage] = useState(0);
  useEffect(() => {
    let active = true;
    let sequence = 0;
    const refresh = () => {
      const current = ++sequence;
      listGallery()
        .then((d) => {
          if (active && current === sequence) {
            setData(d);
            setError("");
          }
        })
        .catch((e) => {
          if (active) setError(dataError(e));
        });
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
    };
  }, [attempt]);
  const rows =
    data?.artworks.filter(
      (a) =>
        (character === "all" ||
          (character === "none" &&
            !data?.characters.some((c) => c.id === a.characterId)) ||
          a.characterId === character) &&
        (status === "all" || a.status === status),
    ) ?? [];
  const effectivePage = Math.min(
    page,
    Math.max(0, Math.ceil(rows.length / 12) - 1),
  );
  return (
    <section className="gallery" aria-labelledby="gallery-heading">
      <h2 id="gallery-heading">あなたの作品</h2>
      {error && (
        <div role="alert" className="error">
          {error}
          <button onClick={() => setAttempt((n) => n + 1)}>
            一覧を再読み込み
          </button>
        </div>
      )}
      {!data && !error && <p role="status">作品を読み込んでいます…</p>}
      {!!data?.invalid && (
        <p className="error">
          読み込めない作品が{data.invalid}
          件あります。元データは削除していません。
        </p>
      )}
      {!!data?.invalidCharacters && (
        <p className="error">
          読み込めない推しが{data.invalidCharacters}
          件あります。元データは削除していません。
        </p>
      )}
      {data && (
        <>
          <div className="gallery-filters">
            <label>
              推しで絞る
              <select
                value={character}
                onChange={(e) => {
                  setCharacter(e.target.value);
                  setPage(0);
                }}
              >
                <option value="all">すべての推し</option>
                <option value="none">推しを選んでいない作品</option>
                {data.characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              状態で絞る
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(0);
                }}
              >
                <option value="all">すべての状態</option>
                <option value="in-progress">途中</option>
                <option value="finished">ひと区切り</option>
              </select>
            </label>
          </div>
          {!rows.length && (
            <p>
              {data.artworks.length
                ? "この条件の作品はまだありません。"
                : "短い落書きも、白紙の準備も、ここに残せます。"}
            </p>
          )}
          <div className="gallery-grid">
            {rows
              .slice(effectivePage * 12, effectivePage * 12 + 12)
              .map((a) => (
                <article key={a.id} className="work-card">
                  <a href={`#/works/${encodeURIComponent(a.id)}`}>
                    <ArtworkImage
                      key={a.revision}
                      id={a.id}
                      kind="thumbnail"
                      alt="作品のサムネイル"
                    />
                    <h3>{a.theme || "テーマなしの一枚"}</h3>
                  </a>
                  <p>
                    {data.characters.find((c) => c.id === a.characterId)
                      ?.name ?? "自由な落書き"}
                    ・{statusName(a.status)}
                  </p>
                  <p className="note">{dateLabel(a.createdAt)}</p>
                </article>
              ))}
          </div>
          {rows.length > 12 && (
            <div className="actions">
              <button
                disabled={effectivePage === 0}
                onClick={() => setPage(effectivePage - 1)}
              >
                前の作品
              </button>
              <span>
                {effectivePage + 1} / {Math.ceil(rows.length / 12)}
              </span>
              <button
                disabled={(effectivePage + 1) * 12 >= rows.length}
                onClick={() => setPage(effectivePage + 1)}
              >
                次の作品
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
export function WorkDetail({
  id,
  onMissing,
}: {
  id: string;
  onMissing: Dispatch<SetStateAction<string | undefined>>;
}) {
  const [data, setData] =
      useState<Awaited<ReturnType<typeof loadArtworkDetail>>>(),
    [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false),
    [reflection, setReflection] = useState(false);
  const busyRef = useRef(false),
    guard = useRef<ReflectionExitGuard>(undefined),
    reflectionTrigger = useRef<HTMLButtonElement>(null);
  const register = useCallback((g?: ReflectionExitGuard) => {
    guard.current = g;
  }, []);
  useEffect(() => {
    let active = true;
    loadArtworkDetail(id)
      .then((d) => {
        if (active) {
          setData(d);
          setLoaded(true);
          setError("");
          onMissing(d ? undefined : id);
        }
      })
      .catch((e) => {
        if (active) {
          setError(dataError(e));
          setLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, [id, attempt, onMissing]);
  useEffect(() => {
    const off = registerNavigationGuard(
      () => !busyRef.current && (!guard.current || guard.current.canLeave()),
    );
    const unload = (e: BeforeUnloadEvent) => {
      if (busyRef.current || guard.current?.pending) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      off();
      window.removeEventListener("beforeunload", unload);
    };
  }, []);
  const update = async (remove: boolean) => {
    if (!data || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      if (remove) {
        await deleteArtwork(id, data.artwork.revision);
        setConfirm(false);
        window.location.hash = "/";
      } else {
        const artwork = await setArtworkStatus(
          id,
          data.artwork.revision,
          data.artwork.status === "finished" ? "in-progress" : "finished",
        );
        setData({ ...data, artwork });
      }
    } catch (e) {
      setError(dataError(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  return (
    <section>
      {error && (
        <div role="alert" className="error">
          <p>{error}</p>
          <button
            disabled={busy}
            onClick={() => {
              setConfirm(false);
              setAttempt((n) => n + 1);
            }}
          >
            最新の内容を読み直す
          </button>
        </div>
      )}
      {!loaded && <p role="status">作品を読み込んでいます…</p>}
      {loaded && !data && !error && (
        <p>保存されていないか、削除された作品です。</p>
      )}
      {data && (
        <>
          <h2>{data.artwork.theme || "テーマなしの一枚"}</h2>
          <p>
            {data.character?.name ?? "自由な落書き"}・
            {statusName(data.artwork.status)}
          </p>
          <ArtworkImage
            key={data.artwork.revision}
            id={id}
            kind="canvas"
            alt="保存した作品"
          />
          <dl className="work-metadata">
            <dt>制作日</dt>
            <dd>{dateLabel(data.artwork.createdAt)}</dd>
            <dt>更新日</dt>
            <dd>{dateLabel(data.artwork.updatedAt)}</dd>
            <dt>テーマ</dt>
            <dd>{data.artwork.theme || "決めていません"}</dd>
            {data.character?.memo && (
              <>
                <dt>好きな特徴・描きたいところ</dt>
                <dd>{data.character.memo}</dd>
              </>
            )}
          </dl>
          <div className="actions">
            <a
              className="button primary"
              href={`#/draw/${encodeURIComponent(id)}`}
            >
              続きを描く
            </a>
            <button
              disabled={busy}
              onClick={() => {
                void update(false);
              }}
            >
              {data.artwork.status === "finished"
                ? "途中に戻す"
                : "ひと区切りにする"}
            </button>
            <button
              ref={reflectionTrigger}
              disabled={busy || !data.artwork.canvasAssetId}
              onClick={() => setReflection(true)}
            >
              振り返りを見る・書く（任意）
            </button>
          </div>
          <ArtworkExport artwork={data.artwork} />
          <p>
            振り返りは{data.reflections.length}
            件保存しています。答えなくても絵は残ります。
          </p>
          <button
            disabled={busy}
            className="danger"
            onClick={() => setConfirm(true)}
          >
            この作品を削除
          </button>
          {confirm && (
            <Sheet
              title="作品を削除しますか？"
              closeDisabled={busy}
              onClose={() => setConfirm(false)}
            >
              <p>
                「{data.artwork.theme || "テーマなしの一枚"}
                」の絵と振り返りを削除します。この操作は元に戻せません。
              </p>
              <div className="actions">
                <button disabled={busy} onClick={() => setConfirm(false)}>
                  キャンセル
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    void update(true);
                  }}
                >
                  削除する
                </button>
              </div>
              {error && <p role="alert">{error}</p>}
            </Sheet>
          )}
          {reflection && (
            <ReflectionSheet
              artworkId={id}
              returnFocusRef={reflectionTrigger}
              registerExitGuard={register}
              onClose={() => {
                setReflection(false);
                setAttempt((n) => n + 1);
              }}
            />
          )}
        </>
      )}
    </section>
  );
}
