/**
 * 手動依頼の印のない`summaryState:'pending'`を、要約状態なし(フィールド不在)へ戻す純粋ロジック
 * (要約の手動・非同期化 PR-C、展開手順0)。
 *
 * PR-C以降、バッチの実行対象は`summaryManualRequestedAt`の印を持つpendingだけになる
 * (`settings/features.autoSummaryOnOcr`が有効な環境を除く)。過去の自動生成・canary由来で残った
 * 印のないpendingは実行されないまま、画面に「作成待ち」の表示だけが残ってしまうため、
 * デプロイ前にこれらを「要約なし」へ戻して、利用者が手動で依頼できる状態にする。
 *
 * 既存の要約本文(`summary`)・生成元(`summaryProvider`)は触らない。Firestoreへ依存しない関数だけを
 * 置く(FieldValueへの変換は実行スクリプト側)。
 */

/** 1回の実行で消去できる上限。想定外の大量書込みを防ぐ件数アサーション(超えたら1件も書かず中断)。 */
export const MAX_CLEAR_COUNT = 500;

/** 消去(deleteField)するフィールド。`summary`・`summaryProvider`は残す。 */
export const CLEAR_FIELDS = [
  'summaryState',
  'summaryAttemptCount',
  'summaryStateUpdatedAt',
  'summaryRunId',
  'summaryError',
  'summaryErrorKind',
] as const;

export interface PendingSnapshot {
  id: string;
  summaryState?: unknown;
  summaryManualRequestedAt?: unknown;
}

/** 消去対象か: pendingで、かつ手動依頼の印(summaryManualRequestedAt)がない。 */
export function isUnmarkedPending(snapshot: PendingSnapshot): boolean {
  return snapshot.summaryState === 'pending' && !snapshot.summaryManualRequestedAt;
}

/** pending一覧から消去対象のIDを抽出する(入力順を保つ)。 */
export function selectUnmarkedPendingIds(snapshots: PendingSnapshot[]): string[] {
  return snapshots.filter(isUnmarkedPending).map((s) => s.id);
}

export type ClearCountCheck = { ok: true } | { ok: false; reason: string };

/** 件数アサーション: 上限超過は1件も書かずに中断する。 */
export function checkClearCount(count: number): ClearCountCheck {
  if (count > MAX_CLEAR_COUNT) {
    return { ok: false, reason: `対象が${count}件で上限${MAX_CLEAR_COUNT}件を超えています(想定外の件数のため中断)` };
  }
  return { ok: true };
}
