# すきのスケッチ（仮称）

好きなキャラクターを自分の手で描き、創作する楽しさを見つける日本語Webアプリ。上達や完成度より、本人の選択と描く過程を大切にします。

## 現在の状態

M1「基盤・画面遷移」を実装しました。ホーム、推し一覧・登録準備、テーマ準備、制作準備、データ管理、存在しないデータの画面を移動できます。登録フォームの入力は保存されません。推し登録保存はM2、テーマはM3、描画・画像取込・作品保存はM4で実装します。

React・TypeScript・Vite・Tailwind CSS、IndexedDB（idb）の構成です。外部AI、ログイン、サーバーへの画像送信はありません。

## 開発手順

Node.js **24.19.0**、npm **11.9.0**を使用します（`.nvmrc`、`package.json`で固定）。

```sh
npm ci
npm run dev
```

```sh
npm run typecheck
npm run lint
npm run test
npm run build
```

E2Eはビルド成果物を`/workshop/`サブパスで配信して検証します。

```sh
npx playwright install chromium
npm run test:e2e
```

既存Chromiumを利用する環境では次のように実行できます。

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
```

クラウド環境の標準npmキャッシュが書込不可のため、`.npmrc`で`/workspace/.npm-cache`を指定しています。別環境では`npm ci --cache <書込可能なパス>`で上書きできます。

## 静的配信

`npm run build`の出力`dist/`を配信します。通常は相対アセットパスです。サブパスが決まっている場合は`npm run build -- --base=/workshop/`のように指定します。URLの画面部分はハッシュ形式なのでサーバー側のルート設定は不要です。オフライン起動は保証しません。

端末のIndexedDBには現在、設定ストアのみを用意しています。サイトデータ削除や配信元変更でデータが消え得ます。作品書出・全件バックアップは後続工程です。公式画像は同梱・自動収集しません。

## 品質検証

2026-10-22時点でも初期版の主要体験は未実装です。既存の基盤について単体15件・Chromium E2E12件を確認し、保存環境の誤判定と入力欄の説明関連付けを修正しました。実機の描画や作品保存を検証済みという意味ではありません。[機能別の結果・手動チェックリスト](docs/QUALITY_REPORT.md)を参照してください。

## 資料

- [スマートフォンでのテスト用公開手順](docs/MOBILE_TEST_GUIDE.md)
- [製品仕様](docs/PRODUCT_SPEC.md)
- [画面遷移・体験](docs/SCREEN_FLOW.md)
- [実装計画・進捗](docs/IMPLEMENTATION_PLAN.md)
- [受け入れ基準・検証記録](docs/TEST_PLAN.md)
- [開発ルール](AGENTS.md)
