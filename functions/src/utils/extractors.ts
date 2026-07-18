/**
 * 強化版情報抽出ユーティリティ
 *
 * Phase 6B: 情報抽出精度向上
 * - 書類名抽出強化（getBestMatchingDocumentName相当）
 * - 事業所名抽出強化（getBestMatchingOffice相当）
 * - 複数顧客候補抽出（getBestMatchingCustomerCandidates相当）
 * - 顧客エントリ保証（ensureCustomerEntries相当）
 *
 * 元GASの対応関数:
 * - getBestMatchingDocumentName_()
 * - getBestMatchingOffice_()
 * - getBestMatchingCustomerCandidates_()
 * - ensureCustomerEntries_()
 */

import {
  normalizeForMatching,
  normalizeTextEnhanced,
  convertFullWidthToHalfWidth,
  extractDateCandidates,
  selectMostReasonableDate,
  formatDateString,
  DateCandidate,
} from './textNormalizer';
import { similarityScore, SIMILARITY_THRESHOLDS } from './similarity';

// Re-export for use in other modules
export { normalizeForMatching } from './textNormalizer';

// #506: collision-based common short master 判定は shared/ に集約 (BE/FE/import-masters
// 全 write 経路で同等ロジックを共有して drift 防止)。再 export は既存 import 経路の
// 後方互換維持のため (functions/test/extractors.test.ts 等の import 先を変えずに済む)。
import {
  computeCommonShortMasters,
  COMMON_SHORT_LENGTH_THRESHOLD,
  COMMON_SHORT_COLLISION_THRESHOLD,
} from '../../../shared/officeMasterValidation';
export {
  computeCommonShortMasters,
  COMMON_SHORT_LENGTH_THRESHOLD,
  COMMON_SHORT_COLLISION_THRESHOLD,
};

/** 候補の最大数 */
const MAX_CANDIDATES = 10;

/** 最小スコア閾値 */
const MIN_SCORE_THRESHOLD = 70;

/** 施設タイプキーワード（汎用語判定にも使用） */
const FACILITY_TYPES = [
  'デイサービス',
  'ショートステイ',
  '訪問介護',
  '訪問看護',
  'グループホーム',
  '特別養護老人ホーム',
  '介護老人保健施設',
  '小規模多機能',
  '通所介護',
  '居宅介護支援',
];

/** マッチタイプ */
export type MatchType = 'exact' | 'partial' | 'fuzzy' | 'none';

/** 顧客候補 */
export interface CustomerCandidate {
  id: string;
  name: string;
  furigana?: string;
  score: number;
  matchType: MatchType;
  isDuplicate: boolean;
  pageNumbers?: number[];
  careManagerName?: string;
}

/** 書類抽出結果 */
export interface DocumentExtractionResult {
  documentType: string | null;
  category: string | null;
  score: number;
  matchType: MatchType;
  keywords: string[];
}

/** 事業所抽出結果 */
export interface OfficeExtractionResult {
  officeName: string | null;
  officeId?: string;
  score: number;
  matchType: MatchType;
}

/** 顧客抽出結果（複数候補対応） */
export interface CustomerExtractionResult {
  bestMatch: CustomerCandidate | null;
  candidates: CustomerCandidate[];
  hasMultipleCandidates: boolean;
  needsManualSelection: boolean;
}

/** 事業所候補 */
export interface OfficeCandidate {
  id: string;
  name: string;
  shortName?: string;
  score: number;
  matchType: MatchType;
  isDuplicate: boolean;
  pageNumbers?: number[];
}

/** 事業所抽出結果（複数候補対応） */
export interface OfficeExtractionResultWithCandidates {
  bestMatch: OfficeCandidate | null;
  candidates: OfficeCandidate[];
  hasMultipleCandidates: boolean;
  needsManualSelection: boolean;
}

/** 日付抽出結果 */
export interface DateExtractionResult {
  date: Date | null;
  formattedDate: string | null;
  source: string | null;
  pattern: string | null;
  confidence: number;
  allCandidates: DateCandidate[];
}

/** ファイル名から抽出した情報 */
export interface FilenameInfo {
  /** ファイル名のプレフィックス部分（-L1-などの前） */
  prefix: string;
  /** プレフィックスの種別 */
  prefixType: 'office_name' | 'phone_number' | 'document_id' | 'unknown';
  /** 正規化済みプレフィックス（マッチング用） */
  normalizedPrefix: string;
  /** 元のファイル名 */
  originalFilename: string;
}

/**
 * マスターデータ型定義 (#338 統合)
 *
 * 元々は本 extractors.ts で独自定義していたが、shared/types.ts の同名型と optionality が
 * 乖離し (shared 側 required / 本 module optional)、FE/BE で型互換が破綻していた。
 * Firestore 実態は optional 側なので、shared/types.ts を optional に寄せた上で本 module
 * は re-export のみ担う (型の単一ソース化)。BE 既存 import パスは維持される。
 */
import type {
  CustomerMaster,
  DocumentMaster,
  OfficeMaster,
} from '../../../shared/types';
export type { CustomerMaster, DocumentMaster, OfficeMaster };

/**
 * マスターデータ envelope (OCR + PDF split 両系列で共用)。
 * #343: pdfAnalyzer.ts は analyzer concern に閉じ、型は *Master element と同居させる。
 */
export interface MasterData {
  customers: CustomerMaster[];
  documents: DocumentMaster[];
  offices: OfficeMaster[];
}

/**
 * ファイル名から情報を抽出
 *
 * ファイル名パターン例:
 * - 西春内科在宅クリニック-L1-20260122101727.pdf → 事業所名
 * - 0529088423-L1-20260122104653.pdf → 電話/FAX番号
 * - DOC260122-L1-20260122101412.pdf → ドキュメントID
 *
 * @param filename ファイル名
 * @returns 抽出されたファイル名情報
 */
