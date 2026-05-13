/**
 * 暗号学的ハッシュ計算の共通 helper。
 *
 * 同一の `crypto.createHash('sha256').update(buffer).digest('hex')` idiom が
 * functions/scripts/test に 5+ 箇所散在していたため統一する (Issue #445 PR-D2 review)。
 *
 * 使用箇所: functions/src/pdf/pdfOperations.ts (source/derived sha256),
 * functions/src/pdf/provenance.ts (型整合の正規化), scripts/lib/parentPdfProvenance.ts
 * (将来 migrate 予定), pdf-feature-survey.ts (将来 migrate 予定)。
 */

import * as crypto from 'crypto';

/**
 * バッファの SHA-256 を 16 進文字列で返す。Uint8Array / Buffer の両方を受け取れる
 * (`pdf-lib` の `PDFDocument.save()` は Uint8Array を返すため、Buffer 化せずに
 * 直接渡して 2 回の Buffer 化 allocation を避ける)。
 */
export function sha256Hex(data: Uint8Array | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}
