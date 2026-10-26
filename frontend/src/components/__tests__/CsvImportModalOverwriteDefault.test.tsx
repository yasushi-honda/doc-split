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

const partial = (id: string, sameNameExistingCount = 1) => ({
  csvData: { name: '田中太郎', furigana: 'タナカタロウ', careManagerName: '', notes: '', aliases: '' },
  existingData: { id, name: '田中太郎', furigana: 'タナカ', careManagerName: '', notes: '', aliases: '' },
  isDuplicate: true,
  sameNameExistingCount,
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

  it('照合時の既存データに同名が複数あるときは、画面キャッシュの件数によらず上書きを既定にしない(別人の誤上書き防止)', async () => {
    mockCheckCustomers.mockResolvedValue([partial('cust-2', 2)])
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
    await waitFor(() => expect(screen.getByText('部分一致（差分あり・上書き候補）')).toBeDefined())
    expect(screen.queryByText(/件上書き選択/)).toBeNull()
  })

  it('CSV内に同名の行が複数あるときは、上書きを既定にしない', async () => {
    mockCheckCustomers.mockResolvedValue([partial('cust-1'), partial('cust-1')])
    render(
      <CsvImportModal
        type="customer"
        isOpen
        onClose={() => {}}
        onImport={vi.fn()}
        existingRecords={[{ id: 'cust-1', name: '田中太郎' }]}
      />
    )
    await uploadCsv('顧客名,フリガナ\n田中太郎,タナカタロウ\n田中太郎,タナカタロウ\n')
    await waitFor(() => expect(screen.getByText('部分一致（差分あり・上書き候補）')).toBeDefined())
    expect(screen.queryByText(/件上書き選択/)).toBeNull()
  })

  it('ID一致行と同名のID無し行が同じ既存レコードを狙うとき、ID無し行は上書きを既定にしない', async () => {
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
    await uploadCsv('id,顧客名,フリガナ\ncust-1,田中花子,タナカハナコ\n,田中太郎,タナカタロウ\n')
    // ID一致行の上書き(1件)だけが選択され、ID無し行(部分一致)は上書き選択されない
    await waitFor(() => expect(screen.getAllByText(/件上書き選択/)).toHaveLength(1))
  })
})
