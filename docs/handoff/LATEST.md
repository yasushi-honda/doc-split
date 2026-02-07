# ハンドオフメモ

**更新日**: 2026-02-07
**ブランチ**: main（クリーン）
**フェーズ**: Phase 8完了 + 追加実装

## 直近の変更（02-06〜07）

| PR/コミット | 内容 |
|----|------|
| **#87** | **全Callable関数の認証・権限チェック統一**（PDF系3関数に認証+WL追加、OCR/検索系にWL追加、マスター操作にadmin確認追加、initTenantに初回限定ガード追加） |
| **#86** | **一括操作の操作手順をヘルプ・管理者ガイドに追加**（HelpPage セクション6新設、admin-guide更新） |
| **#85** | **一括操作ボタンのDRY違反解消**（BulkActionButton共通コンポーネント抽出） |
| **#84** | **デスクトップの件数テキスト・×ボタンを左側に移動**（レイアウト安定化） |
| **#83** | **デスクトップで件数テキスト＋×ボタン表示**（モバイルはバッジのみ、レスポンシブ対応） |
| **#82** | **未選択時に別の操作ボタンへ直接切替可能に** |
| **#81** | **一括操作ボタンの選択/実行状態を視覚的に区別**（0件=アウトライン/トグル、1件+=ソリッド/実行） |
| **#80** | **バッジ切れ防止・×ボタン削除・横スクロール解消** |
| **#79** | **TabsListのflex-wrap削除＋shrink-0対応** |
| **#78** | **外側コンテナのflex-wrap削除** |
| **#77** | **フローティングバッジ化**（absolute positioning、レイアウト非影響） |
| **#76** | **モバイル選択件数バッジ追加** |
| **#75** | **モバイル一括操作ボタンのアイコン化** |
| **#74** | **一括操作ボタン常時表示＋セレクションモード導入**（目的先行UI：操作選択→対象チェック） |
| **#73** | **invalidateQueries queryKeyミスマッチ全箇所修正**（アップロード/編集/分割/エラー再処理の4箇所） |
| **#72** | **一括確認・再処理のqueryKey修正**（2箇所） |
| **#71** | **ネットワーク状態バナー＋一括削除の楽観的UI更新＋queryKeyバグ修正** |
| **#70** | **E2Eテスト「詳細モーダルを閉じる」CI失敗修正** + `.gitignore`に`.serena/`・`*.png`追加 |
| 09856eb | **CLAUDE.md最適化**（395行→87行、公式ベストプラクティス準拠） |
| c36d58e | **OCRバグ修正：processingスタック対応**（errorLogger undefinedフィルタ、handleProcessingError status優先更新、fix-stuck-documents.js追加）|
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
| dev | デプロイ済み（02-07、bf9f991反映、PR #87含む） |
| kanameone | デプロイ済み（02-07、bf9f991反映、PR #87含む） |

## 未解決の既知バグ

なし（02-07: processingスタックバグは修正・復旧済み）

## Codexレビュー指摘事項（バックログ）

PR #71対応時にCodex（GPT）レビューで検出。今後の改善候補:

| 重要度 | 指摘 | 箇所 |
|--------|------|------|
| ~~Medium~~ | ~~PDF系Callable（detectSplitPoints等）にwhitelist/adminチェックなし~~ | ~~`pdfOperations.ts`~~ **→ PR #87で解決** |
| Medium | `useSearch`でレンダー中にsetState | `useSearch.ts:113-121` |
| Medium | Geminiレート制限がインスタンス内のみ | `rateLimiter.ts` |
| Medium | Gmail検索が日単位（`after:YYYY-MM-DD`） | `checkGmailAttachments.ts:137` |

## 次のアクション候補（優先度順）

1. **クライアント別オプション機能の実装**（最初の具体的要望確定時）→ ADR-0009参照
2. Codexレビュー指摘対応（上記バックログ、PDF系Callable権限は解決済み）
3. 精度改善（フィードバック後）
