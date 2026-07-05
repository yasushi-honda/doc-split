# ドキュメント監査レポート

**監査日時**: 2026-07-05
**前回監査**: 2026-03-16（**111日ぶり**、推奨間隔31日を大幅超過）
**監査範囲**: 全ドキュメント（`docs/` 90ファイル + ルート README.md/CLAUDE.md）

---

## サマリー

| カテゴリ | 評価 | 主な所見 |
|---------|------|---------|
| 整合性 | **B** | LATEST.mdがリポジトリ最新コミット（#550, Issue #546 close）に未追随。data-model.md等のfrontmatter `updated:` 日付が2件stale |
| 冗長性 | **A-** | 3スプリント連続未対応だったREADME.md技術スタック重複が解消済み。新規の重複なし |
| AI最適化 | **B** | CLAUDE.md 133行→**207行**（+56%、前回警告の150行閾値を超過）。マルチクライアント運用セクション(21行)がrules/未分離 |
| メンテナンス性 | **B+** | 前回指摘の高優先度3件は全て対応済み。ただし監査間隔自体が3.5倍に延伸 |
| ADR網羅性 | **A-** | ADR-0017まで17件。Issue #526の並行性制御設計は既存ADR-0016の延長として処理（新規ADR化は判断待ち） |

**総合評価**: B+ (85%) - 前回(87%)から微減。主因は**LATEST.mdが同日中の直近コミットに未追随**という即応性の課題と、CLAUDE.md肥大化トレンドの継続

---

## 1. 整合性チェック結果

### 1.1 前回監査（03-16）アクションアイテムの完了確認

| 優先度 | 項目 | 状態 |
|--------|------|------|
| 高 | architecture.md に `onCustomerMasterWrite` を追記 | ✅ **完了**（Cloud Functions表に記載済み、`functions/src/index.ts`の20関数と完全一致） |
| 高 | architecture.md シーケンス図の `status: completed`→`processed` | ✅ **完了**（現状 `processed` 表記） |
| 高 | architecture.md Firestoreスキーマに `displayFileName` 追加 | ✅ **完了**（ER図に記載済み） |
| 中 | data-model.md に `displayFileName` フィールド追加 | ✅ **完了** |
| 中 | LATEST.md 関数数の19→20修正 | - （LATEST.md構成が大幅刷新され該当箇所消滅） |
| 中 | README.md 技術スタック重複解消（3回連続未対応だった件） | ✅ **完了**（該当行が削除されている） |
| 低 | implementation-plan.md `[ ]`→`[x]` 更新 | ❌ **未対応**（20件のまま、4ヶ月間変化なし） |
| 低 | ADR-0009に日付追加 | ❌ **未対応** |

**評価**: 高優先度3件が全て解消されており、architecture.mdの追随体制は改善した。低優先度2件は実害軽微のまま放置が続いている。

### 1.2 今回新規発見の不整合

#### ⚠️ 指摘事項1（優先度: 高）: LATEST.md がリポジトリの最新コミットに未追随

`docs/handoff/LATEST.md`（session95, 2026-07-05記録・PR #549でmerge）は「次のアクション」即着手タスク#1として **「#546 計測基盤+SDK移行+thinking制御」を未着手として記載**している。

しかし、その**後**に行われたコミット `aeaec8c`（PR #550, 同日 2026-07-05 22:02:22）で Issue #546 は実装・**close済み**（`gh issue view 546` で `state: CLOSED` を確認）。つまりリポジトリの最新状態はLATEST.mdの記述より1コミット先行しており、ハンドオフメモが実態を反映していない。

| 項目 | LATEST.md記載 | 実際 |
|------|--------------|------|
| Issue #546 | 「即着手タスク」表で未着手扱い | `CLOSED`（PR #550） |
| 「次のアクション」条件待ち#3（#548 3.5移行スイッチ） | 「#546完了」がtrigger | trigger充足済み、着手可能状態に遷移 |

**推奨対応**: 次セッション冒頭で session96 エントリを追加し、「即着手タスク」表からタスク#1を除去、条件待ち表の trigger 充足状況を更新する。

#### ⚠️ 指摘事項2（優先度: 中）: frontmatter `updated:` 日付のstale化（2件）

| ファイル | frontmatter `updated:` | 実際の最終実質更新（git log） | 差分 |
|---------|----------------------|------------------------------|------|
| `docs/context/data-model.md` | `2026-03-16` | `2026-07-05`（PR #550, `stats/geminiDaily`に`thinkingTokens`/`bySource`フィールド追加） | **111日** |
| `docs/context/functional-requirements.md` | `2026-02-07` | `2026-04-27`（PR #400, 検索結果ソート順変更） | **79日** |

