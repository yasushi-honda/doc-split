# ドキュメント監査レポート

**監査日時**: 2026-03-16
**前回監査**: 2026-02-22
**監査範囲**: 全ドキュメント（78ファイル実質管理対象）

---

## サマリー

| カテゴリ | 評価 | 主な所見 |
|---------|------|---------|
| 整合性 | **B** | architecture.mdに`onCustomerMasterWrite`欠落・`displayFileName`フィールド未反映。LATEST.md内の関数数不整合(L153:19件 vs L181:20個) |
| 冗長性 | **B** | README.md技術スタック詳細が3回連続未対応。data-model.mdにdisplayFileNameフィールド未追加 |
| AI最適化 | **A-** | CLAUDE.md 133行（前回128行）。派生フィールドチェックリスト追加は適切。引き続き適切な範囲内 |
| メンテナンス性 | **A** | displayFileName実装（#178）のLATEST.md・ADR反映が迅速。更新体制は健全 |
| ADR網羅性 | **A** | ADR-0014追加で15件に。新機能に対するADR作成が適切に行われている |

**総合評価**: B+ (87%) - 前回(88%)から微減。主因はdisplayFileName実装後の周辺ドキュメント追随漏れ

---

## 1. 整合性チェック

### 1.1 前回監査（02-22）アクションアイテムの完了確認

| 優先度 | 項目 | 状態 |
|--------|------|------|
| 高 | architecture.md に `exchangeGmailAuthCode` を追記 | ✅ **完了** (L128) |
| 高 | architecture.md の DocumentStatus 定義を修正 (L140) | ✅ **完了** (`processed/split`正確に記載) |
| 中 | overview.md の「OCR処理開始」性能目標を修正 | ✅ **完了** (`1分間隔（ポーリング、ADR-0010）`) |
| 中 | README.md 技術スタック表から詳細行を削除 | ❌ **3回連続未対応** (UIライブラリ/状態管理行が残存) |
| 低 | DESIGN_REVIEW_SUMMARY.md をアーカイブ化 | ✅ **完了** (アーカイブ注記あり) |
| 低 | implementation-plan.md [ ] チェックボックスを [x] に更新 | ❌ **未対応** (20件残存) |
| 低 | LATEST.md の番号抜け修正 | - （LATEST.md更新により構成が変わり該当なし） |

### 1.2 今回新規発見の不整合

#### ⚠️ 指摘事項1: architecture.md に `onCustomerMasterWrite` が欠落

| ファイル | 関数数 | 欠落関数 |
|---------|-------|---------|
| `functions/src/index.ts` | **20** | - |
| `docs/architecture.md` (Cloud Functions表) | **19** | **`onCustomerMasterWrite`が未記載** |

`onCustomerMasterWrite` は PR #177 (2026-03-12以前) で追加された顧客マスターcareManagerName変更同期トリガー。`functions/src/index.ts` L55に `export { onCustomerMasterWrite } from './triggers/syncCareManager';` として実装済み。

**修正案**:
```markdown
| `onCustomerMasterWrite` | Firestore Trigger | 顧客マスターcareManagerName変更時の既存ドキュメント自動同期 |
```
該当ファイル: `/Users/yyyhhh/doc-split/docs/architecture.md` L130付近（`onDocumentWrite`の次行）

#### ⚠️ 指摘事項2: architecture.md Firestoreスキーマに `displayFileName` フィールドが未追加

PR #179 (Stage 0) で `shared/types.ts` に `displayFileName?: string` が追加・ADR-0014が作成されたが、`docs/architecture.md` の Firestoreコレクション ER図（L140-152付近）に `displayFileName` フィールドが反映されていない。

| ファイル | displayFileName記載 |
|---------|-------------------|
| `shared/types.ts` L22 | ✅ `displayFileName?: string` |
| `docs/adr/0014-display-filename.md` | ✅ 詳細設計記載 |
| `docs/handoff/LATEST.md` | ✅ 機能構成表あり |
| `docs/architecture.md` Firestoreスキーマ | ❌ **未反映** |
| `docs/context/data-model.md` | ❌ **未反映** (最終更新2月7日) |

**修正案** (architecture.md Firestoreスキーマ追加):
```markdown
string displayFileName "表示・DL用ファイル名（メタ情報から自動生成）"
```

#### ⚠️ 指摘事項3: LATEST.md L153 に古い関数数(19)が残存

