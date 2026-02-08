/**
 * DocSplit 共通型定義
 * Firestoreスキーマに基づく型定義
 */

import { Timestamp } from 'firebase/firestore';

// ============================================
// ドキュメント（書類管理）
// ============================================

export type DocumentStatus = 'pending' | 'processing' | 'processed' | 'error' | 'split';

/** ドキュメントのソースタイプ */
export type SourceType = 'gmail' | 'upload';

export interface Document {
  id: string;
  processedAt: Timestamp;
  fileId: string;
  fileName: string;
  mimeType: string;
  ocrResult: string;
  ocrResultUrl?: string; // 長い場合はCloud Storage参照
  summary?: string; // AI生成の要約
  documentType: string;
  customerName: string;
  officeName: string;
  fileUrl: string;
  fileDate: Timestamp;
  isDuplicateCustomer: boolean;
  allCustomerCandidates?: string;
  totalPages: number;
  targetPageNumber: number;
  status: DocumentStatus;
  sourceType?: SourceType;
  careManager?: string;
  category?: string;

  // ページ単位OCR結果（PDF分割用）
  pageResults?: PageOcrResult[];
  splitSuggestions?: SplitSuggestion[];
  pageRotations?: PageRotation[];

  // 分割元ドキュメントへの参照（分割で生成された場合）
  parentDocumentId?: string;
  splitFromPages?: { start: number; end: number };

  // Phase 7: 顧客確定機能
  customerId?: string | null;                    // 顧客ID（「該当なし」選択時はnull）
  customerCandidates?: CustomerCandidateInfo[];  // 構造化された候補リスト
  customerConfirmed?: boolean;                   // 確定済みフラグ（デフォルト: true）
  confirmedBy?: string | null;                   // 確定者UID（システム自動確定時はnull）
  confirmedAt?: Timestamp | null;                // 確定日時（システム自動確定時はnull）
  needsManualCustomerSelection?: boolean;        // 後方互換用（Phase 6以前）

  // 事業所確定機能
  officeId?: string | null;                      // 事業所ID（「該当なし」選択時はnull）
  officeCandidates?: OfficeCandidateInfo[];      // 構造化された候補リスト
  officeConfirmed?: boolean;                     // 確定済みフラグ（デフォルト: true）
  officeConfirmedBy?: string | null;             // 確定者UID（システム自動確定時はnull）
  officeConfirmedAt?: Timestamp | null;          // 確定日時（システム自動確定時はnull）
  suggestedNewOffice?: string | null;            // ファイル名から抽出された事業所名（登録提案用）

  // Phase 8: グループ化用正規化キー（Cloud Functionsで自動設定）
  customerKey?: string;       // customerName正規化版
  officeKey?: string;         // officeName正規化版
  documentTypeKey?: string;   // documentType正規化版
  careManagerKey?: string;    // careManager正規化版

  // Phase 9: OCR抽出スナップショット（正解フィードバック用）
  ocrExtraction?: OcrExtraction;

  // OCR結果確認ステータス（人によるチェック状態）
  verified?: boolean;           // 確認済みフラグ（デフォルト: false）
  verifiedBy?: string | null;   // 確認者UID
  verifiedAt?: Timestamp | null; // 確認日時
}

// ============================================
// Phase 9: OCR抽出スナップショット
// ============================================

/** OCRフィールド単位の抽出情報 */
export interface OcrFieldExtraction {
  suggestedValue: string;      // OCRが提案した値
  suggestedId?: string | null; // マッチしたマスターID（あれば）
  confidence: number;          // 信頼度スコア (0-100)
  matchType: string;           // マッチタイプ (exact/partial/fuzzy/none)
}

/** OCR抽出スナップショット（正解フィードバック用） */
export interface OcrExtraction {
  version: string;             // OCRモデルバージョン (例: "gemini-2.5-flash")
  extractedAt: Timestamp;      // 抽出日時
  customer?: OcrFieldExtraction;
  office?: OcrFieldExtraction;
  documentType?: OcrFieldExtraction;
}

// ============================================
// Phase 8: グループ化ビュー
// ============================================

/** グループ化タイプ */
export type GroupType = 'customer' | 'office' | 'documentType' | 'careManager';

