# ハンドオフメモ

**更新日**: 2026-02-07
**ブランチ**: main（クリーン）
**フェーズ**: Phase 8完了 + 追加実装

## 直近の変更（02-06〜07）

| PR/コミット | 内容 |
|----|------|
| 33a271a | **PWAメタタグ非推奨警告修正**（`apple-mobile-web-app-capable` → `mobile-web-app-capable`） |
| 47d63ad | **PWA記載の残漏れ対応**（CLAUDE.md開発完了サマリー+ファイル構成+GitHub Pages 3ファイル） |
| 39f098c | **アプリ内ヘルプにPWAホーム画面追加手順を追記**（iOS/Android/PC対応） |
| 71fbf89 | **PWA対応のドキュメント反映**（6ファイル更新+ユーザーガイドにホーム画面追加手順） |
| **#69** | **PWA最小構成の追加**（ホーム画面設置+スタンドアロン表示、キャッシュなしSW） |
| b7dd31f | **ドキュメント監査残課題の完了**（ファイル構成更新+ADR-0007作成、全アクションアイテム✅） |
| **#68** | E2Eテスト共通ヘルパー抽出（`loginWithTestUser`等、-150行の重複除去） |
| b6709ff | **CI E2Eテスト全パス達成**（39/39）- 6コミットで段階修正 |
| **#67** | Playwright E2Eテスト拡充+CI統合（8ファイル、+540行） |
| 7723d1a | ドキュメント監査残課題の一括対応（data-model.md等） |
| 1b67b2f | 納品ページ改善+ADR-0009 - Feature Flags方針ADR |
| #66 | OAuth OOB→loopback方式移行+納品ページ改善 |
| #65 | setup-tenant.sh/setup-gmail-auth.shに非対話モード追加 |
| #63 | フィルターパネル全タブ共通化＋期間指定フィルター追加 |

### CI E2E修正の詳細（02-07）

6コミット（`2abad2c`〜`b6709ff`）で以下を修正:

| 問題 | 修正 |
|------|------|
| Playwright実行ディレクトリ誤り | `cd frontend &&` 追加 |
| `page.evaluate()`内のベアモジュール解決不可 | `firebase.ts`に`signInWithEmailAndPassword`再エクスポート |
| strict modeロケータ違反 | `.first()` 追加 |
| functionsエミュレータ未起動でトリガー不発火 | `--only auth,firestore,functions` |
| `devices['iPhone 14']`がWebKit依存 | viewport直指定に変更 |
| モバイルで`hidden sm:inline`テキスト非表示 | `h1`ヘッダーで判定 |
| 存在しない「確認待ち」タブ参照 | 事業所別タブテストに書き換え |
| ESC→OCR確認ダイアログでモーダル閉じない | 確認ダイアログ対応追加 |

**プロダクションコード変更**: `firebase.ts`に1行追加のみ（再エクスポート）。アプリ動作への影響なし。

### Claude Code納品フロー（完成状態）

- GitHub Pages: `https://yasushi-honda.github.io/doc-split/#/claude-code-delivery`
- フォーム入力→プロンプト自動生成→コピー→Claude Codeに貼付けで全自動納品

## E2Eテスト状況

| 項目 | 値 |
|------|-----|
| 総テスト数（@emulator） | **39件**（8ファイル、共通ヘルパー含む） |
| CI結果 | **全パス** |
| テスト時間（CI） | 約1.3分 |

## デプロイ状況

| 環境 | 状態 |
|------|------|
| dev | デプロイ済み（02-07、33a271a反映） |
| kanameone | デプロイ済み（02-07、33a271a反映） |

## 未解決の既知バグ

なし

## 次のアクション候補（優先度順）

1. **クライアント別オプション機能の実装**（最初の具体的要望確定時）→ ADR-0009参照
2. 精度改善（フィードバック後）
