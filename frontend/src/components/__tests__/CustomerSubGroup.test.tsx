/**
 * CustomerSubGroup 単体テスト(同姓同名プロアクティブ通知UI、2026-07-26追加)
 *
 * CustomerSubGroupは5箇所のバッジ実装のうち唯一Firestore hookを持たず
 * documents/identityLookup propだけでレンダリングできるため、これを代表として
 * resolveCustomerUnconfirmedReason経由の「同姓同名」バッジ配線をコンポーネントテストする。
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Timestamp } from 'firebase/firestore'
import type { Document } from '@shared/types'
import type { CustomerIdentityLookup } from '@/hooks/useMasters'
import type { CustomerMaster } from '@shared/types'
import { buildCustomerNameIndex } from '@/lib/contractEnded'
import { CustomerSubGroup } from '../views/CustomerSubGroup'

// 契約終了切替(ContractEndedToggle)が使う更新フックのみをモックする(QueryClient不要にする)
vi.mock('@/hooks/useMasters', () => ({
  useSetCustomerContractEnded: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

const makeDocument = (overrides: Partial<Document> = {}): Document => ({
  id: 'doc-001',
  processedAt: Timestamp.now(),
  fileId: 'file-001',
  fileName: 'test.pdf',
  mimeType: 'application/pdf',
  ocrResult: '',
  documentType: 'ケアプラン',
  customerName: '松本 実',
  officeName: 'テスト事業所',
  fileUrl: 'https://example.com/test.pdf',
  fileDate: Timestamp.now(),
  isDuplicateCustomer: false,
  totalPages: 1,
  targetPageNumber: 1,
  status: 'processed',
  verified: true,
  ...overrides,
})

const makeLookup = (sameNameCollisionNames: string[]): CustomerIdentityLookup => ({
  isReady: true,
  sameNameCollisionNames: new Set(sameNameCollisionNames),
  customerMasterNameById: new Map(),
})

/** 顧客グループ→フォルダグループの2段展開をクリックしてDocumentRowを可視化する */
function expandToDocumentRow(customerName: string, documentType: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(customerName) }))
  fireEvent.click(screen.getByRole('button', { name: new RegExp(documentType) }))
}

describe('CustomerSubGroup - 同姓同名バッジ', () => {
  it('両方未設定(レガシーdoc) + 同名衝突ありは「同姓同名」バッジを表示する(本件の中核)', () => {
    const doc = makeDocument()
    render(
      <CustomerSubGroup
        documents={[doc]}
        identityLookup={makeLookup(['松本 実'])}
      />
    )
    expandToDocumentRow('松本 実', 'ケアプラン')
    expect(screen.getByText('同姓同名')).toBeDefined()
  })

  it('両方未設定 + 同名衝突なし(同名1件)は「同姓同名」バッジを表示しない(後方互換)', () => {
    const doc = makeDocument()
    render(
      <CustomerSubGroup
        documents={[doc]}
        identityLookup={makeLookup([])}
      />
    )
    expandToDocumentRow('松本 実', 'ケアプラン')
    expect(screen.queryByText('同姓同名')).toBeNull()
  })

  it('customerConfirmed:true + 同名衝突ありは「同姓同名」バッジを表示しない(人間確定優先)', () => {
    const doc = makeDocument({ customerConfirmed: true })
    render(
      <CustomerSubGroup
        documents={[doc]}
        identityLookup={makeLookup(['松本 実'])}
      />
    )
    expandToDocumentRow('松本 実', 'ケアプラン')
    expect(screen.queryByText('同姓同名')).toBeNull()
  })

  it('customerConfirmed:false + 同名衝突なしは既存の「選択待ち」バッジを表示する(既存挙動の回帰固定)', () => {
    const doc = makeDocument({ customerConfirmed: false })
    render(
      <CustomerSubGroup
        documents={[doc]}
        identityLookup={makeLookup([])}
      />
    )
    expandToDocumentRow('松本 実', 'ケアプラン')
    expect(screen.getByText('選択待ち')).toBeDefined()
    expect(screen.queryByText('同姓同名')).toBeNull()
  })

  // Issue #1044(PR #1041のpr-test-analyzer指摘): Issue #1034で追加された理由メッセージが
  // 未テストだった。「選択待ち」バッジのtitle属性(ホバー時の理由表示)に含まれることを検証する。
  it('customerConfirmed:false + 同名衝突なしは「選択待ち」バッジのtitleに顧客未確定の理由メッセージを含む', () => {
    const doc = makeDocument({ customerConfirmed: false })
    render(
      <CustomerSubGroup
        documents={[doc]}
        identityLookup={makeLookup([])}
      />
    )
    expandToDocumentRow('松本 実', 'ケアプラン')
    expect(screen.getByText('選択待ち').getAttribute('title')).toBe(
      '利用者が未確定です。書類詳細で候補を選択するか、確認済みにすると表示中の候補で確定します'
    )
  })

  it('前後空白付きcustomerNameでもtrim後に衝突集合と一致すれば「同姓同名」バッジを表示する(trim整合)', () => {
    const doc = makeDocument({ customerName: ' 松本 実 ' })
    render(
      <CustomerSubGroup
        documents={[doc]}
        identityLookup={makeLookup(['松本 実'])}
      />
    )
    expandToDocumentRow('松本 実', 'ケアプラン')
    expect(screen.getByText('同姓同名')).toBeDefined()
  })
})

