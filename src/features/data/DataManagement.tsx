import { useEffect, useRef, useState } from "react";
import { openWorkshopDB } from "../../data/database";
import { clearWorkshop } from "../../data/artworks";
import {
  exportBackup,
  inspectBackup,
  restoreBackup,
  type RestorePlan,
} from "../../data/backup";
import { dataError } from "../../data/errors";
import { registerNavigationGuard } from "../../navigation";
import { Sheet } from "../../components/Sheet";
const sizeLabel = (size: number) => `${(size / (1024 * 1024)).toFixed(1)}MiB`;
async function summary() {
  const db = await openWorkshopDB();
  try {
    const tx = db.transaction([
      "characters",
      "artworks",
      "reflections",
      "assets",
    ]);
    const [characters, artworks, reflections, assets] = await Promise.all([
      tx.objectStore("characters").count(),
      tx.objectStore("artworks").count(),
      tx.objectStore("reflections").count(),
      tx.objectStore("assets").count(),
      tx.done,
    ]);
    return { characters, artworks, reflections, assets };
  } finally {
    db.close();
  }
}
export function DataManagement() {
  const [counts, setCounts] = useState<Awaited<ReturnType<typeof summary>>>(),
    [estimate, setEstimate] = useState<StorageEstimate>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [attempt, setAttempt] = useState(0);
  const [plan, setPlan] = useState<RestorePlan>(),
    [download, setDownload] = useState<string>(),
    [confirm, setConfirm] = useState(false),
    [confirmation, setConfirmation] = useState("");
  const busyRef = useRef(false),
    url = useRef<string>(undefined),
    active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      if (url.current) URL.revokeObjectURL(url.current);
    };
  }, []);
  useEffect(() => {
    let current = true;
    summary()
      .then((c) => {
        if (current) setCounts(c);
      })
      .catch((e) => {
        if (current) setError(dataError(e));
      });
    navigator.storage
      ?.estimate?.()
      .then((e) => {
        if (current) setEstimate(e);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [attempt]);
  useEffect(() => {
    const off = registerNavigationGuard(() => !busyRef.current);
    const unload = (e: BeforeUnloadEvent) => {
      if (busyRef.current) {
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
  const run = async (work: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      if (active.current) setError(dataError(e));
    } finally {
      busyRef.current = false;
      if (active.current) {
        setBusy(false);
        setAttempt((n) => n + 1);
      }
    }
  };
  const backup = () =>
    run(async () => {
      const blob = await exportBackup();
      if (!active.current) return;
      if (url.current) URL.revokeObjectURL(url.current);
      url.current = URL.createObjectURL(blob);
      setDownload(url.current);
      const link = document.createElement("a");
      link.href = url.current;
      link.download = "すきのスケッチ-バックアップ.zip";
      link.click();
      setNotice(
        "バックアップを用意しました。端末に保存できたことを確認してください。",
      );
    });
  return (
    <section className="data-tools" aria-labelledby="data-tools-title">
      <h2 id="data-tools-title">保存とバックアップ</h2>
      {counts && (
        <p>
          推し{counts.characters}件・作品{counts.artworks}件・振り返り
          {counts.reflections}件
        </p>
      )}
      {estimate?.quota !== undefined && (
        <p>
          このサイトの使用量の目安：{sizeLabel(estimate.usage ?? 0)} /{" "}
          {sizeLabel(estimate.quota)}。実際に保存できる量の保証ではありません。
        </p>
      )}
      <p>
        作品・参考画像・推しのメモ・振り返りを含むZIPを、この端末へ書き出します。画像だけのPNGとは内容が異なります。
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {busy && (
        <p role="status">
          データを確認・保存しています。この画面でお待ちください。
        </p>
      )}
      <fieldset disabled={busy} className="data-fields">
        <legend className="sr-only">データの操作</legend>
        <button
          onClick={() => {
            void backup();
          }}
        >
          全データをバックアップ
        </button>
        {download && (
          <p>
            <a
              className="button"
              href={download}
              download="すきのスケッチ-バックアップ.zip"
            >
              ZIPをダウンロード
            </a>
          </p>
        )}
        <div className="restore-area">
          <h3>バックアップを追加復元</h3>
          <p>
            このアプリで書き出した50MiB以下のZIPを選びます。内容を確認してから追加し、現在の作品は上書きしません。同じZIPを再び追加すると、作品も複製されます。
          </p>
          <label htmlFor="backup-file">バックアップZIPを選ぶ</label>
          <input
            id="backup-file"
            type="file"
            accept=".zip,application/zip"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = "";
              setPlan(undefined);
              if (file)
                void run(async () => {
                  const inspected = await inspectBackup(file);
                  if (active.current) setPlan(inspected);
                });
            }}
          />
        </div>
        {plan && (
          <div className="restore-preview">
            <h3>追加する内容</h3>
            <p>作成日時：{new Date(plan.createdAt).toLocaleString("ja-JP")}</p>
            <p>
              推し{plan.data.characters.length}件・作品
              {plan.data.artworks.length}件・振り返り
              {plan.data.reflections.length}件・画像{plan.data.assets.length}件
            </p>
            <div className="actions">
              <button
                className="primary"
                onClick={() => {
                  void run(async () => {
                    const added = await restoreBackup(plan);
                    setPlan(undefined);
                    setNotice(
                      `追加復元しました。推し${added.characters}件・作品${added.artworks}件・振り返り${added.reflections}件です。`,
                    );
                  });
                }}
              >
                この内容を追加する
              </button>
              <button onClick={() => setPlan(undefined)}>
                復元をキャンセル
              </button>
            </div>
          </div>
        )}
        {typeof navigator.storage?.persist === "function" && (
          <p>
            <button
              onClick={() => {
                void run(async () => {
                  const ok = await navigator.storage.persist();
                  setNotice(
                    ok
                      ? "ブラウザーにデータを保持する許可が得られました。端末変更やサイトデータ削除に備えてバックアップも残してください。"
                      : "ブラウザーの判断で保持の許可は得られませんでした。バックアップやPNGを残せます。",
                  );
                });
              }}
            >
              データを保持する許可を求める
            </button>
          </p>
        )}
        <p>
          <button
            className="danger"
            onClick={() => {
              setConfirmation("");
              setConfirm(true);
            }}
          >
            このブラウザーの全データを削除
          </button>
        </p>
      </fieldset>
      {confirm && (
        <Sheet
          title="全データを削除しますか？"
          closeDisabled={busy}
          onClose={() => setConfirm(false)}
        >
          <p>
            このアプリの推し・参考画像・作品・振り返り・設定をすべて削除します。元に戻せません。必要なデータのバックアップを端末へ保存してから操作してください。
          </p>
          <label htmlFor="clear-confirmation">
            確認のため「全データを削除」と入力
          </label>
          <input
            id="clear-confirmation"
            disabled={busy}
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
          />
          <div className="actions">
            <button disabled={busy} onClick={() => setConfirm(false)}>
              キャンセル
            </button>
            <button
              disabled={busy || confirmation !== "全データを削除"}
              onClick={() => {
                void run(async () => {
                  await clearWorkshop();
                  setPlan(undefined);
                  setConfirm(false);
                  setNotice("このブラウザーの全データを削除しました。");
                });
              }}
            >
              全データを削除する
            </button>
          </div>
          {error && <p role="alert">{error}</p>}
        </Sheet>
      )}
    </section>
  );
}
