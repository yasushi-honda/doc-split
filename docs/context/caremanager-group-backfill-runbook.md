# 担当CM別集計バックフィル Runbook (ADR-0019, GOAL.md タスクG)

**最終更新**: 2026-07-15 (session131)
**対象読者**: 本番バックフィル実行者(decision-maker番号単位認可のもとで実行するAI executor、または運用者)
**関連**:
- [ADR-0019: 担当CM別集計バックフィルの並行更新対策(メンテナンスゲート方式)](../adr/0019-caremanager-group-backfill-maintenance-gate.md)
- `scripts/migrate-document-groups.js --backfill-cm-unassigned`(実行スクリプト)
- `scripts/diagnose-caremanager-group-gap.js`(検証スクリプト)
- `functions/src/utils/maintenanceGate.ts` / `functions/src/utils/groupAggregation.ts`

---

## このドキュメントの目的

PR #656(タスクA)で修正済みの集計ロジックにより、本番`documentGroups`コレクションに欠落している「CM未設定」グループを安全に新規作成する手順(GOAL.md タスクH/Iで実行)を定義する。設計判断の背景・却下した代替案は[ADR-0019](../adr/0019-caremanager-group-backfill-maintenance-gate.md)を参照。

## 前提条件

- GOAL.md タスクA(#656)・D(#658)・G(サブタスクA〜G、本Runbook作成をもって完了)が完了していること
- 実行対象環境でTask A修正済みの`functions`が既にデプロイ済みであること(新規書込みは既に正しく集計されている状態)
- decision-makerによる番号単位の明示認可(本番destructive操作、CLAUDE.md「PR マージ」と同水準のゲート)

## ゲート対象/対象外の一覧

| 経路 | ゲート対象 | 理由 |
|------|-----------|------|
| OCR完了確定・rescue(`processOCR.ts`) | ✅ 対象 | careManager/status確定の主経路 |
| split(`pdfOperations.ts` `splitPdf`) | ✅ 対象 | 親status:split化+子文書careManager初期値決定 |
| 顧客マスター同期(`syncCareManager.ts`) | ✅ 対象 | 最大500件バッチ更新によるトランザクション集中の主因 |
| Gmail取込・アップロード(pending文書作成) | ❌ 対象外 | customerKey未確定な段階は元々documentGroupsへの副作用を持たない |
| FE手動「再処理」ボタン | ❌ 対象外(残存リスク、許容) | ブラウザ直接書込みのためCloud Function側で制御不可。低トラフィック時間帯実行で発生確率を低減 |
| `scripts/`運用スクリプト(fix-stuck-documents等) | ❌ 対象外(残存リスク、許容) | workflow_dispatch手動トリガー、実行者が事前調整可能 |

## 実行手順

### Step 1: ドライランでプレビュー

```bash
gh workflow run 'Run Operations Script' -f environment=kanameone -f script='migrate-document-groups --backfill-cm-unassigned --dry-run'
```

出力される「スキャン件数」「CM未設定計上見込み件数」を確認する。想定外に大きい/小さい場合は実行を中断し原因調査する。

### Step 2: 低トラフィック時間帯を選定

kanameoneはケアマネジャーの業務時間中に利用されるため、夜間等の低トラフィック時間帯を選定する(FE手動再処理・運用スクリプト手動実行との衝突確率を下げるため)。

### Step 3: 実行(ゲート制御込み)

```bash
gh workflow run 'Run Operations Script' -f environment=kanameone -f script='migrate-document-groups --backfill-cm-unassigned'
```

このコマンドは内部で以下を自動実行する(手動操作不要):
1. `system/maintenanceFlags.groupAggregationGateOpen`を`false`に設定
2. 10分間のドレイン待機(Cloud Functions最大実行時間540秒を上回るバリア、[ADR-0019](../adr/0019-caremanager-group-backfill-maintenance-gate.md)参照)
3. CM未設定グループの安全な作成(`backfillUnassignedCareManagerGroup()`)
4. ゲートを`true`に戻す(成功・失敗いずれの場合も`finally`で実行される)

### Step 4: 検証

```bash
gh workflow run 'Run Operations Script' -f environment=kanameone -f script='diagnose-caremanager-group-gap'
```

以下を確認する:
- 「恒等式検証」セクション: `customer(顧客別合計) = careManager(実CM+CM未設定合計)`が✅一致
- 「groupId単位の個別比較」セクション: 全groupIdで✅一致(相殺による見逃しがないことの確認)
- 不一致がある場合、差分が「Step 1のドライラン後〜Step 3実行完了までに到着した少数の新規書類」で説明可能か確認する(ゲート対象外の残存リスクによる想定内の差)

### Step 5: cocoro環境への展開(タスクI)

kanameoneでの効果確認後、同様の手順をcocoro環境に対して実施する。

## 異常時の対応(ロールバック)

`documentGroups`は完全に`documents`の生フィールドから導出可能な派生データであり、本バックフィルは生フィールドを一切変更しない。したがって「ロールバック」は以下の**自己収束**で行う(詳細: [ADR-0019](../adr/0019-caremanager-group-backfill-maintenance-gate.md)の「ロールバックの再定義」):

| 状況 | 対応 |
|------|------|
| Step 3実行中にゲートが閉じたまま処理が異常終了した | `system/maintenanceFlags.groupAggregationGateOpen`を手動で`true`に戻す(`backfillUnassignedCareManagerGroup()`は`finally`でゲートを再開するが、スクリプト自体がクラッシュした場合はこの保証が効かないため手動確認が必要) |
| グループ未作成のまま失敗した | 原因調査後、Step 3を再実行すれば事前チェックから再開できる(冪等) |
| グループ作成後に誤った値と判明した | `documentGroups/careManager___UNASSIGNED_CARE_MANAGER__`を削除してからStep 3を再実行する |
| Step 4で説明不能な不一致が見つかった | 実行を中断し、[ADR-0019](../adr/0019-caremanager-group-backfill-maintenance-gate.md)の残存リスク一覧と照合、原因を特定してから再実行を判断する |
