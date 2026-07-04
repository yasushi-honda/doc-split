/**
 * ドキュメント関連の共通ユーティリティ
 *
 * 複数コンポーネントで使用される定数・関数を集約
 */

import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Timestamp } from 'firebase/firestore';
import type { DocumentStatus, SplitSegment } from '@shared/types';

// ============================================
// ステータス表示設定
// ============================================

export type BadgeVariant = 'default' | 'secondary' | 'success' | 'warning' | 'destructive';

export interface StatusConfig {
  label: string;
  variant: BadgeVariant;
}

export const DOCUMENT_STATUS_CONFIG: Record<DocumentStatus, StatusConfig> = {
  pending: { label: '待機中', variant: 'secondary' },
  processing: { label: '処理中', variant: 'warning' },
  processed: { label: '完了', variant: 'success' },
  error: { label: 'エラー', variant: 'destructive' },
  split: { label: '分割済', variant: 'default' },
};

export const DEFAULT_STATUS_CONFIG: StatusConfig = {
  label: '不明',
  variant: 'secondary',
};

/**
 * ドキュメントステータスの表示設定を取得
 */
export function getStatusConfig(status: DocumentStatus): StatusConfig {
  return DOCUMENT_STATUS_CONFIG[status] || DEFAULT_STATUS_CONFIG;
}

// ============================================
// 日付フォーマット
// ============================================

/**
 * Timestampを日付文字列にフォーマット
 * @param timestamp Firestore Timestamp
 * @param formatStr フォーマット文字列（デフォルト: yyyy/MM/dd）
 * @returns フォーマットされた日付文字列、無効な場合は'-'
 */
export function formatTimestamp(
  timestamp: Timestamp | null | undefined,
  formatStr = 'yyyy/MM/dd'
): string {
  if (!timestamp) return '-';
  try {
    return format(timestamp.toDate(), formatStr, { locale: ja });
  } catch {
    return '-';
  }
}

// ============================================
// 顧客名・事業所名の有効性判定
// ============================================
// 編集モーダル保存時に「選択確定フラグ」(customerConfirmed/officeConfirmed) を
// true にするか判定するために使用する。Sentinel 値（'未判定'/'不明顧客'/'不明事業所'）
// は OCR 失敗・未判定状態を示すため、選択として無効扱いにする。

const CUSTOMER_INVALID_SENTINELS: ReadonlySet<string> = new Set(['未判定', '不明顧客']);
const OFFICE_INVALID_SENTINELS: ReadonlySet<string> = new Set(['未判定', '不明事業所']);
const DOCUMENT_TYPE_INVALID_SENTINELS: ReadonlySet<string> = new Set(['未判定']);

/**
 * 顧客名が「確定可能な有効値」かを判定する。
 * 空文字・null・undefined・空白のみ・sentinel 値（'未判定'/'不明顧客'）は false を返す。
 */
export function isValidCustomerSelection(name: string | null | undefined): boolean {
  if (name == null) return false;
  const trimmed = name.trim();
  if (trimmed === '') return false;
  return !CUSTOMER_INVALID_SENTINELS.has(trimmed);
}

/**
 * 事業所名が「確定可能な有効値」かを判定する。
 * 空文字・null・undefined・空白のみ・sentinel 値（'未判定'/'不明事業所'）は false を返す。
 */
export function isValidOfficeSelection(name: string | null | undefined): boolean {
  if (name == null) return false;
  const trimmed = name.trim();
  if (trimmed === '') return false;
  return !OFFICE_INVALID_SENTINELS.has(trimmed);
}

/**
 * 書類種別が「確定可能な有効値」かを判定する。
 * 空文字・null・undefined・空白のみ・sentinel 値（'未判定'）は false を返す。
 */
export function isValidDocumentTypeSelection(name: string | null | undefined): boolean {
  if (name == null) return false;
  const trimmed = name.trim();
  if (trimmed === '') return false;
  return !DOCUMENT_TYPE_INVALID_SENTINELS.has(trimmed);
}

// ============================================
// 分割セグメント編集ユーティリティ（Issue #526 / #538）
// ============================================

/**
 * 分割セグメントのフィールド編集を反映する（Issue #538対応）。
 * MasterSelectField は選択時に value（名前）と item（id 付きマスタ情報）を
 * 両方渡すが、名前だけ更新して item を捨てると customerId/officeId が
 * 編集前の値のまま残り、表示名と実際に紐付くマスタが食い違う。
 * 名前フィールド編集時は対応するIDを item 由来の値に同期し、
 * item が無い（マスタ不一致・未判定化）場合は null にクリアする。
 */
export function applySegmentFieldEdit(
  existing: Partial<SplitSegment>,
  field: keyof SplitSegment,
  value: string,
  item?: { id: string }
): Partial<SplitSegment> {
  const update: Partial<SplitSegment> = { ...existing, [field]: value };
  if (field === 'customerName') {
    update.customerId = item?.id ?? null;
  }
  if (field === 'officeName') {
    update.officeId = item?.id ?? null;
  }
  return update;
}

/**
 * 分割セグメントの最終値からconfirmedフラグを算出する（Issue #526）。
 * サーバー側ではID有無から確定状態を推測しない（自動検出候補にもIDが付くため
 * 誤判定しうる、Codexセカンドオピニオン反映）。フロントエンドが値の妥当性
 * 判定結果（isValid*Selection）をそのまま送信する。
 */
export function buildSegmentConfirmedFlags(segment: {
  customerName: string;
  officeName: string;
  documentType: string;
}): {
  customerConfirmed: boolean;
  officeConfirmed: boolean;
  documentTypeConfirmed: boolean;
} {
  return {
    customerConfirmed: isValidCustomerSelection(segment.customerName),
    officeConfirmed: isValidOfficeSelection(segment.officeName),
    documentTypeConfirmed: isValidDocumentTypeSelection(segment.documentType),
  };
}