export function extractFilenameInfo(filename: string): FilenameInfo {
  if (!filename) {
    return {
      prefix: '',
      prefixType: 'unknown',
      normalizedPrefix: '',
      originalFilename: filename,
    };
  }

  // 拡張子を除去
  const baseName = filename.replace(/\.[^.]+$/, '');

  // -L1-, -L2- などのパターンを検出してプレフィックスを抽出。
  // fax gateway由来ファイル名は`{prefix}-L{レーン番号}-{YYYYMMDDHHMMSS}`形式(14桁タイムスタンプ
  // 必須、tokenizer.ts参照)のため、直後が14桁タイムスタンプでない場合は非fax由来の偶然一致と
  // みなしprefixを切り詰めない(Issue #686: 「見積書-L1000-final.pdf」等の誤マッチ防止)
  const match = baseName.match(/^(.+?)-L\d+-(\d{14})$/);
  let prefix = match ? match[1] : baseName;

  // 半角カナを全角に、全角数字を半角に正規化
  const normalizedPrefix = normalizeForMatching(prefix);

  // プレフィックスの種別を判定
  let prefixType: FilenameInfo['prefixType'] = 'unknown';

  // 数字のみの場合は電話/FAX番号
  if (/^[0-9]+$/.test(normalizedPrefix)) {
    prefixType = 'phone_number';
  }
  // DOCで始まる場合はドキュメントID
  else if (/^doc\d/i.test(normalizedPrefix)) {
    prefixType = 'document_id';
  }
  // 日本語を含む場合は事業所名（半角カナも対象。レガシーFAX機器はJIS X 0201制約で
  // 事業所名を半角カナ表記することがあるため、全角カナ・漢字・ひらがなと同様に
  // 「日本語テキスト」として扱う必要がある。/code-review medium指摘・実証済み:
  // 半角カナのみのプレフィックスがunknown型に誤分類され、tokenizer.ts側でbigram検索を
  // 失っていた）
  else if (/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF\uFF61-\uFF9F]/.test(prefix)) {
    prefixType = 'office_name';
  }

  return {
    prefix,
    prefixType,
    normalizedPrefix,
    originalFilename: filename,
  };
}

/**
 * 書類名を抽出（強化版）
 *
 * 元GAS: getBestMatchingDocumentName_()
 *
 * 改善点:
 * - 前処理にtextNormalizerを使用
 * - キーワードベースのマッチング追加
 * - 先頭部分優先の重み付け
 *
 * @param ocrText OCR結果テキスト
 * @param documentMasters 書類マスターリスト
 * @param options オプション
 */
/**
 * 書類種別抽出の既定検索範囲(先頭何文字を対象にするか)。arbitrateDocumentType
 * （本ファイル後方）が候補文字列の再照合でも同じ位置制約を維持するために
 * 定数として共有する。
 */
const DOCUMENT_TYPE_DEFAULT_SEARCH_RANGE = 300;

export function extractDocumentTypeEnhanced(
  ocrText: string,
  documentMasters: DocumentMaster[],
  options: {
    searchRange?: number;
    minScore?: number;
  } = {}
): DocumentExtractionResult {
  const {
    searchRange = DOCUMENT_TYPE_DEFAULT_SEARCH_RANGE,
    minScore = SIMILARITY_THRESHOLDS.DOCUMENT_THRESHOLD,
  } = options;

  if (!ocrText || documentMasters.length === 0) {
    return { documentType: null, category: null, score: 0, matchType: 'none', keywords: [] };
  }

  // 前処理: 全角→半角、正規化
  const normalizedText = normalizeTextEnhanced(ocrText);
  const searchText = normalizedText.slice(0, searchRange);
  const matchingText = normalizeForMatching(searchText);

  let bestResult: DocumentExtractionResult = {
    documentType: null,
    category: null,
    score: 0,
    matchType: 'none',
    keywords: [],
  };

  for (const doc of documentMasters) {
    const normalizedDocName = normalizeForMatching(doc.name);
    const matchedKeywords: string[] = [];
    let score = 0;
    let matchType: MatchType = 'none';

    // 1. 完全一致チェック
    if (matchingText.includes(normalizedDocName)) {
      score = 100;
      matchType = 'exact';
    }
    // 2. 部分一致チェック（書類名が3文字以上の場合）
    else if (normalizedDocName.length >= 3) {
      // 前方部分一致
      const prefixLength = Math.min(normalizedDocName.length, Math.floor(normalizedDocName.length * 0.8));
      if (matchingText.includes(normalizedDocName.slice(0, prefixLength))) {
        score = 90;
        matchType = 'partial';
      }
    }

    // 2.5. エイリアス（許容表記）での一致
    if (matchType === 'none' && doc.aliases && doc.aliases.length > 0) {
      for (const alias of doc.aliases) {
        const normalizedAlias = normalizeForMatching(alias);
        if (matchingText.includes(normalizedAlias)) {
          score = 98; // 正式名称一致に近いスコア
          matchType = 'exact';
          break;
        }
      }
    }

    // 3. キーワードマッチング
    if (doc.keywords && doc.keywords.length > 0) {
      for (const keyword of doc.keywords) {
        const normalizedKeyword = normalizeForMatching(keyword);
        if (matchingText.includes(normalizedKeyword)) {
          matchedKeywords.push(keyword);
        }
      }
      // キーワードマッチによるスコア加算（キーワードは強いシグナル）
      if (matchedKeywords.length > 0 && score < 90) {
        const keywordScore = Math.min(90, 75 + matchedKeywords.length * 10);
        if (keywordScore > score) {
          score = keywordScore;
          matchType = 'partial';
        }
      }
    }

    // 4. ファジーマッチ（上記でマッチしなかった場合）
    if (matchType === 'none' && normalizedDocName.length >= 2) {
      const fuzzyScore = similarityScore(matchingText.slice(0, normalizedDocName.length + 10), normalizedDocName);
      if (fuzzyScore >= minScore) {
        score = fuzzyScore;
        matchType = 'fuzzy';
      }
    }

    // ベストスコア更新
    if (score > bestResult.score) {
      bestResult = {
        documentType: doc.name,
        category: doc.category || null,
        score,
        matchType,
        keywords: matchedKeywords,
      };
    }
  }

  // 閾値チェック
  if (bestResult.score < minScore) {
    return { documentType: null, category: null, score: 0, matchType: 'none', keywords: [] };
  }

  return bestResult;
}

/**
 * 事業所名を抽出（強化版）
 *
 * 元GAS: getBestMatchingOffice_()
 *
 * 改善点:
 * - 前処理にtextNormalizerを使用
 * - 短縮名対応
 * - 住所・電話番号周辺の優先検索
 *
 * @param ocrText OCR結果テキスト
 * @param officeMasters 事業所マスターリスト
 * @param options オプション
 */
