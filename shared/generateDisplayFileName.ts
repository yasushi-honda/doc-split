/**
 * displayFileName 自動生成ユーティリティ
 *
 * frontend / functions の両方で使用する純粋関数を shared モジュールに集約。
 * 命名規則: 書類名_事業所_日付_顧客名.pdf
 *
 * 関連 Issue:
 * - #178: Stage 1-3 本体実装
 * - #181: FE/BE 重複解消、shared 集約
 * - #183: OS/Storage/URL 禁止文字のサニタイズ
 */

export interface DisplayFileNameInput {
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
 * - NUL/C0 制御文字: `\x00-\x1f` + DEL `\x7f` (クロスプラットフォーム互換)
 * - 対応する全角記号 (#335): `＼ ／ ： ＊ ？ ＂ ＜ ＞ ｜`
 *   OCR 抽出で全角記号が混入しても半角と同じ扱いにする。
 *
 * C1 制御文字 `\x80-\x9f` は UTF-8 multibyte の中間バイトと衝突するため対象外
 * (silent-failure-hunter 指摘、C0+DEL のみで実害を覆う)。
 */
// eslint-disable-next-line no-control-regex
const SANITIZE_PATTERN =
  /[\\/:*?"<>|\x00-\x1f\x7f\uFF02\uFF0A\uFF0F\uFF1A\uFF1C\uFF1E\uFF1F\uFF3C\uFF5C]/g;

/** サニタイズ結果が全て置換文字 `_` のみの場合は「情報ゼロ」として空文字を返す */
const REPLACEMENT_ONLY_PATTERN = /^_+$/;

function sanitize(value: string): string {
  const replaced = value.replace(SANITIZE_PATTERN, '_');
  return REPLACEMENT_ONLY_PATTERN.test(replaced) ? '' : replaced;
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

  // 書類名 / 事業所名 / 顧客名 はサニタイズ後に空文字になる可能性があるため pushValidPart で skip。
  // 例: customerName = '/////' → sanitize で '_____' → REPLACEMENT_ONLY_PATTERN で空文字化 → skip
  const pushValidPart = (raw?: string): void => {
    if (!raw || DEFAULT_VALUES.has(raw)) return;
    const sanitized = sanitize(raw);
    if (sanitized) parts.push(sanitized);
  };

  pushValidPart(input.documentType);
  pushValidPart(input.officeName);

  // 日付 (スラッシュ・ハイフン除去して YYYYMMDD 形式に)
  // ハイフン/スラッシュを剥がした後 8 桁数字になる前提。禁止文字が混入しても 8 桁数字でなければ
  // parts に入らないため、ここでの sanitize は不要。
  if (input.fileDate) {
    const dateStr = input.fileDate.replace(/[/-]/g, '');
    if (dateStr.length >= 8) {
      parts.push(dateStr.slice(0, 8));
    }
  }

  pushValidPart(input.customerName);

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