/** グループ内のプレビュードキュメント */
export interface GroupPreviewDoc {
  id: string;
  fileName: string;
  documentType: string;
  processedAt: Timestamp;
}

/** ドキュメントグループ（サマリー情報） */
export interface DocumentGroup {
  id: string;                   // グループID: {groupType}_{groupKey}
  groupType: GroupType;         // グループ化タイプ
  groupKey: string;             // グループキー（正規化された値）
  displayName: string;          // 表示名（元の値）
  count: number;                // グループ内ドキュメント数
  latestAt: Timestamp;          // 最新処理日時
  latestDocs: GroupPreviewDoc[]; // プレビュー用（最新3件）
  updatedAt: Timestamp;         // 集計更新日時
}

// ============================================
// マスターデータ
// ============================================

export interface DocumentMaster {
  id?: string;        // FirestoreドキュメントID（フロントエンド取得時に設定）
  name: string;
  dateMarker: string; // 日付抽出の目印（例: "発行日"）
  category: string;
  keywords?: string[]; // 照合用キーワード（例: ["被保険者証", "介護保険"]）
  aliases?: string[];  // 許容される別表記（例: ["介護保険被保険者証", "被保険者証明書"]）
}

export interface CustomerMaster {
  id: string;
  name: string;
  isDuplicate: boolean; // 同姓同名フラグ
  furigana: string;
  careManagerName?: string; // 担当ケアマネジャー名
  aliases?: string[];  // 許容される別表記（例: ["田中　太郎", "たなか太郎"]）
  notes?: string;      // 区別用補足情報（例: "北名古屋在住"）
}

export interface OfficeMaster {
  id: string;              // ドキュメントID
  name: string;
  nameKey?: string;        // 正規化キー（検索用）
  shortName?: string;
  isDuplicate: boolean;    // 同名フラグ
  aliases?: string[];      // 許容される別表記（例: ["北名古屋市東部地域包括支援センター"]）
  notes?: string;          // 区別用補足情報（例: "東部"）
}

export interface CareManagerMaster {
  id?: string;           // ドキュメントID
  name: string;          // 氏名
  email?: string;        // メールアドレス（Google Workspace）
  aliases?: string[];    // 別表記（例: ["田中 太郎", "たなか太郎"]）
}

// ============================================
// Phase 7: 顧客候補情報
// ============================================

/** 顧客候補のマッチタイプ */
export type CustomerMatchType = 'exact' | 'partial' | 'fuzzy';

/** 顧客候補情報（processOCRで生成、同姓同名解決モーダルで表示） */
export interface CustomerCandidateInfo {
  customerId: string;          // CustomerMaster.id からコピー
  customerName: string;        // CustomerMaster.name からコピー
  customerNameKana?: string;   // CustomerMaster.furigana からコピー
  isDuplicate: boolean;        // CustomerMaster.isDuplicate からコピー
  officeId?: string;           // 将来拡張用
  officeName?: string;         // 将来拡張用
  careManagerName?: string;    // 将来拡張用
  notes?: string;              // 区別用補足情報
  score: number;               // 類似度スコア (0-100)
  matchType: CustomerMatchType;
}

// ============================================
// 事業所候補情報
// ============================================

/** 事業所候補のマッチタイプ */
export type OfficeMatchType = 'exact' | 'partial' | 'fuzzy';

/** 事業所候補情報（processOCRで生成、同名解決モーダルで表示） */
export interface OfficeCandidateInfo {
  officeId: string;            // OfficeMaster.id からコピー
  officeName: string;          // OfficeMaster.name からコピー
  shortName?: string;          // OfficeMaster.shortName からコピー
  isDuplicate: boolean;        // OfficeMaster.isDuplicate からコピー
  notes?: string;              // 区別用補足情報
  score: number;               // 類似度スコア (0-100)
  matchType: OfficeMatchType;
}

// ============================================
// Phase 7: 顧客解決監査ログ
// ============================================

