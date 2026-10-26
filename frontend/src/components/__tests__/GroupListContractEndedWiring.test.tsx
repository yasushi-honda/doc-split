/**
 * GroupList → ContractEndedToggle の配線テスト
 *
 * 利用者別タブでのみ、名前キーが一意に決まる顧客の見出しに契約終了切替を出すこと、
 * 同姓同名・未登録・他タブでは出さないこと、切替ボタン押下で見出しの展開が誤発火しないことを確認する。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Timestamp } from 'firebase/firestore'
import type { CustomerMaster } from '@shared/types'

const mockUseDocumentGroups = vi.fn()
vi.mock('@/hooks/useDocumentGroups', () => ({
  useDocumentGroups: (...a: unknown[]) => mockUseDocumentGroups(...a),
  useGroupStats: () => ({ data: undefined }),
}))

const mockCustomers: { data: CustomerMaster[] | undefined } = { data: [] }
vi.mock('@/hooks/useMasters', () => ({
  useCustomers: () => mockCustomers,
  useDocumentTypes: () => ({ data: [], isError: false }),
  useContractEndedLookup: () => ({ isReady: true, endedById: new Map(), fullyEndedNameKeys: new Set() }),
  useSetCustomerContractEnded: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('../views/GroupDocumentList', () => ({
  GroupDocumentList: () => <div data-testid="group-docs" />,
}))

import { GroupList } from '../views/GroupList'

const group = (groupKey: string, displayName: string, groupType: string) => ({
  id: `${groupType}_${groupKey}`,
  groupType,
  groupKey,
  displayName,
  count: 1,
  latestAt: Timestamp.now(),
})

function mockGroups(groupType: string, groups: ReturnType<typeof group>[]) {
  mockUseDocumentGroups.mockReturnValue({ data: groups, isLoading: false, isError: false, error: null })
  return groupType
}

describe('GroupList の契約終了切替の配線', () => {
  beforeEach(() => {
    mockUseDocumentGroups.mockReset()
    mockCustomers.data = [
      { id: 'a', name: '田中太郎' },
      { id: 'b', name: '鈴木花子' },
      { id: 'c', name: '鈴木　花子' },
    ]
  })

  it('利用者別: 名前キーが一意の顧客の見出しにだけ「契約終了にする」を出す', () => {
    mockGroups('customer', [
      group('田中太郎', '田中太郎', 'customer'),
      group('鈴木花子', '鈴木花子', 'customer'),
      group('不明顧客', '不明顧客', 'customer'),
    ])
    render(<GroupList groupType="customer" />)
    expect(screen.getAllByRole('button', { name: '契約終了にする' })).toHaveLength(1)
  })

  it('利用者別以外のタブ(事業所別)では出さない', () => {
    mockGroups('office', [group('田中太郎', '田中太郎', 'office')])
    render(<GroupList groupType="office" />)
    expect(screen.queryByRole('button', { name: '契約終了にする' })).toBeNull()
  })

  it('切替ボタンを押してもグループの展開は発火しない', () => {
    mockGroups('customer', [group('田中太郎', '田中太郎', 'customer')])
    render(<GroupList groupType="customer" />)
    fireEvent.click(screen.getByRole('button', { name: '契約終了にする' }))
    expect(screen.queryByTestId('group-docs')).toBeNull()
  })
})
