/**
 * かなユーティリティ
 * あかさたな分類・ふりがなソートの共通関数
 */

import type { CustomerMaster } from '@shared/types';

// ============================================
// 定数
// ============================================

/** あかさたな行の定義 */
export const KANA_ROWS = ['あ', 'か', 'さ', 'た', 'な', 'は', 'ま', 'や', 'ら', 'わ'] as const;

export type KanaRow = (typeof KANA_ROWS)[number];

/**
 * ひらがな→行マッピング
 * 清音・濁音・半濁音・小文字すべてを清音の行に分類
 */
const HIRAGANA_TO_ROW: Record<string, KanaRow> = {};

// あ行: あいうえお + 小文字
const A_ROW = 'ぁあぃいぅうぇえぉお';
// か行: かきくけこ + 濁音
const KA_ROW = 'かがきぎくぐけげこご';
// さ行: さしすせそ + 濁音
const SA_ROW = 'さざしじすずせぜそぞ';
// た行: たちつてと + 濁音 + 小文字っ
const TA_ROW = 'ただちぢっつづてでとど';
// な行
const NA_ROW = 'なにぬねの';
// は行: はひふへほ + 濁音・半濁音
const HA_ROW = 'はばぱひびぴふぶぷへべぺほぼぽ';
// ま行
const MA_ROW = 'まみむめも';
// や行 + 小文字
const YA_ROW = 'ゃやゅゆょよ';
// ら行
const RA_ROW = 'らりるれろ';
// わ行 + ゐゑをん
const WA_ROW = 'ゎわゐゑをん';

const ROW_DEFS: Array<[string, KanaRow]> = [
  [A_ROW, 'あ'],
  [KA_ROW, 'か'],
  [SA_ROW, 'さ'],
  [TA_ROW, 'た'],
  [NA_ROW, 'な'],
  [HA_ROW, 'は'],
  [MA_ROW, 'ま'],
  [YA_ROW, 'や'],
  [RA_ROW, 'ら'],
  [WA_ROW, 'わ'],
];

for (const [chars, row] of ROW_DEFS) {
  for (const ch of chars) {
    HIRAGANA_TO_ROW[ch] = row;
  }
}

// ============================================
// 関数
// ============================================

/**
 * カタカナをひらがなに変換
 */
function katakanaToHiragana(char: string): string {
  const code = char.charCodeAt(0);
  // カタカナ範囲: 0x30A0-0x30FF → ひらがな: 0x3040-0x309F (差分: 0x60)
  if (code >= 0x30a1 && code <= 0x30f6) {
    return String.fromCharCode(code - 0x60);
  }
  // 特殊: ヮ(0x30EE)→ゎ, ヰ(0x30F0)→ゐ, ヱ(0x30F1)→ゑ, ヲ(0x30F2)→を, ン(0x30F3)→ん
  if (code === 0x30ee) return 'ゎ';
  if (code === 0x30f0) return 'ゐ';
  if (code === 0x30f1) return 'ゑ';
  if (code === 0x30f2) return 'を';
  if (code === 0x30f3) return 'ん';
  return char;
}

/**
 * 文字の先頭からあかさたな行を判定
 * @returns 行（'あ'〜'わ'）またはnull（かな以外）
 */
export function getKanaRow(text: string): KanaRow | null {
  if (!text) return null;
  const firstChar = text[0];
  // ひらがなチェック
  const row = HIRAGANA_TO_ROW[firstChar];
  if (row) return row;
  // カタカナ→ひらがな変換してチェック
  const hiragana = katakanaToHiragana(firstChar);
  return HIRAGANA_TO_ROW[hiragana] ?? null;
}

/**
 * 顧客マスターから名前→ふりがなのMapを構築
 */
export function buildFuriganaMap(customers: CustomerMaster[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const customer of customers) {
    map.set(customer.name, customer.furigana);
  }
  return map;
}

/**
 * グループをふりがな順（あいうえお順）にソート
 * ふりがながないグループは末尾に配置
 */
export function sortGroupsByFurigana<T extends { displayName: string }>(
  groups: T[],
  furiganaMap: Map<string, string>
): T[] {
  return [...groups].sort((a, b) => {
    const readingA = furiganaMap.get(a.displayName) ?? '';
    const readingB = furiganaMap.get(b.displayName) ?? '';
    // ふりがながある方を優先
    if (readingA && !readingB) return -1;
    if (!readingA && readingB) return 1;
    if (!readingA && !readingB) {
      // 両方なし → displayNameで比較
      return a.displayName.localeCompare(b.displayName, 'ja');
    }
    // 両方あり → ふりがなで比較
    return readingA.localeCompare(readingB, 'ja');
  });
}

/**
 * あかさたな行でグループをフィルター
 * @param kanaRow null = 全て表示
 */
export function filterGroupsByKanaRow<T extends { displayName: string }>(
  groups: T[],
  kanaRow: KanaRow | null,
  furiganaMap: Map<string, string>
): T[] {
  if (kanaRow === null) return groups;

  return groups.filter((group) => {
    const reading = furiganaMap.get(group.displayName);
    if (!reading) return false;
    return getKanaRow(reading) === kanaRow;
  });
}
