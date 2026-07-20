/**
 * Google Drive エクスポート起動トリガー(ADR-0022 Decision 5/6)
 *
 * documentの`verified`がfalse→trueになった瞬間(確認ボタン押下)を検知し、
 * outboxパターン(pending → exporting → exported/error)でexportDocument()を実行する。
 *
 * 自身のdrive系フィールド書戻しによる再発火は`justVerified`判定(立ち上がり
 * エッジのみ)で防ぎ、`driveExportStatus`の存在チェックで二重エンキューを防ぐ
 * (`functions/src/search/searchIndexer.ts`のハッシュ比較と同じ思想)。
 *
 * `driveExportStatus`の存在チェックと`'pending'`書込みはFirestoreトランザクションで
 * アトミックに行う(`/code-review low`指摘対応)。CloudEventスナップショット時点の
 * 1回のみのチェックだと、同一docIdへのverified false→true書込みがほぼ同時に2回
 * 発生した場合(確認ボタンの二重タップ等)に両方が素通りしexportDocument()が並行実行
 * され得るため、トランザクション内でのライブ再読込み+書込みにより二重エンキューを
 * 完全に閉じる。
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { isDriveExportEnabled } from '../utils/featureFlags';
import { exportDocument, ExportDocumentDeps } from './exportDocument';

const db = admin.firestore();

/**
 * トリガーの状態遷移ロジック本体。`onDocumentWritten`のCloudEvent配管から
 * 独立させることでテスト容易性を確保する(`updateDocumentGroups.ts`の
 * `processDocumentAggregationEvent`と同型パターン)。
 */
export async function processDriveExportTrigger(
  firestore: admin.firestore.Firestore,
  docId: string,
  before: FirebaseFirestore.DocumentData | undefined,
  after: FirebaseFirestore.DocumentData | undefined,
  exportDeps: Partial<ExportDocumentDeps> = {}
): Promise<void> {
  if (!after) {
    return; // ドキュメント削除
  }

  const justVerified = before?.verified !== true && after.verified === true;
  if (!justVerified) {
    // 自身のdrive系フィールド書戻し等、verified以外の変更による再発火はここで抜ける
    return;
  }

  if (!(await isDriveExportEnabled(firestore))) {
    return; // Feature Flag OFF → 完全no-op(Drive API呼び出し・フィールド書込み一切なし)
  }

  const docRef = firestore.doc(`documents/${docId}`);

  // outboxマーカー永続化(クラッシュ回復用、driveExportScheduled.tsの再エンキュー対象になる)。
  // 「driveExportStatus未設定の確認」と「'pending'書込み」をトランザクションでアトミックに
  // 行うことで、同一docIdへのほぼ同時な2回のverified false→true書込みが両方とも
  // ガードを素通りしてexportDocument()を並行実行する二重エンキューを防ぐ。
  const claimed = await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists) {
      return false;
    }
    if (snap.data()?.driveExportStatus) {
      return false; // 既に処理中/済み(二重エンキュー防止、ライブ状態で判定)
    }
    tx.update(docRef, { driveExportStatus: 'pending' });
    return true;
  });

  if (!claimed) {
    return;
  }

  try {
    await docRef.update({ driveExportStatus: 'exporting' });
    await exportDocument(docId, exportDeps);
    // 成功時のdriveFileId/driveExportedAt/driveExportStatus:'exported'書戻しはexportDocument()の責務
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Drive export failed for document ${docId}: ${message}`);
    await docRef.update({
      driveExportStatus: 'error',
      driveExportError: message,
    });
  }
}

export const onDocumentWriteDriveExport = onDocumentWritten(
  {
    document: 'documents/{docId}',
    region: 'asia-northeast1',
    // Storage読出し + 複数階層のfind-or-create往復 + files.create を1回のトリガー実行内で
    // 完結させるため、デフォルト(60s)より余裕を持たせる。
    timeoutSeconds: 120,
  },
  async (event) => {
    const docId = event.params.docId;
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    await processDriveExportTrigger(db, docId, before, after);
  }
);
