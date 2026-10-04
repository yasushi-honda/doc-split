/**
 * AI要約の非同期バッチ処理 (ADR-0027 PR4、PR-Cで手動依頼中心に再設計)
 *
 * Cloud Scheduler定期ポーリング(1分ごと) → `summaryState=='pending'`の文書を逐次claim・生成・
 * commitする。要約は「手動を基本」(PR-C)のため、実行対象は`summaryManualRequestedAt`の印を持つ
 * 手動依頼が中心で、`settings/features.autoSummaryOnOcr`が有効な間だけ印のないpending(自動由来)も
 * 残りの枠で処理する。`processOCR.ts`(ポーリング+claim+逐次処理)と同じ設計思想だが、
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
import { MIN_OCR_LENGTH_FOR_SUMMARY } from './summaryPromptBuilder';
import { scanSummaryForFabrication, type FabricationScanResult } from '../../../shared/summaryFabricationScan';
import { scanSummaryForForeignWords } from '../../../shared/summaryLanguageMixScan';
import { logManualSummaryResult } from './summaryManualMetrics';
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
  /**
   * fabricationスキャナが検知したが、総試行上限に達していないため`pending`へ戻した件数。
   * 終端`error`(`errorByKind.fabrication_suspected`)とは別に数える(検知件数と終端error件数を
   * 区別して観測できるようにするため、ADR-0027 PR5 D1対応)。
   */
  fabricationRetried: number;
  /** 英字混入スキャナ(第1段階はログのみ、要約は保存する)が検知した件数。 */
  languageMixDetected: number;
}

function emptyStats(): SummaryBatchStats {
  return {
    claimed: 0,
    done: 0,
    errorByKind: {},
    superseded: 0,
    skipped: 0,
    deferred: 0,
    rescued: 0,
    rescueErrored: 0,
    fabricationRetried: 0,
    languageMixDetected: 0,
  };
}

/** エラー文に載せる検知詳細の最大件数。 */
const FABRICATION_MESSAGE_MAX_FINDINGS = 3;

/**
 * `summaryError`用の診断文字列を組み立てる。
 *
 * `summaryError`は「PIIを含めない」契約(`shared/types.ts`)で、`documents`は全ホワイトリスト
 * 利用者が読める。疑い名(モデル出力=任意文字列)そのものは保存せず、語彙由来のsuffixと
 * core文字数だけを残す(例: 「持つ訪問看護」→ `suffix=訪問看護/coreLen=2`)。これで原因の見当が
 * 付き、実機再現(一時IAM付与)なしに次の誤検知パターンを切り分けられる。
 * `recombined`(原典の語順入替)はブロック対象外のため含めない。
 */
function buildFabricationErrorMessage(scan: FabricationScanResult, attemptCount: number): string {
  const detail = scan.findings
    .filter((f) => f.kind === 'fabricated')
    .slice(0, FABRICATION_MESSAGE_MAX_FINDINGS)
    .map((f) => `suffix=${f.suffix}/coreLen=${f.core.length}`)
    .join(', ');
  return (
    `Fabrication scanner detected ${scan.fabricatedCount} suspect name(s): ${detail} ` +
    `(configVersion=${scan.configVersion}, attempt=${attemptCount}/${MAX_SUMMARY_ATTEMPTS})`
  );
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
    if (failure.state !== 'pending') {
      // 終端(error/skipped)。印はrecordSummaryFailureが削除済みで、1依頼につき1行だけ計測ログを出す。
      logManualSummaryResult({
        functionName: FUNCTION_NAME,
        documentId: docRef.id,
        outcome: failure.state,
        kind: failure.kind,
        provider: null,
        requestedAtMs: claim.manualRequestedAtMs,
        nowMs: Date.now(),
      });
    }
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
  try {
    return await runSummaryBatchInner(deps);
  } catch (error) {
    // silent-failure-hunter指摘反映: `processOCR.ts`と同じ外側の安全網。rescue・pending
    // 一覧取得・L2ゲート読取・claim呼出自体(=個々の文書のtry/catchより前)で例外が出ると、
    // ここまでは一切ログを残さず関数全体が例外で落ちていた(このtickの残り文書は
    // 次tickで再選択されるため自己修復はするが、`errors`コレクションに記録が残らず
    // 監視から不可視だった)。
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`[${FUNCTION_NAME}] Fatal error:`, err.message);
    await safeLogError({ error: err, source: 'ocr', functionName: FUNCTION_NAME });
    throw error;
  }
}

