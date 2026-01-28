/**
 * エイリアス学習履歴モーダル
 */

import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { History, User, Building, FileText, Loader2, ChevronDown } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAliasLearningHistory } from '@/hooks/useAliasLearningHistory';
import type { AliasLearningLog, AliasLearningMasterType } from '@shared/types';
import type { Timestamp } from 'firebase/firestore';

interface AliasLearningHistoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// マスタータイプの表示設定
const MASTER_TYPE_CONFIG: Record<AliasLearningMasterType, { label: string; icon: React.ElementType; color: string }> = {
  customer: { label: '顧客', icon: User, color: 'bg-blue-100 text-blue-800' },
  office: { label: '事業所', icon: Building, color: 'bg-green-100 text-green-800' },
  document: { label: '書類種別', icon: FileText, color: 'bg-purple-100 text-purple-800' },
};

// Timestampを日付文字列に変換
function formatTimestamp(timestamp: Timestamp | undefined): string {
  if (!timestamp) return '-';
  try {
    return format(timestamp.toDate(), 'MM/dd HH:mm', { locale: ja });
  } catch {
    return '-';
  }
}

// 履歴行コンポーネント
function HistoryRow({ log }: { log: AliasLearningLog }) {
  const config = MASTER_TYPE_CONFIG[log.masterType];
  const Icon = config.icon;

  return (
    <div className="flex items-start gap-3 py-3 border-b border-gray-100 last:border-0">
      <div className={`p-1.5 rounded ${config.color}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-gray-900">{log.masterName}</span>
          <Badge variant="outline" className="text-xs">
            {config.label}
          </Badge>
        </div>
        <p className="text-xs text-gray-600 mt-0.5">
          「{log.alias}」を許容表記として登録
        </p>
        <p className="text-xs text-gray-400 mt-0.5">
          {formatTimestamp(log.learnedAt)}
        </p>
      </div>
    </div>
  );
}

export function AliasLearningHistoryModal({ open, onOpenChange }: AliasLearningHistoryModalProps) {
  const [filterType, setFilterType] = useState<AliasLearningMasterType | 'all'>('all');
  const { data, isLoading, isError } = useAliasLearningHistory({ filterType, pageSize: 20 });

  // モーダルが閉じたらフィルタをリセット
  useEffect(() => {
    if (!open) {
      setFilterType('all');
    }
  }, [open]);

  const logs = data?.logs || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-gray-600" />
            学習履歴
          </DialogTitle>
        </DialogHeader>

        <Tabs value={filterType} onValueChange={(v) => setFilterType(v as AliasLearningMasterType | 'all')} className="flex-1 flex flex-col">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="all">すべて</TabsTrigger>
            <TabsTrigger value="customer">顧客</TabsTrigger>
            <TabsTrigger value="office">事業所</TabsTrigger>
            <TabsTrigger value="document">書類種別</TabsTrigger>
          </TabsList>

          <TabsContent value={filterType} className="flex-1 overflow-y-auto mt-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                <span className="ml-2 text-sm text-gray-500">読み込み中...</span>
              </div>
            ) : isError ? (
              <div className="text-center py-8 text-red-500">
                <p className="text-sm">履歴の取得に失敗しました</p>
              </div>
            ) : logs.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <History className="h-12 w-12 mx-auto mb-2 text-gray-300" />
                <p className="text-sm">学習履歴はまだありません</p>
                <p className="text-xs text-gray-400 mt-1">
                  編集画面で「この表記を記憶する」をチェックすると履歴が記録されます
                </p>
              </div>
            ) : (
              <div className="space-y-0">
                {logs.map((log) => (
                  <HistoryRow key={log.id} log={log} />
                ))}
                {data?.hasMore && (
                  <div className="pt-4 text-center">
                    <Button variant="outline" size="sm" disabled>
                      <ChevronDown className="h-4 w-4 mr-1" />
                      さらに読み込む（未実装）
                    </Button>
                  </div>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
