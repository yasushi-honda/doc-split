# ドキュメント監査レポート

## 監査日時
2026-02-06

## 前回監査
2026-01-20（17日前）

## サマリー

| カテゴリ | 前回 | 今回 | 主な所見 |
|---------|------|------|---------|
| 整合性 | B | B | CLAUDE.mdのCloud Functions一覧が不完全、データモデルが旧AppSheetスキーマのまま |
| 冗長性 | B | B | 技術スタック散在は継続、docs/直下とcontext/の重複 |
| AI最適化 | B | B | CLAUDE.md 473行（前回440行→増加）、ファイル構成が実態と大幅乖離 |
| メンテナンス性 | A | B | context/ドキュメントのステータスが「draft」のまま、phase7-requirementsが1663行 |
| ADR網羅性 | B | B | ADR-0005ステータス空、ADR-0007欠番、無限スクロール/期間フィルター等のADR未作成 |

評価基準: A=良好 / B=軽微な改善推奨 / C=要改善

---

## 前回監査からの改善状況

| 前回指摘 | 状態 | 備考 |
|---------|------|------|
| deployment-flow.md 納品方式の記載更新 | ✅ 対応済み | - |
| ADR-0004 ステータスを「Accepted」に | ✅ 対応済み | - |
| ADR-0005 ステータス追加 | ❌ 未対応 | ステータス欄が空のまま |
| README.md Phase 6,7追記 | ✅ 対応済み | Phase 8+追加実装も反映 |
| CLAUDE.md Phase完了詳細の簡略化 | ✅ 対応済み | phase-history.mdに分離済み |
| setup-guide.md 関係の明確化 | ❌ 未対応 | docs/直下とoperation/で重複継続 |

---

## 1. 整合性チェック結果

### 1.1 ドキュメント間の不整合

| ファイルA | ファイルB | 不整合内容 | 推奨対応 |
|-----------|-----------|-----------|---------|
| CLAUDE.md | docs/architecture.md | Cloud Functions一覧: CLAUDE.mdに `processOCROnCreate`, `regenerateSummary`, `onDocumentWrite` が未記載 | CLAUDE.mdを更新 |
| CLAUDE.md | 実ファイル構成 | ファイル構成ツリーが大幅に古い。pages/に `AdminPage`, `HelpPage`, `ProcessingHistoryPage` 未記載。components/に `DateRangeFilter`, `KanaFilterBar`, `LoadMoreIndicator`, `SearchBar`, `views/` 等15+ファイル未記載。hooks/に `useInfiniteScroll`, `useDocumentGroups`, `useSearch` 等9ファイル未記載。functions/src/に `admin/`, `documents/`, `search/`, `triggers/`, `upload/` 未記載 | ファイル構成セクションを更新 |
| docs/context/data-model.md | 実装 | Firestoreコレクション設計の「案」が更新されていない。`documentGroups`, `customerResolutionLogs`, `officeResolutionLogs`, `aliasLearning` 等のコレクションが未記載。`documents`コレクションに `summary`, `verified`, `verifiedBy`, `verifiedAt`, `customerConfirmed`, `customerCandidates`, `officeConfirmed`, `officeCandidates`, `groupKeys` 等のフィールドが未記載 | data-model.mdを実装に合わせて更新 |
| docs/context/gcp-migration-scope.md | 実装 | フロントメタの `status: draft` が残存。開発は全Phase完了済み | `status: completed` に更新 |
| docs/context/functional-requirements.md | 実装 | フロントメタの `status: draft` が残存。P2機能（ダウンロード、処理統計、複数ラベル）の実装状況が未反映。AI要約、エイリアス学習、OCR確認ステータス、無限スクロール等の追加機能が未記載 | ステータス更新＋機能追記 |
| CLAUDE.md | docs/overview.md | 追加実装の記載範囲が異なる。CLAUDE.mdは02-06まで、overview.mdは01-31頃まで | overview.mdに02-05, 02-06の実装を追記 |
| ~~docs/adr/0005~~ | - | ~~ステータスが空欄~~ → 実際は「Accepted」記載済み（grep誤検知） | 対応不要 |

### 1.2 実装との乖離

