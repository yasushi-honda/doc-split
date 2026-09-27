/**
 * AI要約のOCR完了イベント駆動バッチ処理 (ADR-0027 PR4)
 *
 * Cloud Scheduler定期ポーリング → `summaryState=='pending'`の文書を逐次claim・生成・
 * commitする。`processOCR.ts`(ポーリング+claim+逐次処理)と同じ設計思想だが、
 * 1文書の生成が最大`SARASHINA_SUMMARY_CONFIG.requestTimeoutMs`(620秒)かかりうるため、
 * ソフトデッドライン(`SUMMARY_BATCH_SOFT_DEADLINE_MS`)で早期打ち切りする点が異なる。
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import type { Bucket } from '@google-cloud/storage';
import { safeLogError } from '../utils/errorLogger';
import { SARASHINA_SUMMARY_CONFIG, type SummaryProviderSetting } from '../utils/config';
import { getSarashinaSummaryGate } from '../utils/featureFlags';
import { generateSummaryForProvider, type SummaryPassProvider } from './summaryPass';
import { loadOcrTextForSummary } from './summaryOcrTextLoader';
import { MIN_OCR_LENGTH_FOR_SUMMARY, MAX_SUMMARY_INPUT_LENGTH } from './summaryPromptBuilder';
import { scanSummaryForFabrication } from '../../../shared/summaryFabricationScan';
import {
  claimSummaryRun,
  commitSummaryResult,
  recordSummaryFailure,
  rescueStuckSummaryDocs,
  type SummaryRunClaim,
} from './summaryRunStore';
import type { SummaryErrorKind, SummaryState } from '../../../shared/types';
import {
  classifySummaryFailure,
  SummarySupersededError,
  SUMMARY_BATCH_TIMEOUT_SECONDS,
  SUMMARY_BATCH_LIMIT,
  SUMMARY_BATCH_SOFT_DEADLINE_MS,
  MAX_SUMMARY_ATTEMPTS,
} from './summaryRunGuard';

const FUNCTION_NAME = 'generateSummaryBatch';

export interface SummaryBatchStats {
  claimed: number;
  done: number;
  errorByKind: Record<string, number>;
  superseded: number;
  skipped: number;
  deferred: number;
  rescued: number;
  rescueErrored: number;
}

function emptyStats(): SummaryBatchStats {
  return { claimed: 0, done: 0, errorByKind: {}, superseded: 0, skipped: 0, deferred: 0, rescued: 0, rescueErrored: 0 };
}

function incrementErrorKind(stats: SummaryBatchStats, kind: string): void {
  stats.errorByKind[kind] = (stats.errorByKind[kind] ?? 0) + 1;
}

/**
 * `recordSummaryFailure`をsupersede-safeに呼ぶ(codex review P2指摘反映)。
 *
 * このヘルパーはエラーハンドラ(catchブロック)内から呼ばれる。手動再生成が
 * 「providerが失敗した後・recordSummaryFailure実行前」の間隙でこのclaimをpreemptすると、
 * `recordSummaryFailure`自身が`SummarySupersededError`をthrowしうる。これを素通りさせると
 * バッチ全体(runSummaryBatch呼出元)が例外で落ち、残りのキュー済み文書がこのtickで
 * 一切処理されなくなる。正常系(`commitSummaryResult`)と同じくsupersedeを吸収する。
 */
async function recordFailureOrCountSuperseded(
  firestore: admin.firestore.Firestore,
  docRef: FirebaseFirestore.DocumentReference,
  claim: SummaryRunClaim,
  failure: { state: Extract<SummaryState, 'pending' | 'error' | 'skipped'>; kind: SummaryErrorKind | null; message: string },
  stats: SummaryBatchStats
): Promise<void> {
  try {
    await recordSummaryFailure(firestore, docRef, claim, failure);
  } catch (err) {
    if (err instanceof SummarySupersededError) {
      stats.superseded++;
      return;
    }
    throw err;
  }
}

