# ハンドオフメモ

**更新日**: 2026-02-14（再処理機能修正・Firestoreルール補完・E2Eテスト修正）
**ブランチ**: main
**フェーズ**: Phase 8完了 + マルチクライアント安全運用機構 + 再処理機能バグ修正（PR #129-131）

## 直近の変更（02-14）

| PR | コミット | 内容 |
|----|------|------|
| **#131** | **9d99407** | **fix: 再処理E2Eテストを#129仕様変更に合わせて修正** PR #129でモーダル自動クローズ削除後、テストが旧仕様（自動クローズ）を期待していたため失敗。モーダルが開いたままステータス「待機中」に変わることを検証するよう修正 |
| **#130** | **c96d116** | **fix: Firestoreルールに再処理用フィールドを追加** `getReprocessClearFields()`が使用する15フィールド(ocrResultUrl, summary, ocrExtraction, pageResults, fileDateFormatted, careManager, category, customerCandidates, officeCandidates, extractionScores, extractionDetails, allCustomerCandidates, suggestedNewOffice, lastErrorMessage, lastErrorId)がルールのaffectedKeys().hasOnly()に不足していた。フロント→Firestore updateで PERMISSION_DENIED 回避 |
| **#129** | **48e869e** | **fix: 再処理機能の4つのバグを修正** ①確認済み→未確認リセット漏れ ②メタ情報クリア漏れ ③モーダルポーリング未対応 ④処理中UI未実装。`getReprocessClearFields()`ファクトリ追加、`useDocument()`にconditional polling、processing overlayUI実装。モーダル自動クローズ削除し進捗表示対応 |

## 実運用テスト結果（8 Phase 全完了・02-13）

| Phase | 内容 | 結果 |
|-------|------|------|
| 1 | ベースライン記録 | ✅ 完了 |
| 2 | switch-client.sh全3環境切替 | ✅ 通過（dev↔kanameone↔cocoro） |
| 3 | deploy-to-project.sh認証チェック | ✅ 通過（正常系3件、異常系ブロック） |
| 4 | verify-setup.sh環境検証 | ✅ 通過（dev 9/10, kanameone 16/16, cocoro 8/14） |
| 5 | PITR確認 | ✅ 通過（dev:DISABLED, kanameone/cocoro:ENABLED） |
| 6 | GitHub Pages納品フォーム | ✅ 通過（表示・生成OK）|
| 7 | client-setup-gcp.sh構造確認 | ✅ 通過（Step 0-4確認）|
| 8 | 環境復元・ベースライン確認 | ✅ 通過（一致） |

## 安全運用機構の判定

**✅ 本番運用可能** - 複数クライアント環境での誤操作防止が正常動作

### 実装完了内容

1. **クライアント定義ファイル** (`scripts/clients/*.env`)
   - dev/kanameone: 個人アカウント（gmail.com）
   - cocoro: ハイブリッド（SA owner + 開発者 editor）

2. **環境切替スクリプト** (`switch-client.sh`)
   - gcloud構成・アカウント自動切替
   - `.envrc.client` 生成 + direnv allow実行

3. **デプロイ前認証チェック** (`deploy-to-project.sh`)
   - gcloud構成・アカウント一致を自動検証
   - 不一致時は即座に中止 + 修正案提示

4. **PITR自動有効化** (`setup-tenant.sh` Step 9)
   - Firestore 7日間ポイントインタイムリカバリ自動有効化
   - 本番環境(kanameone/cocoro): ENABLED
   - 開発環境(dev): DISABLED

### cocoro 納品状態（2026-02-13 確認完了）

| 項目 | 状態 | 詳細 |
|------|------|------|
| Google Sign-in | ✅ **動作確認済み** | Web Application OAuth Client作成、ログイン成功確認 |
| 運用体制 | ✅ **ハイブリッド確立** | SA (owner) + 開発者 hy.unimail.11@gmail.com (editor) |
| Firestore settings | ✅ **設定済み** | app/auth/gmail全て投入済み（02-11） |
| マスターデータ | ✅ **投入済み** | 顧客5, 書類種別5, 事業所5, ケアマネ2 |
| Cloud Functions | ✅ **ACTIVE** | 19関数全て稼働 |
| Storage CORS | ✅ **設定済み** | https://docsplit-cocoro.web.app でアクセス可能 |
| Gmail API | ✅ **ENABLED** | Secret Manager に client-id/secret 保存済み（v2: Web Client統一） |
| PITR | ✅ **ENABLED** | 7日間ポイントインタイムリカバリ有効 |
| 管理者ユーザー | ✅ **登録済み** | a.itagaki@cocoro-mgnt.com (admin) |
| **Gmail OAuth認証** | ⏳ **先方操作待ち** | OAuthポップアップ認証 → ラベル設定 → 運用開始 |

**開発者側作業: 100%完了。先方はブラウザUI操作のみ（3ステップ）**

**技術メモ**: 標準OAuth 2.0 Web Application ClientはGCPコンソールUIからのみ作成可能（パブリックAPI非対応）。IAP/WIF APIでは代替不可。

## E2Eテスト

| 項目 | 値 |
|------|-----|
| 総テスト数 | **98件**（9ファイル）※PR #121追加分含む |
| CI結果 | **全パス** - chromiumプロジェクトのみ実行（PR #131修正で再処理テストも成功） |
| 最新修正 | PR #131 でreprocess-button.spec.ts テスト4を仕様に合わせて修正 |

## デプロイ環境

| 環境 | 状態 |
|------|------|
| dev | ✅ デプロイ済み |
| kanameone | ✅ デプロイ済み |
| cocoro | ✅ デプロイ済み（ログイン確認済み・Gmail認証待ち） |
| GitHub Pages | ✅ デプロイ済み（PR #110-111反映） |

## 次のアクション

1. **cocoro Gmail OAuth認証（先方操作待ち）**
   - 設定画面 → Gmail連携ボタン → OAuthポップアップ認証 → ラベル設定 → 運用開始
   - docs/clients/cocoro.md の「運用開始に必要な先方操作」を参照

2. **実クライアント納品テスト**（Phase 2）
   - Mac/Windows/Linux各OSでのclient-setup-gcp実行
   - Claude Code納品プロンプト検証

3. **SAキーファイル管理**
   - cocoro SAキーの安全管理確認

4. **クライアント別オプション機能**（要望確定後）

## 参考リンク

- [クライアント管理ドキュメント](docs/clients/)
  - [dev](docs/clients/dev.md) - 開発環境（verify 9/10）
  - [kanameone](docs/clients/kanameone.md) - カナメワン（verify 16/16、運用中）
  - [cocoro](docs/clients/cocoro.md) - ココロ（ハイブリッド運用、ログイン確認済み・Gmail認証待ち）

## Git状態

- ブランチ: main（PR #129-131 マージ済み）
- 未コミット変更: なし
- 未プッシュ: なし
- CI: すべて成功（✅ Deploy & CI）
- 最新コミット: `9d99407` (fix: 再処理E2Eテストを#129仕様変更に合わせて修正)