両ファイルとも本文自体は正しく更新されているが、frontmatterの日付だけが更新時に見落とされている。`purpose: "AI駆動開発時のコンテキストとして優先読込"` と明記された最優先読込ドキュメントであるため、日付の信頼性低下は軽微ながら見過ごせない。

#### ⚠️ 指摘事項3（優先度: 中）: リンク切れ 1件（実害あり）

`docs/operation-guide.md` L67:
```
詳細: [同名/同姓同名対応](duplicate-name-handling.md)
```
実ファイルは `docs/context/duplicate-name-handling.md`。相対パスが誤っており、docsifyサイト上でリンク切れとなる。

**修正案**: `[同名/同姓同名対応](context/duplicate-name-handling.md)`

#### 1.3 リンク切れ一覧（優先度: 低、影響軽微）

以下は過去セッションの記録ファイル（凍結済みアーカイブ）内のリンクで、実害は小さいが技術的には不整合:

- [ ] `docs/operation-guide.md` → `duplicate-name-handling.md`（指摘事項3、要修正）
- [ ] `docs/handoff/archive/2026-04-history.md` 内の `../../memory/feedback_*.md` 系リンク（3件、グローバルmemoryへの相対パスが崩れている。アーカイブ化前のセッション記録をそのまま移動した際の副作用）
- [ ] `docs/handoff/archive/2026-05-history.md` / `2026-06-history.md` 内の同種リンク（計4件）
- [ ] `docs/audit/2026-02-06/2026-02-15/2026-02-22-document-audit.md` 内の相対パス誤り（過去監査レポート自体の記載ミス、凍結済み文書のため修正不要と判断）

いずれも**過去の記録として凍結されたアーカイブ文書**であり、現役ドキュメントの参照網には影響しない。修正の緊急性は低い。

### 1.4 実装との整合性

- **Cloud Functions数**: `functions/src/index.ts` の export（20関数）と `docs/architecture.md` のCloud Functions表（20行）が完全一致 ✅
- **DocumentStatus**: `shared/types.ts` の `'pending' | 'processing' | 'processed' | 'error' | 'split'` と `data-model.md` L53 が一致 ✅
- **Issue追跡状況**: `gh issue list --state open` の実際のOPEN issue（#548, #547, #540, #539, #526, #503, #251, #238）とLATEST.mdの記載がほぼ一致（#546の扱いのみ指摘事項1の通り不整合）
- **Gemini モデル表記**: README/architecture.md/context配下 計15箇所超で「Gemini 2.5 Flash」表記が一貫。LATEST.mdには2026-10-16の3.5 Flash移行期限が明記されているが、これは意図的な「移行前」の正確な現状記述であり不整合ではない（#548完了時に一括更新が必要な15+箇所として記録しておく価値あり）

---

## 2. 冗長性分析結果

### 2.1 解消された重複

- ✅ **README.md技術スタック詳細**（3スプリント連続未対応だった項目）: UIライブラリ・状態管理の詳細行が削除され、architecture.mdとの二重管理が解消

### 2.2 新規重複は検出なし

`docs/client/`（クライアント様向け一般セットアップ、docsifyサイト）と `docs/clients/`（内部向け環境別ステータス管理: dev/kanameone/cocoro）はディレクトリ名が酷似しているが、各READMEの冒頭で役割が明記されており意図的な分離と判断（要注意点として記録のみ、対応不要）。

### 2.3 古い情報

| ファイル | 該当箇所 | 推奨対応 |
|---------|---------|---------|
| `docs/context/implementation-plan.md` | `[ ]` チェックボックス20件残存（4ヶ月間変化なし） | 冒頭に「実装完了済みの記録」注記済みのため実害なしと再確認。恒久的に `[x]` 化しないなら注記をさらに強調するか、ファイル自体をarchive化検討 |
| `docs/adr/0009-feature-flags-per-client.md` | Date行なし（4ヶ月間未対応） | 他ADRとの体裁統一のため日付追記推奨（推定2026-02-07前後） |

---

## 3. AI駆動開発最適化

### 3.1 CLAUDE.md簡潔性

| 項目 | 前回(03-16) | 今回(07-05) | 判定 |
|------|------------|------------|------|
| 行数 | 133行 | **207行**（+74行, +56%） | ⚠️ 前回「150行超えでリファクタリング検討」と警告済みの閾値を超過 |
| バイトサイズ | 約6.3KB | 約12.3KB | 増加傾向 |
| rules/への分離 | 未（0ファイル） | **未（0ファイル、変化なし）** | ⚠️ プロジェクトローカルrules/が一度も活用されていない |
| skills/への分離 | 済（deploy/のみ） | 済（deploy/のみ、変化なし） | - |
| CLAUDE.local.md | なし | なし | 個人設定混入リスクなし |

