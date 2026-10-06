/**
 * 要約の Firestore 書き込みペイロードのビルダー
 *
 * リファクタや typo で 3点セット書き込みが失われる回帰を pure function テストで検出可能にする。
 *
 * 関連経緯:
 * - #178 教訓: 派生フィールド (truncated/originalLength) を一括で書き込まないとFE側マッピングが破壊される
 * - ADR-0027 PR-E: 要約のGemini経路を撤去し、旧Gemini用のリクエストビルダーを削除した
 */

import type { SummaryField } from '../../../shared/types';

/**
 * Firestore documents/{docId}.summary に書き込む discriminated union ペイロード。
 *
 * #215 で旧フラット3フィールド (summary / summaryTruncated / summaryOriginalLength) を
 * 廃止し、不変条件 (truncated=true ⟹ originalLength 必須) を型レベル保証する
 * SummaryField ネスト型に統一。#178 教訓の「派生フィールドの書き込み漏れで
 * FE 表示が壊れる」問題は union の tag (truncated) で構造的に排除される。
 *
 * #258: CappedText と SummaryField を統合した結果、本関数は identity 化したが、
 * 「summary 書込前に必ず通る単一通過点」としての契約テスト保護目的で存続。
 * caller が直接書込にバイパスすると summaryWritePayloadContract.test.ts が検知。
 */
export function buildSummaryFields(summary: SummaryField): SummaryField {
  if (summary.truncated) {
    return {
      text: summary.text,
      truncated: true,
      originalLength: summary.originalLength,
    };
  }
  return { text: summary.text, truncated: false };
}
