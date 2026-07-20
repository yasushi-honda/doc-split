/**
 * Google Drive エクスポート 定期リトライ Cloud Function(ADR-0022 Phase 1 Task8)
 *
 * `driveExportStatus==='error'`(恒久エラーのバックストップ)、または`'exporting'`のまま
 * Functionクラッシュ等で長時間滞留したdocを再エンキューする。outboxパターンの
 * クラッシュ回復用(`functions/src/ocr/processOCR.ts`のstuck rescueと同じ思想)。
 *
 * `driveExportStatus`は単一フィールドの`in`クエリのみで絞り込み(複合indexが不要な
 * equality query)、`updatedAt`によるスタック判定はアプリ側でフィルタする
 * (件数が少ない想定のため、複合indexデプロイの運用負荷を避ける設計選択)。
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import { isDriveExportEnabled } from '../utils/featureFlags';
import { executeDriveExport } from './executeDriveExport';
import type { ExportDocumentDeps } from './exportDocument';
import type { DriveExportStatus } from '../../../shared/types';

const db = admin.firestore();

/** 1回のスケジュール実行で再エンキューする最大件数 */
export const DRIVE_EXPORT_SCHEDULED_BATCH_SIZE = 10;

/**
 * `error`滞留の再試行間隔。直後の連続リトライ(手動リトライ直後の二重実行等)を避ける。
 * (`processOCR.ts`の`ERROR_RESCUE_THRESHOLD_MS`と同型: 1時間)
 */
export const DRIVE_EXPORT_ERROR_RETRY_THRESHOLD_MS = 60 * 60 * 1000;

/**
 * `exporting`滞留の停止判定閾値。トリガー/リトライのtimeoutSeconds(120s)より
 * 十分大きく取り、真にクラッシュしたdocのみを対象にする。
 */
export const DRIVE_EXPORT_STUCK_EXPORTING_THRESHOLD_MS = 10 * 60 * 1000;

export interface SweepResult {
  requeued: number;
  skipped: number;
}

/**
 * スケジュール実行の本体ロジック。`onSchedule`のCloudEvent配管から独立させることで
 * テスト容易性を確保する(`rescueStuckProcessingDocs`と同型パターン)。
 */
export async function sweepStuckDriveExports(
  firestore: admin.firestore.Firestore,
  exportDeps: Partial<ExportDocumentDeps> = {}
): Promise<SweepResult> {
  const candidates = await firestore
    .collection('documents')
    .where('driveExportStatus', 'in', ['error', 'exporting'])
    .limit(DRIVE_EXPORT_SCHEDULED_BATCH_SIZE * 4)
    .get();

  const result: SweepResult = { requeued: 0, skipped: 0 };
  if (candidates.empty) {
    return result;
  }

  const now = Date.now();

  for (const docSnapshot of candidates.docs) {
    if (result.requeued >= DRIVE_EXPORT_SCHEDULED_BATCH_SIZE) {
      break;
    }

    const data = docSnapshot.data();
    const status = data.driveExportStatus as DriveExportStatus;
    const updatedAtMs = (data.updatedAt as admin.firestore.Timestamp | undefined)?.toMillis?.() ?? 0;
    const threshold =
      status === 'error'
        ? DRIVE_EXPORT_ERROR_RETRY_THRESHOLD_MS
        : DRIVE_EXPORT_STUCK_EXPORTING_THRESHOLD_MS;

    if (now - updatedAtMs < threshold) {
      result.skipped++;
      continue; // まだ猶予期間内(直近の失敗/実行中の可能性)
    }

    try {
      // eslint-disable-next-line no-await-in-loop
      const claimed = await executeDriveExport(firestore, docSnapshot.id, exportDeps, status);
      if (claimed) {
        result.requeued++;
      } else {
        result.skipped++; // クレーム失敗(並行して他呼び出しが処理済み等)
      }
    } catch (error) {
      console.error(`[driveExportScheduled] requeue failed for ${docSnapshot.id}:`, error);
      result.skipped++;
    }
  }

  return result;
}

export const driveExportScheduled = onSchedule(
  {
    schedule: 'every 15 minutes',
    region: 'asia-northeast1',
    timeoutSeconds: 540,
    maxInstances: 1,
  },
  async () => {
    if (!(await isDriveExportEnabled(db))) {
      console.log('[driveExportScheduled] driveExport flag OFF, skipping');
      return;
    }

    const result = await sweepStuckDriveExports(db);
    console.log(
      `[driveExportScheduled] completed: requeued=${result.requeued}, skipped=${result.skipped}`
    );
  }
);