async function runSummaryBatchInner(deps: RunSummaryBatchDeps): Promise<SummaryBatchStats> {
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
  // L2のenabled/allowlistを経由させない)。自動生成フラグ(autoSummaryOnOcr)だけは、どちらの
  // L1でも同じsnapshotから読む。
  let allowlist: string[] | null = null;
  let autoEnabled = false;
  const gate = await getGate(firestore);
  autoEnabled = gate.autoOnOcr === true;
  if (l1Provider === 'sarashina') {
    if (!gate.enabled) {
      console.log(`[${FUNCTION_NAME}] sarashinaSummary gate disabled, pausing queue for this tick`);
      return stats;
    }
    allowlist = gate.allowlist;
  }

  const startedAt = now();
  // 実行対象(PR-C): 手動依頼の印(summaryManualRequestedAt)を持つpendingを依頼順に取得する
  // (印のない文書はorderByの対象外になる=過去の自動・canary由来のpendingは実行されない)。
  const manualSnap = await firestore
    .collection('documents')
    .where('summaryState', '==', 'pending')
    .orderBy('summaryManualRequestedAt', 'asc')
    .limit(limit)
    // 参照のみ取得(egress削減、ADR-0018方針)。claim transaction内で改めて最新値を読む。
    .select()
    .get();
  const docs = [...manualSnap.docs];

  if (autoEnabled && docs.length < limit) {
    // 自動生成が有効な間だけ、残りの枠を従来のupdatedAt順で埋める。手動依頼の文書が先頭に
    // 含まれうるため、重複を除いた結果がlimit件に満たないことがないよう多めに取得する。
    const autoSnap = await firestore
      .collection('documents')
      .where('summaryState', '==', 'pending')
      .orderBy('updatedAt', 'asc')
      .limit(limit + docs.length)
      .select()
      .get();
    const seen = new Set(docs.map((d) => d.id));
    for (const candidate of autoSnap.docs) {
      if (docs.length >= limit) break;
      if (seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      docs.push(candidate);
    }
  }

  const provider: SummaryPassProvider = l1Provider === 'gemini' ? 'gemini' : 'sarashina';

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
      let skippedRequestedAtMs: number | null = null;
      const stillPending = await firestore.runTransaction(async (tx) => {
        skippedRequestedAtMs = null;
        const fresh = await tx.get(docRef);
        if (!fresh.exists || fresh.data()?.summaryState !== 'pending') return false;
        const requestedAt = fresh.data()?.summaryManualRequestedAt as FirebaseFirestore.Timestamp | undefined;
        skippedRequestedAtMs = requestedAt && typeof requestedAt.toMillis === 'function' ? requestedAt.toMillis() : null;
        tx.update(docRef, {
          summaryState: 'skipped',
          summaryStateUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
          // 手動依頼の印は終端で削除する(skippedも終端)。
          summaryManualRequestedAt: admin.firestore.FieldValue.delete(),
        });
        return true;
      });
      if (stillPending) {
        stats.skipped++;
        logManualSummaryResult({
          functionName: FUNCTION_NAME,
          documentId: docId,
          outcome: 'skipped',
          kind: null,
          provider: null,
          requestedAtMs: skippedRequestedAtMs,
          nowMs: Date.now(),
        });
      }
      continue;
    }

    const claimResult = await claimSummaryRun(firestore, docRef);
    if (!claimResult.claimed) {
      if (claimResult.reason === 'not-processed') {
        stats.skipped++;
        logManualSummaryResult({
          functionName: FUNCTION_NAME,
          documentId: docId,
          outcome: 'skipped',
          kind: null,
          provider: null,
          requestedAtMs: claimResult.manualRequestedAtMs,
          nowMs: Date.now(),
        });
      }
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
        logManualSummaryResult({
          functionName: FUNCTION_NAME,
          documentId: docId,
          outcome: 'skipped',
          kind: null,
          provider: null,
          requestedAtMs: claim.manualRequestedAtMs,
          nowMs: Date.now(),
        });
        continue;
      }

      const passResult = await summarize(loaded.ocrResult, loaded.documentType, provider);

      // 比較対象は実際に送信した原文(context超過時の再短縮を反映済み)。元のOCR全文(の先頭8,000字)と
      // 比べると、再短縮で送らなかった部分の語を許してしまう。
      const scanSource = passResult.sentText;
      const scan = scanSummaryForFabrication(passResult.summary.text, scanSource);
      if (scan.fabricatedCount > 0) {
        // 要約は確率的生成でスキャナも語彙ベースのため、自然な文の誤検知(ADR-0027 PR5 D1:
        // 「指示期間を持つ訪問看護指示書」→「持つ訪問看護」)が起こりうる。1回の検知で終端
        // errorにせず、他のretry経路と同じ総試行上限(MAX_SUMMARY_ATTEMPTS)の範囲で
        // pendingへ戻して再生成する。summaryAttemptCountはquota/transient/手動再生成と共有の
        // 総claim回数のため、先に試行を消費済みの文書は初回の検知で即errorになりうる(仕様)。
        // 要約は保存しない(検知した出力は一度も書き込まれない)。
        const nextState = claim.attemptCount >= MAX_SUMMARY_ATTEMPTS ? 'error' : 'pending';
        const fabricationMessage = buildFabricationErrorMessage(scan, claim.attemptCount);
        await recordSummaryFailure(firestore, docRef, claim, {
          state: nextState,
          kind: 'fabrication_suspected',
          message: fabricationMessage,
        });
        // 再試行(pending)した検知は`errors`コレクションに載せない(誤検知の再試行が運用者向けの
        // エラー一覧に並ぶのを避ける)。代わりにCloud Loggingへ検知ごとの1行ログを残し、
        // 検知率・再試行結果を後から集計できるようにする(message自体はPIIを含まない)。
        console.warn(
          `[${FUNCTION_NAME}] fabrication_suspected documentId=${docId} outcome=${nextState === 'error' ? 'error' : 'retry'} ${fabricationMessage}`
        );
        if (nextState === 'error') {
          incrementErrorKind(stats, 'fabrication_suspected');
          logManualSummaryResult({
            functionName: FUNCTION_NAME,
            documentId: docId,
            outcome: 'error',
            kind: 'fabrication_suspected',
            provider: null,
            requestedAtMs: claim.manualRequestedAtMs,
            nowMs: Date.now(),
          });
        } else {
          stats.fabricationRetried++;
        }
        continue;
      }

      // 英字混入(原文にない4文字以上の英単語): 第1段階はログのみで、要約は保存する。誤検知率を
      // 実運用で測ってから、再生成・error化(ブロック)するかを判断する(PR-C)。
      // 語そのものはログへ出さない(件数と文字数のみ): 原文に無い語でも、モデルが氏名等を
      // ローマ字へ音訳した語がPIIになりうるため。誤検知の分析は文字数分布と件数で行う。
      const languageMix = scanSummaryForForeignWords(passResult.summary.text, scanSource);
      if (languageMix.count > 0) {
        stats.languageMixDetected++;
        console.warn(
          `[${FUNCTION_NAME}] language_mix_suspected documentId=${docId} count=${languageMix.count} ` +
            `wordLengths=${languageMix.words.slice(0, 5).map((w) => w.length).join(',')}`
        );
      }

      await commitSummaryResult(firestore, docRef, claim, {
        summary: passResult.summary,
        provider: passResult.provider,
      });
      stats.done++;
      logManualSummaryResult({
        functionName: FUNCTION_NAME,
        documentId: docId,
        outcome: 'done',
        kind: null,
        provider: passResult.provider,
        requestedAtMs: claim.manualRequestedAtMs,
        nowMs: Date.now(),
      });
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
        case 'abort-batch-config': {
          // pr-test-analyzer指摘反映(実バグ): retry-or-errorと同じattemptCount上限判定を
          // 適用しないと、SARASHINA_SUMMARY_URL誤設定等の恒久的な設定不備の間、文書が
          // 'pending'のままsummaryAttemptCountだけがtickごとに際限なく増え続け、
          // 誰も気づかないまま無限リトライし続けてしまう(errorへ確定させて可視化する機会が
          // 永久に来ない)。
          const configNextState = claim.attemptCount >= MAX_SUMMARY_ATTEMPTS ? 'error' : 'pending';
          await recordFailureOrCountSuperseded(
            firestore,
            docRef,
            claim,
            { state: configNextState, kind: 'unknown', message },
            stats
          );
          incrementErrorKind(stats, 'config');
          stats.deferred = docs.length - i - 1;
          return stats;
        }
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
    // 1分ごと(PR-C): 手動依頼は次の実行を待つため、短い間隔にする。maxInstances:1とconcurrency:1で
    // 同時に走るのは1本だけ(実行中の予定回はスキップされる)。tickの長さはSUMMARY_BATCH_SOFT_DEADLINE_MSで抑える。
    schedule: 'every 1 minutes',
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
