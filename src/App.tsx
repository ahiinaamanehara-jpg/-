import { useEffect, useRef, useState } from "react";
import { resolveRoute, characterIdFromHash, draftIdFromHash } from "./router";
import { Sheet } from "./components/Sheet";
import {
  checkWorkshopStorage,
  StorageSchemaError,
  StorageBlockedError,
} from "./data/database";
import {
  CharactersPage,
  CharacterEditor,
  FreeStartLink,
} from "./features/characters/CharacterPages";
import {
  ThemePage,
  DraftPreparation,
  ResumePreparation,
} from "./features/themes/ThemePages";
import { canNavigate } from "./navigation";
export function App() {
  const [hash, setHash] = useState(window.location.hash);
  const [sheet, setSheet] = useState(false);
  const [storage, setStorage] = useState("保存環境を確認しています");
  const heading = useRef<HTMLHeadingElement>(null);
  const activeHash = useRef(window.location.hash);
  const route = resolveRoute(hash);
  const characterId = characterIdFromHash(hash);
  const draftId = draftIdFromHash(hash);
  const [missingDraftId, setMissingDraftId] = useState<string>();
  const [missingId, setMissingId] = useState<string>();
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let approvedTarget: string | undefined;
    const click = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      const target = anchor?.getAttribute("href");
      if (
        !target?.startsWith("#/") ||
        target === activeHash.current ||
        anchor?.getAttribute("target") === "_blank"
      )
        return;
      if (!canNavigate()) {
        event.preventDefault();
        return;
      }
      approvedTarget = target;
    };
    const change = () => {
      const next = window.location.hash;
      if (next === activeHash.current) return;
      const approved = approvedTarget === next;
      approvedTarget = undefined;
      if (!approved && !canNavigate()) {
        // Backで到達した先を上書きせず、元の編集画面へ戻す。
        // 通常のリンクはclickで事前確認し、キャンセル時に履歴を追加しない。
        window.history.pushState(null, "", activeHash.current || "#/");
        return;
      }
      activeHash.current = next;
      setHash(next);
      setSheet(false);
    };
    window.addEventListener("hashchange", change);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("hashchange", change);
      document.removeEventListener("click", click, true);
    };
  }, []);
  useEffect(() => {
    heading.current?.focus();
    window.scrollTo(0, 0);
  }, [hash]);
  useEffect(() => {
    let active = true;
    checkWorkshopStorage()
      .then(() => {
        if (active)
          setStorage(
            "このブラウザーで端末内保存を利用できます（小さな設定データで確認）",
          );
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (
          error instanceof StorageSchemaError ||
          (error instanceof DOMException && error.name === "VersionError")
        ) {
          setStorage(
            "保存データの構造を確認できません。既存データを削除せず確認を中止しました。",
          );
        } else if (
          error instanceof DOMException &&
          error.name === "QuotaExceededError"
        ) {
          setStorage(
            "保存領域が不足しています。端末内保存を利用できません。既存データは削除していません。",
          );
        } else if (error instanceof StorageBlockedError) {
          setStorage(error.message);
        } else {
          setStorage("このブラウザーでは端末内保存を利用できません");
        }
      });
    return () => {
      active = false;
    };
  }, []);
  const titles = {
    home: "好き、からはじめよう。",
    characters: "推しのノート",
    "character-new": "推しを迎える",
    "character-edit":
      missingId === characterId ? "推しが見つかりません" : "推しを編集する",
    new: "今日は、どんな姿に？",
    draw:
      draftId && missingDraftId === draftId
        ? "作品が見つかりません"
        : "あなたの創作スペース",
    "work-missing": "作品が見つかりません",
    data: "データと安心のこと",
    "not-found": "ページが見つかりません",
  };
  return (
    <>
      <a
        className="skip"
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        本文へ移動
      </a>
      <header>
        <a className="brand" href="#/" aria-label="すきのスケッチ ホーム">
          ✎{" "}
          <span>
            すきのスケッチ<small>あなたの「好き」を、ひと筆ずつ。</small>
          </span>
        </a>
        <span className="badge">開発中</span>
      </header>
      <nav aria-label="メインメニュー">
        <a href="#/" aria-current={route === "home" ? "page" : undefined}>
          作品の棚
        </a>
        <a
          href="#/characters"
          aria-current={route.startsWith("character") ? "page" : undefined}
        >
          推しのノート
        </a>
        <a
          href="#/settings/data"
          aria-current={route === "data" ? "page" : undefined}
        >
          データ管理
        </a>
      </nav>
      <main id="main" tabIndex={-1}>
        <div className="eyebrow">FAN ART NOTEBOOK</div>
        <h1 ref={heading} tabIndex={-1}>
          {titles[route]}
        </h1>
        {route === "home" && (
          <>
            <p className="lead">
              上手く描くより、描いてみたい気持ちから。
              <br />
              短い落書きも、途中の一枚も、あなたの作品です。
            </p>
            <ResumePreparation />
            <section className="hero">
              <div className="paper-art" aria-hidden="true">
                <span>すき</span>
                <i>✧</i>
                <b>✎</b>
              </div>
              <div>
                <h2>まだ白紙の、あなたの棚</h2>
                <p>
                  好きなキャラクターや、ふと思いついたもの。
                  <br />
                  ここから創作の準備をはじめられます。
                </p>
                <div className="actions">
                  <a className="button primary" href="#/characters">
                    好きなキャラクターを選ぶ
                  </a>
                  <FreeStartLink>自由に落書きする準備</FreeStartLink>
                </div>
              </div>
            </section>
            <p className="note">
              推しと創作テーマを保存できます。描画・作品画像の保存は、これから追加します。
            </p>
            <section className="info">
              <h2>自分のペースで、大丈夫。</h2>
              <p>
                講座も振り返りも、使いたいときだけ。完成を急ぐ必要はありません。
              </p>
              <button onClick={() => setSheet(true)}>端末内保存について</button>
            </section>
          </>
        )}
        {route === "characters" && <CharactersPage notice={notice} />}
        {(route === "character-new" || route === "character-edit") && (
          <CharacterEditor
            key={hash}
            id={
              route === "character-edit"
                ? (characterId ?? "invalid-id")
                : undefined
            }
            onSaved={setNotice}
            onMissing={setMissingId}
          />
        )}
        {route === "new" && <ThemePage />}
        {route === "draw" && (
          <DraftPreparation
            key={hash}
            id={draftId}
            onMissing={setMissingDraftId}
          />
        )}
        {route === "data" && (
          <section className="card">
            <h2>作品は、あなたの端末に</h2>
            <p>
              作品・参考画像・メモは、このブラウザー内に保存する設計です。外部サーバーへ送信しません。
            </p>
            <p role="status">{storage}</p>
            <p>
              ブラウザーのデータ削除や端末変更で消える可能性があります。大切な絵は端末への書き出しやバックアップで残してください。
            </p>
            <button onClick={() => setSheet(true)}>保存の仕組みを読む</button>
            <p className="note">
              推しの名前・メモ・参考画像と、創作テーマの準備データを保存できます。作品画像の保存・バックアップ・復元は後の工程で追加します。
            </p>
          </section>
        )}
        {["not-found", "work-missing"].includes(route) && (
          <section className="card">
            <p>URLが違うか、まだ登録されていないデータです。</p>
            <a className="button primary" href="#/">
              作品の棚に戻る
            </a>
          </section>
        )}
        {route !== "home" && (
          <p className="back">
            <a href="#/">← 作品の棚に戻る</a>
          </p>
        )}
      </main>
      <footer>すきのスケッチ · 自分の手で描く、あなたのための場所。</footer>
      {sheet && (
        <Sheet
          title="このブラウザーに保存します"
          onClose={() => setSheet(false)}
        >
          <p>
            画像や回答を外部に送信せず、IndexedDBというブラウザー内の保存領域を使います。
          </p>
          <p>
            サイトデータの削除、プライベートブラウズ、端末やURLの変更でデータが失われる場合があります。端末内保存は、永久保存の保証ではありません。
          </p>
          <p>画像の書き出しと全データのバックアップは後の工程で用意します。</p>
        </Sheet>
      )}
    </>
  );
}
