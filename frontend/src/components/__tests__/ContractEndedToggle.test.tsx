/**
 * ContractEndedToggle 単体テスト(全スタッフが顧客の契約終了フラグを切り替える操作)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { CustomerMaster } from '@shared/types'

const mockMutateAsync = vi.fn()
vi.mock('@/hooks/useMasters', () => ({
  useSetCustomerContractEnded: () => ({ mutateAsync: mockMutateAsync, isPending: false }),
}))

import { ContractEndedToggle } from '../views/ContractEndedToggle'

const customer = (overrides: Partial<CustomerMaster> = {}): CustomerMaster => ({
  id: 'cust-1',
  name: '田中太郎',
  ...overrides,
})

describe('ContractEndedToggle', () => {
  beforeEach(() => {
    mockMutateAsync.mockReset()
    mockMutateAsync.mockResolvedValue(undefined)
  })

  it('対象顧客が特定できない(同姓同名・未登録)場合は操作を表示しない', () => {
    render(<ContractEndedToggle customer={null} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('契約中の顧客には「契約終了にする」を表示する', () => {
    render(<ContractEndedToggle customer={customer()} />)
    expect(screen.getByRole('button', { name: '契約終了にする' })).toBeDefined()
    expect(screen.queryByText('契約終了')).toBeNull()
  })

  it('契約終了の顧客には「契約終了」バッジと「契約中に戻す」を表示する', () => {
    render(<ContractEndedToggle customer={customer({ isContractEnded: true })} />)
    expect(screen.getByText('契約終了')).toBeDefined()
    expect(screen.getByRole('button', { name: '契約中に戻す' })).toBeDefined()
  })

  it('確認ダイアログで実行すると、顧客IDと反転した値で更新する', async () => {
    render(<ContractEndedToggle customer={customer()} />)
    fireEvent.click(screen.getByRole('button', { name: '契約終了にする' }))
    expect(screen.getByText(/今後届く未確認・選択待ちの書類も非表示/)).toBeDefined()
    expect(mockMutateAsync).not.toHaveBeenCalled()
    const buttons = screen.getAllByRole('button', { name: '契約終了にする' })
    fireEvent.click(buttons[buttons.length - 1]!)
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledWith({ id: 'cust-1', isContractEnded: true }))
  })

  it('契約中に戻す場合は false で更新する', async () => {
    render(<ContractEndedToggle customer={customer({ isContractEnded: true })} />)
    fireEvent.click(screen.getByRole('button', { name: '契約中に戻す' }))
    const buttons = screen.getAllByRole('button', { name: '契約中に戻す' })
    fireEvent.click(buttons[buttons.length - 1]!)
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledWith({ id: 'cust-1', isContractEnded: false }))
  })

  it('キャンセルすると書き込まない', () => {
    render(<ContractEndedToggle customer={customer()} />)
    fireEvent.click(screen.getByRole('button', { name: '契約終了にする' }))
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(mockMutateAsync).not.toHaveBeenCalled()
  })

  it('更新に失敗したらエラーを表示する', async () => {
    mockMutateAsync.mockRejectedValue(new Error('permission-denied'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<ContractEndedToggle customer={customer()} />)
    fireEvent.click(screen.getByRole('button', { name: '契約終了にする' }))
    const buttons = screen.getAllByRole('button', { name: '契約終了にする' })
    fireEvent.click(buttons[buttons.length - 1]!)
    await waitFor(() => expect(screen.getByText('契約状態の更新に失敗しました')).toBeDefined())
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