export function extractOfficeNameEnhanced(
  ocrText: string,
  officeMasters: OfficeMaster[],
  options: {
    minScore?: number;
  } = {}
): OfficeExtractionResult {
  const { minScore = SIMILARITY_THRESHOLDS.OFFICE_THRESHOLD } = options;

  if (!ocrText || officeMasters.length === 0) {
    return { officeName: null, score: 0, matchType: 'none' };
  }

  // 前処理
  const normalizedText = normalizeTextEnhanced(ocrText);
  const matchingText = normalizeForMatching(normalizedText);

  // #501 v2: マスター name 同士の substring 衝突から common short master を事前計算し
  // exact match path から除外する (legitimate な短マスターは collision なしで通過する)
  const commonShortIds = computeCommonShortMasters(officeMasters);

  let bestResult: OfficeExtractionResult = {
    officeName: null,
    score: 0,
    matchType: 'none',
  };

  for (const office of officeMasters) {
    // 正式名称でチェック
    const normalizedOfficeName = normalizeForMatching(office.name);
    let score = 0;
    let matchType: MatchType = 'none';
    const skipExactMatch = commonShortIds.has(office.id);

    // 完全一致 (正式名 / shortName) — #501 で common short master は exact path skip
    if (
      !skipExactMatch &&
      matchingText.includes(normalizedOfficeName)
    ) {
      score = 100;
      matchType = 'exact';
    }
    else if (office.shortName && !skipExactMatch) {
      const normalizedShortName = normalizeForMatching(office.shortName);
      if (matchingText.includes(normalizedShortName)) {
        score = 95;
        matchType = 'exact';
      }
    }

    // 部分一致（事業所名が4文字以上の場合）
    if (matchType === 'none' && normalizedOfficeName.length >= 4) {
      const prefixLength = Math.floor(normalizedOfficeName.length * 0.75);
      if (matchingText.includes(normalizedOfficeName.slice(0, prefixLength))) {
        score = 85;
        matchType = 'partial';
      }
    }

    // ファジーマッチ
    if (matchType === 'none') {
      // スライディングウィンドウで最良マッチを探す
      const windowSize = Math.min(normalizedOfficeName.length + 5, matchingText.length);
      for (let i = 0; i <= matchingText.length - windowSize; i++) {
        const window = matchingText.slice(i, i + windowSize);
        const fuzzyScore = similarityScore(window, normalizedOfficeName);
        if (fuzzyScore > score && fuzzyScore >= minScore) {
          score = fuzzyScore;
          matchType = 'fuzzy';
        }
      }
    }

    if (score > bestResult.score) {
      bestResult = {
        officeName: office.name,
        officeId: office.id,
        score,
        matchType,
      };
    }
  }

  // 閾値チェック
  if (bestResult.score < minScore) {
    return { officeName: null, score: 0, matchType: 'none' };
  }

  return bestResult;
}

/**
 * 複数顧客候補を抽出（強化版）
 *
 * 元GAS: getBestMatchingCustomerCandidates_()
 *
 * 改善点:
 * - 常に複数候補を返す（最大10件）
 * - ページ番号との紐付け
 * - マッチタイプの詳細記録
 * - 同姓同名フラグ考慮
 *
 * @param ocrText OCR結果テキスト
 * @param customerMasters 顧客マスターリスト
 * @param options オプション
 */
export function extractCustomerCandidates(
  ocrText: string,
  customerMasters: CustomerMaster[],
  options: {
    minScore?: number;
    maxCandidates?: number;
    pageNumber?: number;
  } = {}
): CustomerExtractionResult {
  const {
    minScore = MIN_SCORE_THRESHOLD,
    maxCandidates = MAX_CANDIDATES,
    pageNumber,
  } = options;

  if (!ocrText || customerMasters.length === 0) {
    return {
      bestMatch: null,
      candidates: [],
      hasMultipleCandidates: false,
      needsManualSelection: false,
    };
  }

  // 前処理
  const normalizedText = normalizeTextEnhanced(ocrText);
  const matchingText = normalizeForMatching(normalizedText);

  const candidates: CustomerCandidate[] = [];

  for (const customer of customerMasters) {
    const normalizedName = normalizeForMatching(customer.name);
    let score = 0;
    let matchType: MatchType = 'none';

    // 1. 完全一致
    if (matchingText.includes(normalizedName)) {
      score = 100;
      matchType = 'exact';
    }
    // 2. ふりがなでの一致
    else if (customer.furigana) {
      const normalizedFurigana = normalizeForMatching(customer.furigana);
      if (matchingText.includes(normalizedFurigana)) {
        score = 95;
        matchType = 'exact';
      }
    }

    // 2.5. エイリアス（許容表記）での一致
    if (matchType === 'none' && customer.aliases && customer.aliases.length > 0) {
      for (const alias of customer.aliases) {
        const normalizedAlias = normalizeForMatching(alias);
        if (matchingText.includes(normalizedAlias)) {
          score = 98; // 正式名称一致に近いスコア
          matchType = 'exact';
          break;
        }
      }
    }

    // 3. ファジーマッチ（類似度検索）
    // GAS版と同様：完全一致・ふりがな一致がない場合のみ類似度で判定
    if (matchType === 'none') {
      const windowSize = Math.min(normalizedName.length + 3, matchingText.length);
      for (let i = 0; i <= matchingText.length - windowSize; i++) {
        const window = matchingText.slice(i, i + windowSize);
        const fuzzyScore = similarityScore(window, normalizedName);
        if (fuzzyScore > score) {
          score = fuzzyScore;
          matchType = 'fuzzy';
        }
      }
    }

    // 閾値以上の場合、候補に追加
    if (score >= minScore) {
      candidates.push({
        id: customer.id,
        name: customer.name,
        furigana: customer.furigana,
        score,
        matchType,
        isDuplicate: customer.isDuplicate || false,
        pageNumbers: pageNumber !== undefined ? [pageNumber] : undefined,
        careManagerName: customer.careManagerName,
      });
    }
  }

  // スコア順にソート
  candidates.sort((a, b) => b.score - a.score);

  // 候補数制限
  const limitedCandidates = candidates.slice(0, maxCandidates);

  // 結果を構築
  const bestMatch = limitedCandidates.length > 0 ? limitedCandidates[0]! : null;
  const hasMultipleCandidates = limitedCandidates.length > 1;

  // 手動選択が必要かどうかの判定
  // - 同姓同名フラグがある場合
  // - 上位2件のスコア差が小さい場合（10ポイント以内）
  let needsManualSelection = false;
  if (bestMatch?.isDuplicate) {
    needsManualSelection = true;
  } else if (hasMultipleCandidates && limitedCandidates[1]) {
    const scoreDiff = bestMatch!.score - limitedCandidates[1].score;
    if (scoreDiff <= 10) {
      needsManualSelection = true;
    }
  }

  return {
    bestMatch,
    candidates: limitedCandidates,
    hasMultipleCandidates,
    needsManualSelection,
  };
}

/**
 * ページごとの顧客候補を集約
 *
 * 複数ページからの候補を統合し、重複を除去
 *
 * @param pageResults ページごとの抽出結果
 */
