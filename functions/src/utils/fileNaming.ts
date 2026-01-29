/**
 * ファイル名生成ユーティリティ
 *
 * Phase 6C: ファイル名生成
 * - 顧客エントリ分析（analyzeCustomerEntries相当）
 * - 最適ファイル名生成（generateOptimalFileName相当）
 * - ファイル名サニタイズ（sanitizeFileName相当）
 *
 * 命名ルール（元GAS踏襲）:
 * - 1顧客: 「書類名_事業所_日付_顧客名」
 * - 複数顧客（同属性）: 「書類名_事業所_日付_顧客A_顧客B」
 * - 複数顧客（異属性）: ファイル分割推奨
 */

import { convertFullWidthToHalfWidth } from './textNormalizer';

/** ファイル名の最大長（拡張子除く） */
const MAX_FILENAME_LENGTH = 100;

/** 顧客名の最大連結数 */
const MAX_CUSTOMER_NAMES = 3;

/** 禁止文字パターン（ファイルシステム互換） */
const FORBIDDEN_CHARS_PATTERN = /[<>:"/\\|?*\x00-\x1f]/g;

/** 顧客属性 */
export interface CustomerAttribute {
  id: string;
  name: string;
  officeId?: string;
  careManagerId?: string;
}

/** 顧客エントリ分析結果 */
export interface CustomerAnalysisResult {
  /** 顧客数 */
  count: number;
  /** 単一顧客かどうか */
  isSingle: boolean;
  /** 同一属性かどうか（事業所・ケアマネが同じ） */
  isSameAttribute: boolean;
  /** 属性の一致状況 */
  attributeMatch: {
    office: boolean;
    careManager: boolean;
  };
  /** 分割推奨かどうか */
  shouldSplit: boolean;
  /** 分割推奨理由 */
  splitReason?: string;
  /** 代表顧客 */
  primaryCustomer?: CustomerAttribute;
  /** 全顧客リスト */
  customers: CustomerAttribute[];
}

/** ファイル名生成オプション */
export interface FileNameOptions {
  /** 書類名 */
  documentType?: string;
  /** 事業所名 */
  officeName?: string;
  /** 日付（YYYY/MM/DD形式） */
  date?: string;
  /** 顧客リスト */
  customers?: CustomerAttribute[];
  /** ドキュメントID（短縮形で付与） */
  documentId?: string;
  /** 拡張子（デフォルト: .pdf） */
  extension?: string;
  /** 最大長（デフォルト: 100） */
  maxLength?: number;
}

/** ファイル名生成結果 */
export interface FileNameResult {
  /** 生成されたファイル名 */
  fileName: string;
  /** 元のファイル名（サニタイズ前） */
  originalFileName: string;
  /** 切り詰められたかどうか */
  wasTruncated: boolean;
  /** 分割推奨かどうか */
  shouldSplit: boolean;
  /** 分割推奨理由 */
  splitReason?: string;
  /** 含まれる顧客名 */
  includedCustomers: string[];
  /** 省略された顧客名 */
  omittedCustomers: string[];
}

/**
 * 顧客エントリを分析
 *
 * 元GAS: analyzeCustomerEntries_()
 *
 * 複数顧客の属性（事業所・ケアマネ）が一致するかを分析し、
 * ファイル分割が必要かどうかを判定
 *
 * @param customers 顧客リスト
 */
export function analyzeCustomerEntries(customers: CustomerAttribute[]): CustomerAnalysisResult {
  if (!customers || customers.length === 0) {
    return {
      count: 0,
      isSingle: false,
      isSameAttribute: true,
      attributeMatch: { office: true, careManager: true },
      shouldSplit: false,
      customers: [],
    };
  }

  if (customers.length === 1) {
    return {
      count: 1,
      isSingle: true,
      isSameAttribute: true,
      attributeMatch: { office: true, careManager: true },
      shouldSplit: false,
      primaryCustomer: customers[0],
      customers,
    };
  }

  // 属性の一致チェック
  const firstCustomer = customers[0]!;
  let officeMatch = true;
  let careManagerMatch = true;

  for (let i = 1; i < customers.length; i++) {
    const customer = customers[i]!;

    // 事業所IDの一致チェック
    if (firstCustomer.officeId && customer.officeId) {
      if (firstCustomer.officeId !== customer.officeId) {
        officeMatch = false;
      }
    }

    // ケアマネIDの一致チェック
    if (firstCustomer.careManagerId && customer.careManagerId) {
      if (firstCustomer.careManagerId !== customer.careManagerId) {
        careManagerMatch = false;
      }
    }
  }

  const isSameAttribute = officeMatch && careManagerMatch;

  // 分割推奨の判定
  // - 顧客数が多い（4人以上）
  // - 属性が異なる
  let shouldSplit = false;
  let splitReason: string | undefined;

  if (!isSameAttribute) {
    shouldSplit = true;
    if (!officeMatch && !careManagerMatch) {
      splitReason = '顧客の事業所・ケアマネが異なります';
    } else if (!officeMatch) {
      splitReason = '顧客の事業所が異なります';
    } else {
      splitReason = '顧客のケアマネが異なります';
    }
  } else if (customers.length > MAX_CUSTOMER_NAMES) {
    shouldSplit = true;
    splitReason = `顧客数が${MAX_CUSTOMER_NAMES}名を超えています（${customers.length}名）`;
  }

  return {
    count: customers.length,
    isSingle: false,
    isSameAttribute,
    attributeMatch: { office: officeMatch, careManager: careManagerMatch },
    shouldSplit,
    splitReason,
    primaryCustomer: firstCustomer,
    customers,
  };
}

/**
 * ファイル名を簡易サニタイズ（ストレージパス用）
 *
 * Cloud Storage保存時のファイル名サニタイズに使用
 * - 禁止文字をアンダースコアに置換
 * - 空白をアンダースコアに置換
 * - 連続アンダースコアを統一
 * - 最大200文字に切り詰め
 *
 * @param filename ファイル名
 * @param maxLength 最大長（デフォルト: 200）
 */
export function sanitizeFilenameForStorage(filename: string, maxLength: number = 200): string {
  return filename
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, maxLength);
}