### 3.2 Include/Exclude違反候補

| 行/セクション | 違反種別 | 推奨対応 |
|--------------|---------|---------|
| L187-207「マルチクライアント運用 (catchup 時の必須確認、Issue #432 session81+84 教訓)」（21行、必須マトリクス表+session81/84の具体的経緯2件） | 詳細ルール（10行超）がCLAUDE.mdに直書き | `.claude/rules/multi-client-operations.md` へ切り出し、CLAUDE.mdには1-2行のポインタのみ残す（グローバル`quality-gate.md`の責務分離基準に準拠） |
| L41-52「環境別 gcloud 操作の必須プロトコル」（12行、#220 Follow-up B失敗事例の詳細記述含む） | 同上（境界線上、非自明な罠情報のため許容範囲との判断もあり得る） | 上記と合わせて切り出すか判断は decision-maker 領分。単独では現状維持でも実害小さい |

**背景**: グローバル `~/.claude/memory/MEMORY.md` の運用方針では「プロジェクト固有事例は最初から当該プロジェクトリポジトリの `.claude/memory/` に書く」とされているが、doc-splitには `.claude/memory/` 自体が存在しない。同様に `.claude/rules/` も0ファイルのまま4ヶ月間活用されていない。CLAUDE.mdの肥大化はこの「受け皿」の不在が一因と考えられる。

### 3.3 改善提案

1. `.claude/rules/` ディレクトリを新設し、L187-207のマルチクライアント運用ルールを移設（CLAUDE.mdは-19行程度）
2. 今後、CLAUDE.mdに「教訓」セクションを追記する際は、5行超のセクションは追記前に rules/ 行きを検討する運用を明文化（グローバル `quality-gate.md` の基準をプロジェクトレベルでも意識）

---

## 4. メンテナンス性

### 4.1 監査プロセス自体の負債

前回監査（03-16）が「次回推奨日: 2026-04-16」としていたにもかかわらず、実施は2026-07-05（**111日後、目標の3.6倍**）。この間に33件のPRがマージされ（Issue #432マルチクライアント全量確認完結、ADR-0017 Accepted昇格、Issue #526の大規模OCR再処理パイプライン実装等）、ドキュメント負債が蓄積するリスク期間が長期化した。実際には前回の高優先度指摘は全て解消されており実害は限定的だったが、次回はより短い間隔での実施が望ましい。

### 4.2 ドキュメント負債

```
注意が必要なファイル:
- docs/handoff/LATEST.md: 最新コミット(#550, Issue #546 close)に未追随（指摘事項1）
- docs/context/data-model.md: frontmatter updated: が111日stale（指摘事項2）
- docs/context/functional-requirements.md: frontmatter updated: が79日stale（指摘事項2）
- docs/context/implementation-plan.md: [ ]チェックボックス20件、4ヶ月間未更新（実害小、注記済み）
- docs/adr/0009: 日付なし、4ヶ月間未対応

参考資料（更新不要、変化なし）:
- docs/reference/: 51,029行 + 47,328行の大型参考資料2件、削除不要
- docs/adr/0001-0008: 更新なし、各ADRとして完結
```

### 4.3 大型ファイル（500行超）

実質管理対象（`docs/reference/`配下の参考資料を除く）で500行超は以下の3件のみ:
- `docs/handoff/archive/2026-04-history.md`（4,114行）
- `docs/specs/pr-d4-backfill-impl-plan.md`（836行）
- `docs/handoff/archive/2026-05-history.md`（2,849行）

いずれもLATEST.mdのアーカイブ運用（session92, PR #536で108KB→5.7KBに圧縮した実績あり）または個別Issueの実装計画記録であり、意図的な設計。**LATEST.md本体は69行/9.2KBと健全な水準を維持**しており、アーカイブ運用のプロセスは前回以降も継続的に機能している。

---

## 5. ADR監査

### 5.1 現状

- ADR数: **17件**（前回15件から+2: ADR-0016 document-identity-and-provenance, ADR-0017 vertex-429-resilience）
- 最新: `0017-vertex-429-resilience.md`（2026-07-02にAccepted昇格、3週間の運用実績で実証）
- ステータス記法の混在（`## Status` vs 記載なし）は0008/0010-0014で継続（前回から変化なし、軽微）

### 5.2 新規ADR要否の検討

| 変更 | ADR要否 | 判断理由 |
|------|---------|---------|
| Issue #526（OCR再処理パイプライン: confirmed保護マージ+transaction化） | **要検討（decision-maker判断）** | 既存ADR-0016の識別子/物理パス分離原則を参照しているが、「confirmedフィールド単位でのマージ保護」「transaction化による並行編集耐性」は新規の並行性制御パターンであり、Codexセカンドオピニオン2回・evaluator・5エージェントレビューを経た重い設計判断。ADR化すれば将来の類似設計（#540 stale snapshot一般解等）の参照点になる |
| Issue #546（Geminiコスト計測基盤、SDK移行） | 不要 | 計測・移行の実装詳細であり、アーキテクチャ判断ではない |
| Issue #547/#548（コスト圧縮: egress削減、3.5 Flash移行） | **着手時に必須（すでに認識済み）** | LATEST.md自体が「destructive migration・Codexレビュー必須」「ADR作成+Codexレビュー完了」をtriggerに明記しており、プロジェクト側で既にADR作成の必要性を認識している。追加指摘不要 |

---

## アクションアイテム

### 優先度: 高

- [ ] **LATEST.mdにsession96エントリを追加し、Issue #546 close（PR #550）を反映**
  - 該当ファイル: `docs/handoff/LATEST.md`
  - 「即着手タスク」表からタスク#1（#546）を除去
  - 「条件待ち」表#3（#548 3.5移行スイッチ）のtrigger欄「#546完了」が充足したことを明記

### 優先度: 中

- [ ] **docs/context/data-model.md のfrontmatter `updated:` を `2026-07-05` に更新**
- [ ] **docs/context/functional-requirements.md のfrontmatter `updated:` を実際の最終更新日（2026-04-27以降で要確認）に更新**
- [ ] **docs/operation-guide.md L67のリンク修正**: `duplicate-name-handling.md` → `context/duplicate-name-handling.md`
- [ ] **CLAUDE.md L187-207「マルチクライアント運用」セクションの `.claude/rules/` への切り出し検討**（decision-maker判断。現状207行で前回警告の150行閾値を大きく超過）

### 優先度: 低

- [ ] ADR-0009に日付を追記（他ADRとの体裁統一）
- [ ] docs/handoff/archive/配下の壊れたmemoryリンク計7件の修正（凍結済みアーカイブのため緊急性低）
- [ ] docs/context/implementation-plan.mdの`[ ]`チェックボックス20件の扱い方針決定（`[x]`化 or archive化）

---

## 9. 総合評価

### スコアカード

| 項目 | 前回(03-16) | 今回(07-05) | 変化 |
|------|------------|------------|------|
| 整合性 | 79% | **83%** | ↑ 高優先度3件解消の効果が大。LATEST.md即応性課題で相殺 |
| 冗長性最適化 | 82% | **90%** | ↑ 3スプリント連続未対応だったREADME重複が解消 |
| AI駆動開発適合性 | 92% | **80%** | ↓ CLAUDE.md +56%肥大化、rules/未活用が継続 |
| メンテナンス性 | 93% | **85%** | ↓ 監査間隔111日（目標31日の3.6倍）、LATEST.md追随遅延 |
| ADR網羅性 | 97% | **95%** | → ほぼ変化なし。#526のADR化要否は判断待ちのまま |
| **総合** | **87%** | **85%** | ↓ 2pt |

### 主要な強み（継続）

1. **高優先度指摘への対応率が高い**: 前回の高優先度3件（architecture.md追随、README重複）が全て解消
2. **LATEST.mdアーカイブ運用が機能**: session92のPR #536による108KB→5.7KB圧縮以降、本体69行を維持
3. **ADRの継続整備**: 17件、Issue #526のような大規模変更でもCodexセカンドオピニオン等の重いレビュープロセスを経る文化が定着
4. **マルチクライアント確認マトリクス運用**: Issue #432を通じて確立された「環境別チェック表」がCLAUDE.mdに定着し、実際にsession92でcocoro再監査に活用された実績あり

### 今回の主要な課題

1. **LATEST.mdの即応性ギャップ**: ハンドオフ記録の直後に行われた変更（#550, Issue #546 close）が未反映のまま次セッションを迎えるリスク状態
2. **CLAUDE.mdの肥大化トレンド継続**: 133→207行（+56%）。rules/・memory/という「受け皿」が一度も使われないまま教訓セクションが本体に蓄積し続けている
3. **frontmatter `updated:` フィールドの形骸化**: 本文は正しく更新されているのに日付だけ取り残される、という新種の不整合パターンが2件発生

---

## 次回監査推奨日

**2026-08-05**（1ヶ月後。前回111日の遅延を踏まえ、次回は必達目標として明記）

**監査対象**:
- 高優先度アクションアイテム（LATEST.md追随）の実施確認
- CLAUDE.md行数トレンド（207行からの増減、rules/切り出しの実施有無）
- Issue #547/#548着手時のADR作成状況
- frontmatter `updated:` 日付の正確性（今回発見した形骸化パターンの再発有無）

---

監査者: Claude Code
レポートバージョン: 2.1