export function aggregateCustomerCandidates(
  pageResults: Array<{ pageNumber: number; result: CustomerExtractionResult }>
): CustomerExtractionResult {
  const aggregated = new Map<string, CustomerCandidate>();

  for (const { pageNumber, result } of pageResults) {
    for (const candidate of result.candidates) {
      const existing = aggregated.get(candidate.id);

      if (existing) {
        // 既存候補がある場合、スコアを比較して更新
        if (candidate.score > existing.score) {
          existing.score = candidate.score;
          existing.matchType = candidate.matchType;
        }
        // ページ番号を追加
        if (existing.pageNumbers && !existing.pageNumbers.includes(pageNumber)) {
          existing.pageNumbers.push(pageNumber);
        }
      } else {
        // 新規候補
        aggregated.set(candidate.id, {
          ...candidate,
          pageNumbers: [pageNumber],
        });
      }
    }
  }

  // スコア順にソート
  const candidates = Array.from(aggregated.values()).sort((a, b) => b.score - a.score);
  const limitedCandidates = candidates.slice(0, MAX_CANDIDATES);

  const bestMatch = limitedCandidates.length > 0 ? limitedCandidates[0]! : null;
  const hasMultipleCandidates = limitedCandidates.length > 1;

  let needsManualSelection = false;
  if (bestMatch?.isDuplicate) {
    needsManualSelection = true;
  } else if (hasMultipleCandidates && limitedCandidates[1]) {
    const scoreDiff = bestMatch!.score - limitedCandidates[1].score;
    if (scoreDiff <= 10) {
      needsManualSelection = true;
    }
  }

  return {
    bestMatch,
    candidates: limitedCandidates,
    hasMultipleCandidates,
    needsManualSelection,
  };
}

/**
 * 事業所候補を抽出（複数候補対応）
 *
 * 顧客同姓同名対応と同じパターンで事業所同名を処理
 * ファイル名情報も参考にしてマッチング精度を向上
 *
 * @param ocrText OCR結果テキスト
 * @param officeMasters 事業所マスターリスト
 * @param options オプション
 */

/**
 * テキストからキーワードを抽出
 * 事業所名のマッチングに使用
 *
 * @param text 対象テキスト
 * @returns キーワード配列
 */
