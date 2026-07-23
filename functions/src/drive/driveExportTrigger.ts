/**
 * Google Drive エクスポート起動トリガー(ADR-0022 Decision 5/6)
 *
 * documentの`verified`がfalse→trueになった瞬間(確認ボタン押下)を検知し、
 * outboxパターン((フィールド不在) → exporting → exported/error)でexportDocument()を
 * 実行する。
 *
 * 自身のdrive系フィールド書戻しによる再発火は`justVerified`判定(立ち上がり
 * エッジのみ)で防ぎ、`driveExportStatus`の存在チェックで二重エンキューを防ぐ
 * (`functions/src/search/searchIndexer.ts`のハッシュ比較と同じ思想)。
 *
 * クレーム(フィールド不在→'exporting')・所有権トークン発行・exportDocument()実行・
 * エラー時の書戻しは全て`executeDriveExport.ts`に委譲する(手動/定期リトライと共有)。
 * クレームは`executeDriveExport.ts`内の単一のFirestoreトランザクションでアトミックに
 * 行われるため、同一docIdへのverified false→true書込みがほぼ同時に2回発生した場合
 * (確認ボタンの二重タップ等)も、片方のみがクレームに成功しexportDocument()を実行する。
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { getDriveExportGate } from '../utils/featureFlags';
import { executeDriveExport } from './executeDriveExport';
import type { ExportDocumentDeps } from './exportDocument';

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

  const { enabled, allowlist } = await getDriveExportGate(firestore);
  if (!enabled) {
    return; // Feature Flag OFF → 完全no-op(Drive API呼び出し・フィールド書込み一切なし)
  }

  // allowlist(settings/features.driveExportAllowlist)によるコントロールテスト時の
  // 巻き込み回避(Phase D/E再設計、Codex Finding1対応)。null(フィールド不在)は
  // 「制限なし」を意味し、既存の全展開挙動を保持する。空配列を含む配列が設定されて
  // いる場合はallowlistに含まれるdocIdのみexportを許可する(段階的展開のcanary用)。
  // sweep(driveExportScheduled.ts)・手動retry(retryDriveExport.ts)はこのallowlistの
  // 対象外(意図的、スコープはbackfillの--limitやadmin個別操作で制御する設計)。
  if (allowlist !== null && !allowlist.includes(docId)) {
    return;
  }

  // driveExportStatusが未設定(フィールド不在)のdocのみをexportingへクレームする。
  // 既にdriveExportStatusがある場合はexecuteDriveExport()の内部クレームが
  // 失敗しfalseを返す(二重エンキュー防止、ライブ状態で判定)。
  await executeDriveExport(firestore, docId, exportDeps, undefined);
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
