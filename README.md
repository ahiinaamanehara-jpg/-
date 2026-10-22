# すきのスケッチ（仮称）

好きなキャラクターを自分の手で描き、創作する楽しさを見つける日本語Webアプリ。上達や完成度より、本人の選択と描く過程を大切にします。

## 現在の状態

M3「お題・創作テーマ選択」まで実装しました。M2の推し登録・編集・削除に加え、表情／衣装・小物／ポーズ・場面のお題から選ぶ、別の候補を見る、自由に書き換える、テーマを決めずに進む操作ができます。

選んだ推しとテーマを作品の準備データとして端末内に保存します。再読み込みしても内容が残り、ホームの「続きから準備を開く」で最後に開いた準備へ戻れます。別の準備を始めても前のデータを上書きしません。準備データの一覧はM6で実装予定です。

参考画像はPNG／JPEG／WebP（10MiB・1,600万画素まで）。端末内で向きを補正し、長辺1,600px以下のPNGとして保存します。画像なし・推し未選択でも利用できます。

描画・作品画像の保存はM4以降です。現段階は内部確認用で、創作の一連の体験はまだ完成していません。

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

端末のIndexedDB v3に設定・推し・参考画像・作品の準備データを保存します。v1／v2のデータを削除せず移行します。サイトデータ削除や配信元変更でデータが消え得ます。作品書出・全件バックアップは後続工程です。公式画像は同梱・自動収集しません。

## 品質検証

M1時点の品質検証報告は過去の記録です。最新の実行結果とスマートフォンの確認手順は[テスト計画](docs/TEST_PLAN.md)を参照してください。実機の画像選択や描画を検証済みという意味ではありません。[機能別の結果・手動チェックリスト](docs/QUALITY_REPORT.md)を参照してください。

## 資料

- [スマートフォンでのテスト用公開手順](docs/MOBILE_TEST_GUIDE.md)
- [製品仕様](docs/PRODUCT_SPEC.md)
- [画面遷移・体験](docs/SCREEN_FLOW.md)
- [実装計画・進捗](docs/IMPLEMENTATION_PLAN.md)
- [受け入れ基準・検証記録](docs/TEST_PLAN.md)
- [開発ルール](AGENTS.md)
