/**
 * detail/main サブコレクションの dual-read ヘルパー (ADR-0018 Phase D, Issue #547)
 *
 * Phase D の読者切替は「detail優先 + 親フォールバック」の dual-read で行う:
 * - detail/main は Phase B (作成時dual-write) + Phase C (backfill、全環境verify PASS)
 *   で全docに存在するが、万一の欠落時も Phase E 完了までは親にデータが残存する
 *   ため、旧経路で動作を継続できる(ロールバック安全性)
 * - FE reprocess-clear (PR-D1 #598) は detail の ocrResult/pageResults を
 *   deleteField で消すため、「detail doc は存在するがフィールド不在」の形がある。
 *   フィールド単位で判定し、型が合う値のみ採用する
 * - detail の ocrResult='' (Storage offload済み / backfill由来) は有効値として
 *   そのまま返す(親へフォールバックしない — offload doc の真値は ''+ocrResultUrl)
 *
 * 既知の時間窓 (Phase D 展開手順で対処、impl-plan デプロイゲート):
 * PR-D1 未適用の旧FE (PWAキャッシュ残存) が親のみクリアした後 OCR が最終失敗すると
 * detail に旧コンテンツが残存し、detail優先読みがそれを配信しうる。ランタイムでの
 * stale 判定は「親不在 = 正常形」となる Phase E と非両立のため実装せず、環境ごとに
 * 「Hosting(PR-D1) 先行デプロイ → backfill --verify で stale=0 確認 → Functions」の
 * 展開順序で窓を閉じる。
 *
 * Phase F (cleanup) で親フォールバックを除去し detail 単独読みに単純化する予定。
 */

import type {
  DocumentData,
  DocumentReference,
  DocumentSnapshot,
  Firestore,
} from 'firebase-admin/firestore';
import type { DocumentDetail } from '../../../shared/types';

export function resolveDetailFields(
  detailData: DocumentData | undefined,
  parentData: DocumentData
): DocumentDetail {
  const resolved: DocumentDetail = {};
  if (typeof detailData?.ocrResult === 'string') {
    resolved.ocrResult = detailData.ocrResult;
  } else if (typeof parentData.ocrResult === 'string') {
    resolved.ocrResult = parentData.ocrResult;
  }
  if (Array.isArray(detailData?.pageResults)) {
    resolved.pageResults = detailData.pageResults;
  } else if (Array.isArray(parentData.pageResults)) {
    resolved.pageResults = parentData.pageResults;
  }
  return resolved;
}

/**
 * 親doc + detail/main を read-only transaction の tx.getAll で
 * 同一スナップショットとして読む (ADR-0018 Phase D #5/#6 + Codex/code-review 指摘反映)。
 *
 * 非トランザクションの db.getAll() は複数doc間のスナップショット一貫性を
 * 公式保証しない(BatchGetDocuments は transaction/readTime 指定時のみ一貫)ため、
 * dual-write 中の別処理が読取の間に commit すると「新しい親 + 古い detail」の
 * 裂けた組合せを読みうる。全読者で本ヘルパーの transactional paired-read に統一する。
 *
 * @param fieldMask 転送フィールドの絞り込み(親・detail の両方に適用)。
 *   detail/main は pageResults(ページ毎全文)を含む重量docのため、
 *   ocrResult しか使わない読者は必ず指定して egress を抑える (#547 の趣旨)
 */
export async function readDocWithDetail(
  db: Firestore,
  docRef: DocumentReference,
  fieldMask?: string[]
): Promise<[DocumentSnapshot, DocumentSnapshot]> {
  const detailRef = docRef.collection('detail').doc('main');
  const snaps = await db.runTransaction(
    async (tx) =>
      fieldMask
        ? tx.getAll(docRef, detailRef, { fieldMask })
        : tx.getAll(docRef, detailRef),
    { readOnly: true }
  );
  return [snaps[0], snaps[1]];
}