| 箇所 | 記載 | 正しい値 |
|------|------|---------|
| L153 (cocoro納品状態表) | `19関数全て稼働` | **20関数** |
| L181 (デプロイ環境セクション) | `Functions 20個に統一` | ✅ 正確 |

L153は02-13時点のcocoro状態を記録したもので当時は19関数だったが、現在20関数に増えており参照時に混乱を招く。

#### ⚠️ 指摘事項4: architecture.md シーケンス図に `status: completed` が残存

```
L100: ProcessOCR->>Firestore: 書類更新(status: completed)
```

前回監査のアクション「DocumentStatus定義を修正」はL141のER図では修正済みだが、L100のシーケンス図では `completed` が残存。実際の値は `processed`（`shared/types.ts` L12で確認）。

### 1.3 整合性チェック詳細

#### ✅ Phase情報: 全ドキュメントで一致
- CLAUDE.md: `Phase 8完了 + 追加実装（CI/CD、PWA、テナント自動化等）`
- README.md: Phase 0-8および追加実装が全て ✅
- LATEST.md: `Phase 8完了 + マルチクライアント安全運用機構 + displayFileName自動生成（#178）`

#### ✅ 技術スタック: 主要技術スタックは全ドキュメントで一致

#### ✅ リンク切れなし
`docs/_sidebar.md` 参照ファイル全て存在確認:
- overview.md ✅, architecture.md ✅, features.md ✅, alias-feature.md ✅
- deployment-flow.md ✅, claude-code-delivery.md ✅, setup-guide.md ✅
- operation/gmail-setup-guide.md ✅, operation-guide.md ✅, health-report.md ✅
- api-reference.md ✅, security.md ✅

---

## 2. 冗長性分析

### 2.1 継続する未解消重複

#### ❌ README.md 技術スタック詳細（3回連続未対応）

`README.md` L25-26 のUIライブラリ（shadcn/ui + Tailwind CSS）・状態管理（Zustand + TanStack Query）の詳細行が残存。`docs/architecture.md` に同内容あり。

**なぜ重要か**: architecture.md 更新時に README.md も更新が必要な二重管理が継続中。実害は軽微だが、3スプリント連続で対応されていない。

### 2.2 今回新規発見の冗長性

#### data-model.md の未同期（displayFileName）

`docs/context/data-model.md` の最終更新は2026-02-07。PR #179以降の `displayFileName` フィールド追加が未反映。documents コレクションのフィールド一覧に追加が必要。

### 2.3 意図的な重複（問題なし）

- `docs/setup-guide.md` vs `docs/operation/setup-guide.md`: 冒頭にGitHub Pages用簡略版の注記あり、意図的構成
- `.serena/memories/` の要約ファイル群: delivery-and-update-guide.md の要約派生物として機能

---

## 3. AI駆動開発最適化

### 3.1 CLAUDE.md 簡潔性

| 項目 | 前回(02-22) | 今回(03-16) | 評価 |
|------|------------|------------|------|
| 行数 | 128行 | **133行** | ⚠️ 微増（+5行） |
| 追加セクション | - | 「派生フィールド追加時の注意（#178教訓）」(L105-113) | ✅ 適切な追記 |
| 内容品質 | 必要情報のみ | 必要情報のみ | ✅ 維持 |

追加された「派生フィールド追加時の注意」セクションは3回連続で漏れが発生した実績に基づく非自明なチェックリストで、追記は正当。133行は許容範囲内（200行以下）。

### 3.2 Include/Exclude 評価

**新規追加の「派生フィールド追加時の注意」セクション**:
- `firestoreToDocument()`マッピングの確認: ✅ Include適切（罠情報）
- `getReprocessClearFields()`へのdeleteField()追加: ✅ Include適切（非自明な副作用）

**引き続き適切な記述**:
- デプロイコマンド（`/deploy`スキルへの委譲）
- マスターデータのコレクションパス（`masters/documents/items`の罠）
- Firestore削除禁止コマンド（非可逆操作の罠）
- Storage バケット名の推測禁止（`.appspot.com`/`.firebasestorage.app`混在）

**評価**: Include/Exclude 基準に適合。不要情報の混入なし。

### 3.3 責務分離チェック

| 区分 | 状態 | 評価 |
|------|------|------|
| rules/ (プロジェクトローカル) | 空（0ファイル） | グローバルrules/で代替 |
| skills/ | 1ファイル（deploy/SKILL.md） | ✅ デプロイ手順が分離済み |
| CLAUDE.local.md | なし | 個人設定混入リスクなし |
| @import活用 | なし | docs/context/はリンク参照で対応 |

