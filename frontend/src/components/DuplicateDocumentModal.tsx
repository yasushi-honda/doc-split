/**
 * 他の利用者用に複製するモーダル (ADR-0032: 複数名FAXの手動複製ボタン)
 *
 * 1枚のFAXに複数名分が載っているとき、担当者が押したときだけ、選んだ利用者の分の書類を作る。
 * 元の書類は今の利用者のまま。複製した書類は利用者が確定済み・確認は未で作られ、各書類で
 * 「確認済みにする」を押すと従来どおりその利用者のフォルダへDrive出力される。
 *
 * 作成・重複防止・人数上限(元の書類を含め合計5名)はサーバー側で強制する。ここでは
 * 1回の選択を (上限 − 1) 名までに絞り、結果をわかりやすく伝えるだけ。
 */

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { MasterSelectField, type MasterItem } from '@/components/MasterSelectField'
import { useCustomerMasters } from '@/hooks/useDocuments'
import { useDuplicateDocument } from '@/hooks/useDuplicateDocument'
import { getCallableErrorCode, getCallableErrorMessage } from '@/lib/callFunction'
import { getDisplayName } from '@/utils/displayName'
import { MANUAL_DUPLICATION_MAX_GROUP_SIZE } from '@shared/types'
import type { CustomerCandidateInfo, Document } from '@shared/types'

/** 1回の依頼で選べる利用者の上限(元の書類の分を除く) */
const MAX_TARGETS = MANUAL_DUPLICATION_MAX_GROUP_SIZE - 1

interface SelectedCustomer {
  id: string
  name: string
  notes?: string
  careManagerName?: string
}

