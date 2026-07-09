/**
 * detail/main サブコレクションの dual-read 解決ヘルパー (ADR-0018 Phase D, Issue #547)
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
 * Phase F (cleanup) で親フォールバックを除去し detail 単独読みに単純化する予定。
 */

import type { DocumentDetail } from '../../../shared/types';

export function resolveDetailFields(
  detailData: FirebaseFirestore.DocumentData | undefined,
  parentData: FirebaseFirestore.DocumentData
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