### 3.4 コンテキスト効率

```
CLAUDE.md: 133行 / 約6.3KB（コンテキストへの影響: 最小）
実質利用ドキュメント総量: 約 400KB（参考資料除く）
評価: ✅ 効率的。CLAUDE.mdへの過剰集積なし
```

---

## 4. メンテナンス性

### 4.1 02-22 → 03-16 の更新品質

| 変更内容 | ドキュメント更新 | 評価 |
|---------|----------------|------|
| displayFileName実装（#178 Stage 0-3） | ADR-0014作成、LATEST.md詳細記録 | ✅ |
| CLAUDE.md 派生フィールドチェックリスト | LATEST.md・CLAUDE.md更新 | ✅ |
| onCustomerMasterWrite追加（#177） | LATEST.md未確認、**architecture.md未更新** | ❌ |
| displayFileNameフィールド追加 | ADRあり、**data-model.md/architecture.md未更新** | ❌ |
| dev環境STORAGE_BUCKET修正 | LATEST.mdに記録 | ✅ |

### 4.2 ドキュメント負債

```
注意が必要なファイル:
- docs/architecture.md: onCustomerMasterWrite欠落、displayFileNameなし、status:completed残存
- docs/context/data-model.md: 最終更新2026-02-07。displayFileNameフィールド未追加
- docs/context/implementation-plan.md: 20件の [ ] チェックボックス残存

参考資料（更新不要）:
- docs/reference/: 1月17-18日以前 → 参考資料として許容
- docs/adr/0001-0008: 1月以降更新なし → 各ADRとして完結
```

### 4.3 大型ファイル（500行超）

```
51029行: docs/reference/appsheet-full-spec.md → 参考資料、削除不要
47328行: docs/reference/sections/01_data.md → 参考資料、削除不要
```

実質管理対象で500行超のドキュメントなし。良好。

---

## 5. ADR監査

### 5.1 ADR一覧（全15件）

| ADR# | タイトル | ステータス | 日付 |
|------|---------|----------|------|
| 0000 | テンプレート | - | - |
| 0001 | tech-stack-selection | Accepted | 2026-01-18 |
| 0002 | security-design | Accepted | 2026-01-18 |
| 0003 | authentication-design | Accepted | 2026-01-18 |
| 0004 | frontend-architecture | Accepted | 2026-02-07 |
| 0005 | multi-client-deployment | Accepted | 2026-01-20 |
| 0006 | search-implementation | Accepted | 2026-01-26 |
| 0007 | infinite-scroll-strategy | Accepted | 2026-02-07 |
| 0008 | firestore-data-protection | Accepted | 2026-01-30 |
| 0009 | feature-flags-per-client | Accepted | **日付なし** |
| 0010 | ocr-polling-unification | Accepted | 2026-02-08 |
| 0011 | service-account-delivery-for-org-accounts | ステータス記載のみ | 2026-02-11 |
| 0012 | automated-org-account-setup | ステータス記載のみ | 2026-02-11 |
| 0013 | iap-oauth-api-gmail-setup | ステータス記載のみ | 2026-02-13 |
| 0014 | display-filename | **Accepted** | 2026-03-15 |

**評価**: ✅ ADR-0014が適切なタイミングで追加。displayFileName設計判断が記録されている。

### 5.2 新規ADR要否（02-22以降の変更を評価）

| 変更 | ADR要否 | 判断理由 |
|------|---------|---------|
| displayFileName実装 | ✅ ADR-0014作成済み | 新フィールド設計、責務分離判断あり |
| onCustomerMasterWrite追加 | 不要 | 既存パターン（Firestoreトリガー）の追加実装 |
| STORAGE_BUCKET修正 | 不要 | バグ修正 |
| ESLintワーニング修正 | 不要 | コード品質修正 |

### 5.3 ADR品質（継続課題）

| 項目 | 状態 | 評価 |
|------|------|------|
| ステータス記法の混在 | `## Status` vs `## ステータス` | ⚠️ 軽微（機能的問題なし） |
| ADR-0009 日付なし | - | ⚠️ 軽微 |
| ADR-0011/0012/0013 Accepted明記なし | ステータスヘッダーのみ | ⚠️ 軽微 |

---

## アクションアイテム

### 優先度: 高

