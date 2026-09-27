/**
 * 要約生成のclaim/所有権保護付き書込みストア (ADR-0027 PR4)
 *
 * `tryStartProcessing`/`rescueStuckProcessingDocs`(processOCR.ts)と同じ設計思想を、
 * `generateSummaryBatch`(逐次claim)と`regenerateSummary`(手動、既存所有者をpreempt)の
 * 2経路で共有する。`summary: buildSummaryFields(`の書込みは本モジュールの
 * `commitSummaryResult`が唯一のサイトであり、`summaryWritePayloadContract.test.ts`の
 * `WRITE_PAYLOAD_CALLERS`はこのファイルのみを指す(#178教訓: 書込みサイトを一箇所に
 * 集約し、フィールドの追加漏れが起きうる箇所を最小化する)。
 */

import * as admin from 'firebase-admin';
import { randomUUID } from 'node:crypto';
import { withBackoffRetry } from '../utils/retry';
import { isRetryableFirestoreError } from '../utils/firestoreErrors';
import { safeLogError } from '../utils/errorLogger';
import { buildSummaryFields } from './summaryRequestBuilder';
import {
  evaluateSummaryRunOwnership,
  SummarySupersededError,
  MAX_SUMMARY_ATTEMPTS,
  SUMMARY_STUCK_THRESHOLD_MS,
  type SummaryRunExpectation,
  type OcrCompletionSummaryDecision,
} from './summaryRunGuard';
import type { SummaryProviderSetting } from '../utils/config';
import type { SummaryField, SummaryState, SummaryProvider, SummaryErrorKind } from '../../../shared/types';

/** claim/commit系トランザクションのリトライ設定。`ocrProcessor.ts`のOCR_TX_RETRY_*と同値。 */
const SUMMARY_TX_RETRY_ATTEMPTS = 3;
const SUMMARY_TX_RETRY_BASE_DELAY_MS = 300;

const SUMMARY_RESCUE_BATCH_SIZE = 20;

export interface SummaryRunClaim {
  runId: string;
  /** claim時点のocrRunId。commit時の`evaluateSummaryRunOwnership`に引き継ぐ。 */
  ocrRunId: string | null;
  /** claim前のsummaryState(preemptの復元・ログ用)。フィールド不在は`null`。 */
  priorState: SummaryState | null;
  /**
   * claim後(increment後)の試行回数。呼び出し側(`generateSummaryBatch`)が
   * `MAX_SUMMARY_ATTEMPTS`との比較に使う。claim一覧クエリを`.select()`(参照のみ取得)
   * で行うため、この値をtransaction内で読んだ最新値として持ち回る必要がある。
   */
  attemptCount: number;
}

export type ClaimSummaryRunResult =
  | { claimed: true; claim: SummaryRunClaim }
  | { claimed: false; reason: 'not-found' | 'not-pending' | 'not-processed' };

/**
 * 要約生成のclaimを試みる。
 *
 * `mode:'batch'`: `summaryState==='pending'`の文書のみclaimする。`status!=='processed'`
 * (split/error等、再OCR中を含む)なら`summaryState:'skipped'`を書いてスキップする
 * (先頭固定によるキュー閉塞を防ぐ。OCR再完了時は`decideOcrCompletionSummaryState`が
 * 改めて`pending`を書くため、恒久的に取りこぼされることはない)。
 *
 * `mode:'manual'`: 現在の所有者(バッチ実行中・過去の手動実行)を無条件でpreemptする
 * (ユーザーの明示操作を優先。preemptされた側は`commitSummaryResult`/
 * `recordSummaryFailure`実行時に`SummarySupersededError`として検出され、
 * 実害は1回分の無駄な推論のみ)。
 */
