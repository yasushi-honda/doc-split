/**
 * 利用者別グループ見出しの「契約終了」切替操作
 *
 * 全スタッフが顧客マスターの契約終了フラグ(isContractEnded)だけを切り替えられる
 * (Firestoreルールがこの1項目の更新のみ許可。顧客名等の編集は管理者のマスター画面のまま)。
 * 対象顧客が特定できない(同姓同名・未登録)場合は誤更新を避けるため何も表示しない。
 */

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useSetCustomerContractEnded } from '@/hooks/useMasters';
import type { CustomerMaster } from '@shared/types';

interface ContractEndedToggleProps {
  customer: CustomerMaster | null;
}

export function ContractEndedToggle({ customer }: ContractEndedToggleProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setContractEnded = useSetCustomerContractEnded();

  if (!customer) return null;

  const isEnded = customer.isContractEnded === true;
  const actionLabel = isEnded ? '契約中に戻す' : '契約終了にする';

  const handleConfirm = async () => {
    setError(null);
    try {
      await setContractEnded.mutateAsync({ id: customer.id, isContractEnded: !isEnded });
      setOpen(false);
    } catch (err) {
      console.error('[ContractEndedToggle] 契約状態の更新に失敗しました', { customerId: customer.id, err });
      setOpen(false);
      const code = (err as { code?: string }).code;
      setError(
        code === 'permission-denied'
          ? '契約状態を変更する権限がありません。ページを再読み込みして再度お試しください'
          : '契約状態の更新に失敗しました。通信状況を確認して再度お試しください'
      );
    }
  };

  return (
    <div className="flex flex-shrink-0 items-center gap-2 pr-4">
      {error && (
        <span role="alert" className="text-xs text-red-600">
          {error}
        </span>
      )}
      {isEnded && (
        <Badge variant="secondary" className="text-xs">
          契約終了
        </Badge>
      )}
      <Button
        variant="outline"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        disabled={setContractEnded.isPending}
      >
        {actionLabel}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{customer.name}さんを{actionLabel}</AlertDialogTitle>
            <AlertDialogDescription>
              {isEnded
                ? 'この利用者の書類が、書類画面に再び表示されます(全スタッフの画面に反映されます。反映まで数分かかることがあります)。'
                : 'この利用者の書類は、書類画面で既定では非表示になります。今後届く未確認・選択待ちの書類も非表示になります(全スタッフの画面に反映されます。反映まで数分かかることがあります)。「契約終了の利用者も表示」で確認でき、いつでも契約中に戻せます。'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              disabled={setContractEnded.isPending}
              onClick={(e) => {
                e.preventDefault();
                void handleConfirm();
              }}
            >
              {actionLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
