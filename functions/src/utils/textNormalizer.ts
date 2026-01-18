/**
 * テキスト正規化ユーティリティ
 *
 * Phase 6A: 基盤強化
 * - 全角→半角変換
 * - テキスト正規化
 * - 日付候補抽出（複数候補対応）
 * - 和暦→西暦変換
 *
 * 元GAS関数からの移植:
 * - convertFullWidthToHalfWidth_()
 * - normalizeText_()
 * - extractRawDate_()
 * - convertEraToWesternYear_()
 */

/** 日付候補 */
export interface DateCandidate {
  date: Date;
  source: string; // マッチした元の文字列
  pattern: string; // マッチしたパターン名
  confidence: number; // 信頼度 (0-100)
}

/** 元号定義 */
const ERA_DEFINITIONS = {
  // 令和: 2019年5月1日〜
  R: { start: 2018, name: '令和', chars: ['R', 'r', '令和'] },
  // 平成: 1989年1月8日〜2019年4月30日
  H: { start: 1988, name: '平成', chars: ['H', 'h', '平成'] },
  // 昭和: 1926年12月25日〜1989年1月7日
  S: { start: 1925, name: '昭和', chars: ['S', 's', '昭和'] },
  // 大正: 1912年7月30日〜1926年12月24日
  T: { start: 1911, name: '大正', chars: ['T', 't', '大正'] },
} as const;

/**
 * 全角数字・英字を半角に変換
 *
 * @param str 変換対象文字列
 * @returns 半角変換後の文字列
 */
export function convertFullWidthToHalfWidth(str: string): string {
  if (!str) return '';

  return str
    // 全角数字 → 半角数字
    .replace(/[０-９]/g, (char) => {
      return String.fromCharCode(char.charCodeAt(0) - 0xfee0);
    })
    // 全角英字 → 半角英字
    .replace(/[Ａ-Ｚａ-ｚ]/g, (char) => {
      return String.fromCharCode(char.charCodeAt(0) - 0xfee0);
    })
    // 全角記号 → 半角記号
    .replace(/／/g, '/')
    .replace(/．/g, '.')
    .replace(/－/g, '-')
    .replace(/（/g, '(')
    .replace(/）/g, ')');
}

/**
 * テキストを正規化（強化版）
 *
 * @param text 正規化対象テキスト
 * @returns 正規化後のテキスト
 */
export function normalizeTextEnhanced(text: string): string {
  if (!text) return '';

  let normalized = text;

  // 1. 全角→半角変換
  normalized = convertFullWidthToHalfWidth(normalized);

  // 2. OCR誤読み補正
  normalized = normalized
    .replace(/[｜Il]/g, '1') // 縦棒やIやlを1に
    .replace(/[Oo]/g, '0') // Oやoを0に（数字コンテキストで）
    .replace(/[Ss]/g, '5'); // Sやsを5に（数字コンテキストで）
  // 注: 上記は日付抽出用の補正。一般テキストには適用しない場合は別関数に

  // 3. 空白正規化
  normalized = normalized
    .replace(/[\s\u3000]+/g, ' ') // 連続空白を1つに
    .trim();

  // 4. 小文字化（比較用）
  // 注: 元のケースが必要な場合はこの行をコメントアウト
  // normalized = normalized.toLowerCase();

  return normalized;
}

/**
 * マッチング用のテキスト正規化（より積極的な正規化）
 *
 * @param text 正規化対象テキスト
 * @returns 正規化後のテキスト
 */
export function normalizeForMatching(text: string): string {
  if (!text) return '';

  let normalized = convertFullWidthToHalfWidth(text);

  // 空白・記号を除去
  normalized = normalized
    .replace(/[\s\u3000]+/g, '') // 空白除去
    .replace(/[・．.。、，,]/g, '') // 句読点除去
    .replace(/[-－ー]/g, '') // ハイフン・長音除去
    .toLowerCase();

  return normalized;
}

/**
 * 和暦を西暦に変換
 *
 * @param eraChar 元号文字（R, H, S, T, 令和, 平成, 昭和, 大正 など）
 * @param eraYear 元号年
 * @returns 西暦年（無効な場合は -1）
 */