export async function claimSummaryRun(
  firestore: admin.firestore.Firestore,
  docRef: FirebaseFirestore.DocumentReference,
  mode: 'batch' | 'manual',
  /** テスト注入用(ambiguous commit後の再実行が同一トークンを使うことを検証する目的)。本番は省略しrandomUUID()を使う。 */
  testRunId?: string
): Promise<ClaimSummaryRunResult> {
  // Issue #963(tryStartProcessing)と同じ理由でtransaction外に1回だけ発行する:
  // ambiguous commit後の再実行(withBackoffRetryの外側リトライ含む)が同一トークンを
  // 再利用できるようにするため。
  const runId = testRunId ?? randomUUID();

  return withBackoffRetry(
    () =>
      firestore.runTransaction(async (tx): Promise<ClaimSummaryRunResult> => {
        const fresh = await tx.get(docRef);
        if (!fresh.exists) return { claimed: false, reason: 'not-found' };

        const data = fresh.data()!;
        const currentState = (data.summaryState as SummaryState | undefined) ?? null;
        const currentOcrRunId = (data.ocrRunId as string | undefined) ?? null;
        const priorAttemptCount = (data.summaryAttemptCount as number) || 0;

        if (mode === 'batch') {
          // ambiguous commit後の再実行: 自分自身のclaimが既にcommit済み(冪等復帰)。
          // このパスではsummaryAttemptCountは既に前回の呼出しでincrement済みのため、
          // 再度incrementせず現在値をそのまま返す。
          if (currentState === 'processing' && data.summaryRunId === runId) {
            return {
              claimed: true,
              claim: { runId, ocrRunId: currentOcrRunId, priorState: currentState, attemptCount: priorAttemptCount },
            };
          }
          if (currentState !== 'pending') {
            return { claimed: false, reason: 'not-pending' };
          }
          if (data.status !== 'processed') {
            tx.update(docRef, {
              summaryState: 'skipped' satisfies SummaryState,
              summaryStateUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            return { claimed: false, reason: 'not-processed' };
          }
          tx.update(docRef, {
            summaryState: 'processing' satisfies SummaryState,
            summaryRunId: runId,
            summaryStateUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
            summaryAttemptCount: admin.firestore.FieldValue.increment(1),
          });
          return {
            claimed: true,
            claim: { runId, ocrRunId: currentOcrRunId, priorState: currentState, attemptCount: priorAttemptCount + 1 },
          };
        }

        // mode === 'manual': 無条件preempt
        tx.update(docRef, {
          summaryState: 'processing' satisfies SummaryState,
          summaryRunId: runId,
          summaryStateUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
          summaryAttemptCount: admin.firestore.FieldValue.increment(1),
        });
        return {
          claimed: true,
          claim: { runId, ocrRunId: currentOcrRunId, priorState: currentState, attemptCount: priorAttemptCount + 1 },
        };
      }),
    SUMMARY_TX_RETRY_ATTEMPTS,
    SUMMARY_TX_RETRY_BASE_DELAY_MS,
    isRetryableFirestoreError
  );
}

function toExpectation(docId: string, claim: SummaryRunClaim): SummaryRunExpectation {
  return { summaryRunId: claim.runId, ocrRunId: claim.ocrRunId };
}

async function withOwnershipCheckedTransaction(
  firestore: admin.firestore.Firestore,
  docRef: FirebaseFirestore.DocumentReference,
  expectation: SummaryRunExpectation,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Transaction.update()のUpdateData<DocumentData>契約に合わせる(FieldValueとリテラル値が混在するため)
  buildUpdate: () => Record<string, any>
): Promise<void> {
  await withBackoffRetry(
    () =>
      firestore.runTransaction(async (tx) => {
        const fresh = await tx.get(docRef);
        const freshData = fresh.data() ?? {};
        const ownership = evaluateSummaryRunOwnership(freshData, expectation);
        if (!ownership.ok) {
          throw new SummarySupersededError(
            `Summary run for document ${docRef.id} superseded (reason: ${ownership.reason}), skipping write`,
            docRef.id,
            ownership.reason
          );
        }
        tx.update(docRef, buildUpdate());
      }),
    SUMMARY_TX_RETRY_ATTEMPTS,
    SUMMARY_TX_RETRY_BASE_DELAY_MS,
    isRetryableFirestoreError
  );
}

/**
 * 要約生成成功をcommitする。所有権を再検証し、不一致なら書込みせず
 * `SummarySupersededError`をthrowする。`summary: buildSummaryFields(`の唯一の書込みサイト。
 */
export async function commitSummaryResult(
  firestore: admin.firestore.Firestore,
  docRef: FirebaseFirestore.DocumentReference,
  claim: SummaryRunClaim,
  result: { summary: SummaryField; provider: SummaryProvider }
): Promise<void> {
  const expectation = toExpectation(docRef.id, claim);
  await withOwnershipCheckedTransaction(firestore, docRef, expectation, () => ({
    summary: buildSummaryFields(result.summary),
    summaryTruncated: admin.firestore.FieldValue.delete(),
    summaryOriginalLength: admin.firestore.FieldValue.delete(),
    summaryState: 'done' satisfies SummaryState,
    summaryProvider: result.provider,
    summaryRunId: null,
    summaryStateUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    summaryError: null,
    summaryErrorKind: null,
  }));
}

/**
 * 要約生成失敗を記録する。`summary`本体は書かない。所有権チェックはcommitと同じ。
 * `state:'skipped'`はOCR結果読込自体が失敗した等、生成を試みる前提が崩れた場合に使う
 * (捏造/quota/transient等の生成失敗は'pending'/'error'を使う)。
 */
export async function recordSummaryFailure(
  firestore: admin.firestore.Firestore,
  docRef: FirebaseFirestore.DocumentReference,
  claim: SummaryRunClaim,
  failure: { state: 'pending' | 'error' | 'skipped'; kind: SummaryErrorKind | null; message: string }
): Promise<void> {
  const expectation = toExpectation(docRef.id, claim);
  await withOwnershipCheckedTransaction(firestore, docRef, expectation, () => ({
    summaryState: failure.state satisfies SummaryState,
    summaryRunId: null,
    summaryStateUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    summaryError: failure.message,
    summaryErrorKind: failure.kind,
  }));
}

/**
 * 手動claim(`regenerateSummary`)が失敗した際、preempt前の状態へ復元する。
 * 復元自体の失敗はcaller側でログのみに留めること(元のエラーの伝播を妨げないため)。
 */
export async function releaseManualSummaryRun(
  firestore: admin.firestore.Firestore,
  docRef: FirebaseFirestore.DocumentReference,
  claim: SummaryRunClaim,
  kind: SummaryErrorKind
): Promise<void> {
  const expectation = toExpectation(docRef.id, claim);
  await withOwnershipCheckedTransaction(firestore, docRef, expectation, () => {
    if (claim.priorState === null) {
      return {
        summaryState: admin.firestore.FieldValue.delete(),
        summaryRunId: admin.firestore.FieldValue.delete(),
        summaryStateUpdatedAt: admin.firestore.FieldValue.delete(),
        summaryError: admin.firestore.FieldValue.delete(),
        summaryErrorKind: admin.firestore.FieldValue.delete(),
        summaryProvider: admin.firestore.FieldValue.delete(),
        summaryAttemptCount: admin.firestore.FieldValue.delete(),
      };
    }
    if (claim.priorState === 'processing') {
      // preempt前にバッチ実行中だった: そのバッチ実行はもはや所有権を持たないため、
      // 通常のcommit/recordSummaryFailureでは検出されない。ここで明示的にerror化する。
      return {
        summaryState: 'error' satisfies SummaryState,
        summaryRunId: null,
        summaryStateUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        summaryError: 'Preempted by a manual regeneration request while a batch run was in progress',
        summaryErrorKind: kind,
      };
    }
    return {
      summaryState: claim.priorState satisfies SummaryState,
      summaryRunId: null,
      summaryStateUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
  });
}

/** `summaryState`関連7フィールドの名前(バックフィル防止判定・後方互換クリーンアップで使う)。 */
const SUMMARY_STATE_FIELD_NAMES = [
  'summaryState',
  'summaryRunId',
  'summaryStateUpdatedAt',
  'summaryError',
  'summaryErrorKind',
  'summaryProvider',
  'summaryAttemptCount',
] as const;

/**
 * OCR完了transaction(`ocrProcessor.ts`の`applyOcrCompletionTransaction`)内の`tx.update()`に
 * spreadするsummaryState関連フィールドを構築する(バックフィル防止、ADR-0027主要な設計判断4)。
 *
 * `decision.kind==='absent'`(L1='none')の場合、`freshData`が既にいずれかの
 * summaryState系フィールドを持っていれば全て削除する(過去にL1が'sarashina'/'gemini'
 * だった時期に書かれた状態が、'none'へ戻した後も残存してキュー扱いされ続けることを防ぐ)。
 * 1件も持たなければ空オブジェクト(無駄な書込みを増やさない、`multiCustomerCleanup`と同じ設計)。
 */
export function buildOcrCompletionSummaryStateFields(
  decision: OcrCompletionSummaryDecision,
  freshData: FirebaseFirestore.DocumentData
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Transaction.update()のUpdateData<DocumentData>契約に合わせる
): Record<string, any> {
  if (decision.kind === 'absent') {
    const hasAny = SUMMARY_STATE_FIELD_NAMES.some((name) => freshData[name] !== undefined);
    if (!hasAny) return {};
    return {
      summaryState: admin.firestore.FieldValue.delete(),
      summaryRunId: admin.firestore.FieldValue.delete(),
      summaryStateUpdatedAt: admin.firestore.FieldValue.delete(),
      summaryError: admin.firestore.FieldValue.delete(),
      summaryErrorKind: admin.firestore.FieldValue.delete(),
      summaryProvider: admin.firestore.FieldValue.delete(),
      summaryAttemptCount: admin.firestore.FieldValue.delete(),
    };
  }
  return {
    summaryState: decision.state,
    summaryRunId: null,
    summaryStateUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    summaryAttemptCount: 0,
    summaryError: admin.firestore.FieldValue.delete(),
    summaryErrorKind: admin.firestore.FieldValue.delete(),
    summaryProvider: admin.firestore.FieldValue.delete(),
  };
}

/**
 * 上記の新規文書(`tx.set()`、faxDuplicationのコピー文書等)向け版。`tx.set()`(mergeなし)は
 * `FieldValue.delete()`を許容しないため、`kind==='absent'`では何も書かない
 * (新規docなのでそもそも削除すべき既存値がない)。
 */
export function buildOcrCompletionSummaryStateFieldsForNewDoc(
  decision: OcrCompletionSummaryDecision
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 上記と同じ理由
): Record<string, any> {
  if (decision.kind === 'absent') return {};
  return {
    summaryState: decision.state,
    summaryStateUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    summaryAttemptCount: 0,
  };
}

export interface RescueStuckSummaryDocsResult {
  rescued: number;
  errored: number;
}

/**
 * `summaryState==='processing'`のまま`SUMMARY_STUCK_THRESHOLD_MS`を超過した文書を救済する。
 * `processOCR.ts`の`rescueStuckProcessingDocs`と同じ設計: 個別トランザクション・逐次処理・
 * per-doc try/catchでのログ記録。
 *
 * `l1`が`'none'`の場合は`pending`へは戻さず`error`にする(U4: L1が`none`の環境では
 * バッチが`pending`を処理しないため、`pending`へ戻すとキューに静かに蓄積し続けるだけになる)。
 */
export async function rescueStuckSummaryDocs(
  firestore: admin.firestore.Firestore,
  opts: { now: () => number; l1: SummaryProviderSetting }
): Promise<RescueStuckSummaryDocsResult> {
  const threshold = admin.firestore.Timestamp.fromMillis(opts.now() - SUMMARY_STUCK_THRESHOLD_MS);

  const stuckDocs = await firestore
    .collection('documents')
    .where('summaryState', '==', 'processing')
    .where('summaryStateUpdatedAt', '<', threshold)
    .limit(SUMMARY_RESCUE_BATCH_SIZE)
    .get();

  const result: RescueStuckSummaryDocsResult = { rescued: 0, errored: 0 };
  if (stuckDocs.empty) return result;

  for (const docSnapshot of stuckDocs.docs) {
    const docId = docSnapshot.id;
    const docRef = firestore.doc(`documents/${docId}`);
    try {
      const fatal = await firestore.runTransaction(async (tx) => {
        const fresh = await tx.get(docRef);
        if (!fresh.exists) return null;
        const data = fresh.data()!;
        // rescue scan後にcommit/recordSummaryFailureが先に走った場合は二重救済しない。
        const updatedAt = data.summaryStateUpdatedAt as FirebaseFirestore.Timestamp | undefined;
        if (data.summaryState !== 'processing' || !updatedAt || updatedAt.toMillis() > threshold.toMillis()) {
          return null;
        }
        const attemptCount = (data.summaryAttemptCount as number) || 0;
        const fatalReached = attemptCount >= MAX_SUMMARY_ATTEMPTS || opts.l1 === 'none';
        if (fatalReached) {
          tx.update(docRef, {
            summaryState: 'error' satisfies SummaryState,
            summaryRunId: null,
            summaryStateUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
            summaryError:
              opts.l1 === 'none'
                ? 'Summary generation disabled (SUMMARY_PROVIDER=none) while a claim was stuck in processing'
                : `Stuck in processing beyond max attempts (${attemptCount}/${MAX_SUMMARY_ATTEMPTS})`,
            summaryErrorKind: 'unknown' satisfies SummaryErrorKind,
          });
          return true;
        }
        tx.update(docRef, {
          summaryState: 'pending' satisfies SummaryState,
          summaryRunId: null,
          summaryStateUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return false;
      });

      if (fatal === true) result.errored++;
      else if (fatal === false) result.rescued++;
    } catch (err) {
      console.error(`Failed to rescue stuck summary document ${docId}:`, err);
      await safeLogError({
        error: err instanceof Error ? err : new Error(String(err)),
        source: 'ocr',
        functionName: 'rescueStuckSummaryDocs',
        documentId: docId,
      });
    }
  }
  return result;
}