describe('CustomerSubGroup - 契約終了ボタン(担当CM別、2026-10-27)', () => {
  const master = (overrides: Partial<CustomerMaster> & { id: string; name: string }): CustomerMaster => overrides

  it('customerNameIndex未指定(他のタブ等)ではボタンを出さない(後方互換)', () => {
    render(<CustomerSubGroup documents={[makeDocument({ customerKey: '松本実' })]} />)
    expect(screen.queryByRole('button', { name: '契約終了にする' })).toBeNull()
  })

  it('名前キーが一意の顧客の行には「契約終了にする」を出す', () => {
    const index = buildCustomerNameIndex([master({ id: 'a', name: '松本 実' })])
    render(
      <CustomerSubGroup
        documents={[makeDocument({ customerKey: '松本実' })]}
        customerNameIndex={index}
      />
    )
    expect(screen.getByRole('button', { name: '契約終了にする' })).toBeDefined()
  })

  it('同姓同名(名前キーが一致する顧客が複数)の行にはボタンを出さない', () => {
    const index = buildCustomerNameIndex([
      master({ id: 'a', name: '松本 実' }),
      master({ id: 'b', name: '松本　実' }),
    ])
    render(
      <CustomerSubGroup
        documents={[makeDocument({ customerKey: '松本実' })]}
        customerNameIndex={index}
      />
    )
    expect(screen.queryByRole('button', { name: '契約終了にする' })).toBeNull()
  })

  it('マスター未登録の顧客(例: 未判定)の行にはボタンを出さない', () => {
    const index = buildCustomerNameIndex([master({ id: 'a', name: '別の人' })])
    render(
      <CustomerSubGroup
        documents={[makeDocument({ customerKey: '松本実' })]}
        customerNameIndex={index}
      />
    )
    expect(screen.queryByRole('button', { name: '契約終了にする' })).toBeNull()
  })

  it('契約終了の顧客の行には「契約終了」バッジと「契約中に戻す」を出す', () => {
    const index = buildCustomerNameIndex([master({ id: 'a', name: '松本 実', isContractEnded: true })])
    render(
      <CustomerSubGroup
        documents={[makeDocument({ customerKey: '松本実' })]}
        customerNameIndex={index}
      />
    )
    expect(screen.getByText('契約終了')).toBeDefined()
    expect(screen.getByRole('button', { name: '契約中に戻す' })).toBeDefined()
  })

  it('切替ボタンを押しても利用者行の展開は発火しない', () => {
    const index = buildCustomerNameIndex([master({ id: 'a', name: '松本 実' })])
    render(
      <CustomerSubGroup
        documents={[makeDocument({ customerKey: '松本実' })]}
        customerNameIndex={index}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: '契約終了にする' }))
    expect(screen.queryByText(/ケアプラン/)).toBeNull()
  })
})

describe('CustomerSubGroup - 保存値「不明顧客」の見出し表示', () => {
  it('グループ見出しは「不明顧客」でなく「不明利用者」を表示する', () => {
    render(
      <CustomerSubGroup
        documents={[makeDocument({ customerName: '不明顧客' })]}
        identityLookup={makeLookup([])}
      />
    )
    expect(screen.getByRole('button', { name: /不明利用者/ })).toBeDefined()
    expect(screen.queryByText(/不明顧客/)).toBeNull()
  })

  it('実在の利用者名の見出しはそのまま表示する', () => {
    render(
      <CustomerSubGroup
        documents={[makeDocument({ customerName: '松本 実' })]}
        identityLookup={makeLookup([])}
      />
    )
    expect(screen.getByRole('button', { name: /松本 実/ })).toBeDefined()
  })
})
