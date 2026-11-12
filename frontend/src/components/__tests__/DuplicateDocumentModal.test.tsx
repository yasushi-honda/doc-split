/**
 * DuplicateDocumentModal 単体テスト (ADR-0032: 複数名FAXの手動複製ボタン)
 *
 * 検証する契約:
 *   - 候補欄: OCRの完全一致候補のみ(元の書類の利用者・fuzzy/partial・重複IDは除く)
 *   - 同姓同名を区別できる表示(担当ケアマネ・区別用メモ)
 *   - 選択: 追加/取り消し、同じ利用者は二重に入らない、1回の選択は4名まで
 *   - 実行: callable に { documentId, customerIds } を選択順で渡す
 *   - 結果: 作成/作成済み(skipped)/エラーの各表示、エラー時はモーダルを閉じず選択を保持
 *
 * 氏名・事業所名はすべて架空の値。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { Timestamp } from 'firebase/firestore'
import type { CustomerCandidateInfo, CustomerMaster, Document } from '@shared/types'

const isDisabled = (el: HTMLElement): boolean => (el as HTMLButtonElement).disabled

vi.mock('@/lib/firebase', () => ({
  storage: {},
}))

// マスター取得(Firestore経由)をバイパス
let mockCustomers: CustomerMaster[] = []
let mockMasterError = false
let mockMasterLoading = false
vi.mock('@/hooks/useDocuments', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useDocuments')>('@/hooks/useDocuments')
  return {
    ...actual,
    useCustomerMasters: () => ({
      data: mockMasterError || mockMasterLoading ? undefined : mockCustomers,
      isError: mockMasterError,
      isLoading: mockMasterLoading,
    }),
  }
})

// MasterSelectField は内部で react-query hook を呼ぶため、渡された items の確認と選択操作だけのスタブにする
vi.mock('@/components/MasterSelectField', () => ({
  MasterSelectField: ({
    items,
    onChange,
    disabled,
  }: {
    items: Array<{ id: string; name: string; notes?: string }>
    onChange: (v: string, item?: { id: string; name: string }) => void
    disabled?: boolean
  }) => (
    <div data-testid="master-select-stub" data-disabled={String(!!disabled)}>
      {items.map((item) => (
        <button key={item.id} onClick={() => onChange(item.name, item)}>{`pick:${item.id}`}</button>
      ))}
    </div>
  ),
}))

// 複製mutation(Cloud Functions呼び出し)をバイパス
const mockMutateAsync = vi.fn()
let mockPending = false
vi.mock('@/hooks/useDuplicateDocument', () => ({
  useDuplicateDocument: () => ({ mutateAsync: mockMutateAsync, isPending: mockPending }),
}))

const mockToastError = vi.fn()
const mockToastSuccess = vi.fn()
const mockToastInfo = vi.fn()
const mockToastWarning = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    success: (...args: unknown[]) => mockToastSuccess(...args),
    info: (...args: unknown[]) => mockToastInfo(...args),
    warning: (...args: unknown[]) => mockToastWarning(...args),
  },
}))

import { DuplicateDocumentModal } from '../DuplicateDocumentModal'

function candidate(overrides: Partial<CustomerCandidateInfo> & { customerId: string; customerName: string }): CustomerCandidateInfo {
  return {
    isDuplicate: false,
    score: 100,
    matchType: 'exact',
    ...overrides,
  }
}

const makeDocument = (overrides: Partial<Document> = {}): Document => ({
  id: 'src1',
  processedAt: Timestamp.now(),
  fileId: 'file-001',
  fileName: 'fax.pdf',
  mimeType: 'application/pdf',
  documentType: '提供票',
  customerName: 'テスト太郎',
  customerId: 'c-src',
  officeName: 'テスト事業所',
  fileUrl: 'https://example.com/fax.pdf',
  fileDate: Timestamp.now(),
  isDuplicateCustomer: false,
  totalPages: 2,
  targetPageNumber: 1,
  status: 'processed',
  customerConfirmed: true,
  customerCandidates: [
    candidate({ customerId: 'c-src', customerName: 'テスト太郎' }),
    candidate({ customerId: 'c-a', customerName: 'テスト花子' }),
    candidate({ customerId: 'c-b', customerName: 'テスト次郎' }),
    candidate({ customerId: 'c-fuzzy', customerName: 'テスト曖昧', matchType: 'fuzzy', score: 70 }),
    candidate({ customerId: 'c-partial', customerName: 'テスト部分', matchType: 'partial', score: 80 }),
    candidate({ customerId: 'c-a', customerName: 'テスト花子' }), // 重複ID
  ],
  ...overrides,
})

function master(id: string, name: string, extra: Partial<CustomerMaster> = {}): CustomerMaster {
  return { id, name, ...extra }
}

function renderModal(overrides: { document?: Document; onOpenChange?: (open: boolean) => void } = {}) {
  const onOpenChange = overrides.onOpenChange ?? vi.fn()
  render(
    <DuplicateDocumentModal
      document={overrides.document ?? makeDocument()}
      open={true}
      onOpenChange={onOpenChange}
    />
  )
  return { onOpenChange }
}

const submitButton = () => screen.getByRole('button', { name: /複製する|複製中/ })

function callableError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code: `functions/${code}` })
}

describe('DuplicateDocumentModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPending = false
    mockMasterError = false
    mockMasterLoading = false
    mockCustomers = [
      master('c-src', 'テスト太郎', { careManagerName: '担当甲' }),
      master('c-a', 'テスト花子', { careManagerName: '担当乙' }),
      master('c-b', 'テスト次郎', { careManagerName: '担当丙' }),
      master('c-c', 'テスト三郎'),
      master('c-d', 'テスト四郎'),
      master('c-e', 'テスト五郎'),
    ]
    mockMutateAsync.mockResolvedValue({ created: [], skipped: [] })
  })

  describe('候補欄(OCRの完全一致候補)', () => {
    it('完全一致の候補だけを表示する(fuzzy/partialは出さない)', () => {
      renderModal()
      expect(screen.getByRole('checkbox', { name: /テスト花子/ })).toBeTruthy()
      expect(screen.getByRole('checkbox', { name: /テスト次郎/ })).toBeTruthy()
      expect(screen.queryByRole('checkbox', { name: /テスト曖昧/ })).toBeNull()
      expect(screen.queryByRole('checkbox', { name: /テスト部分/ })).toBeNull()
    })

    it('元の書類の利用者は候補に出さない', () => {
      renderModal()
      expect(screen.queryByRole('checkbox', { name: /テスト太郎/ })).toBeNull()
    })

    it('同じ customerId の候補は1件にまとめる', () => {
      renderModal()
      expect(screen.getAllByRole('checkbox', { name: /テスト花子/ })).toHaveLength(1)
    })

    it('候補が無い書類では候補欄を出さず、検索欄は使える', () => {
      renderModal({ document: makeDocument({ customerCandidates: undefined }) })
      expect(screen.queryByText('OCRが読み取った利用者')).toBeNull()
      expect(screen.getByTestId('master-select-stub')).toBeTruthy()
    })

    it('同姓同名を区別できるよう、担当ケアマネと区別用メモを併記する', () => {
      mockCustomers = [
        master('c-src', 'テスト太郎'),
        master('c-a', 'テスト花子', { careManagerName: '担当乙', notes: '北在住' }),
      ]
      renderModal({ document: makeDocument({ customerCandidates: [candidate({ customerId: 'c-a', customerName: 'テスト花子' })] }) })
      const box = screen.getByRole('checkbox', { name: /テスト花子/ })
      expect(box.getAttribute('aria-label')).toContain('北在住')
      expect(box.getAttribute('aria-label')).toContain('担当乙')
    })
  })

  describe('選択', () => {
    it('何も選んでいないときは「複製する」が押せない', () => {
      renderModal()
      expect(isDisabled(submitButton())).toBe(true)
    })

    it('候補にチェックすると押せるようになり、人数がボタンに出る', () => {
      renderModal()
      fireEvent.click(screen.getByRole('checkbox', { name: /テスト花子/ }))
      expect(isDisabled(submitButton())).toBe(false)
      expect(submitButton().textContent).toContain('1名分')
    })

    it('チェックを外すと選択から消える', () => {
      renderModal()
      const box = screen.getByRole('checkbox', { name: /テスト花子/ })
      fireEvent.click(box)
      fireEvent.click(box)
      expect(isDisabled(submitButton())).toBe(true)
    })

    it('検索欄で選んだ利用者が複製先に追加される', () => {
      renderModal()
      fireEvent.click(screen.getByText('pick:c-c'))
      expect(screen.getByRole('button', { name: /テスト三郎を外す/ })).toBeTruthy()
      expect(submitButton().textContent).toContain('1名分')
    })

    it('検索欄の選択肢から、元の書類の利用者と選択済みの利用者を除く', () => {
      renderModal()
      expect(screen.queryByText('pick:c-src')).toBeNull()
      fireEvent.click(screen.getByText('pick:c-c'))
      expect(screen.queryByText('pick:c-c')).toBeNull()
    })

    it('候補でチェックした利用者を検索欄から重ねて追加しても二重に入らない', () => {
      renderModal()
      fireEvent.click(screen.getByRole('checkbox', { name: /テスト花子/ }))
      expect(screen.queryByText('pick:c-a')).toBeNull()
      expect(submitButton().textContent).toContain('1名分')
    })

    it('複製先の一覧の「外す」で選択から消せる', () => {
      renderModal()
      fireEvent.click(screen.getByText('pick:c-c'))
      fireEvent.click(screen.getByRole('button', { name: /テスト三郎を外す/ }))
      expect(isDisabled(submitButton())).toBe(true)
    })

    it('1回の選択は4名まで: 4名選ぶと残りの候補は選べなくなり、検索欄の選択肢も出ない', () => {
      renderModal()
      fireEvent.click(screen.getByText('pick:c-c'))
      fireEvent.click(screen.getByText('pick:c-d'))
      fireEvent.click(screen.getByText('pick:c-e'))
      fireEvent.click(screen.getByRole('checkbox', { name: /テスト花子/ }))
      expect(submitButton().textContent).toContain('4名分')

      expect(isDisabled(screen.getByRole('checkbox', { name: /テスト次郎/ }))).toBe(true)
      expect(screen.queryByText('pick:c-b')).toBeNull()
      expect(screen.getByText(/最大4名/)).toBeTruthy()
    })
  })

  describe('実行', () => {
    it('callable に { documentId, customerIds } を選択順で渡す', async () => {
      renderModal()
      fireEvent.click(screen.getByText('pick:c-c'))
      fireEvent.click(screen.getByRole('checkbox', { name: /テスト花子/ }))
      fireEvent.click(submitButton())

      await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1))
      expect(mockMutateAsync).toHaveBeenCalledWith({ documentId: 'src1', customerIds: ['c-c', 'c-a'] })
    })

    it('成功すると件数を表示してモーダルを閉じる', async () => {
      mockMutateAsync.mockResolvedValue({
        created: [
          { customerId: 'c-a', documentId: 'src1_dup_c-a' },
          { customerId: 'c-b', documentId: 'src1_dup_c-b' },
        ],
        skipped: [],
      })
      const { onOpenChange } = renderModal()
      fireEvent.click(screen.getByRole('checkbox', { name: /テスト花子/ }))
      fireEvent.click(screen.getByRole('checkbox', { name: /テスト次郎/ }))
      fireEvent.click(submitButton())

      await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledTimes(1))
      expect(String(mockToastSuccess.mock.calls[0]?.[0])).toContain('2名分')
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it('一部が作成済みなら、作成した件数と作成済みの件数を両方伝える', async () => {
      mockMutateAsync.mockResolvedValue({
        created: [{ customerId: 'c-b', documentId: 'src1_dup_c-b' }],
        skipped: [{ customerId: 'c-a', reason: 'already-exists' }],
      })
      renderModal()
      fireEvent.click(screen.getByRole('checkbox', { name: /テスト花子/ }))
      fireEvent.click(screen.getByRole('checkbox', { name: /テスト次郎/ }))
      fireEvent.click(submitButton())

      await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledTimes(1))
      const message = String(mockToastSuccess.mock.calls[0]?.[0])
      expect(message).toContain('1名分')
      expect(message).toContain('作成済み')
    })

    it('全員が作成済みなら、エラーではなく「作成済み」と伝えて閉じる', async () => {
      mockMutateAsync.mockResolvedValue({
        created: [],
        skipped: [{ customerId: 'c-a', reason: 'already-exists' }],
      })
      const { onOpenChange } = renderModal()
      fireEvent.click(screen.getByRole('checkbox', { name: /テスト花子/ }))
      fireEvent.click(submitButton())

      await waitFor(() => expect(mockToastInfo).toHaveBeenCalledTimes(1))
      expect(String(mockToastInfo.mock.calls[0]?.[0])).toContain('作成済み')
      expect(mockToastError).not.toHaveBeenCalled()
      expect(mockToastSuccess).not.toHaveBeenCalled()
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it('エラー時はBE側の説明文を表示し、モーダルを閉じず選択を保持する', async () => {
      mockMutateAsync.mockRejectedValue(
        callableError('failed-precondition', '元の書類の利用者が確定していません。先に利用者を決めてください')
      )
      const { onOpenChange } = renderModal()
      fireEvent.click(screen.getByRole('checkbox', { name: /テスト花子/ }))
      fireEvent.click(submitButton())

      await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1))
      expect(String(mockToastError.mock.calls[0]?.[0])).toContain('利用者が確定していません')
      expect(onOpenChange).not.toHaveBeenCalledWith(false)
      expect(isDisabled(submitButton())).toBe(false)
      expect(submitButton().textContent).toContain('1名分')
    })

    it('入力不正・マスター不在のエラーも、BE側の説明文をそのまま表示する', async () => {
      mockMutateAsync.mockRejectedValue(callableError('not-found', '選んだ利用者がマスターに見つかりません'))
      renderModal()
      fireEvent.click(screen.getByRole('checkbox', { name: /テスト花子/ }))
      fireEvent.click(submitButton())

      await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1))
      expect(String(mockToastError.mock.calls[0]?.[0])).toContain('マスターに見つかりません')
    })

    it('通信エラーは既存の共通文言で表示する', async () => {
      mockMutateAsync.mockRejectedValue(callableError('internal', 'internal'))
      renderModal()
      fireEvent.click(screen.getByRole('checkbox', { name: /テスト花子/ }))
      fireEvent.click(submitButton())

      await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1))
      expect(String(mockToastError.mock.calls[0]?.[0])).toContain('通信エラー')
    })

    it('実行中は「複製中…」で押せない(二重送信を防ぐ)', () => {
      mockPending = true
      renderModal()
      fireEvent.click(screen.getByRole('checkbox', { name: /テスト花子/ }))
      expect(submitButton().textContent).toContain('複製中')
      expect(isDisabled(submitButton())).toBe(true)
    })
  })

  describe('結果の伝え方', () => {
    it('付け替えられた複製(reassigned)は、「作成済み」ではなく、削除してから複製し直す手順を伝える', async () => {
      mockMutateAsync.mockResolvedValue({
        created: [],
        skipped: [{ customerId: 'c-a', reason: 'reassigned' }],
      })
      renderModal()
      fireEvent.click(screen.getByRole('checkbox', { name: /テスト花子/ }))
      fireEvent.click(submitButton())

      await waitFor(() => expect(mockToastWarning).toHaveBeenCalledTimes(1))
      const message = String(mockToastWarning.mock.calls[0]?.[0])
      expect(message).toContain('付け替え')
      expect(message).toContain('削除')
      // 実際には書類が無いので「すでに作成済みです」とは言わない
      expect(mockToastInfo).not.toHaveBeenCalled()
    })

    it('一部が作成され、一部が付け替え済みなら、作成の結果と付け替えの案内を両方出す', async () => {
      mockMutateAsync.mockResolvedValue({
        created: [{ customerId: 'c-b', documentId: 'src1_dup_c-b' }],
        skipped: [{ customerId: 'c-a', reason: 'reassigned' }],
      })
      renderModal()
      fireEvent.click(screen.getByRole('checkbox', { name: /テスト花子/ }))
      fireEvent.click(screen.getByRole('checkbox', { name: /テスト次郎/ }))
      fireEvent.click(submitButton())

      await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledTimes(1))
      expect(String(mockToastSuccess.mock.calls[0]?.[0])).toContain('1名分')
      expect(mockToastWarning).toHaveBeenCalledTimes(1)
    })

    it('入力不正(invalid-argument)も、BE側の説明文をそのまま表示する', async () => {
      mockMutateAsync.mockRejectedValue(callableError('invalid-argument', '元の書類と同じ利用者は指定できません'))
      renderModal()
      fireEvent.click(screen.getByRole('checkbox', { name: /テスト花子/ }))
      fireEvent.click(submitButton())

      await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1))
      expect(String(mockToastError.mock.calls[0]?.[0])).toContain('元の書類と同じ利用者は指定できません')
    })
  })

  describe('元の書類の利用者が未確定のとき', () => {
    it('押す前に案内を出し、「複製する」を押せなくする(押した後のエラーで初めて知らせない)', () => {
      renderModal({ document: makeDocument({ customerConfirmed: false }) })
      expect(screen.getByText(/利用者がまだ確定していません/)).toBeTruthy()
      fireEvent.click(screen.getByRole('checkbox', { name: /テスト花子/ }))
      expect(isDisabled(submitButton())).toBe(true)
    })

    it('customerConfirmed が未設定の書類も、未確定として扱う(BEと同じ)', () => {
      const document = makeDocument()
      delete (document as { customerConfirmed?: boolean }).customerConfirmed
      renderModal({ document })
      expect(screen.getByText(/利用者がまだ確定していません/)).toBeTruthy()
    })

    it('確定済みの書類では案内を出さない', () => {
      renderModal()
      expect(screen.queryByText(/利用者がまだ確定していません/)).toBeNull()
    })
  })

  describe('利用者マスターの読み込み', () => {
    it('読み込みに失敗したら、「該当なし」に見えないよう失敗を伝え、検索欄を使えなくする(OCR候補は選べる)', () => {
      mockMasterError = true
      renderModal()
      expect(screen.getByText(/利用者マスターを読み込めませんでした/)).toBeTruthy()
      expect(screen.getByTestId('master-select-stub').getAttribute('data-disabled')).toBe('true')
      // OCR候補(書類に保存済みの情報)は、マスターが読めなくても選べる
      fireEvent.click(screen.getByRole('checkbox', { name: /テスト花子/ }))
      expect(isDisabled(submitButton())).toBe(false)
    })

    it('読み込み中は検索欄を使えなくする', () => {
      mockMasterLoading = true
      renderModal()
      expect(screen.getByTestId('master-select-stub').getAttribute('data-disabled')).toBe('true')
    })

    it('読み込みに成功していれば、失敗の案内は出ず、検索欄が使える', () => {
      renderModal()
      expect(screen.queryByText(/利用者マスターを読み込めませんでした/)).toBeNull()
      expect(screen.getByTestId('master-select-stub').getAttribute('data-disabled')).toBe('false')
    })
  })

  describe('選択の状態管理', () => {
    it('閉じて開き直すと、前回の選択は空に戻る', () => {
      const { rerender } = render(
        <DuplicateDocumentModal document={makeDocument()} open={true} onOpenChange={vi.fn()} />
      )
      fireEvent.click(screen.getByRole('checkbox', { name: /テスト花子/ }))
      expect(submitButton().textContent).toContain('1名分')

      rerender(<DuplicateDocumentModal document={makeDocument()} open={false} onOpenChange={vi.fn()} />)
      rerender(<DuplicateDocumentModal document={makeDocument()} open={true} onOpenChange={vi.fn()} />)

      expect(isDisabled(submitButton())).toBe(true)
      expect(screen.getByText('まだ選ばれていません')).toBeTruthy()
    })

    it('上限(4名)に達しても、チェック済みの候補は外せる(未選択の候補だけが選べなくなる)', () => {
      renderModal()
      fireEvent.click(screen.getByText('pick:c-c'))
      fireEvent.click(screen.getByText('pick:c-d'))
      fireEvent.click(screen.getByText('pick:c-e'))
      fireEvent.click(screen.getByRole('checkbox', { name: /テスト花子/ }))

      expect(isDisabled(screen.getByRole('checkbox', { name: /テスト花子/ }))).toBe(false)
      expect(isDisabled(screen.getByRole('checkbox', { name: /テスト次郎/ }))).toBe(true)
    })
  })

  describe('説明文', () => {
    it('元の書類は今の利用者のままであることと、未確認で作られることを伝える', () => {
      renderModal()
      const dialog = screen.getByRole('dialog')
      expect(within(dialog).getByText(/今の利用者/)).toBeTruthy()
      expect(within(dialog).getByText(/確認済みにする/)).toBeTruthy()
    })

    it('キャンセルで閉じる', () => {
      const { onOpenChange } = renderModal()
      fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })
})