export interface RunSummaryBatchDeps {
  firestore: admin.firestore.Firestore;
  bucket: Bucket;
  /** 既定は`SARASHINA_SUMMARY_CONFIG.provider`(実際のL1環境変数値)。テスト注入用。 */
  l1Provider?: SummaryProviderSetting;
  now?: () => number;
  limit?: number;
  softDeadlineMs?: number;
  summarize?: typeof generateSummaryForProvider;
  getGate?: typeof getSarashinaSummaryGate;
}

/**
 * `onSchedule`のCloudEvent配管から独立させたバッチ本体(`rescueStuckProcessingDocs`と
 * 同型パターン、直接テストする)。
 */
export async function runSummaryBatch(deps: RunSummaryBatchDeps): Promise<SummaryBatchStats> {
  const {
    firestore,
    bucket,
    l1Provider = SARASHINA_SUMMARY_CONFIG.provider,
    now = () => Date.now(),
    limit = SUMMARY_BATCH_LIMIT,
    softDeadlineMs = SUMMARY_BATCH_SOFT_DEADLINE_MS,
    summarize = generateSummaryForProvider,
    getGate = getSarashinaSummaryGate,
  } = deps;

  const stats = emptyStats();

  // rescueはL1に関わらず毎tick実行する(手動claim(regenerateSummary)がプロセスごと
  // 落ちて放置されたケースの回収は、自動生成が無効な環境でも必要なため)。
  const rescueResult = await rescueStuckSummaryDocs(firestore, { now, l1: l1Provider });
  stats.rescued = rescueResult.rescued;
  stats.rescueErrored = rescueResult.errored;

  if (l1Provider === 'none') {
    console.log(`[${FUNCTION_NAME}] SUMMARY_PROVIDER=none, skipping batch (rescue only)`);
    return stats;
  }

  // L2ゲート(Firestoreフラグ+許可リスト)はL1='sarashina'の場合のみ適用する
  // (resolveSummaryProviderと同じ設計。L1='gemini'は明示的なロールバック運用のため
  // L2を経由させない)。
  let allowlist: string[] | null = null;
  if (l1Provider === 'sarashina') {
    const gate = await getGate(firestore);
    if (!gate.enabled) {
      console.log(`[${FUNCTION_NAME}] sarashinaSummary gate disabled, pausing queue for this tick`);
      return stats;
    }
    allowlist = gate.allowlist;
  }

  const startedAt = now();
  const pendingSnap = await firestore
    .collection('documents')
    .where('summaryState', '==', 'pending')
    .orderBy('updatedAt', 'asc')
    .limit(limit)
    // 参照のみ取得(egress削減、ADR-0018方針)。claim transaction内で改めて最新値を読む。
    .select()
    .get();

  const provider: SummaryPassProvider = l1Provider === 'gemini' ? 'gemini' : 'sarashina';
  const docs = pendingSnap.docs;

  for (let i = 0; i < docs.length; i++) {
    if (now() - startedAt >= softDeadlineMs) {
      stats.deferred = docs.length - i;
      console.log(`[${FUNCTION_NAME}] soft deadline reached, deferring ${stats.deferred} document(s) to next tick`);
      break;
    }

    const docId = docs[i].id;
    const docRef = firestore.doc(`documents/${docId}`);

    if (allowlist !== null && !allowlist.includes(docId)) {
      // codex review P2指摘反映: 参照のみ取得したスナップショットは既に古い可能性がある。
      // 無条件updateだと、この間に手動再生成がclaimした文書(summaryState:'processing')を
      // 'skipped'へ上書きしてしまい、手動側のcommit時の所有権チェック(state-mismatch)で
      // 正当な結果が破棄される。トランザクション内で'pending'のままであることを再確認する。
      const stillPending = await firestore.runTransaction(async (tx) => {
        const fresh = await tx.get(docRef);
        if (!fresh.exists || fresh.data()?.summaryState !== 'pending') return false;
        tx.update(docRef, {
          summaryState: 'skipped',
          summaryStateUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return true;
      });
      if (stillPending) stats.skipped++;
      continue;
    }

    const claimResult = await claimSummaryRun(firestore, docRef, 'batch');
    if (!claimResult.claimed) {
      if (claimResult.reason === 'not-processed') stats.skipped++;
      continue;
    }
    stats.claimed++;
    const { claim } = claimResult;

    try {
      const loaded = await loadOcrTextForSummary(firestore, bucket, docRef);
      if (!loaded || loaded.ocrResult.length < MIN_OCR_LENGTH_FOR_SUMMARY) {
        // decideOcrCompletionSummaryStateが既に短文をskippedへ倒しているため通常到達しない
        // (Storageダウンロード失敗等の稀な例外系のみを想定した安全網)。
        await recordSummaryFailure(firestore, docRef, claim, {
          state: 'skipped',
          kind: null,
          message: 'OCR結果を読み込めなかったため要約を生成できません',
        });
        stats.skipped++;
        continue;
      }

      const sentText =
        loaded.ocrResult.length > MAX_SUMMARY_INPUT_LENGTH
          ? loaded.ocrResult.slice(0, MAX_SUMMARY_INPUT_LENGTH)
          : loaded.ocrResult;

      const passResult = await summarize(loaded.ocrResult, loaded.documentType, provider);

      const scan = scanSummaryForFabrication(passResult.summary.text, sentText);
      if (scan.fabricatedCount > 0) {
        await recordSummaryFailure(firestore, docRef, claim, {
          state: 'error',
          kind: 'fabrication_suspected',
          message: `Fabrication scanner detected ${scan.fabricatedCount} suspect name(s) (configVersion=${scan.configVersion})`,
        });
        incrementErrorKind(stats, 'fabrication_suspected');
        continue;
      }

      await commitSummaryResult(firestore, docRef, claim, {
        summary: passResult.summary,
        provider: passResult.provider,
      });
      stats.done++;
    } catch (err) {
      if (err instanceof SummarySupersededError) {
        stats.superseded++;
        continue;
      }

      await safeLogError({
        error: err instanceof Error ? err : new Error(String(err)),
        source: 'ocr',
        functionName: FUNCTION_NAME,
        documentId: docId,
      });

      const message = err instanceof Error ? err.message : String(err);
      const outcome = classifySummaryFailure(err);
      switch (outcome.action) {
        case 'leave-processing-stop-batch':
          // 二重推論防止(ADR-0027主要な設計判断8): summaryStateはprocessingのまま残し
          // rescueStuckSummaryDocsに委ねる。直後のリクエストも同じ理由でブロックされて
          // いる可能性が高いため、このtickでの新規claimは打ち切る。
          stats.deferred = docs.length - i - 1;
          return stats;
        case 'abort-batch-config':
          await recordFailureOrCountSuperseded(firestore, docRef, claim, { state: 'pending', kind: null, message }, stats);
          stats.deferred = docs.length - i - 1;
          return stats;
        case 'retry-or-error': {
          const nextState = claim.attemptCount >= MAX_SUMMARY_ATTEMPTS ? 'error' : 'pending';
          await recordFailureOrCountSuperseded(
            firestore,
            docRef,
            claim,
            { state: nextState, kind: outcome.kind, message },
            stats
          );
          incrementErrorKind(stats, outcome.kind);
          if (outcome.stopBatch) {
            stats.deferred = docs.length - i - 1;
            return stats;
          }
          break;
        }
        case 'error':
          await recordFailureOrCountSuperseded(firestore, docRef, claim, { state: 'error', kind: outcome.kind, message }, stats);
          incrementErrorKind(stats, outcome.kind);
          break;
      }
    }
  }

  console.log(`[${FUNCTION_NAME}] stats: ${JSON.stringify(stats)}`);
  return stats;
}

export const generateSummaryBatch = onSchedule(
  {
    schedule: 'every 60 minutes',
    region: 'asia-northeast1',
    timeoutSeconds: SUMMARY_BATCH_TIMEOUT_SECONDS,
    memory: '512MiB',
    maxInstances: 1,
    concurrency: 1,
  },
  async () => {
    const firestore = admin.firestore();
    const bucket = admin.storage().bucket();
    await runSummaryBatch({ firestore, bucket });
  }
);
