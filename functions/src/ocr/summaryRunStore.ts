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
import { logManualSummaryResult } from './summaryManualMetrics';
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
  /**
   * claim時点の`summaryManualRequestedAt`(epoch ms)。手動依頼由来の文書だけが持つ印で、
   * 終端(done/error/skipped)でcommit/recordSummaryFailureが削除する際の計測ログ
   * (`summary_manual_result`)の起点になる。自動由来(印なし)はnull。
   */
  manualRequestedAtMs: number | null;
}

export type ClaimSummaryRunResult =
  | { claimed: true; claim: SummaryRunClaim }
  | { claimed: false; reason: 'not-found' | 'not-pending' }
  | { claimed: false; reason: 'not-processed'; manualRequestedAtMs: number | null };

/** `summaryManualRequestedAt`(Timestamp)をepoch msへ。不在・型不一致はnull。 */
function readManualRequestedAtMs(data: FirebaseFirestore.DocumentData): number | null {
  const value = data.summaryManualRequestedAt as FirebaseFirestore.Timestamp | undefined;
  return value && typeof value.toMillis === 'function' ? value.toMillis() : null;
}

/**
 * 要約生成のclaimを試みる(バッチ専用)。`summaryState==='pending'`の文書のみclaimする。
 *
 * PR-C(手動・非同期化)で、手動依頼もバッチのキューを通る(`regenerateSummary`は
 * `summaryState:'pending'`と`summaryManualRequestedAt`を書くだけ)ため、旧「手動claimが既存の
 * 所有者を無条件でpreemptする」モードは廃止した。Sarashinaは同時実行1(並行リクエストは429)で、
 * 生成の入口はバッチ1本に絞る必要があるため。
 *
 * `status!=='processed'`(split/error等、再OCR中を含む)なら`summaryState:'skipped'`を書いて
 * スキップする(先頭固定によるキュー閉塞を防ぐ。手動依頼の印もこの終端で削除する)。
 */
export async function claimSummaryRun(
  firestore: admin.firestore.Firestore,
  docRef: FirebaseFirestore.DocumentReference,
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
        const manualRequestedAtMs = readManualRequestedAtMs(data);

        // ambiguous commit後の再実行: 自分自身のclaimが既にcommit済み(冪等復帰)。
        // このパスではsummaryAttemptCountは既に前回の呼出しでincrement済みのため、
        // 再度incrementせず現在値をそのまま返す。
        if (currentState === 'processing' && data.summaryRunId === runId) {
          return {
            claimed: true,
            claim: {
              runId,
              ocrRunId: currentOcrRunId,
              priorState: currentState,
              attemptCount: priorAttemptCount,
              manualRequestedAtMs,
            },
          };
        }
        if (currentState !== 'pending') {
          return { claimed: false, reason: 'not-pending' };
        }
        if (data.status !== 'processed') {
          tx.update(docRef, {
            summaryState: 'skipped' satisfies SummaryState,
            summaryStateUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
            summaryManualRequestedAt: admin.firestore.FieldValue.delete(),
          });
          return { claimed: false, reason: 'not-processed', manualRequestedAtMs };
        }
        tx.update(docRef, {
          summaryState: 'processing' satisfies SummaryState,
          summaryRunId: runId,
          summaryStateUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
          summaryAttemptCount: admin.firestore.FieldValue.increment(1),
        });
        return {
          claimed: true,
          claim: {
            runId,
            ocrRunId: currentOcrRunId,
            priorState: currentState,
            attemptCount: priorAttemptCount + 1,
            manualRequestedAtMs,
          },
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
    // 手動依頼の印は終端で削除する(寿命の定義、PR-C)。後日のOCR再処理で古い印が残ると、
    // 手動優先キューへ誤って載り、計測も歪むため。
    summaryManualRequestedAt: admin.firestore.FieldValue.delete(),
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
    // 'pending'(再試行)の間は手動依頼の印を保つ(優先キューに残す)。終端(error/skipped)で削除する。
    ...(failure.state === 'pending' ? {} : { summaryManualRequestedAt: admin.firestore.FieldValue.delete() }),
  }));
}

/** `summaryState`関連8フィールドの名前(バックフィル防止判定・後方互換クリーンアップで使う)。 */
const SUMMARY_STATE_FIELD_NAMES = [
  'summaryState',
  'summaryRunId',
  'summaryStateUpdatedAt',
  'summaryError',
  'summaryErrorKind',
  'summaryProvider',
  'summaryAttemptCount',
  'summaryManualRequestedAt',
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
      summaryManualRequestedAt: admin.firestore.FieldValue.delete(),
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
    // 自動生成(OCR完了時のpending)は手動依頼ではない。古い印が残っていれば消す。
    summaryManualRequestedAt: admin.firestore.FieldValue.delete(),
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
      // transactionが再試行されても最後の実行の値が残るよう、transaction外で宣言して都度上書きする。
      let manualRequestedAtMs: number | null = null;
      const fatal = await firestore.runTransaction(async (tx) => {
        manualRequestedAtMs = null;
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
          manualRequestedAtMs = readManualRequestedAtMs(data);
          tx.update(docRef, {
            summaryManualRequestedAt: admin.firestore.FieldValue.delete(),
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

      if (fatal === true) {
        result.errored++;
        // 手動依頼が終端errorで確定した場合も、1依頼につき1行の計測ログを残す(通常ループ外の経路)。
        logManualSummaryResult({
          functionName: 'rescueStuckSummaryDocs',
          documentId: docId,
          outcome: 'error',
          kind: 'unknown',
          provider: null,
          requestedAtMs: manualRequestedAtMs,
          nowMs: opts.now(),
        });
      } else if (fatal === false) result.rescued++;
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