interface DuplicateDocumentModalProps {
  /** 複製元の書類 */
  document: Document
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** 同姓同名を区別できるよう、区別用メモ・担当ケアマネを併記した表示名 */
function describeCustomer(c: SelectedCustomer): string {
  const base = getDisplayName(c.name, c.notes)
  return c.careManagerName ? `${base} 担当: ${c.careManagerName}` : base
}

export function DuplicateDocumentModal({ document, open, onOpenChange }: DuplicateDocumentModalProps) {
  const { data: customerMasters } = useCustomerMasters()
  const duplicate = useDuplicateDocument()
  const [selected, setSelected] = useState<SelectedCustomer[]>([])

  // 閉じたとき(または別の書類に切り替わったとき)は選択を空に戻す
  useEffect(() => {
    if (!open) setSelected([])
  }, [open, document.id])

  const masterById = useMemo(() => {
    const map = new Map<string, NonNullable<typeof customerMasters>[number]>()
    for (const m of customerMasters ?? []) map.set(m.id, m)
    return map
  }, [customerMasters])

  // OCRの完全一致候補(元の書類の利用者・fuzzy/partial・重複IDは除く)
  const candidates = useMemo(() => {
    const seen = new Set<string>()
    const result: CustomerCandidateInfo[] = []
    for (const c of document.customerCandidates ?? []) {
      if (c.matchType !== 'exact' || !c.customerId) continue
      if (c.customerId === document.customerId || seen.has(c.customerId)) continue
      seen.add(c.customerId)
      result.push(c)
    }
    return result
  }, [document.customerCandidates, document.customerId])

  const selectedIds = useMemo(() => new Set(selected.map((s) => s.id)), [selected])
  const atLimit = selected.length >= MAX_TARGETS

  // マスター検索の選択肢: 元の書類の利用者と選択済みの利用者は除く。上限に達したら出さない
  const searchItems: MasterItem[] = useMemo(() => {
    if (atLimit) return []
    return (customerMasters ?? [])
      .filter((m) => m.id !== document.customerId && !selectedIds.has(m.id))
      .map((m) => ({
        id: m.id,
        name: m.name,
        notes: m.notes,
        subText: m.careManagerName ? `担当: ${m.careManagerName}` : m.furigana,
      }))
  }, [customerMasters, document.customerId, selectedIds, atLimit])

  const addCustomer = (customer: SelectedCustomer) => {
    setSelected((prev) => {
      if (prev.length >= MAX_TARGETS || prev.some((s) => s.id === customer.id)) return prev
      return [...prev, customer]
    })
  }

  const removeCustomer = (id: string) => {
    setSelected((prev) => prev.filter((s) => s.id !== id))
  }

  const fromCandidate = (c: CustomerCandidateInfo): SelectedCustomer => {
    const m = masterById.get(c.customerId)
    return {
      id: c.customerId,
      name: m?.name ?? c.customerName,
      notes: m?.notes ?? c.notes,
      careManagerName: m?.careManagerName ?? c.careManagerName,
    }
  }

  const handlePickFromSearch = (_value: string, item?: MasterItem) => {
    if (!item) return
    const m = masterById.get(item.id)
    addCustomer({
      id: item.id,
      name: item.name,
      notes: item.notes ?? m?.notes,
      careManagerName: m?.careManagerName,
    })
  }

  const handleSubmit = async () => {
    if (selected.length === 0) return
    try {
      const result = await duplicate.mutateAsync({
        documentId: document.id,
        customerIds: selected.map((s) => s.id),
      })
      if (result.created.length === 0) {
        // 選んだ全員が作成済み。エラーではなく、既に複製されていることを伝える
        toast.info('選んだ利用者の書類は、すでに作成済みです')
      } else {
        const skippedNote =
          result.skipped.length > 0 ? `（${result.skipped.length}名は作成済みのため対象外）` : ''
        toast.success(`${result.created.length}名分の書類を複製しました${skippedNote}`)
      }
      onOpenChange(false)
    } catch (err) {
      // 入力不正・マスター不在はBE側が状況別の日本語を返すため、そのまま見せる
      // (getCallableErrorMessage は invalid-argument/not-found を既定文言に丸めるため)
      const code = getCallableErrorCode(err)
      const message =
        (code === 'invalid-argument' || code === 'not-found') && err instanceof Error
          ? err.message
          : getCallableErrorMessage(err, '複製に失敗しました')
      toast.error(`複製エラー: ${message}`)
    }
  }

  const isPending = duplicate.isPending

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!isPending) onOpenChange(next) }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>他の利用者用に複製</DialogTitle>
          <DialogDescription>
            このFAXを、ほかの利用者の分の書類として複製します。元の書類は今の利用者（
            {getDisplayName(document.customerName)}）のままです。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {candidates.length > 0 && (
            <section className="space-y-2">
              <h3 className="font-medium">OCRが読み取った利用者</h3>
              <ul className="space-y-1">
                {candidates.map((c) => {
                  const customer = fromCandidate(c)
                  const checked = selectedIds.has(customer.id)
                  const label = describeCustomer(customer)
                  return (
                    <li key={customer.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`dup-candidate-${customer.id}`}
                        aria-label={label}
                        checked={checked}
                        disabled={!checked && atLimit}
                        onCheckedChange={(value) =>
                          value === true ? addCustomer(customer) : removeCustomer(customer.id)
                        }
                      />
                      <label htmlFor={`dup-candidate-${customer.id}`} className="cursor-pointer">
                        {label}
                      </label>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          <section className="space-y-2">
            <h3 className="font-medium">ほかの利用者を探して追加</h3>
            <MasterSelectField
              type="customer"
              value=""
              items={searchItems}
              onChange={handlePickFromSearch}
              placeholder="利用者を検索して追加"
              disabled={atLimit || isPending}
            />
          </section>

          <section className="space-y-2">
            <h3 className="font-medium">
              複製先（{selected.length}/{MAX_TARGETS}名）
            </h3>
            {selected.length === 0 ? (
              <p className="text-muted-foreground">まだ選ばれていません</p>
            ) : (
              <ul className="space-y-1">
                {selected.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 rounded border px-2 py-1">
                    <span>{describeCustomer(s)}</span>
                    <button
                      type="button"
                      aria-label={`${getDisplayName(s.name, s.notes)}を外す`}
                      onClick={() => removeCustomer(s.id)}
                      disabled={isPending}
                      className="rounded p-1 text-muted-foreground hover:bg-gray-100"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              1回に選べるのは最大{MAX_TARGETS}名までです（同じFAXから作る書類は、元の書類を含めて合計
              {MANUAL_DUPLICATION_MAX_GROUP_SIZE}名まで）。
            </p>
          </section>

          <p className="rounded bg-gray-50 p-2 text-xs text-muted-foreground">
            複製した書類は未確認で作られます。各書類で「確認済みにする」を押すと、その利用者のフォルダにDrive出力されます。
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            キャンセル
          </Button>
          <Button onClick={handleSubmit} disabled={selected.length === 0 || isPending}>
            {isPending ? '複製中…' : selected.length > 0 ? `${selected.length}名分を複製する` : '複製する'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