/** 顧客解決監査ログ */
export interface CustomerResolutionLog {
  documentId: string;               // 対象書類ID
  previousCustomerId: string | null; // 変更前の顧客ID（初回確定時はnull）
  newCustomerId: string | null;     // 変更後の顧客ID（「該当なし」選択時はnull）
  newCustomerName: string;          // 変更後の顧客名（「該当なし」時は"不明顧客"）
  resolvedBy: string;               // 確定者UID
  resolvedByEmail: string;          // 確定者メールアドレス
  resolvedAt: Timestamp;            // 確定日時
  reason?: string;                  // 任意のメモ（「該当なし」時は"該当なし選択"）
}

/** 事業所解決監査ログ */
export interface OfficeResolutionLog {
  documentId: string;               // 対象書類ID
  previousOfficeId: string | null;  // 変更前の事業所ID（初回確定時はnull）
  newOfficeId: string | null;       // 変更後の事業所ID（「該当なし」選択時はnull）
  newOfficeName: string;            // 変更後の事業所名（「該当なし」時は"不明事業所"）
  resolvedBy: string;               // 確定者UID
  resolvedByEmail: string;          // 確定者メールアドレス
  resolvedAt: Timestamp;            // 確定日時
  reason?: string;                  // 任意のメモ（「該当なし」時は"該当なし選択"）
}

// ============================================
// エイリアス学習履歴
// ============================================

export type AliasLearningMasterType = 'office' | 'customer' | 'document';

export interface AliasLearningLog {
  id: string;
  masterType: AliasLearningMasterType;
  masterId: string;
  masterName: string;
  alias: string;
  learnedBy: string;
  learnedByEmail: string;
  learnedAt: Timestamp;
}

// ============================================
// エラー履歴
// ============================================

export type ErrorType =
  | 'OCR完全失敗'
  | 'OCR部分失敗'
  | '情報抽出エラー'
  | 'ファイル処理エラー'
  | 'システムエラー';

export type ErrorStatus = '未対応' | '対応中' | '完了';

export interface ErrorRecord {
  errorId: string;
  errorDate: Timestamp;
  errorType: ErrorType;
  fileName: string;
  fileId: string;
  totalPages: number;
  successPages: number;
  failedPages: number;
  failedPageNumbers: string[];
  errorDetails: string;
  fileUrl: string;
  status: ErrorStatus;
}

// ============================================
// Gmail受信ログ
// ============================================

export interface GmailLog {
  fileName: string;
  hash: string; // MD5ハッシュ（重複検知用）
  fileSizeKB: number;
  emailSubject: string;
  processedAt: Timestamp;
  fileUrl: string;
  emailBody: string;
}

// ============================================
// アップロードログ
// ============================================

export interface UploadLog {
  fileName: string;
  hash: string; // MD5ハッシュ（重複検知用）
  fileSizeKB: number;
  uploadedAt: Timestamp;
  uploadedBy: string; // UID
  uploadedByEmail: string;
  fileUrl: string;
}

// ============================================
// アプリ設定
// ============================================

export type LabelSearchOperator = 'AND' | 'OR';

export interface AppSettings {
  targetLabels: string[]; // 監視対象Gmailラベル
  targetSenders: string[]; // 監視対象送信元メールアドレス
  labelSearchOperator: LabelSearchOperator;
  errorNotificationEmails: string[];
  gmailAccount?: string; // 監視対象Gmailアカウント
}

// ============================================
// ユーザー管理
// ============================================

export type UserRole = 'admin' | 'user';

export interface User {
  uid: string;
  email: string;
  displayName?: string;
  role: UserRole;
  createdAt: Timestamp;
  lastLoginAt: Timestamp;
}

// ============================================
// 定数（ビジネスロジック設定値）
// ============================================

export const CONSTANTS = {
  /** 顧客名・事業所名の類似度閾値（0-100） */
  CUSTOMER_SIMILARITY_THRESHOLD: 70,

  /** 書類名検索時のOCRテキスト先頭文字数 */
  DOCUMENT_NAME_SEARCH_RANGE_CHARS: 200,

  /** 日付マーカー後の検索文字数 */
  DATE_MARKER_SEARCH_RANGE_CHARS: 50,

  /** 未識別情報の代替文字列 */
  STATUS_UNDETERMINED: '未判定',

  /** 不明書類の代替文字列 */
  FILE_NAME_UNKNOWN_DOCUMENT: '不明文書',

  /** 不明顧客の代替文字列 */
  FILE_NAME_UNKNOWN_CUSTOMER: '不明顧客',
} as const;