| ドキュメント記載 | 実際の状況 | 推奨対応 |
|-----------------|-----------|---------|
| CLAUDE.md: `processOCR` Scheduled (1分間隔) のみ | 実装: `processOCROnCreate` Firestoreトリガー即時処理も存在 | 追記 |
| CLAUDE.md: ファイル構成にscripts/は3ファイルのみ | 実際: 20+ファイル（deploy-all-clients.sh, verify-setup.sh等） | 主要スクリプトを追記 |
| data-model.md: AppSheet時代のER図（「書類管理T」等の日本語名） | 実装: Firestoreコレクション名で運用中 | Firestoreスキーマを正とし、AppSheet ER図はアーカイブ |
| data-model.md: `status: pending | processed | error` | 実装: `status: pending | processing | completed | error` | 修正 |

### 1.3 リンク切れ

- なし（良好）

---

## 2. 冗長性分析結果

### 2.1 重複情報

| 情報 | 記載箇所数 | マスター候補 | 推奨対応 |
|------|-----------|-------------|---------|
| Cloud Functions一覧 | 3箇所（CLAUDE.md, architecture.md, features.md） | docs/architecture.md | CLAUDE.mdは簡潔な表のみ維持、features.mdは参照に |
| 技術スタック | 13ファイル | docs/adr/0001 | 前回から改善なし。構造的には許容範囲 |
| デプロイ手順 | 3箇所（CLAUDE.md, delivery-and-update-guide.md, deployment-flow.md） | delivery-and-update-guide.md | CLAUDE.mdはクイックリファレンスのみに |
| 開発ステータス（Phaseテーブル） | 4箇所（CLAUDE.md, README.md, overview.md, phase-history.md） | phase-history.md | CLAUDE.md/README.mdは最新Phase番号のみ、詳細はphase-history.md |
| 環境情報（doc-split-dev） | 12ファイル | CLAUDE.md | 実用上問題なし（各ファイルで必要な文脈） |

### 2.2 古い情報

| ファイル | 該当箇所 | 推奨対応 |
|---------|---------|---------|
| docs/context/gcp-migration-scope.md | `status: draft`, `updated: 2026-01-17` | completed, 日付更新 |
| docs/context/functional-requirements.md | `status: draft`, `updated: 2026-01-17` | completed, 日付更新 |
| docs/context/gcp-migration-scope.md L37-43 | 「データベース（要相談）」「ストレージ（要相談）」 | 確定済み表記に変更 |
| docs/context/phase7-requirements.md | 1663行、Phase 7は完了済み | アーカイブ検討（reference/に移動） |

### 2.3 TODO/FIXME

| ファイル | 内容 | 推奨対応 |
|---------|------|---------|
| docs/context/gcp-migration-scope.md:184 | `## 相談事項（TODO）` | 全て確定済みなら削除 |

---

## 3. AI駆動開発最適化

### 3.1 CLAUDE.md評価

| 項目 | 前回 | 現状 | 推奨 | 判定 |
|------|------|------|------|------|
| 行数 | 440行 | 473行（+33行） | 200-400行 | ⚠️ 増加傾向 |
| 参照ガイド | あり | あり | - | ✅ |
| コマンド集約 | あり | あり | - | ✅ |
| ファイル構成 | やや古い | 大幅に古い | 更新必要 | ❌ |
| CLAUDE.mdからの外部参照 | 複数 | 1件のみ（phase-history.md） | 増やすべき | ⚠️ |

### 3.2 改善提案

1. **ファイル構成ツリーの更新**（優先度: 高）
   - 現在のツリーはPhase 4-5時代のもの。Phase 8+追加実装で追加されたファイルが30+件未記載
   - AIが新しいファイルの存在を知らないと、適切な修正箇所を見つけられない

2. **CLAUDE.mdの行数削減**（優先度: 中）
   - 「Phase 8以降の追加実装」セクション（27項目の詳細テーブル）→ phase-history.mdへの参照に変更
   - 「完了したインフラ設定」→ 既に完了しているため削除またはphase-history.mdに移動
   - 「確定した相談事項」→ 「確定事項」テーブルと重複が多い。統合可能
   - これらで50-70行削減可能（目標: 400行以下）

3. **CLAUDE.mdからの参照リンク追加**（優先度: 中）
   - 現在1件のみ。「読込優先順序」セクションにリンクを追加すべき
   - 例: `1. [移行スコープ](docs/context/gcp-migration-scope.md)` のようにリンク化

4. **data-model.mdの現代化**（優先度: 高）
   - AppSheet時代のER図が「主要テーブル詳細」として残っている
   - Firestore設計が「案」のまま。実際の運用スキーマとの乖離が大きい
   - AIがスキーマを参照する際に誤った情報に基づく可能性がある

