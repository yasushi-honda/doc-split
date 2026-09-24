/**
 * 一括インポート(上書き)の部分更新 単体テスト(Issue #1036)
 *
 * CLAUDE.md MUST: DB Partial Update関数の追加/変更 → 更新対象外フィールドが不変であることを
 * テストに含める。事業所/書類種別/ケアマネの上書きがsetDoc(非merge)のためCSV列に無い
 * フィールドが消えていた既存バグを、updateDoc(CSVに値がある列のみ送信)へ修正したことを検証する。
 * ケアマネは実doc ID(existingId)で上書きされること、途中の1件が失敗しても後続行は
 * 処理が続行されfailedNamesに記録されることもあわせて確認する(/plan-crossreview反映#4・#5)。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetDocs = vi.fn()
const mockUpdateDoc = vi.fn()
const mockSetDoc = vi.fn()
const mockDoc = vi.fn((..._args: unknown[]) => ({ id: 'mock-doc-ref' }))
const mockCollection = vi.fn((..._args: unknown[]) => ({ _collection: true }))
const mockServerTimestamp = vi.fn(() => 'SERVER_TIMESTAMP')

vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual('firebase/firestore')
  return {
    ...actual,
    doc: (...args: unknown[]) => mockDoc(...args),
    collection: (...args: unknown[]) => mockCollection(...args),
    getDocs: (...args: unknown[]) => mockGetDocs(...args),
    updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
    setDoc: (...args: unknown[]) => mockSetDoc(...args),
    serverTimestamp: () => mockServerTimestamp(),
  }
})

vi.mock('@/lib/firebase', () => ({
  db: { type: 'firestore' },
}))

function emptySnapshot() {
  return { docs: [] }
}

describe('一括インポート(上書き)の部分更新', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateDoc.mockResolvedValue(undefined)
    mockSetDoc.mockResolvedValue(undefined)
    mockGetDocs.mockResolvedValue(emptySnapshot())
  })

  describe('顧客(bulkImportCustomersWithActions)', () => {
    it('overwriteでupdateDocが呼ばれ、既存IDのdocを指定する', async () => {
      const { useBulkImportCustomersWithActions } = await import('../useMasters')
      const { renderHook, act } = await import('@testing-library/react')
      const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
      const React = await import('react')
      const queryClient = new QueryClient()
      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(QueryClientProvider, { client: queryClient }, children)

      const { result } = renderHook(() => useBulkImportCustomersWithActions(), { wrapper })
      await act(async () => {
        await result.current.mutateAsync([
          {
            data: { name: '田中太郎', furigana: 'タナカタロウ', notes: '北区在住' },
            existingId: 'cust-1',
            action: 'overwrite',
          },
        ])
      })

      expect(mockUpdateDoc).toHaveBeenCalledTimes(1)
      expect(mockSetDoc).not.toHaveBeenCalled()
      const [, data] = mockUpdateDoc.mock.calls[0] as [unknown, Record<string, unknown>]
      expect(data.notes).toBe('北区在住')
      // CSVテンプレートに無いフィールド(isContractEnded・isDuplicate)は送信されない
      expect('isContractEnded' in data).toBe(false)
      expect('isDuplicate' in data).toBe(false)
    })

    it('空欄のnotes・aliasesは送信データにキー自体が含まれない(空欄=変更しない)', async () => {
      const { useBulkImportCustomersWithActions } = await import('../useMasters')
      const { renderHook, act } = await import('@testing-library/react')
      const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
      const React = await import('react')
      const queryClient = new QueryClient()
      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(QueryClientProvider, { client: queryClient }, children)

      const { result } = renderHook(() => useBulkImportCustomersWithActions(), { wrapper })
      await act(async () => {
        await result.current.mutateAsync([
          { data: { name: '田中太郎', furigana: 'タナカタロウ' }, existingId: 'cust-1', action: 'overwrite' },
        ])
      })

      const [, data] = mockUpdateDoc.mock.calls[0] as [unknown, Record<string, unknown>]
      expect('notes' in data).toBe(false)
      expect('aliases' in data).toBe(false)
    })

    it('空欄のfuriganaは送信データにキー自体が含まれない(既存値を消さない、codex review指摘の回帰)', async () => {
      const { useBulkImportCustomersWithActions } = await import('../useMasters')
      const { renderHook, act } = await import('@testing-library/react')
      const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
      const React = await import('react')
      const queryClient = new QueryClient()
      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(QueryClientProvider, { client: queryClient }, children)

      const { result } = renderHook(() => useBulkImportCustomersWithActions(), { wrapper })
      await act(async () => {
        await result.current.mutateAsync([
          { data: { name: '田中太郎', furigana: '', notes: '北区在住' }, existingId: 'cust-1', action: 'overwrite' },
        ])
      })

      const [, data] = mockUpdateDoc.mock.calls[0] as [unknown, Record<string, unknown>]
      expect('furigana' in data).toBe(false)
      expect(data.notes).toBe('北区在住')
    })

    it('addは従来通りsetDocであること', async () => {
      const { useBulkImportCustomersWithActions } = await import('../useMasters')
      const { renderHook, act } = await import('@testing-library/react')
      const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
      const React = await import('react')
      const queryClient = new QueryClient()
      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(QueryClientProvider, { client: queryClient }, children)

      const { result } = renderHook(() => useBulkImportCustomersWithActions(), { wrapper })
      await act(async () => {
        await result.current.mutateAsync([
          { data: { name: '新規太郎', furigana: 'シンキタロウ' }, action: 'add' },
        ])
      })

      expect(mockSetDoc).toHaveBeenCalledTimes(1)
      expect(mockUpdateDoc).not.toHaveBeenCalled()
    })

    it('途中の1件が失敗しても後続行は処理され、失敗行はfailedNamesに記録される', async () => {
      mockUpdateDoc.mockRejectedValueOnce(new Error('no document to update')).mockResolvedValueOnce(undefined)

      const { useBulkImportCustomersWithActions } = await import('../useMasters')
      const { renderHook, act } = await import('@testing-library/react')
      const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
      const React = await import('react')
      const queryClient = new QueryClient()
      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(QueryClientProvider, { client: queryClient }, children)

      const { result } = renderHook(() => useBulkImportCustomersWithActions(), { wrapper })
      let importResult: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined
      await act(async () => {
        importResult = await result.current.mutateAsync([
          { data: { name: '失敗太郎', furigana: '' }, existingId: 'cust-fail', action: 'overwrite' },
          { data: { name: '成功太郎', furigana: '' }, existingId: 'cust-ok', action: 'overwrite' },
        ])
      })

      expect(mockUpdateDoc).toHaveBeenCalledTimes(2)
      expect(importResult?.failedNames).toEqual(['失敗太郎'])
      expect(importResult?.overwritten).toBe(1)
    })
  })

  describe('事業所(bulkImportOfficesWithActions)', () => {
    it('overwriteでupdateDocが呼ばれ、空欄のnotes・aliasesは送信されない', async () => {
      const { useBulkImportOfficesWithActions } = await import('../useMasters')
      const { renderHook, act } = await import('@testing-library/react')
      const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
      const React = await import('react')
      const queryClient = new QueryClient()
      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(QueryClientProvider, { client: queryClient }, children)

      const { result } = renderHook(() => useBulkImportOfficesWithActions(), { wrapper })
      await act(async () => {
        await result.current.mutateAsync([
          {
            data: { name: '〇〇訪問介護ステーション', shortName: '', aliases: '〇〇訪問介護|○○訪問介護' },
            existingId: 'office-1',
            action: 'overwrite',
          },
        ])
      })

      expect(mockUpdateDoc).toHaveBeenCalledTimes(1)
      expect(mockSetDoc).not.toHaveBeenCalled()
      const [, data] = mockUpdateDoc.mock.calls[0] as [unknown, Record<string, unknown>]
      expect(data.aliases).toEqual(['〇〇訪問介護', '○○訪問介護'])
      expect('shortName' in data).toBe(false)
      expect('notes' in data).toBe(false)
    })
  })

  describe('書類種別(bulkImportDocumentTypesWithActions)', () => {
    it('overwriteでupdateDocが呼ばれ、値がある別表記は送信される', async () => {
      const { useBulkImportDocumentTypesWithActions } = await import('../useMasters')
      const { renderHook, act } = await import('@testing-library/react')
      const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
      const React = await import('react')
      const queryClient = new QueryClient()
      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(QueryClientProvider, { client: queryClient }, children)

      const { result } = renderHook(() => useBulkImportDocumentTypesWithActions(), { wrapper })
      await act(async () => {
        await result.current.mutateAsync([
          {
            data: { name: '介護保険被保険者証', dateMarker: '', category: '', keywords: '', aliases: '被保険者証|介護保険証' },
            action: 'overwrite',
          },
        ])
      })

      expect(mockUpdateDoc).toHaveBeenCalledTimes(1)
      expect(mockSetDoc).not.toHaveBeenCalled()
      const [, data] = mockUpdateDoc.mock.calls[0] as [unknown, Record<string, unknown>]
      expect(data.aliases).toEqual(['被保険者証', '介護保険証'])
      expect('dateMarker' in data).toBe(false)
      expect('category' in data).toBe(false)
      expect('keywords' in data).toBe(false)
    })
  })

  describe('ケアマネ(bulkImportCareManagersWithActions)', () => {
    it('overwriteは実doc ID(existingId)でupdateDocを呼ぶ(名前ではない)', async () => {
      const { useBulkImportCareManagersWithActions } = await import('../useMasters')
      const { renderHook, act } = await import('@testing-library/react')
      const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
      const React = await import('react')
      const queryClient = new QueryClient()
      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(QueryClientProvider, { client: queryClient }, children)

      const { result } = renderHook(() => useBulkImportCareManagersWithActions(), { wrapper })
      await act(async () => {
        await result.current.mutateAsync([
          {
            data: { name: '佐藤花子', email: 'sato@example.com' },
            existingId: 'auto-generated-id-from-cli', // CLI(import-masters.js)由来の自動採番IDを模したフィクスチャ
            action: 'overwrite',
          },
        ])
      })

      expect(mockUpdateDoc).toHaveBeenCalledTimes(1)
      expect(mockSetDoc).not.toHaveBeenCalled()
      // doc()が実doc ID(existingId)で呼ばれていること(名前ではない)
      expect(mockDoc).toHaveBeenCalledWith(expect.anything(), 'masters/caremanagers/items', 'auto-generated-id-from-cli')
      const [, data] = mockUpdateDoc.mock.calls[0] as [unknown, Record<string, unknown>]
      expect(data.email).toBe('sato@example.com')
    })

    it('existingIdが無いoverwriteは新規追加(setDoc)にフォールバックする', async () => {
      const { useBulkImportCareManagersWithActions } = await import('../useMasters')
      const { renderHook, act } = await import('@testing-library/react')
      const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
      const React = await import('react')
      const queryClient = new QueryClient()
      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(QueryClientProvider, { client: queryClient }, children)

      const { result } = renderHook(() => useBulkImportCareManagersWithActions(), { wrapper })
      await act(async () => {
        await result.current.mutateAsync([
          { data: { name: '新規花子' }, action: 'overwrite' },
        ])
      })

      expect(mockSetDoc).toHaveBeenCalledTimes(1)
      expect(mockUpdateDoc).not.toHaveBeenCalled()
    })
  })
})
