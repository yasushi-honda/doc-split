/**
 * AI要約の再生成
 *
 * 既存ドキュメントに対してAI要約を再生成するCallable関数。
 * Issue #214 で Vertex AI 呼び出しロジックは summaryGenerator.generateSummaryCore に集約。
 */

import * as functions from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { GCP_CONFIG } from '../utils/config';
import { safeLogError } from '../utils/errorLogger';
import type { SummaryField } from '../../../shared/types';
import { generateSummaryCore, MIN_OCR_LENGTH_FOR_SUMMARY } from './summaryGenerator';
import { classifySummaryError, mapSummaryErrorToHttpsError } from './summaryErrorClassification';
import { resolveDetailFields, readDocWithDetail } from './documentDetail';
import { claimSummaryRun, commitSummaryResult, releaseManualSummaryRun } from './summaryRunStore';
import { MANUAL_SUMMARY_SOFT_TIMEOUT_MS, SummarySupersededError } from './summaryRunGuard';

const LOCATION = GCP_CONFIG.location;

const db = admin.firestore();

interface RegenerateSummaryRequest {
  docId: string;
}

/**
 * `Promise.race`で発火した際にthrowするマーカーエラー。onCallの60秒ハードタイムアウトで
 * 強制終了される前に`releaseManualSummaryRun`でclaimを解放できるようにする
 * (`MANUAL_SUMMARY_SOFT_TIMEOUT_MS`、ADR-0027 PR4)。
 */
class ManualSummarySoftTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Summary generation exceeded soft timeout (${timeoutMs}ms)`);
    this.name = 'ManualSummarySoftTimeoutError';
  }
}

/** `promise`が`timeoutMs`以内に解決しなければ`ManualSummarySoftTimeoutError`でrejectする。 */
function raceWithSoftTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ManualSummarySoftTimeoutError(timeoutMs)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/**
 * AI要約を再生成
 */
export const regenerateSummary = functions.https.onCall(
  {
    region: LOCATION,
    memory: '512MiB',
    timeoutSeconds: 60,
    cors: true,
  },
  async (request) => {
    // 認証チェック
    if (!request.auth) {
      throw new functions.https.HttpsError('unauthenticated', '認証が必要です');
    }
    const userDoc = await db.doc(`users/${request.auth.uid}`).get();
    if (!userDoc.exists) {
      throw new functions.https.HttpsError('permission-denied', 'User not in whitelist');
    }

    const { docId } = request.data as RegenerateSummaryRequest;

    if (!docId) {
      throw new functions.https.HttpsError('invalid-argument', 'docIdが必要です');
    }

    // ドキュメント取得
    // ADR-0018 Phase D (#6): getOcrText と同じ transactional paired-read
    // (根拠は readDocWithDetail の doc comment 参照)。fieldMask で転送を要約に必要な
    // フィールドに限定
    const docRef = db.doc(`documents/${docId}`);
    const [docSnap, detailSnap] = await readDocWithDetail(db, docRef, [
      'ocrResult',
      'documentType',
    ]);

    if (!docSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'ドキュメントが見つかりません');
    }

    const docData = docSnap.data()!;
    const { ocrResult } = resolveDetailFields(detailSnap.data(), docData);
    // 空/未定義はそのまま core に渡し、core 内の DEFAULT_DOCUMENT_TYPE_LABEL で一本化。
    const documentType = (docData.documentType as string | undefined) ?? '';

    if (!ocrResult || ocrResult.length < MIN_OCR_LENGTH_FOR_SUMMARY) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'OCR結果が短すぎるため要約を生成できません'
      );
    }

    // claim(ADR-0027 PR4): 現在の所有者(バッチ実行中・過去の手動実行)を無条件でpreempt
    // する(主要な設計判断3。ユーザーの明示操作を優先し、最大35分のstuck待ちで
    // ブロックしない。preemptされた側はcommit/release時にSummarySupersededErrorとして
    // 検出され、実害は1回分の無駄な推論のみ)。手動モードは常にclaimするため、
    // claimed:falseは「claim transaction内でdocが削除された」極めて稀なケースのみ。
    const claimResult = await claimSummaryRun(db, docRef, 'manual');
    if (!claimResult.claimed) {
      throw new functions.https.HttpsError('not-found', 'ドキュメントが見つかりません');
    }
    const claim = claimResult.claim;

    // 要約生成 (Issue #214: 共通コアに委譲。本経路は error を rethrow して onCall の HttpsError 化)
    // Issue #266: rethrow 前に safeLogError で errors collection + 通知による検知を確保。
    // 順序根拠 (rules/error-handling.md § 1): 本経路は "状態復旧なし + 即 rethrow" のため、
    // ログ記録 → rethrow の順を採る。safeLogError は内部で try/catch 済、caller に波及しない。
    // ADR-0027 PR4: onCallの60秒ハードタイムアウトで強制終了される前に、45秒
    // (MANUAL_SUMMARY_SOFT_TIMEOUT_MS)でclaimを自発的に解放できるようraceさせる。
    // Issue #251 Scope3: 空/ブロック応答は generateSummaryCore が SummaryBlockedError を throw するため
    // (finishReason/safetyRatings を保持したまま)、ここで !summary.text を再チェックする必要はない。
    // quota/transient/blocked をエラー種別で HttpsError コードへ細分化し、client 側の再試行判断を助ける。
    // console.error(error) はここで先に実行する (rules/error-handling.md § 1「最低限のconsole.error
    // はtry-catch外で先に実行」)。safeLogError内部のconsole.errorはerrorCode/message等の flat summary
    // のみでスタックトレースを含まないため (/code-review指摘)、Cloud Logging上のstack可視性はこちらが担う。
    // classifySummaryErrorには生のerror(catch句の引数)をそのまま渡す。console.error/safeLogError用に
    // 作る `new Error(String(error))` ラップ値を渡すと、is429Error/isTransientErrorが読む
    // .code/.status/.cause.codeが失われ'unknown'に落ちるため (/code-review指摘)。
    let summary: SummaryField;
    try {
      summary = await raceWithSoftTimeout(
        generateSummaryCore(ocrResult, documentType),
        MANUAL_SUMMARY_SOFT_TIMEOUT_MS
      );
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('Failed to generate summary:', err);
      await safeLogError({
        error: err,
        source: 'ocr',
        functionName: 'regenerateSummary',
        documentId: docId,
      });

      const classification = error instanceof ManualSummarySoftTimeoutError ? 'unknown' : classifySummaryError(error);
      try {
        await releaseManualSummaryRun(db, docRef, claim, classification);
      } catch (releaseErr) {
        console.error(`Failed to release manual summary claim for ${docId}:`, releaseErr);
      }

      if (error instanceof ManualSummarySoftTimeoutError) {
        throw new functions.https.HttpsError(
          'deadline-exceeded',
          '要約生成に時間がかかっているため処理を中断しました。しばらく待って再試行してください'
        );
      }
      const mapping = mapSummaryErrorToHttpsError(classification);
      if (mapping) {
        throw new functions.https.HttpsError(mapping.code, mapping.message);
      }
      throw err;
    }

    // commit(ADR-0027 PR4): 所有権を再検証してから書き込む。claim後に別の実行に
    // preemptされていた場合はSummarySupersededErrorとしてabortされ、書込みは行わない。
    // silent-failure-hunter/code-reviewer指摘反映: commit失敗(supersede以外)もIssue #266と
    // 同じくsafeLogErrorで記録する(releaseManualSummaryRunはあえて呼ばない。生成済みの
    // 要約を破棄することになり、claimは'processing'のまま残るがrescueが後で回収する)。
    try {
      await commitSummaryResult(db, docRef, claim, { summary, provider: 'gemini' });
    } catch (commitErr) {
      if (commitErr instanceof SummarySupersededError) {
        throw new functions.https.HttpsError('aborted', '別の要約生成処理が先に完了したため、この結果は破棄されました');
      }
      const err = commitErr instanceof Error ? commitErr : new Error(String(commitErr));
      console.error('Failed to commit summary:', err);
      await safeLogError({ error: err, source: 'ocr', functionName: 'regenerateSummary', documentId: docId });
      throw commitErr;
    }

    console.log(`Summary regenerated for ${docId}: ${summary.text.length} chars`);

    return { success: true, summary: summary.text };
  }
);
