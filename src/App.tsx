import { useEffect, useRef, useState } from "react";
import { resolveRoute } from "./router";
import { Sheet } from "./components/Sheet";
import { Field } from "./components/Field";
import { checkWorkshopStorage, StorageSchemaError } from "./data/database";
export function App() {
  const [hash, setHash] = useState(window.location.hash);
  const [sheet, setSheet] = useState(false);
  const [storage, setStorage] = useState("保存環境を確認しています");
  const heading = useRef<HTMLHeadingElement>(null);
  const route = resolveRoute(hash);
  useEffect(() => {
    const change = () => {
      setHash(window.location.hash);
      setSheet(false);
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
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
    "character-missing": "推しが見つかりません",
    new: "今日は、どんな姿に？",
    draw: "あなたの創作スペース",
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
                  <a className="button" href="#/new">
                    自由に落書きする準備
                  </a>
                </div>
              </div>
            </section>
            <p className="note">
              今は画面の土台を準備中です。描画・作品保存はまだ利用できません。
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
        {route === "characters" && (
          <section className="card">
            <div className="empty-icon" aria-hidden="true">
              ♡
            </div>
            <h2>推しのノートは、まだ空です</h2>
            <p>好きなところや描きたい表情を、少しずつ残せる場所になります。</p>
            <a className="button primary" href="#/characters/new">
              登録画面を開く
            </a>
            <p className="note">登録・保存は次の工程で追加します。</p>
            <a href="#/new">推しを選ばずに進む →</a>
          </section>
        )}
        {route === "character-new" && (
          <section className="card">
            <p>
              登録フォームの準備画面です。入力は試せますが、まだ保存されません。画面を離れると消えます。
            </p>
            <Field
              label="キャラクター名"
              hint="好きな呼び名でもかまいません。"
              maxLength={100}
            />
            <label className="field">
              好きな特徴・描きたいところ
              <textarea maxLength={2000} rows={4} />
            </label>
            <button disabled>登録・保存（準備中）</button>
            <p>
              <a href="#/characters">推し一覧に戻る</a>
            </p>
          </section>
        )}
        {route === "new" && (
          <section className="card">
            <p>
              テーマを決めても、決めなくても。自分のペースで始められる場所を準備しています。
            </p>
            <ul className="chips">
              <li>表情</li>
              <li>衣装・小物</li>
              <li>ポーズ・場面</li>
              <li>自由なアイデア</li>
            </ul>
            <p className="note">お題の提案・テーマ保存はM3で追加します。</p>
            <a className="button primary" href="#/draw/new">
              制作画面の準備を見る
            </a>
          </section>
        )}
        {route === "draw" && (
          <section className="card">
            <div className="canvas-placeholder">
              <p>ここに、あなたの一枚を。</p>
              <span>キャンバスはM4で追加します。まだ描画できません。</span>
            </div>
            <p>
              ペン・画像取込・途中保存は準備中です。講座を受けずに描けるようにします。
            </p>
            <a href="#/new">テーマ画面に戻る</a>
          </section>
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
              作品保存・バックアップ・復元は後の工程で追加します。現在は保存基盤のみです。
            </p>
          </section>
        )}
        {["not-found", "work-missing", "character-missing"].includes(route) && (
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