/**
 * ファイル名をサニタイズ
 *
 * 元GAS: sanitizeFileName_()
 *
 * - 禁止文字を除去
 * - 全角英数字を半角に変換
 * - 連続アンダースコアを統一
 * - 最大長制限
 *
 * @param fileName ファイル名
 * @param maxLength 最大長（デフォルト: 100）
 */
export function sanitizeFileName(fileName: string, maxLength: number = MAX_FILENAME_LENGTH): string {
  if (!fileName) return '';

  let sanitized = fileName;

  // 1. 全角→半角変換
  sanitized = convertFullWidthToHalfWidth(sanitized);

  // 2. 禁止文字を除去
  sanitized = sanitized.replace(FORBIDDEN_CHARS_PATTERN, '');

  // 3. 先頭・末尾の空白・アンダースコアを除去
  sanitized = sanitized.replace(/^[\s_]+|[\s_]+$/g, '');

  // 4. 連続アンダースコアを単一に
  sanitized = sanitized.replace(/_+/g, '_');

  // 5. 空白をアンダースコアに
  sanitized = sanitized.replace(/\s+/g, '_');

  // 6. 長さ制限（単語の途中で切らないよう調整）
  if (sanitized.length > maxLength) {
    sanitized = sanitized.slice(0, maxLength);
    // 末尾がアンダースコアでない場合、最後のアンダースコアまで切り詰め
    const lastUnderscore = sanitized.lastIndexOf('_');
    if (lastUnderscore > maxLength * 0.7) {
      sanitized = sanitized.slice(0, lastUnderscore);
    }
  }

  return sanitized;
}

/**
 * 日付文字列をファイル名用にフォーマット
 *
 * @param dateStr 日付文字列（YYYY/MM/DD形式）
 * @returns YYYYMMDD形式
 */
export function formatDateForFileName(dateStr: string): string {
  if (!dateStr) return '';

  // スラッシュやハイフンを除去
  return dateStr.replace(/[\/-]/g, '');
}

/**
 * ドキュメントIDを短縮形に変換
 *
 * @param documentId ドキュメントID
 * @param length 短縮長（デフォルト: 6）
 */
export function shortenDocumentId(documentId: string, length: number = 6): string {
  if (!documentId) return '';
  return documentId.slice(0, length);
}

/**
 * 最適なファイル名を生成
 *
 * 元GAS: generateOptimalFileName_()
 *
 * 命名ルール:
 * - 基本形式: 「書類名_事業所_日付_顧客名」
 * - 複数顧客（同属性）: 「書類名_事業所_日付_顧客A_顧客B」
 * - 複数顧客（異属性）: 分割推奨フラグをセット
 *
 * @param options ファイル名生成オプション
 */
