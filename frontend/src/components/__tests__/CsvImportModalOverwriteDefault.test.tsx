/**
 * CsvImportModal: 部分一致行の「上書き」既定ON(クライアント要望 2026-10-27)と、
 * 同名が曖昧な行では上書きを既定にしない安全側の挙動(codex review P1指摘)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockCheckCustomers = vi.fn()
vi.mock('@/hooks/useMasters', () => ({
  checkCustomerDuplicatesWithDetails: (...a: unknown[]) => mockCheckCustomers(...a),
  checkOfficeDuplicatesWithDetails: vi.fn(),
  checkCareManagerDuplicatesWithDetails: vi.fn(),
  checkDocumentTypeDuplicatesWithDetails: vi.fn(),
}))

import { CsvImportModal } from '../CsvImportModal'

const CSV = '顧客名,フリガナ\n田中太郎,タナカタロウ\n'

async function uploadCsv(csv: string) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  const file = new File([csv], 'customers.csv', { type: 'text/csv' })
  // jsdomのFileにはtext()/arrayBuffer()が無いため補う
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(csv) })
  fireEvent.change(input, { target: { files: [file] } })
}

const partial = (id: string) => ({
  csvData: { name: '田中太郎', furigana: 'タナカタロウ', careManagerName: '', notes: '', aliases: '' },
  existingData: { id, name: '田中太郎', furigana: 'タナカ', careManagerName: '', notes: '', aliases: '' },
  isDuplicate: true,
})

describe('CsvImportModal 上書き既定', () => {
  beforeEach(() => mockCheckCustomers.mockReset())

  it('同名の既存が1件だけなら、部分一致行は上書きが既定ONになる', async () => {
    mockCheckCustomers.mockResolvedValue([partial('cust-1')])
    render(
      <CsvImportModal
        type="customer"
        isOpen
        onClose={() => {}}
        onImport={vi.fn()}
        existingRecords={[{ id: 'cust-1', name: '田中太郎' }]}
      />
    )
    await uploadCsv(CSV)
    await waitFor(() => expect(screen.getByText(/1件上書き選択/)).toBeDefined())
  })

  it('同姓同名の既存が複数あるときは、上書きを既定にしない(別人の誤上書き防止)', async () => {
    mockCheckCustomers.mockResolvedValue([partial('cust-2')])
    render(
      <CsvImportModal
        type="customer"
        isOpen
        onClose={() => {}}
        onImport={vi.fn()}
        existingRecords={[
          { id: 'cust-1', name: '田中太郎' },
          { id: 'cust-2', name: '田中太郎' },
        ]}
      />
    )
    await uploadCsv(CSV)
    await waitFor(() => expect(screen.getByText('部分一致（差分あり・上書き候補）')).toBeDefined())
    expect(screen.queryByText(/件上書き選択/)).toBeNull()
  })
})
