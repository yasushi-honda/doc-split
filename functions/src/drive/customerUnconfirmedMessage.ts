/**
 * 「利用者未確定のためDriveへエクスポートできない」エラーメッセージの組み立て。
 *
 * このメッセージは Firestore の `driveExportError` に保存され、エラー画面にそのまま表示される。
 * Firebase Admin に依存しない純粋関数として切り出している(単体テストで`exportDocument.ts`を
 * importすると、トップレベルの admin.firestore() 利用で app/no-app になるため)。
 */

import { DRIVE_EXPORT_CUSTOMER_UNCONFIRMED_MESSAGE_PREFIX } from '../../../shared/types';
import { formatCustomerNameForDisplay } from '../../../shared/customerIdentity';

export function buildCustomerUnconfirmedMessage(customerName: string): string {
  // OCRで特定できなかった書類の保存値'不明顧客'は、画面の他の箇所と同じく「不明利用者」と表示する
  return (
    `${DRIVE_EXPORT_CUSTOMER_UNCONFIRMED_MESSAGE_PREFIX}Google Driveへエクスポートできません` +
    `(書類詳細で利用者を選択・保存して確定すると自動で再試行されます): ${formatCustomerNameForDisplay(customerName)}`
  );
}
