/**
 * displayFileName 自動生成ユーティリティ (Issue #181 + #183)
 *
 * frontend / functions の両方で使用する純粋関数を shared モジュールに集約。
 * 命名規則: 書類名_事業所_日付_顧客名.pdf
 *
 * #183 (fix): OS 禁止文字 (/ \ : * ? " < > | と制御文字) をサニタイズして
 * Storage/OS/URL で問題になる文字を構造的に除去する。
 *
 * Issue 関連:
 * - #178 (Stage 1-3 displayFileName 自動生成の本体実装)
 * - #181 (本 PR): FE/BE 重複解消、shared 集約
 * - #183 (本 PR): 特殊文字サニタイズ追加
 */

interface DisplayFileNameInput {
  documentType?: string;
  customerName?: string;
  officeName?: string;
  fileDate?: string;
  extension?: string;
}

/** デフォルト値 (=情報なし) として扱う値 */
const DEFAULT_VALUES = new Set(['未判定', '不明顧客']);

/**
 * OS / Storage / URL で問題になる文字を `_` に置換する。
 *
 * 対象:
 * - Windows 禁止文字: `\ / : * ? " < > |`
 * - NUL + 制御文字: `\x00-\x1f`
 *
 * macOS / Linux ではスラッシュのみ禁止だが、クロスプラットフォーム互換で
 * Windows 禁止文字を全て対象にする。
 */
// eslint-disable-next-line no-control-regex
const SANITIZE_PATTERN = /[\\/:*?"<>|\x00-\x1f]/g;

function sanitize(value: string): string {
  return value.replace(SANITIZE_PATTERN, '_');
}

/**
 * メタ情報から displayFileName を生成する純粋関数
 *
 * @returns 生成されたファイル名。有効なメタ情報がない場合は null
 */
export function generateDisplayFileName(
  input: DisplayFileNameInput,
): string | null {
  const ext = input.extension ?? '.pdf';

  const parts: string[] = [];

  // 書類名
  if (input.documentType && !DEFAULT_VALUES.has(input.documentType)) {
    parts.push(sanitize(input.documentType));
  }

  // 事業所名
  if (input.officeName && !DEFAULT_VALUES.has(input.officeName)) {
    parts.push(sanitize(input.officeName));
  }

  // 日付 (スラッシュ・ハイフン除去して YYYYMMDD 形式に)
  // ※日付文字列はハイフン/スラッシュを剥がした後 8 桁数字になる前提。サニタイズ対象の
  //   禁止文字は含まれないはずだが、万一混入しても 8 桁数字でなければ parts に入らない。
  if (input.fileDate) {
    const dateStr = input.fileDate.replace(/[/-]/g, '');
    if (dateStr.length >= 8) {
      parts.push(dateStr.slice(0, 8));
    }
  }

  // 顧客名
  if (input.customerName && !DEFAULT_VALUES.has(input.customerName)) {
    parts.push(sanitize(input.customerName));
  }

  if (parts.length === 0) {
    return null;
  }

  // 日付のみでは識別不能 (例: 20260315.pdf) なので null を返す
  const hasNonDatePart = parts.some((p) => !/^\d{8}$/.test(p));
  if (!hasNonDatePart) {
    return null;
  }

  return parts.join('_') + sanitize(ext);
}