// ============================================
// ページ単位OCR結果（PDF分割用）
// ============================================

export interface PageOcrResult {
  pageNumber: number;
  text: string;
  detectedDocumentType: string | null;
  detectedCustomerName: string | null;
  detectedOfficeName: string | null;
  detectedDate: Date | null;
  matchScore: number; // マッチ精度スコア（0-100）
  matchType: 'exact' | 'partial' | 'none';
}

export interface SplitSuggestion {
  afterPageNumber: number; // このページの後で分割
  reason: SplitReason;
  confidence: number; // 確信度（0-100）
  newDocumentType: string | null;
  newCustomerName: string | null;
}

export type SplitReason =
  | 'new_customer' // 新しい顧客が検出された
  | 'new_document_type' // 新しい書類種別が検出された
  | 'content_break' // 内容の明確な区切り
  | 'manual'; // ユーザーが手動で追加

export interface SplitPreview {
  segments: SplitSegment[];
}

export interface SplitSegment {
  startPage: number;
  endPage: number;
  suggestedFileName: string;
  documentType: string;
  customerName: string;
  customerId?: string | null;
  officeName: string;
  officeId?: string | null;
  fileDate: Date | null;
  /** 顧客候補リスト */
  customerCandidates?: Array<{
    id: string;
    name: string;
    score: number;
    isDuplicate: boolean;
    careManagerName?: string;
  }>;
  /** 事業所候補リスト */
  officeCandidates?: Array<{
    id: string;
    name: string;
    score: number;
    isDuplicate: boolean;
  }>;
  /** 手動選択が必要か（顧客） */
  needsManualCustomerSelection?: boolean;
  /** 手動選択が必要か（事業所） */
  needsManualOfficeSelection?: boolean;
  /** 同姓同名の顧客か */
  isDuplicateCustomer?: boolean;
  /** 担当ケアマネ名 */
  careManagerName?: string | null;
}

// ============================================
// PDF編集操作
// ============================================

export interface PageRotation {
  pageNumber: number;
  rotation: 0 | 90 | 180 | 270;
}

export interface PdfEditRequest {
  documentId: string;
  operations: PdfOperation[];
}

export type PdfOperation =
  | { type: 'rotate'; pageNumber: number; degrees: 90 | 180 | 270 }
  | { type: 'split'; afterPageNumber: number }
  | { type: 'delete'; pageNumber: number };

// ============================================
// ファイル命名規則
// ============================================

/**
 * ファイル名を生成
 * 形式: [YYYYMMDD]_[顧客名]_[事業所名]_[書類名]_[ファイルID先頭8文字].[拡張子]
 */
export function generateFileName(params: {
  date: Date;
  customerName: string;
  officeName: string;
  documentType: string;
  fileId: string;
  extension: string;
}): string {
  const { date, customerName, officeName, documentType, fileId, extension } = params;

  const dateStr = formatDate(date);
  const sanitizedCustomer = sanitizeFileName(customerName);
  const sanitizedOffice = sanitizeFileName(officeName);
  const sanitizedDocType = sanitizeFileName(documentType);
  const fileIdShort = fileId.slice(0, 8);

  // 事業所名が「未判定」の場合は含めない
  const parts = [dateStr, sanitizedCustomer];
  if (sanitizedOffice && sanitizedOffice !== CONSTANTS.STATUS_UNDETERMINED) {
    parts.push(sanitizedOffice);
  }
  parts.push(sanitizedDocType, fileIdShort);

  return `${parts.join('_')}.${extension}`;
}

/**
 * ファイル名をサニタイズ
 */
export function sanitizeFileName(name: string): string {
  if (!name) return '';

  return name
    // 禁止文字を置換
    .replace(/[\\/:*?"<>|]/g, '_')
    // 全角・半角スペースを置換
    .replace(/[\s\u3000]/g, '_')
    // 連続アンダースコアを統合
    .replace(/_+/g, '_')
    // 先頭・末尾アンダースコアを削除
    .replace(/^_|_$/g, '');
}

/**
 * 日付をYYYYMMDD形式にフォーマット
 */
function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}
