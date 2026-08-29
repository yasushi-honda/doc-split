import { Users } from 'lucide-react'
import type { Document } from '@shared/types'

interface MultiCustomerBadgeProps {
  document: Pick<Document, 'multiCustomerDetected' | 'multiCustomerCount' | 'distributionId'>
}

/**
 * 「複数名の可能性」バッジ(PR-B「複数人記載FAX: 複製廃止→検出バッジへの置換」、2026-08-30)
 *
 * 既存の担当CM併記(DocumentsPage.tsxのDocumentRow、顧客名セル内に小さく併記するパターン、
 * #424教訓)と同じ配置規約に合わせて設計している。ステータス列には置かない: 複製OFF後の
 * 複数人記載docは必ずcustomerConfirmed:falseになり常に「選択待ち」バッジで占有されるため、
 * ステータス列は最も出したいケースで最も見えなくなる。
 *
 * distributionIdを持つdoc(複製済み・DocumentDetailModal.tsxの「自動配信・要整理」表示の
 * 対象)では非表示にする(表示の競合を避けるため)。
 *
 * 文言は「複数人記載」と断定せず「複数名の可能性」という検出結果の提示にとどめる
 * (plan-crossreview codex指摘: OCRの確信度付き提案であって確定事実ではないため)。
 */
export function MultiCustomerBadge({ document }: MultiCustomerBadgeProps) {
  if (!document.multiCustomerDetected) return null
  if (document.distributionId) return null

  const count = document.multiCustomerCount
  const label = typeof count === 'number' && count > 0 ? `複数名の可能性 (${count}名)` : '複数名の可能性'

  return (
    <div
      className="flex items-center gap-1 truncate text-[11px] text-indigo-600"
      title="OCRで複数の顧客名が完全一致で検出されました。1つの書類に複数人が記載されている可能性があります。"
    >
      <Users className="h-3 w-3 flex-shrink-0" />
      {label}
    </div>
  )
}
