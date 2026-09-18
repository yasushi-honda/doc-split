/**
 * Google Drive エクスポート実行の共通ロジック(ADR-0022 Phase 1 Task8)
 *
 * `driveExportStatus`が`claimFromStatus`である時のみトランザクションで`exporting`へ
 * クレームし、`exportDocument()`を実行、成功/失敗を書き戻す。verified検知トリガー
 * (`driveExportTrigger.ts`)・手動リトライ(`retryDriveExport.ts`)・定期リトライ
 * (`driveExportScheduled.ts`)の3箇所から共通で呼び出される。
 *
 * クレームをトランザクション化することで、同一docIdに対する呼び出しが重なっても
 * (例: 手動リトライと定期リトライの同時実行)、`exportDocument()`が二重実行される
 * ことはない(`driveExportTrigger.ts`のTOCTOUレース対策と同じ思想)。
 *
 * クレーム成功時は`randomUUID()`で所有権トークン(`driveExportRunId`)を発行し、
 * `exportDocument()`へ渡す。書戻し(成功時はexportDocument()内、失敗時は本ファイルの
 * catch節)は、書戻し直前に再読込した`driveExportRunId`が自分のrunIdと一致する場合
 * のみ行う。これにより、`driveExportScheduled.ts`が長時間'exporting'のdocを再クレーム
 * し2つの実行が並走した場合でも、後から完了した古い実行が新しい実行の状態を上書き
 * しない(`functions/src/ocr/ocrRunGuard.ts`の`ocrRunId`による所有権検証と同じ思想)。
 *
 * `updatedAt`は`driveExportScheduled.ts`の滞留検出(`exporting`状態の長時間スタック)
 * が参照するため、`exporting`/`error`遷移の両方で必ず書き込む。
 */

import { randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';
import {
  exportDocument,
  ExportDocumentDeps,
  CustomerUnconfirmedError,
  DriveSettingsIncompleteError,
  AmbiguousFileError,
} from './exportDocument';
import {
  FolderCreationInProgressError,
  FolderVerificationPendingError,
  FolderClaimCommitError,
  FolderClaimRestoreCommitError,
  AmbiguousFolderErrorBase,
  DivergentFolderClaimError,
  DrivePermissionError,
  classifyDriveApiError,
} from './driveFolderClaim';
import {
  FuriganaMissingError,
  CareManagerMissingError,
  DocumentCategoryMissingError,
  CustomerNameMissingError,
  FileDateMissingError,
} from './folderPath';
import { isTransientError } from '../utils/retry';
import type { DriveExportStatus, DriveExportErrorKind } from '../../../shared/types';

// 呼び出し元・テストからの既存importを壊さないための再export
// (type-design-analyzerレビュー指摘対応: 型定義自体は`DriveExportStatus`と同じく
// shared/types.tsを真実源とし、ここではimportして再利用する)。
export type { DriveExportErrorKind };

/**
 * エラーを transient(時間経過で自然に解消しうる) / permanent(人手介入が必要)に分類する。
 *
 * 分類の優先順位: (1) 既知のアプリ内エラークラス → (2) gRPCステータスコード(0〜16の数値
 * 空間、Firestore SDKが内部リトライ対象とする1/2/4/8/10/13/14/16はtransient、それ以外は
 * permanent) → (3) HTTPステータスが実在する生のDrive APIエラー(`classifyDriveApiError()`
 * に委譲) → (4) それ以外(ネットワーク層エラー・素のError等、`isTransientError()`に委譲)。
 *
 * (3)と(4)を分離している理由: `classifyDriveApiError()`は`status===undefined`を
 * 無条件でtransientに倒すが、これは`verifyFolderClaim()`のfiles.get()呼び出し専用の
 * 狭い文脈(呼び出し元が確実にgaxios由来のエラーだけを渡す)を前提にした設計。
 * ここ(exportDocument()のcatch-all)には`folderPath.ts`由来の素のError等、
 * 非API起源のエラーも混在するため、そのまま委譲すると本来permanentであるべき
 * 未列挙のアプリ内エラーまで無差別にtransient化してしまう(現行の1時間据え置きより
 * 悪化する回帰になる)。よってHTTPステータスの実在を委譲の前提条件として明示的に課す。
 *
 * **既知の限界(fable-review指摘、スコープ外として許容)**:
 * - transientが恒久的に解消しない場合の再試行回数上限は設けていない(`driveExportScheduled.ts`
 *   が`DRIVE_EXPORT_TRANSIENT_ERROR_RETRY_THRESHOLD_MS`ごとに無期限リトライし続ける)。
 *   `BATCH_SIZE`は成功件数のみを消費するため他docのstarvationは起きないが、恒久的な
 *   transient誤判定があった場合の打ち切り機構(N回失敗でpermanentへ降格等)は未実装
 * - `childFolderResolver.ts`(Phase B、移行スクリプト専用)固有のエラークラス
 *   (`ChildFolderCreatedButUncommittedError`等)は未列挙。`exportDocument()`は
 *   `findOrCreateFolder`のみを使い`childFolderResolver`は経由しないため現状は到達しないが、
 *   将来両リゾルバの呼び出し経路が統合された場合はここへの追加列挙が必要になる
 */
export function classifyDriveExportErrorKind(error: unknown): DriveExportErrorKind {
  // transient: 時間経過で自然に解消しうる
  if (
    error instanceof FolderCreationInProgressError ||
    error instanceof FolderVerificationPendingError ||
    error instanceof FolderClaimCommitError ||
    error instanceof FolderClaimRestoreCommitError
  ) {
    return 'transient';
  }
  // permanent: 人手介入が必要（時間経過だけでは解消しない）
  if (
    error instanceof CustomerUnconfirmedError ||
    error instanceof DriveSettingsIncompleteError ||
    error instanceof AmbiguousFolderErrorBase || // AmbiguousFolderError/AmbiguousChildFolderError
    error instanceof AmbiguousFileError ||
    error instanceof DivergentFolderClaimError ||
    error instanceof DrivePermissionError ||
    error instanceof FuriganaMissingError ||
    error instanceof CareManagerMissingError ||
    error instanceof DocumentCategoryMissingError ||
    error instanceof CustomerNameMissingError ||
    error instanceof FileDateMissingError
  ) {
    return 'permanent';
  }

  const err = error as { status?: number; code?: number | string; response?: { status?: number } };

  // fable-review指摘(2巡目レビューHigh-1、確認済み・自分で再現も確認): 1巡目レビュー
  // Medium-2への対応として`code===4||code===14`のみを個別救済していたが、gRPCステータス
  // コードは0〜16の数値空間全体(google-gaxのGoogleError.code)であり、Firestoreの
  // `runTransaction()`自身が内部リトライ対象とするコードは1(CANCELLED)/2(UNKNOWN)/
  // 4(DEADLINE_EXCEEDED)/8(RESOURCE_EXHAUSTED)/10(ABORTED)/13(INTERNAL)/14(UNAVAILABLE)/
  // 16(UNAUTHENTICATED)の8種(出典: @google-cloud/firestore transaction.js
  // `isRetryableTransactionError`)。4/14以外(特に10=ABORTED、Issue #526で「Firestore
  // transaction書込競合は一時的エラー」と既に確立されている性質)を素通りさせると、
  // 下のHTTPステータス判定(`typeof err.code==='number'`で数値codeを全てHTTPとみなす)に
  // 吸収されて`classifyDriveApiError()`の`unknown`(→permanent)に誤って倒れてしまう
  // (1巡目の修正自体が持ち込んだ回帰、2巡目レビューで検出)。
  //
  // HTTPステータスコード(100〜599)とgRPCステータスコード(0〜16)は値域が重ならないため、
  // `code < 100`をgRPC体系の判定に使う(fable-review 2巡目の提案どおり)。
  const GRPC_TRANSIENT_CODES = new Set([1, 2, 4, 8, 10, 13, 14, 16]);
  if (typeof err?.code === 'number' && err.code < 100) {
    return GRPC_TRANSIENT_CODES.has(err.code) ? 'transient' : 'permanent';
  }

  // fable-review指摘(1巡目Medium-1、確認済み): classifyDriveApiError()自身は
  // status→数値code→response.statusの順でHTTPステータスを解決するが、ここが`status`/
  // `response.status`しか見ていないと、数値codeのみを持つエラー(例: @google-cloud/storage
  // ApiErrorの`code: number`、HTTPステータスをそのまま格納する)が意図せず下の
  // isTransientError()経路に落ちる。両関数の定数集合がたまたま一致していても、片方だけ
  // 変更されるとドリフトする不安定な一致になるため、classifyDriveApiError()と同じ判定
  // 順序をここでも明示的に揃える(上のgRPCコード判定を通過した後なので、ここに残る
  // 数値codeは100以上の真のHTTPステータスのみ)。
  const hasHttpStatus =
    typeof err?.status === 'number' ||
    typeof err?.code === 'number' ||
    typeof err?.response?.status === 'number';
  if (hasHttpStatus) {
    const kind = classifyDriveApiError(error);
    // notFound/unauthenticated/permissionDenied/unknown はfail-closedでpermanent扱い
    // (rules/error-handling.md §3の一般原則: 404/401/403/未分類は人手対応が必要な終端エラー)
    return kind === 'transient' || kind === 'rateLimited' ? 'transient' : 'permanent';
  }

  // HTTPステータス・上記gRPCコードのいずれも持たない生エラー(ネットワーク層エラー・
  // 素のError等)は、既存の汎用ネットワーク層エラー判定に委譲する。plainなError
  // (例: 'document not found'、フォルダ/ファイルidが取得できません等の不変条件違反)は
  // falseを返すためpermanentに倒れる(ただしtimeout等の特定キーワードを含むメッセージは
  // isTransientError()の緩いメッセージ一致によりtransientになりうる)。
  return isTransientError(error) ? 'transient' : 'permanent';
}

/**
 * @returns クレームに成功し`exportDocument()`を実行した場合true。
 *   現在の`driveExportStatus`が`claimFromStatus`と一致しない(既に他の呼び出しが
 *   処理中/対象外の状態)場合はfalse(何も書き込まない)。
 */
export async function executeDriveExport(
  firestore: admin.firestore.Firestore,
  docId: string,
  exportDeps: Partial<ExportDocumentDeps> = {},
  claimFromStatus: DriveExportStatus | undefined
): Promise<boolean> {
  const docRef = firestore.doc(`documents/${docId}`);
  const runId = randomUUID();

  const claimed = await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists) {
      return false;
    }
    const currentStatus = snap.data()?.driveExportStatus as DriveExportStatus | undefined;
    if (currentStatus !== claimFromStatus) {
      return false;
    }
    tx.update(docRef, {
      driveExportStatus: 'exporting',
      driveExportRunId: runId,
      driveExportError: admin.firestore.FieldValue.delete(),
      driveExportErrorKind: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return true;
  });

  if (!claimed) {
    return false;
  }

  try {
    await exportDocument(docId, runId, exportDeps);
    // 成功時のdriveFileId/driveExportedAt/driveExportStatus:'exported'書戻しはexportDocument()の責務
    // (所有権チェック付きtransactionで行われる)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Drive export failed for document ${docId}: ${message}`);
    const errorPatch = {
      driveExportStatus: 'error' as const,
      driveExportError: message,
      driveExportErrorKind: classifyDriveExportErrorKind(error),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    try {
      await firestore.runTransaction(async (tx) => {
        const snap = await tx.get(docRef);
        if (!snap.exists || snap.data()?.driveExportRunId !== runId) {
          return; // 他の実行に引き継がれている(superseded) → 新しい状態を上書きしない
        }
        tx.update(docRef, errorPatch);
      });
    } catch (writebackError) {
      // このtransaction自体(tx.get()/tx.update())が失敗すると、driveExportStatusは
      // 'exporting'のまま固着しErrorsPageのエラー一覧UIから原因を追跡できなくなる(Issue #947)。
      // 所有権チェック(driveExportRunId一致)自体は維持するが、get→updateの間に他の実行が
      // 割り込む余地(TOCTOU、runTransaction()なら内部的に防げていたもの)が生まれる。
      // `lastUpdateTime` precondition(Issue #539/EFF-M2と同一パターン)を使い、
      // get以降にdocが変更されていればFAILED_PRECONDITIONで書込みを拒否させることで
      // この穴を塞ぎつつ、非transactionのbest-effort書込みへフォールバックする。
      const writebackMessage =
        writebackError instanceof Error ? writebackError.message : String(writebackError);
      console.error(
        `Drive export error writeback failed for document ${docId} (original error: ${message}): ${writebackMessage}`
      );
      try {
        const snap = await docRef.get();
        if (snap.exists && snap.data()?.driveExportRunId === runId) {
          await docRef.update(errorPatch, { lastUpdateTime: snap.updateTime! });
        } // else: 他の実行に引き継がれている(superseded) → 新しい状態を上書きしない
      } catch (fallbackError) {
        const fallbackMessage =
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        console.error(
          `Drive export error writeback fallback also failed for document ${docId} (original error: ${message}): ${fallbackMessage}`
        );
      }
    }
  }

  return true;
}