function extractKeywordsForMatching(text: string): string[] {
  // 正規化
  const normalized = normalizeForMatching(text);

  // ノイズワードを除去
  const noiseWords = [
    '株式会社',
    '有限会社',
    '合同会社',
    '社会福祉法人',
    '医療法人',
    '一般社団法人',
    'npo法人',
    'ケアセンター',
    'センター',
    'サービス',
  ];

  let cleaned = normalized;
  for (const noise of noiseWords) {
    // normalizeForMatchingがー（長音）を除去するため、ノイズワードも同様に正規化してマッチさせる
    const normalizedNoise = normalizeForMatching(noise);
    cleaned = cleaned.replace(new RegExp(normalizedNoise.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '');
  }

  // キーワードに分割（連続する漢字・カタカナ・ひらがなを抽出）
  const keywords: string[] = [];

  // 地名パターン（〇〇市、〇〇区、〇〇町など）
  const locationPattern = /[一-龯ぁ-んァ-ヶ]+[市区町村]/g;
  const locations = cleaned.match(locationPattern) || [];
  keywords.push(...locations);

  // 施設タイプ（モジュールレベル定数を参照）
  const facilityTypes = FACILITY_TYPES;
  for (const ft of facilityTypes) {
    if (normalized.includes(normalizeForMatching(ft))) {
      keywords.push(normalizeForMatching(ft));
    }
  }

  // ブランド名・固有名詞（3文字以上の連続するカタカナ）
  // ノイズ除去後のテキストから抽出（「サービス」等の汎用語がキーワードになるのを防ぐ）
  const katakanaPattern = /[ァ-ヶー]{3,}/g;
  const katakanaMatches = cleaned.match(katakanaPattern) || [];
  keywords.push(...katakanaMatches);

  // 地名（連続する漢字で3文字以上）
  const kanjiPattern = /[一-龯]{3,}/g;
  const kanjiMatches = cleaned.match(kanjiPattern) || [];
  keywords.push(...kanjiMatches);

  // ひらがなの固有名詞（3文字以上の連続するひらがな）
  const hiraganaPattern = /[ぁ-ん]{3,}/g;
  const hiraganaMatches = cleaned.match(hiraganaPattern) || [];
  keywords.push(...hiraganaMatches);

  // 重複除去して返す
  return [...new Set(keywords)].filter((k) => k.length >= 2);
}

/**
 * キーワードベースの類似度スコアを計算
 * マッチ率とマッチした文字数の両方を考慮
 *
 * @param ocrText OCRテキスト
 * @param officeName 事業所名
 * @returns スコアオブジェクト
 */
function calculateKeywordMatchScore(
  ocrText: string,
  officeName: string
): { score: number; matchedLength: number } {
  const ocrKeywords = extractKeywordsForMatching(ocrText);
  const officeKeywords = extractKeywordsForMatching(officeName);

  if (officeKeywords.length === 0) {
    return { score: 0, matchedLength: 0 };
  }

  let matchedWeight = 0;
  let totalWeight = 0;
  let matchedLength = 0;

  const normalizedOcrText = normalizeForMatching(ocrText);

  for (const officeKw of officeKeywords) {
    // キーワードの長さに応じた重み（長いキーワードほど重要）
    const weight = Math.min(officeKw.length, 10);
    totalWeight += weight;

    // OCRテキストにキーワードが含まれるか
    if (normalizedOcrText.includes(officeKw)) {
      matchedWeight += weight;
      matchedLength += officeKw.length;
    } else {
      // 部分一致チェック（短すぎるサブストリングマッチを防ぐ）
      for (const ocrKw of ocrKeywords) {
        const shorter = Math.min(ocrKw.length, officeKw.length);
        const longer = Math.max(ocrKw.length, officeKw.length);
        const overlapRatio = shorter / longer;
        if ((ocrKw.includes(officeKw) || officeKw.includes(ocrKw)) && overlapRatio >= 0.65) {
          matchedWeight += weight * 0.8;
          matchedLength += Math.min(ocrKw.length, officeKw.length);
          break;
        }
      }
    }
  }

  // 施設タイプのみでマッチした場合はペナルティ（汎用語による誤判定防止）
  // 注意: [].every()はtrueを返すため、空配列チェックが必須
  if (matchedWeight > 0) {
    const facilityTypeSet = new Set(FACILITY_TYPES.map(normalizeForMatching));
    const matchedKeywordsInOcr = officeKeywords.filter(kw => normalizedOcrText.includes(kw));
    if (matchedKeywordsInOcr.length > 0 && matchedKeywordsInOcr.every(kw => facilityTypeSet.has(kw))) {
      matchedWeight = matchedWeight * 0.5;
    }
  }

  const score = totalWeight > 0 ? Math.round((matchedWeight / totalWeight) * 100) : 0;
  return { score, matchedLength };
}

export function extractOfficeCandidates(
  ocrText: string,
  officeMasters: OfficeMaster[],
  options: {
    minScore?: number;
    maxCandidates?: number;
    pageNumber?: number;
    filenameInfo?: FilenameInfo;
  } = {}
): OfficeExtractionResultWithCandidates {
  const {
    minScore = SIMILARITY_THRESHOLDS.OFFICE_THRESHOLD,
    maxCandidates = MAX_CANDIDATES,
    pageNumber,
    filenameInfo,
  } = options;

  if (!ocrText || officeMasters.length === 0) {
    return {
      bestMatch: null,
      candidates: [],
      hasMultipleCandidates: false,
      needsManualSelection: false,
    };
  }

  // 前処理
  const normalizedText = normalizeTextEnhanced(ocrText);
  const matchingText = normalizeForMatching(normalizedText);

  // #501 v2: マスター name 同士の substring 衝突から common short master を事前計算し
  // exact match path から除外する (legitimate な短マスターは collision なしで通過する)
  const commonShortIds = computeCommonShortMasters(officeMasters);

  // ファイル名プレフィックスの正規化（事業所名タイプの場合のみ使用）
  const useFilenameForMatching = filenameInfo && filenameInfo.prefixType === 'office_name';
  const filenamePrefix = useFilenameForMatching ? filenameInfo.normalizedPrefix : '';

  const candidates: OfficeCandidate[] = [];

  for (const office of officeMasters) {
    const normalizedOfficeName = normalizeForMatching(office.name);
    let score = 0;
    let matchType: MatchType = 'none';
    let filenameBoost = 0;
    const skipExactMatch = commonShortIds.has(office.id);

    // ファイル名マッチング（事業所名がファイル名に含まれる場合にボーナス）
    if (useFilenameForMatching && filenamePrefix) {
      // ファイル名プレフィックスと事業所名の類似度をチェック
      const filenameSimilarity = similarityScore(filenamePrefix, normalizedOfficeName);

      // ファイル名に事業所名が完全一致
      if (filenamePrefix.includes(normalizedOfficeName) || normalizedOfficeName.includes(filenamePrefix)) {
        filenameBoost = 15; // 大きなボーナス
      }
      // ファイル名と事業所名が高い類似度
      else if (filenameSimilarity >= 80) {
        filenameBoost = 10;
      }
      // 短縮名がファイル名に含まれる
      else if (office.shortName) {
        const normalizedShortName = normalizeForMatching(office.shortName);
        if (filenamePrefix.includes(normalizedShortName) || normalizedShortName.includes(filenamePrefix)) {
          filenameBoost = 12;
        }
      }
    }

    // 1-2.5: 完全一致 (正式名 / shortName / aliases)
    // #501 v2 で common short master (他マスター name の substring に頻出) は skip。
    // 1. 完全一致（正式名称）
    if (!skipExactMatch && matchingText.includes(normalizedOfficeName)) {
      score = 100;
      matchType = 'exact';
    }
    // 2. 短縮名での一致
    else if (office.shortName && !skipExactMatch) {
      const normalizedShortName = normalizeForMatching(office.shortName);
      if (matchingText.includes(normalizedShortName)) {
        score = 95;
        matchType = 'exact';
      }
    }

    // 2.5. エイリアス（許容表記）での一致
    if (matchType === 'none' && !skipExactMatch && office.aliases && office.aliases.length > 0) {
      for (const alias of office.aliases) {
        const normalizedAlias = normalizeForMatching(alias);
        if (matchingText.includes(normalizedAlias)) {
          score = 98; // 正式名称一致に近いスコア
          matchType = 'exact';
          break;
        }
      }
    }

    // 3. キーワードマッチング（事業所名の構成要素で照合）
    if (matchType === 'none') {
      const keywordResult = calculateKeywordMatchScore(ocrText, office.name);
      if (keywordResult.score >= 70) {
        // キーワードマッチスコアをベースにして、マッチした文字数でボーナス
        // マッチした文字数が多いほど信頼度が高い
        const baseScore = 80 + Math.floor((keywordResult.score - 70) / 5);
        // マッチ文字数ボーナス: 10文字ごとに1ポイント（最大10ポイント）
        const lengthBonus = Math.min(10, Math.floor(keywordResult.matchedLength / 3));
        score = Math.min(95, baseScore + lengthBonus);
        matchType = 'partial';
      }
    }

    // 4. 部分一致（事業所名が4文字以上の場合）
    // キーワードマッチングより低い優先度
    if (matchType === 'none' && normalizedOfficeName.length >= 4) {
      const prefixLength = Math.floor(normalizedOfficeName.length * 0.75);
      const prefix = normalizedOfficeName.slice(0, prefixLength);
      if (matchingText.includes(prefix)) {
        // マッチした文字数に応じてスコアを調整
        // 短いプレフィックスマッチは低いスコア
        const matchLengthRatio = prefix.length / normalizedOfficeName.length;
        score = Math.min(80, Math.floor(70 + matchLengthRatio * 10));
        matchType = 'partial';
      }
    }

    // 5. ファジーマッチ
    if (matchType === 'none') {
      const windowSize = Math.min(normalizedOfficeName.length + 5, matchingText.length);
      for (let i = 0; i <= matchingText.length - windowSize; i++) {
        const window = matchingText.slice(i, i + windowSize);
        const fuzzyScore = similarityScore(window, normalizedOfficeName);
        if (fuzzyScore > score) {
          score = fuzzyScore;
          matchType = 'fuzzy';
        }
      }
    }

    // ファイル名ボーナスを適用（スコアが閾値以上の場合のみ）
    // ファイル名だけでのマッチは避け、OCRでもある程度マッチした場合にブーストする
    if (score >= minScore - 10 && filenameBoost > 0) {
      score = Math.min(100, score + filenameBoost);
      // ファイル名ブーストでスコアが閾値を超えた場合のみ候補に
    }

    // 閾値以上の場合、候補に追加
    if (score >= minScore) {
      candidates.push({
        id: office.id,
        name: office.name,
        shortName: office.shortName,
        score,
        matchType,
        isDuplicate: office.isDuplicate || false,
        pageNumbers: pageNumber !== undefined ? [pageNumber] : undefined,
      });
    }
  }

  // スコア順にソート
  candidates.sort((a, b) => b.score - a.score);

  // 候補数制限
  const limitedCandidates = candidates.slice(0, maxCandidates);

  // 結果を構築
  const bestMatch = limitedCandidates.length > 0 ? limitedCandidates[0]! : null;
  const hasMultipleCandidates = limitedCandidates.length > 1;

  // 手動選択が必要かどうかの判定
  // - 同名フラグがある場合
  // - 上位2件のスコア差が小さい場合（10ポイント以内）
  let needsManualSelection = false;
  if (bestMatch?.isDuplicate) {
    needsManualSelection = true;
  } else if (hasMultipleCandidates && limitedCandidates[1]) {
    const scoreDiff = bestMatch!.score - limitedCandidates[1].score;
    if (scoreDiff <= 10) {
      needsManualSelection = true;
    }
  }

  return {
    bestMatch,
    candidates: limitedCandidates,
    hasMultipleCandidates,
    needsManualSelection,
  };
}

/**
 * ページごとの事業所候補を集約
 *
 * 複数ページからの候補を統合し、重複を除去
 * aggregateCustomerCandidatesと同じパターン
 *
 * @param pageResults ページごとの抽出結果
 */
export function aggregateOfficeCandidates(
  pageResults: Array<{ pageNumber: number; result: OfficeExtractionResultWithCandidates }>
): OfficeExtractionResultWithCandidates {
  const aggregated = new Map<string, OfficeCandidate>();

  for (const { pageNumber, result } of pageResults) {
    for (const candidate of result.candidates) {
      const existing = aggregated.get(candidate.id);

      if (existing) {
        // 既存候補がある場合、スコアを比較して更新
        if (candidate.score > existing.score) {
          existing.score = candidate.score;
          existing.matchType = candidate.matchType;
        }
        // ページ番号を追加
        if (existing.pageNumbers && !existing.pageNumbers.includes(pageNumber)) {
          existing.pageNumbers.push(pageNumber);
        }
      } else {
        // 新規候補
        aggregated.set(candidate.id, {
          ...candidate,
          pageNumbers: [pageNumber],
        });
      }
    }
  }

  // スコア順にソート
  const candidates = Array.from(aggregated.values()).sort((a, b) => b.score - a.score);
  const limitedCandidates = candidates.slice(0, MAX_CANDIDATES);

  const bestMatch = limitedCandidates.length > 0 ? limitedCandidates[0]! : null;
  const hasMultipleCandidates = limitedCandidates.length > 1;

  let needsManualSelection = false;
  if (bestMatch?.isDuplicate) {
    needsManualSelection = true;
  } else if (hasMultipleCandidates && limitedCandidates[1]) {
    const scoreDiff = bestMatch!.score - limitedCandidates[1].score;
    if (scoreDiff <= 10) {
      needsManualSelection = true;
    }
  }

  return {
    bestMatch,
    candidates: limitedCandidates,
    hasMultipleCandidates,
    needsManualSelection,
  };
}

/**
 * 日付を抽出（強化版）
 *
 * Phase 6Aで実装したtextNormalizerを活用
 * 1ページ目のテキストがある場合は、そこから「○年○月○日」形式を優先的に探す
 *
 * @param ocrText OCR結果テキスト（全体）
 * @param dateMarker 日付マーカー（例: "発行日"）
 * @param firstPageText 1ページ目のテキスト（オプション、指定時は優先）
 */
export function extractDateEnhanced(
  ocrText: string,
  dateMarker?: string,
  firstPageText?: string
): DateExtractionResult {
  if (!ocrText) {
    return {
      date: null,
      formattedDate: null,
      source: null,
      pattern: null,
      confidence: 0,
      allCandidates: [],
    };
  }

  // 1ページ目のテキストがある場合、そこから「○年○月○日」形式を優先的に探す
  if (firstPageText) {
    const normalizedFirstPage = convertFullWidthToHalfWidth(firstPageText);
    const firstPageCandidates = extractDateCandidates(normalizedFirstPage);

    // 1ページ目で「○年○月○日」形式（日まで指定）の日付を探す
    const fullDateCandidate = firstPageCandidates.find(
      (c) =>
        c.pattern === '令和年月日' ||
        c.pattern === '西暦年月日' ||
        c.pattern === '西暦スラッシュ' ||
        c.pattern === 'R略記' ||
        (c.pattern?.includes('年月日') && !c.pattern?.includes('年月分'))
    );

    if (fullDateCandidate) {
      // 1ページ目で完全な日付が見つかった場合、それを採用（ボーナス付き）
      const year = fullDateCandidate.date.getFullYear();
      const month = String(fullDateCandidate.date.getMonth() + 1).padStart(2, '0');
      const day = String(fullDateCandidate.date.getDate()).padStart(2, '0');
      const formattedDate = `${year}/${month}/${day}`;

      return {
        date: fullDateCandidate.date,
        formattedDate,
        source: fullDateCandidate.source,
        pattern: `${fullDateCandidate.pattern}(1頁目)`,
        confidence: Math.min(100, fullDateCandidate.confidence + 5), // 1ページ目ボーナス
        allCandidates: firstPageCandidates,
      };
    }
  }

  // 前処理
  const normalizedText = convertFullWidthToHalfWidth(ocrText);

  // 日付候補を抽出
  const candidates = extractDateCandidates(normalizedText);

  if (candidates.length === 0) {
    return {
      date: null,
      formattedDate: null,
      source: null,
      pattern: null,
      confidence: 0,
      allCandidates: [],
    };
  }

  // 最適な日付を選択
  const bestCandidate = selectMostReasonableDate(candidates, dateMarker, normalizedText);

  if (!bestCandidate) {
    return {
      date: null,
      formattedDate: null,
      source: null,
      pattern: null,
      confidence: 0,
      allCandidates: candidates,
    };
  }

  // フォーマット
  const year = bestCandidate.date.getFullYear();
  const month = String(bestCandidate.date.getMonth() + 1).padStart(2, '0');
  const day = String(bestCandidate.date.getDate()).padStart(2, '0');
  const formattedDate = `${year}/${month}/${day}`;

  return {
    date: bestCandidate.date,
    formattedDate,
    source: bestCandidate.source,
    pattern: bestCandidate.pattern,
    confidence: bestCandidate.confidence,
    allCandidates: candidates,
  };
}

/**
 * 顧客エントリ情報（Firestoreに保存される形式）
 */
export interface CustomerEntry {
  customerId: string;
  customerName: string;
  score: number;
  matchType: MatchType;
  isConfirmed: boolean;
  confirmedBy?: string;
  confirmedAt?: Date;
}

/**
 * 顧客エントリを保証
 *
 * 元GAS: ensureCustomerEntries_()
 *
 * 抽出結果からFirestoreに保存する顧客エントリを生成
 * - ベストマッチがあればそれを使用
 * - なければ「未確定」エントリを生成
 *
 * @param extractionResult 顧客抽出結果
 * @param documentId 対象ドキュメントID
 */
export function ensureCustomerEntry(
  extractionResult: CustomerExtractionResult,
  _documentId: string
): CustomerEntry | null {
  const { bestMatch } = extractionResult;

  if (bestMatch && bestMatch.score >= MIN_SCORE_THRESHOLD) {
    return {
      customerId: bestMatch.id,
      customerName: bestMatch.name,
      score: bestMatch.score,
      matchType: bestMatch.matchType,
      isConfirmed: !extractionResult.needsManualSelection,
    };
  }

  // マッチなしの場合はnullを返す（ドキュメント側で「未確定」として処理）
  return null;
}

/**
 * 全情報を一括抽出
 *
 * OCRテキストから書類名・事業所名・顧客名・日付を一括で抽出
 *
 * @param ocrText OCR結果テキスト
 * @param masters マスターデータ
 * @param options オプション
 */
export function extractAllInformation(
  ocrText: string,
  masters: {
    documents: DocumentMaster[];
    offices: OfficeMaster[];
    customers: CustomerMaster[];
  },
  options: {
    dateMarker?: string;
    pageNumber?: number;
  } = {}
): {
  document: DocumentExtractionResult;
  office: OfficeExtractionResult;
  customer: CustomerExtractionResult;
  date: DateExtractionResult;
} {
  return {
    document: extractDocumentTypeEnhanced(ocrText, masters.documents),
    office: extractOfficeNameEnhanced(ocrText, masters.offices),
    customer: extractCustomerCandidates(ocrText, masters.customers, {
      pageNumber: options.pageNumber,
    }),
    date: extractDateEnhanced(ocrText, options.dateMarker),
  };
}

/**
 * OCR突合arbitration（GOAL.md タスクC）
 *
 * 既存の全文ベース突合結果（本ファイル既存関数の出力）と、独立したGemini呼出し
 * （functions/src/ocr/ocrProcessor.ts の extractOcrCandidates()、タスクB実装済み）
 * が返す候補文字列を統合する。不変条件（GOAL.md）: 突合の精度劣化は一切禁止。
 *
 * 設計はCodexセカンドオピニオン（plan mode、session121）の指摘を反映した保守的な
 * ものになっている:
 * - 既存が何らかのマッチ済み（documentType: matchType!=='none' / officeName・
 *   customerName: bestMatch!==null / date: date!==null）なら、候補がどれだけ
 *   高スコアでも絶対に上書きしない
 * - 候補は既存関数へ再入力してマスター突合させるが、既存の全文とは
 *   searchRange・スライディングウィンドウの前提が異なり、fuzzy/partial一致は
 *   スコアインフレしやすいため、昇格対象はexact matchのみに限定する
 * - 候補はOCR全文内へのgrounding（逐語一致）が必須。文字化けした候補
 *   （タスクA/Bスパイクで実証: 「請求書」→「舅求書」等）を弾く安全弁
 */

/** arbitrationの結果、既存(全文ベース)結果と候補抽出結果のどちらを採用したかの由来情報 */
export interface ArbitrationProvenance {
  /** 'existing'=全文ベース結果を採用 / 'candidate'=AI候補抽出結果に昇格 */
  source: 'existing' | 'candidate';
  /** 候補文字列がOCR全文内にgrounding(逐語存在)されていたか。候補がnull/型崩れの場合はfalse */
  candidateGrounded: boolean;
}

export interface ArbitratedDocumentExtractionResult extends DocumentExtractionResult {
  provenance: ArbitrationProvenance;
}

export interface ArbitratedOfficeExtractionResult extends OfficeExtractionResultWithCandidates {
  provenance: ArbitrationProvenance;
}

export interface ArbitratedCustomerExtractionResult extends CustomerExtractionResult {
  provenance: ArbitrationProvenance;
}

export interface ArbitratedDateExtractionResult extends DateExtractionResult {
  provenance: ArbitrationProvenance;
}

/**
 * grounding判定で許容する候補文字列の最小文字数（正規化後）。1〜2文字等の極端に
 * 短い候補は、無関係な文脈に偶然出現しただけでも「grounded」と誤判定されるリスクが
 * 高いため拒否する（/code-review medium指摘・実証済み: 実サンプルの事業所shortName
 * 「ふじ」2文字が、顧客名「ふじたに」を含む無関係な文書全文で誤ってgrounded判定
 * され、exact match昇格してしまうケースを実機で再現）。
 */
const MIN_GROUNDING_LENGTH = 3;

/**
 * 候補文字列がOCR全文（またはその先頭searchRange文字）内に逐語的に存在するか
 * 判定する（grounding判定）。
 *
 * normalizeForMatchingで表記ゆれ（全角半角・長音等）は吸収するが、OCR特有の
 * 文字化め（誤字）までは吸収しない。文字化け候補を誤ってgroundedと判定すると
 * タスクA/Bのスパイクで実証された誤昇格リスクに直結するため、意図的に厳格。
 *
 * candidateが文字列でない場合（型崩れ）・正規化後にMIN_GROUNDING_LENGTH未満に
 * なる場合は必ずfalseを返す（後者は/code-review medium指摘・実証済みの誤昇格を
 * 防ぐガード）。
 *
 * searchRangeを指定した場合、fullTextの先頭searchRange文字（normalizeTextEnhanced
 * 適用後）のみを対象に判定する。既存のextractDocumentTypeEnhanced等が持つ位置
 * 制約（書類種別名は文書冒頭に出現するはず、という設計上の前提）を、候補文字列の
 * 再照合でも維持するために使う（/code-review medium指摘・実証済み: searchRange
 * 未適用のままだと、文書後方の無関係な言及が候補経由で誤ってexact match昇格した）。
 */
function isGroundedInText(candidate: string | null, fullText: string, searchRange?: number): boolean {
  if (typeof candidate !== 'string') return false;
  const normalizedCandidate = normalizeForMatching(candidate);
  if (normalizedCandidate.length < MIN_GROUNDING_LENGTH) return false;
  const targetText = searchRange !== undefined ? normalizeTextEnhanced(fullText).slice(0, searchRange) : fullText;
  const normalizedTargetText = normalizeForMatching(targetText);
  return normalizedTargetText.includes(normalizedCandidate);
}

/**
 * documentTypeのarbitration。既存の全文ベース結果がmatchType==='none'の場合
 * のみ、候補による昇格を検討する（既存に何らかのマッチがあれば絶対に上書きしない）。
 */
export function arbitrateDocumentType(
  existing: DocumentExtractionResult,
  candidate: string | null,
  documentMasters: DocumentMaster[],
  fullText: string
): ArbitratedDocumentExtractionResult {
  const candidateGrounded = isGroundedInText(candidate, fullText, DOCUMENT_TYPE_DEFAULT_SEARCH_RANGE);

  if (existing.matchType !== 'none') {
    return { ...existing, provenance: { source: 'existing', candidateGrounded } };
  }

  if (!candidateGrounded || typeof candidate !== 'string') {
    return { ...existing, provenance: { source: 'existing', candidateGrounded: false } };
  }

  const candidateResult = extractDocumentTypeEnhanced(candidate, documentMasters);
  if (candidateResult.matchType !== 'exact') {
    return { ...existing, provenance: { source: 'existing', candidateGrounded: true } };
  }

  // #501と同種のリスク対策: office系のみに実装されているcomputeCommonShortMasters
  // (短い/汎用的な名前が他マスターとの衝突で誤ってexact match対象になるのを防ぐ)を、
  // document系のexact match昇格にも適用する（/code-review medium指摘: customer/
  // document側にはこの防御がなく、#501で実際にoffice系675件を誤分類したのと同種の
  // 脆弱性がarbitrationの安全性の拠り所として温存されていた）。
  const commonShortIds = computeCommonShortMasters(
    documentMasters.map((d) => ({ id: d.id ?? d.name, name: d.name }))
  );
  const matchedMaster = documentMasters.find((d) => d.name === candidateResult.documentType);
  if (matchedMaster && commonShortIds.has(matchedMaster.id ?? matchedMaster.name)) {
    return { ...existing, provenance: { source: 'existing', candidateGrounded: true } };
  }

  return { ...candidateResult, provenance: { source: 'candidate', candidateGrounded: true } };
}

/**
 * officeNameのarbitration。既存の全文ベース結果のbestMatchがnullの場合のみ、
 * 候補による昇格を検討する（既存に何らかの候補があれば絶対に上書きしない）。
 *
 * 候補再照合には既存のextractOfficeCandidatesをそのまま使うため、#501対策の
 * computeCommonShortMasters/skipExactMatchが既にexact match判定に組み込まれて
 * おり、customer/documentと異なり追加のコリジョン防御は不要。
 */
export function arbitrateOfficeName(
  existing: OfficeExtractionResultWithCandidates,
  candidate: string | null,
  officeMasters: OfficeMaster[],
  fullText: string,
  options: { filenameInfo?: FilenameInfo } = {}
): ArbitratedOfficeExtractionResult {
  const candidateGrounded = isGroundedInText(candidate, fullText);

  if (existing.bestMatch !== null) {
    return { ...existing, provenance: { source: 'existing', candidateGrounded } };
  }

  if (!candidateGrounded || typeof candidate !== 'string') {
    return { ...existing, provenance: { source: 'existing', candidateGrounded: false } };
  }

  const candidateResult = extractOfficeCandidates(candidate, officeMasters, options);
  if (candidateResult.bestMatch?.matchType === 'exact') {
    return { ...candidateResult, provenance: { source: 'candidate', candidateGrounded: true } };
  }

  return { ...existing, provenance: { source: 'existing', candidateGrounded: true } };
}

/**
 * customerNameのarbitration。既存の全文ベース結果のbestMatchがnullの場合のみ、
 * 候補による昇格を検討する（既存に何らかの候補があれば絶対に上書きしない）。
 */
export function arbitrateCustomerName(
  existing: CustomerExtractionResult,
  candidate: string | null,
  customerMasters: CustomerMaster[],
  fullText: string
): ArbitratedCustomerExtractionResult {
  const candidateGrounded = isGroundedInText(candidate, fullText);

  if (existing.bestMatch !== null) {
    return { ...existing, provenance: { source: 'existing', candidateGrounded } };
  }

  if (!candidateGrounded || typeof candidate !== 'string') {
    return { ...existing, provenance: { source: 'existing', candidateGrounded: false } };
  }

  const candidateResult = extractCustomerCandidates(candidate, customerMasters);
  if (candidateResult.bestMatch?.matchType !== 'exact') {
    return { ...existing, provenance: { source: 'existing', candidateGrounded: true } };
  }

  // #501と同種のリスク対策: arbitrateDocumentTypeと同じ理由でcustomer系にも
  // computeCommonShortMastersによるコリジョン防御を適用する。
  const commonShortIds = computeCommonShortMasters(customerMasters);
  if (commonShortIds.has(candidateResult.bestMatch.id)) {
    return { ...existing, provenance: { source: 'existing', candidateGrounded: true } };
  }

  return { ...candidateResult, provenance: { source: 'candidate', candidateGrounded: true } };
}

/**
 * dateのarbitration。既存の全文ベース結果がdate===nullの場合のみ、候補による
 * 補完を検討する（既存に何らかの日付があれば絶対に上書きしない）。
 *
 * 既存のextractDateEnhanced()が持つdateMarker優先・1ページ目優先などの複雑な
 * 選択ロジックはここでは再現しない（Codexセカンドオピニオン指摘: 候補は
 * grounding済みの単一文字列でしかなく、複数候補間の選別ロジックを必要としない
 * ため、再現しようとすること自体が過剰設計と判断）。extractDateCandidatesは
 * confidence降順ソート済みのため、先頭候補をそのまま採用する。
 */
export function arbitrateDate(
  existing: DateExtractionResult,
  candidate: string | null,
  fullText: string
): ArbitratedDateExtractionResult {
  const candidateGrounded = isGroundedInText(candidate, fullText);

  if (existing.date !== null) {
    return { ...existing, provenance: { source: 'existing', candidateGrounded } };
  }

  if (!candidateGrounded || typeof candidate !== 'string') {
    return { ...existing, provenance: { source: 'existing', candidateGrounded: false } };
  }

  // Geminiは日付候補を「原文の書式のまま」返すため、OCR全文が全角表記であれば
  // 候補も全角のまま返る。extractDateCandidatesの正規表現は半角数字のみに
  // マッチするため、他の呼び出し箇所（extractDateEnhanced）と同様に事前の
  // 半角変換が必須（/code-review medium指摘・実証済み: 変換漏れにより全角日付が
  // 一切パースされず日付補完が機能しないバグを修正）。
  const dateCandidates = extractDateCandidates(convertFullWidthToHalfWidth(candidate));
  if (dateCandidates.length === 0) {
    return { ...existing, provenance: { source: 'existing', candidateGrounded: true } };
  }

  const best = dateCandidates[0]!;
  const formattedDate = formatDateString(best.date.getFullYear(), best.date.getMonth() + 1, best.date.getDate());

  return {
    date: best.date,
    formattedDate,
    source: best.source,
    pattern: `${best.pattern}(candidate)`,
    confidence: best.confidence,
    allCandidates: dateCandidates,
    provenance: { source: 'candidate', candidateGrounded: true },
  };
}
