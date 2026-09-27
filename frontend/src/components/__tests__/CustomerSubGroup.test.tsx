/**
 * CustomerSubGroup 単体テスト(同姓同名プロアクティブ通知UI、2026-07-26追加)
 *
 * CustomerSubGroupは5箇所のバッジ実装のうち唯一Firestore hookを持たず
 * documents/identityLookup propだけでレンダリングできるため、これを代表として
 * resolveCustomerUnconfirmedReason経由の「同姓同名」バッジ配線をコンポーネントテストする。
 */

import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Timestamp } from 'firebase/firestore'
import type { Document } from '@shared/types'
import type { CustomerIdentityLookup } from '@/hooks/useMasters'
import { CustomerSubGroup } from '../views/CustomerSubGroup'

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
      '顧客が未確定です。書類詳細で候補を選択するか、確認済みにすると表示中の候補で確定します'
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