---

## 4. メンテナンス性

### 4.1 ドキュメント負債

| ファイル | 問題 | 推奨対応 |
|---------|------|---------|
| docs/context/phase7-requirements.md | 1663行、完了済みPhaseの詳細要件 | docs/reference/に移動 |
| docs/context/gcp-migration-scope.md | status: draft（実装完了済み） | status更新 |
| docs/context/functional-requirements.md | status: draft、追加機能未反映 | status更新＋追記 |
| docs/context/data-model.md | Firestoreスキーマが実装と乖離 | 全面更新 |

### 4.2 大きすぎるファイル

| ファイル | 行数 | 前回 | 対応 |
|---------|------|------|------|
| docs/reference/appsheet-full-spec.md | 51,029 | 同じ | アーカイブのため維持 |
| docs/reference/sections/01_data.md | 47,328 | 同じ | アーカイブのため維持 |
| docs/context/phase7-requirements.md | 1,663 | N/A | reference/に移動推奨 |
| CLAUDE.md | 473 | 440 | 削減推奨（目標400行以下） |

### 4.3 構造評価

```
docs/
├── 直下 (GitHub Pages用 - 外部向け簡略版) ✅ 明確
├── context/ (AI/開発者向け詳細)             ⚠️ 一部古い情報あり
├── operation/ (運用者向け)                  ✅ 明確
├── adr/ (技術決定記録)                      ⚠️ ADR-0005ステータス空、0007欠番
├── audit/ (監査レポート)                    ✅ 新規追加
├── handoff/ (ハンドオフメモ)                ✅ 明確
└── reference/ (旧システム参照)              ✅ 明確
```

---

## 5. ADR監査

### 5.1 現状

- ADR数: 9件（テンプレート除く）
- 最新: 0009-feature-flags-per-client.md（2026-02-07）
- 欠番: なし

| ADR | ステータス | 判定 |
|-----|-----------|------|
| 0001-tech-stack-selection | Accepted | ✅ |
| 0002-security-design | Accepted | ✅ |
| 0003-authentication-design | Accepted | ✅ |
| 0004-frontend-architecture | Accepted | ✅（前回から改善） |
| 0005-multi-client-deployment | **空欄** | ❌ 前回指摘から未対応 |
| 0006-search-implementation | Accepted | ✅ |
| 0007-infinite-scroll-strategy | Accepted | ✅（02-07追加） |
| 0008-firestore-data-protection | Accepted | ✅ |

### 5.2 作成推奨ADR

| 対象 | 理由 | 状態 |
|------|------|------|
| ~~ADR-0007: 欠番の解消~~ | ~~番号の連続性~~ | ✅ 02-07対応（無限スクロール戦略） |
| ~~無限スクロール戦略~~ | ~~カーソルベースの判断~~ | ✅ ADR-0007として作成済み |

---

## アクションアイテム

### 優先度: 高

- [x] CLAUDE.md: ファイル構成ツリーを実態に合わせて更新 → 02-07対応（components/hooks/scripts更新）
- [x] CLAUDE.md: Cloud Functions一覧に `processOCROnCreate`, `regenerateSummary`, `onDocumentWrite` を追加 → 02-06対応済み
- [x] docs/context/data-model.md: Firestoreスキーマを実装に合わせて更新 → 02-06対応済み（759行、16コレクション）
- [x] ~~docs/adr/0005: ステータスに `Accepted` を追記~~ → 確認済み（既にAccepted記載あり）

### 優先度: 中

- [x] CLAUDE.md: 行数削減 → 385行（目標400行以下達成）
- [x] docs/context/gcp-migration-scope.md: `status: completed` に更新 → 02-06対応済み
- [x] docs/context/functional-requirements.md: `status: completed`、F24-F35追記 → 02-06対応済み
- [x] docs/context/phase7-requirements.md: docs/reference/に移動 → 02-06対応済み
- [x] CLAUDE.md: 「読込優先順序」セクションのドキュメント名をリンク化 → 02-06対応済み

### 優先度: 低

- [x] docs/setup-guide.md と docs/operation/setup-guide.md の関係明確化 → 簡略版に参照リンク記載済み
- [x] ADR-0007 欠番の整理 → 02-07対応（無限スクロール戦略ADR作成）
- [x] docs/overview.md: 追加実装を追記 → 02-06対応済み

---

## 次回監査推奨日

2026-02-20（2週間後）

---

## 監査実行者

Claude Code (doc-audit skill)
