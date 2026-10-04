/**
 * 手動要約依頼の登録 (PR-C)
 *
 * 「要約を作る」ボタンの依頼を、生成せずキューへ登録するだけの処理(`regenerateSummary`の本体)。
 * 生成は`generateSummaryBatch`が直列に実行する(Sarashinaは同時実行1で、並行リクエストは429に
 * なるため、入口をバッチ1本に絞る)。依頼は`summaryState:'pending'`と`summaryManualRequestedAt`
 * で表し、バッチは印のある文書を優先して処理する。
 *
 * 画面側は登録の完了(数秒)だけを待ち、生成の完了はFirestoreの更新を待って表示する。
 */

import * as admin from 'firebase-admin';
import { SARASHINA_SUMMARY_CONFIG, type SummaryProviderSetting } from '../utils/config';
import { getSarashinaSummaryGate } from '../utils/featureFlags';
import { logManualSummaryRequested } from './summaryManualMetrics';
import { readManualRequestedAtMs } from './summaryRunStore';
import type { SummaryState } from '../../../shared/types';

export type ManualSummaryRejectReason = 'disabled' | 'not-allowed' | 'not-found' | 'not-processed';

/** 登録を拒否した場合のエラー。`message`はそのまま画面に表示される(PIIを含めない)。 */
export class ManualSummaryRejectedError extends Error {
  constructor(
    public readonly reason: ManualSummaryRejectReason,
    message: string
  ) {
    super(message);
    this.name = 'ManualSummaryRejectedError';
  }
}

export interface EnqueueManualSummaryDeps {
  firestore: admin.firestore.Firestore;
  docId: string;
  /** 既定は`SARASHINA_SUMMARY_CONFIG.provider`(実際のL1環境変数値)。テスト注入用。 */
  l1Provider?: SummaryProviderSetting;
  getGate?: typeof getSarashinaSummaryGate;
}

export interface EnqueueManualSummaryResult {
  /** すでに待機中・生成中のため何も書かなかった場合true(二重依頼の吸収)。 */
  alreadyQueued: boolean;
}

export async function enqueueManualSummary(deps: EnqueueManualSummaryDeps): Promise<EnqueueManualSummaryResult> {
  const { firestore, docId, l1Provider = SARASHINA_SUMMARY_CONFIG.provider, getGate = getSarashinaSummaryGate } = deps;

  // L1/L2ゲート(resolveSummaryProviderと同じ設計。L1='gemini'は明示的なロールバック運用のため
  // L2を経由しない)。拒否は書込み前に行い、無効な環境ではGeminiも呼ばない。
  if (l1Provider === 'none') {
    throw new ManualSummaryRejectedError('disabled', 'この環境では要約機能は準備中です');
  }
  if (l1Provider === 'sarashina') {
    const gate = await getGate(firestore);
    if (!gate.enabled) {
      throw new ManualSummaryRejectedError('disabled', 'この環境では要約機能は準備中です');
    }
    if (gate.allowlist !== null && !gate.allowlist.includes(docId)) {
      throw new ManualSummaryRejectedError('not-allowed', 'この書類は要約機能の対象外です');
    }
  }

  const docRef = firestore.doc(`documents/${docId}`);
  const alreadyQueued = await firestore.runTransaction(async (tx) => {
    const fresh = await tx.get(docRef);
    if (!fresh.exists) {
      throw new ManualSummaryRejectedError('not-found', 'ドキュメントが見つかりません');
    }
    const data = fresh.data()!;
    if (data.status !== 'processed') {
      throw new ManualSummaryRejectedError('not-processed', '書類の処理が完了していないため、要約を作成できません');
    }

    const state = (data.summaryState as SummaryState | undefined) ?? null;
    if (state === 'processing') return true;
    if (state === 'pending') {
      if (readManualRequestedAtMs(data) !== null) return true;
      // 印のない既存pending(過去の自動・canary由来)は、手動依頼として実行対象にするため印を付ける。
      // 過去の試行回数(summaryAttemptCount)は引き継がず、手動依頼としての再試行枠(MAX_SUMMARY_ATTEMPTS)を
      // 確保する(古い試行が残っていると、依頼直後の1回の失敗でerrorに確定してしまう)。
      tx.update(docRef, {
        summaryManualRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
        summaryAttemptCount: 0,
      });
      return false;
    }

    // 既存の要約本文(summary)は消さない。新しい要約をcommitした時点で上書きする。
    tx.update(docRef, {
      summaryState: 'pending' satisfies SummaryState,
      summaryAttemptCount: 0,
      summaryStateUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      summaryManualRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
      summaryError: admin.firestore.FieldValue.delete(),
      summaryErrorKind: admin.firestore.FieldValue.delete(),
      summaryRunId: admin.firestore.FieldValue.delete(),
    });
    return false;
  });

  logManualSummaryRequested(docId, alreadyQueued);
  return { alreadyQueued };
}
