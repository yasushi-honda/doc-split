/**
 * displayFileName 自動生成ユーティリティ
 *
 * #178 Stage 1: OCR完了時・PDF分割時にメタ情報から表示用ファイル名を生成
 * 命名規則: 書類名_事業所_日付_顧客名.pdf
 */

interface DisplayFileNameInput {
  documentType?: string;
  customerName?: string;
  officeName?: string;
  fileDate?: string;
  extension?: string;
}

/** デフォルト値（=情報なし）として扱う値 */
const DEFAULT_VALUES = new Set(['未判定', '不明顧客']);

/**
 * メタ情報から displayFileName を生成する純粋関数
 *
 * @returns 生成されたファイル名。有効なメタ情報がない場合は null
 */
export function generateDisplayFileName(input: DisplayFileNameInput): string | null {
  const ext = input.extension ?? '.pdf';

  const parts: string[] = [];

  // 書類名
  if (input.documentType && !DEFAULT_VALUES.has(input.documentType)) {
    parts.push(input.documentType);
  }

  // 事業所名
  if (input.officeName && !DEFAULT_VALUES.has(input.officeName)) {
    parts.push(input.officeName);
  }

  // 日付（スラッシュ・ハイフン除去して YYYYMMDD 形式に）
  if (input.fileDate) {
    const dateStr = input.fileDate.replace(/[\/-]/g, '');
    if (dateStr.length >= 8) {
      parts.push(dateStr.slice(0, 8));
    }
  }

  // 顧客名
  if (input.customerName && !DEFAULT_VALUES.has(input.customerName)) {
    parts.push(input.customerName);
  }

  if (parts.length === 0) {
    return null;
  }

  return parts.join('_') + ext;
}