export function convertEraToWesternYear(eraChar: string, eraYear: number): number {
  if (!eraChar || eraYear < 1) {
    return -1;
  }

  const normalizedEra = eraChar.toUpperCase();

  // 元号を特定
  let startYear = -1;

  for (const [, def] of Object.entries(ERA_DEFINITIONS)) {
    if (def.chars.some((c) => normalizedEra.includes(c.toUpperCase()))) {
      startYear = def.start;
      break;
    }
  }

  if (startYear === -1) {
    return -1;
  }

  const adYear = eraYear + startYear;

  // 妥当性チェック（1900年〜現在+50年）
  const currentYear = new Date().getFullYear();
  if (adYear < 1900 || adYear > currentYear + 50) {
    return -1;
  }

  return adYear;
}

/**
 * 日付文字列をフォーマット
 *
 * @param year 年
 * @param month 月
 * @param day 日
 * @returns YYYY/MM/DD形式の文字列
 */
export function formatDateString(year: number, month: number, day: number): string {
  const y = String(year);
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${y}/${m}/${d}`;
}

/**
 * テキストから日付候補を抽出（複数候補対応）
 *
 * @param text 抽出対象テキスト
 * @param maxCandidates 最大候補数（デフォルト: 10）
 * @returns 日付候補リスト
 */
export function extractDateCandidates(text: string, maxCandidates: number = 10): DateCandidate[] {
  if (!text) return [];

  const candidates: DateCandidate[] = [];

  // === Phase 1: 元号パターン（最優先） ===

  // 令和X年Y月分（最重要）
  const reiwaMonthlyPattern = /令和(\d{1,2})年(\d{1,2})月分/g;
  let match: RegExpExecArray | null;

  while ((match = reiwaMonthlyPattern.exec(text)) !== null) {
    const eraYear = parseInt(match[1]!, 10);
    const month = parseInt(match[2]!, 10);
    const adYear = eraYear + 2018;

    if (isValidDate(adYear, month, 1)) {
      candidates.push({
        date: new Date(adYear, month - 1, 1),
        source: match[0],
        pattern: '令和年月分',
        confidence: 95,
      });
    }
  }

  // 令和X年Y月Z日
  const reiwaFullPattern = /令和(\d{1,2})年(\d{1,2})月(\d{1,2})日/g;
  while ((match = reiwaFullPattern.exec(text)) !== null) {
    const eraYear = parseInt(match[1]!, 10);
    const month = parseInt(match[2]!, 10);
    const day = parseInt(match[3]!, 10);
    const adYear = eraYear + 2018;

    if (isValidDate(adYear, month, day)) {
      candidates.push({
        date: new Date(adYear, month - 1, day),
        source: match[0],
        pattern: '令和年月日',
        confidence: 90,
      });
    }
  }

  // 令和X年Y月
  const reiwaMonthPattern = /令和(\d{1,2})年(\d{1,2})月(?!分)/g;
  while ((match = reiwaMonthPattern.exec(text)) !== null) {
    const eraYear = parseInt(match[1]!, 10);
    const month = parseInt(match[2]!, 10);
    const adYear = eraYear + 2018;

    if (isValidDate(adYear, month, 1)) {
      candidates.push({
        date: new Date(adYear, month - 1, 1),
        source: match[0],
        pattern: '令和年月',
        confidence: 85,
      });
    }
  }

  // 平成・昭和・大正パターン
  const eraPatterns = [
    { regex: /平成(\d{1,2})年(\d{1,2})月(\d{1,2})日/g, era: 'H', hasDay: true, confidence: 85 },
    { regex: /平成(\d{1,2})年(\d{1,2})月/g, era: 'H', hasDay: false, confidence: 80 },
    { regex: /昭和(\d{1,2})年(\d{1,2})月(\d{1,2})日/g, era: 'S', hasDay: true, confidence: 85 },
    { regex: /昭和(\d{1,2})年(\d{1,2})月/g, era: 'S', hasDay: false, confidence: 80 },
  ];

  for (const pattern of eraPatterns) {
    while ((match = pattern.regex.exec(text)) !== null) {
      const eraYear = parseInt(match[1]!, 10);
      const month = parseInt(match[2]!, 10);
      const day = pattern.hasDay ? parseInt(match[3]!, 10) : 1;
      const adYear = convertEraToWesternYear(pattern.era, eraYear);

      if (adYear > 0 && isValidDate(adYear, month, day)) {
        candidates.push({
          date: new Date(adYear, month - 1, day),
          source: match[0],
          pattern: `${ERA_DEFINITIONS[pattern.era as keyof typeof ERA_DEFINITIONS].name}${pattern.hasDay ? '年月日' : '年月'}`,
          confidence: pattern.confidence,
        });
      }
    }
  }

  // === Phase 2: 西暦パターン ===

  // YYYY年MM月DD日
  const fullDatePattern = /(\d{4})年(\d{1,2})月(\d{1,2})日/g;
  while ((match = fullDatePattern.exec(text)) !== null) {
    const year = parseInt(match[1]!, 10);
    const month = parseInt(match[2]!, 10);
    const day = parseInt(match[3]!, 10);

    if (isValidDate(year, month, day)) {
      candidates.push({
        date: new Date(year, month - 1, day),
        source: match[0],
        pattern: '西暦年月日',
        confidence: 90,
      });
    }
  }

  // YYYY/MM/DD or YYYY-MM-DD
  const slashDatePattern = /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/g;
  while ((match = slashDatePattern.exec(text)) !== null) {
    const year = parseInt(match[1]!, 10);
    const month = parseInt(match[2]!, 10);
    const day = parseInt(match[3]!, 10);

    if (isValidDate(year, month, day)) {
      candidates.push({
        date: new Date(year, month - 1, day),
        source: match[0],
        pattern: '西暦スラッシュ',
        confidence: 85,
      });
    }
  }

  // === Phase 3: 前処理後の再検索 ===
  const correctedText = convertFullWidthToHalfWidth(text)
    .replace(/[｜Il]/g, '1')
    .replace(/\s+/g, '');

  // R7.5.1 形式
  const shortEraPattern = /[Rr](\d{1,2})\.(\d{1,2})\.(\d{1,2})/g;
  while ((match = shortEraPattern.exec(correctedText)) !== null) {
    const eraYear = parseInt(match[1]!, 10);
    const month = parseInt(match[2]!, 10);
    const day = parseInt(match[3]!, 10);
    const adYear = eraYear + 2018;

    if (isValidDate(adYear, month, day)) {
      candidates.push({
        date: new Date(adYear, month - 1, day),
        source: match[0],
        pattern: 'R略記',
        confidence: 75,
      });
    }
  }

  // 重複除去（同じ日付は最も信頼度の高いものを残す）
  const uniqueCandidates = deduplicateCandidates(candidates);

  // 信頼度順にソート
  uniqueCandidates.sort((a, b) => b.confidence - a.confidence);

  return uniqueCandidates.slice(0, maxCandidates);
}

/**
 * 日付の妥当性チェック
 */
function isValidDate(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > new Date().getFullYear() + 10) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;

  // 月ごとの日数チェック
  const daysInMonth = new Date(year, month, 0).getDate();
  if (day > daysInMonth) return false;

  return true;
}

/**
 * 重複候補を除去
 */
function deduplicateCandidates(candidates: DateCandidate[]): DateCandidate[] {
  const seen = new Map<string, DateCandidate>();

  for (const candidate of candidates) {
    const key = candidate.date.toISOString().split('T')[0]!;

    if (!seen.has(key) || seen.get(key)!.confidence < candidate.confidence) {
      seen.set(key, candidate);
    }
  }

  return Array.from(seen.values());
}

/**
 * 最も妥当な日付を選択
 *
 * @param candidates 日付候補リスト
 * @param dateMarker 日付マーカー（オプション、例: "発行日"）
 * @param referenceText マーカー周辺のテキスト（オプション）
 * @returns 最適な日付候補（見つからない場合は null）
 */
export function selectMostReasonableDate(
  candidates: DateCandidate[],
  dateMarker?: string,
  referenceText?: string
): DateCandidate | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;

  // マーカーが指定されている場合、マーカー周辺の日付を優先
  if (dateMarker && referenceText) {
    const markerIndex = referenceText.indexOf(dateMarker);
    if (markerIndex !== -1) {
      const nearbyText = referenceText.slice(markerIndex, markerIndex + 50);

      for (const candidate of candidates) {
        if (nearbyText.includes(candidate.source)) {
          return candidate;
        }
      }
    }
  }

  // 未来日付を除外
  const now = new Date();
  const validCandidates = candidates.filter((c) => c.date <= now);

  if (validCandidates.length === 0) {
    // 全て未来日付の場合は、最も近い未来の日付を返す
    candidates.sort((a, b) => a.date.getTime() - b.date.getTime());
    return candidates[0]!;
  }

  // 信頼度でソート済みなので、最初の有効な候補を返す
  validCandidates.sort((a, b) => b.confidence - a.confidence);
  return validCandidates[0]!;
}