- [ ] **architecture.md に `onCustomerMasterWrite` を追記**
  - 該当ファイル: `/Users/yyyhhh/doc-split/docs/architecture.md`
  - 挿入位置: L130付近（`onDocumentWrite`の次行）
  - 内容: `| \`onCustomerMasterWrite\` | Firestore Trigger | 顧客マスターcareManagerName変更時の既存ドキュメント自動同期 |`

- [ ] **architecture.md シーケンス図の `status: completed` を `status: processed` に修正**
  - 該当ファイル: `/Users/yyyhhh/doc-split/docs/architecture.md` L100
  - 前回の「DocumentStatus定義修正」で見落とした残件

- [ ] **architecture.md Firestoreスキーマに `displayFileName` フィールドを追加**
  - 該当ファイル: `/Users/yyyhhh/doc-split/docs/architecture.md` L152付近（documentsフィールドリスト末尾）
  - 内容: `string displayFileName "表示・DL用ファイル名（メタ情報から自動生成）"`

### 優先度: 中

- [ ] **data-model.md に `displayFileName` フィールドを追加**
  - 該当ファイル: `/Users/yyyhhh/doc-split/docs/context/data-model.md`
  - 挿入位置: 「基本情報」セクション内の `fileName` 行の直後（L47付近）
  - 内容: `| displayFileName | string | No | 表示・DL用ファイル名（メタ情報から自動生成。未設定時はfileNameにフォールバック） |`

- [ ] **LATEST.md L153 の関数数を19→20に修正**
  - 該当ファイル: `/Users/yyyhhh/doc-split/docs/handoff/LATEST.md` L153
  - 修正: `19関数全て稼働` → `20関数全て稼働`

- [ ] **README.md の技術スタック表から詳細行を削除**（3回連続未対応）
  - 削除対象: UIライブラリ行（`shadcn/ui + Tailwind CSS`）、状態管理行（`Zustand + TanStack Query`）
  - 「詳細は docs/architecture.md を参照」への置換を検討

### 優先度: 低

- [ ] **docs/context/implementation-plan.md の [ ] チェックボックスを [x] に更新**
  - 20件の未チェック項目（全て実装済み）。`status: completed` との矛盾を解消
  - 冒頭に「このドキュメントは実装完了済みの記録です」の注記がすでにあるため実害なし

- [ ] **ADR-0009 に日付を追加**
  - 他ADRに合わせてDate行を追記（推定2026-02-07前後）

---

## 9. 総合評価

### スコアカード

| 項目 | 前回(02-22) | 今回(03-16) | 変化 |
|------|------------|------------|------|
| 整合性 | 82% | **79%** | ↓ onCustomerMasterWrite/displayFileName未反映 |
| 冗長性最適化 | 83% | **82%** | ↓ data-model.mdにdisplayFileNameなし |
| AI駆動開発適合性 | 92% | **92%** | → 変化なし（派生フィールドチェックリスト適切追加） |
| メンテナンス性 | 93% | **93%** | → 変化なし（displayFileName実装は適切に記録） |
| ADR網羅性 | 95% | **97%** | ↑ ADR-0014追加 |
| **総合** | **88%** | **87%** | ↓ 1pt |

### 主要な強み（継続）
1. **LATEST.md中心の更新体制**: displayFileName実装（#178）の変更記録が詳細かつ迅速
2. **ADRの継続的整備**: 15件で主要決定網羅。ADR-0014が適切なタイミングで追加
3. **CLAUDE.md簡潔性**: 133行、実際のプロジェクト固有情報（罠・チェックリスト）に絞られている
4. **高優先度アクション対応率**: 02-22の高優先度2件は今回までに完了

### 今回の主要な課題
1. **architecture.md の機能追随遅れ（パターン化）**: 02-22に `exchangeGmailAuthCode`、今回は `onCustomerMasterWrite` が欠落。新関数追加時にarchitecture.mdを更新するプロセスが定着していない
2. **data-model.md の長期未更新**: 2026-02-07以降2ヶ月近く更新なし。`displayFileName` など実装変更が未反映
3. **README.md技術スタック重複**: 3スプリント連続で未対応

---

## 次回監査推奨日

**2026-04-16**（1ヶ月後）

**監査対象**:
- 高優先度アクションアイテムの実施確認（architecture.md 3件）
- data-model.md の更新確認
- CLAUDE.md 行数のトレンド監視（150行超えでリファクタリング検討）
- 新規クライアント納品テスト（Phase 2）の実施状況とドキュメント反映

---

監査者: Claude Code
レポートバージョン: 2.1
