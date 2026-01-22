/**
 * 確認待ちドキュメント一覧
 *
 * 顧客/事業所の確認が必要なドキュメントを表示
 * 行クリックで詳細モーダルを開く
 */

import { useState, useCallback } from 'react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Timestamp } from 'firebase/firestore';
import {
  FileText,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Users,
  Building2,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  usePendingConfirmationDocuments,
  usePendingConfirmationStats,
  useInvalidatePendingConfirmations,
  type PendingConfirmationDocument,
} from '@/hooks/usePendingConfirmations';
import { DocumentDetailModal } from '@/components/DocumentDetailModal';

// ============================================
// Timestampフォーマット
// ============================================

function formatTimestamp(timestamp: Timestamp | undefined): string {
  if (!timestamp) return '-';
  try {
    return format(timestamp.toDate(), 'MM/dd HH:mm', { locale: ja });
  } catch {
    return '-';
  }
}

// ============================================
// 確認タイプバッジ
// ============================================

function PendingTypeBadge({ type }: { type: 'customer' | 'office' | 'both' }) {
  switch (type) {
    case 'customer':
      return (
        <Badge variant="outline" className="bg-orange-100 text-orange-800 border-orange-300">
          <Users className="h-3 w-3 mr-1" />
          顧客
        </Badge>
      );
    case 'office':
      return (
        <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-300">
          <Building2 className="h-3 w-3 mr-1" />
          事業所
        </Badge>
      );
    case 'both':
      return (
        <div className="flex gap-1">
          <Badge variant="outline" className="bg-orange-100 text-orange-800 border-orange-300">
            <Users className="h-3 w-3 mr-1" />
            顧客
          </Badge>
          <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-300">
            <Building2 className="h-3 w-3 mr-1" />
            事業所
          </Badge>
        </div>
      );
  }
}

// ============================================
// 候補数バッジ
// ============================================

function CandidateCountBadge({ count }: { count: number }) {
  if (count === 0) {
    return (
      <span className="text-xs text-gray-500">候補なし</span>
    );
  }
  return (
    <span className="text-xs text-amber-600 font-medium">
      {count}件の候補
    </span>
  );
}

// ============================================
// メインコンポーネント
// ============================================

export function PendingConfirmationList() {
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);

  const { data: stats } = usePendingConfirmationStats();
  const { data: documents, isLoading, isError, error } = usePendingConfirmationDocuments(100);
  const { invalidateAll } = useInvalidatePendingConfirmations();

  const handleRowClick = useCallback((doc: PendingConfirmationDocument) => {
    setSelectedDocumentId(doc.id);
  }, []);

  const handleModalClose = useCallback(() => {
    setSelectedDocumentId(null);
    // モーダルを閉じたら一覧を更新（確認済みになった可能性があるため）
    invalidateAll();
  }, [invalidateAll]);

  // ローディング
  if (isLoading) {
    return (
      <Card>
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          <span className="ml-2 text-gray-500">読み込み中...</span>
        </div>
      </Card>
    );
  }

  // エラー
  if (isError) {
    return (
      <Card>
        <div className="flex flex-col items-center justify-center py-16 text-red-500">
          <AlertCircle className="mb-2 h-8 w-8" />
          <p>データの読み込みに失敗しました</p>
          <p className="text-sm text-gray-500">{error?.message}</p>
        </div>
      </Card>
    );
  }

  // 空状態（すべて確認済み）
  if (!documents || documents.length === 0) {
    return (
      <Card>
        <div className="flex flex-col items-center justify-center py-16 text-gray-500">
          <CheckCircle2 className="mb-4 h-12 w-12 text-green-400" />
          <p className="text-lg font-medium text-green-600">すべて確認済みです</p>
          <p className="mt-1 text-sm">
            確認が必要な書類はありません
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* 統計情報 */}
      {stats && (
        <div className="flex items-center gap-4 text-sm text-gray-600">
          <span>
            <span className="font-medium text-amber-600">{stats.total}</span>
            &nbsp;件の確認待ち
          </span>
          {stats.customerUnconfirmed > 0 && (
            <>
              <span>•</span>
              <span>
                顧客: <span className="font-medium">{stats.customerUnconfirmed}</span>件
              </span>
            </>
          )}
          {stats.officeUnconfirmed > 0 && (
            <>
              <span>•</span>
              <span>
                事業所: <span className="font-medium">{stats.officeUnconfirmed}</span>件
              </span>
            </>
          )}
        </div>
      )}

      {/* ドキュメント一覧 */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12"></TableHead>
              <TableHead>ファイル名</TableHead>
              <TableHead>確認項目</TableHead>
              <TableHead>抽出された名前</TableHead>
              <TableHead>候補</TableHead>
              <TableHead>処理日時</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {documents.map((doc) => (
              <TableRow
                key={doc.id}
                className="cursor-pointer hover:bg-gray-50"
                onClick={() => handleRowClick(doc)}
              >
                <TableCell>
                  <FileText className="h-4 w-4 text-gray-400" />
                </TableCell>
                <TableCell className="font-medium max-w-48 truncate">
                  {doc.fileName || '(無題)'}
                </TableCell>
                <TableCell>
                  <PendingTypeBadge type={doc.pendingType} />
                </TableCell>
                <TableCell className="text-gray-600">
                  {doc.pendingType === 'customer' && (doc.customerName || '-')}
                  {doc.pendingType === 'office' && (doc.officeName || '-')}
                  {doc.pendingType === 'both' && `${doc.customerName || '-'} / ${doc.officeName || '-'}`}
                </TableCell>
                <TableCell>
                  <CandidateCountBadge
                    count={doc.customerCandidates?.length || 0}
                  />
                </TableCell>
                <TableCell className="text-gray-500 text-sm">
                  {formatTimestamp(doc.processedAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* 詳細モーダル */}
      {selectedDocumentId && (
        <DocumentDetailModal
          documentId={selectedDocumentId}
          open={true}
          onClose={handleModalClose}
        />
      )}
    </div>
  );
}