export function generateOptimalFileName(options: FileNameOptions): FileNameResult {
  const {
    documentType,
    officeName,
    date,
    customers = [],
    documentId,
    extension = '.pdf',
    maxLength = MAX_FILENAME_LENGTH,
  } = options;

  // 顧客分析
  const analysis = analyzeCustomerEntries(customers);

  // ファイル名パーツを構築
  const parts: string[] = [];

  // 1. 書類名
  if (documentType) {
    parts.push(documentType);
  }

  // 2. 事業所名
  if (officeName) {
    parts.push(officeName);
  }

  // 3. 日付
  if (date) {
    parts.push(formatDateForFileName(date));
  }

  // 4. 顧客名（最大MAX_CUSTOMER_NAMES名まで）
  const includedCustomers: string[] = [];
  const omittedCustomers: string[] = [];

  for (let i = 0; i < customers.length; i++) {
    if (i < MAX_CUSTOMER_NAMES) {
      includedCustomers.push(customers[i]!.name);
      parts.push(customers[i]!.name);
    } else {
      omittedCustomers.push(customers[i]!.name);
    }
  }

  // 5. 省略された顧客がある場合は「他X名」を追加
  if (omittedCustomers.length > 0) {
    parts.push(`他${omittedCustomers.length}名`);
  }

  // 6. ドキュメントID（短縮形）
  if (documentId) {
    parts.push(shortenDocumentId(documentId));
  }

  // パーツを結合
  const originalFileName = parts.join('_') + extension;

  // サニタイズ
  const baseFileName = sanitizeFileName(parts.join('_'), maxLength);
  const fileName = baseFileName + extension;

  return {
    fileName,
    originalFileName,
    wasTruncated: baseFileName.length < parts.join('_').length,
    shouldSplit: analysis.shouldSplit,
    splitReason: analysis.splitReason,
    includedCustomers,
    omittedCustomers,
  };
}

/**
 * ファイル名の衝突を回避するためのサフィックスを生成
 *
 * @param baseName ベースファイル名（拡張子除く）
 * @param extension 拡張子
 * @param existingNames 既存のファイル名リスト
 */
export function generateUniqueFileName(
  baseName: string,
  extension: string,
  existingNames: string[]
): string {
  const fullName = baseName + extension;

  if (!existingNames.includes(fullName)) {
    return fullName;
  }

  // 衝突回避のためサフィックスを追加
  let counter = 1;
  while (existingNames.includes(`${baseName}_${counter}${extension}`)) {
    counter++;
    if (counter > 100) {
      // 無限ループ防止
      break;
    }
  }

  return `${baseName}_${counter}${extension}`;
}

/**
 * 分割後のファイル名を生成
 *
 * PDF分割時に各セグメントのファイル名を生成
 *
 * @param baseOptions 基本オプション
 * @param segments セグメント情報
 */
export function generateSplitFileNames(
  baseOptions: Omit<FileNameOptions, 'customers'>,
  segments: Array<{
    customers: CustomerAttribute[];
    pageRange: { start: number; end: number };
  }>
): FileNameResult[] {
  return segments.map((segment, index) => {
    const result = generateOptimalFileName({
      ...baseOptions,
      customers: segment.customers,
    });

    // セグメント番号を追加（分割が2つ以上の場合）
    if (segments.length > 1 && !result.fileName.includes('_' + (index + 1))) {
      const ext = baseOptions.extension || '.pdf';
      const baseName = result.fileName.replace(ext, '');
      result.fileName = `${baseName}_${index + 1}${ext}`;
    }

    return result;
  });
}

/**
 * ファイル名から情報を抽出（逆パース）
 *
 * @param fileName ファイル名
 */
export function parseFileName(fileName: string): {
  documentType?: string;
  officeName?: string;
  date?: string;
  customerNames: string[];
  extension: string;
} {
  // 拡張子を分離
  const extMatch = fileName.match(/(\.[^.]+)$/);
  const extension = extMatch ? extMatch[1]! : '';
  const baseName = fileName.replace(/\.[^.]+$/, '');

  // アンダースコアで分割
  const parts = baseName.split('_');

  // 日付パターンを探す（YYYYMMDD）
  const datePattern = /^\d{8}$/;
  let dateIndex = parts.findIndex((p) => datePattern.test(p));

  // 日付が見つからない場合
  if (dateIndex === -1) {
    // 簡易的なパース
    return {
      documentType: parts[0],
      customerNames: parts.slice(1),
      extension,
    };
  }

  // 日付が見つかった場合
  const date = parts[dateIndex];
  const formattedDate = date
    ? `${date.slice(0, 4)}/${date.slice(4, 6)}/${date.slice(6, 8)}`
    : undefined;

  return {
    documentType: parts[0],
    officeName: dateIndex > 1 ? parts[1] : undefined,
    date: formattedDate,
    customerNames: parts.slice(dateIndex + 1).filter((p) => !p.match(/^他\d+名$/) && p.length <= 6),
    extension,
  };
}
