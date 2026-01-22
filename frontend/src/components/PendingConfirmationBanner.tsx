/**
 * 確認待ち通知バナー
 *
 * 顧客未確定・事業所未確定のドキュメントがある場合に表示
 * クリックで確認待ちタブへ遷移
 */

import { AlertTriangle, ArrowRight, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { usePendingConfirmationStats } from '@/hooks/usePendingConfirmations';

interface PendingConfirmationBannerProps {
  onNavigateToTab: () => void;
}

export function PendingConfirmationBanner({
  onNavigateToTab,
}: PendingConfirmationBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const { data: stats, isLoading } = usePendingConfirmationStats();

  // ローディング中、件数0、または非表示の場合は表示しない
  if (isLoading || !stats || stats.total === 0 || dismissed) {
    return null;
  }

  const getMessage = () => {
    const parts: string[] = [];
    if (stats.customerUnconfirmed > 0) {
      parts.push(`顧客の確認: ${stats.customerUnconfirmed}件`);
    }
    if (stats.officeUnconfirmed > 0) {
      parts.push(`事業所の確認: ${stats.officeUnconfirmed}件`);
    }
    return parts.join('、');
  };

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-amber-800">
              {stats.total}件の書類で確認が必要です
            </p>
            <p className="text-xs text-amber-600 mt-0.5">
              {getMessage()}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onNavigateToTab}
            className="bg-white hover:bg-amber-100 border-amber-300 text-amber-800"
          >
            今すぐ確認
            <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDismissed(true)}
            className="text-amber-600 hover:text-amber-800 hover:bg-amber-100 p-1 h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
