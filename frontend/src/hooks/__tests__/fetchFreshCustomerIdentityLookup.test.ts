/**
 * fetchFreshCustomerIdentityLookup 単体テスト
 *
 * codexレビュー指摘(P1、7回目): `getDocs()`(既定)はFirestore SDKのローカルキャッシュ
 * (IndexedDB永続化が有効な場合、オフライン時等)から解決されうるため、「新規取得」の
 * 意図に反して古いマスター一覧を返す恐れがあった。`getDocsFromServer()`を使うことを
 * 検証する回帰テスト(useCustomers()のキャッシュ許容パス(fetchCustomers)は引き続き
 * `getDocs()`のままであることも合わせて確認する)。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetDocs = vi.fn()
const mockGetDocsFromServer = vi.fn()
const mockCollection = vi.fn().mockReturnValue({ id: 'customers-ref' })

vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual('firebase/firestore')
  return {
    ...actual,
    collection: (...args: unknown[]) => mockCollection(...args),
    getDocs: (...args: unknown[]) => mockGetDocs(...args),
    getDocsFromServer: (...args: unknown[]) => mockGetDocsFromServer(...args),
  }
})

vi.mock('@/lib/firebase', () => ({
  db: { type: 'firestore' },
}))

function makeSnapshot(customers: Array<{ id: string; name: string }>) {
  return {
    docs: customers.map((c) => ({
      id: c.id,
      data: () => ({ name: c.name }),
    })),
  }
}

describe('fetchFreshCustomerIdentityLookup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('getDocsFromServer()を使う(getDocs()は使わない、サーバー到達不能時にキャッシュへフォールバックさせないため)', async () => {
    mockGetDocsFromServer.mockResolvedValue(makeSnapshot([{ id: 'c1', name: '田村 勝義' }]))
    const { fetchFreshCustomerIdentityLookup } = await import('../useMasters')

    await fetchFreshCustomerIdentityLookup()

    expect(mockGetDocsFromServer).toHaveBeenCalledTimes(1)
    expect(mockGetDocs).not.toHaveBeenCalled()
  })

  it('取得結果からsameNameCollisionNames/customerMasterNameByIdを正しく組み立てる', async () => {
    mockGetDocsFromServer.mockResolvedValue(
      makeSnapshot([
        { id: 'c1', name: '田村 勝義' },
        { id: 'c2', name: '田村 勝義' },
        { id: 'c3', name: '鈴木花子' },
      ])
    )
    const { fetchFreshCustomerIdentityLookup } = await import('../useMasters')

    const result = await fetchFreshCustomerIdentityLookup()

    expect(result.sameNameCollisionNames.has('田村 勝義')).toBe(true)
    expect(result.sameNameCollisionNames.has('鈴木花子')).toBe(false)
    expect(result.customerMasterNameById.get('c1')).toBe('田村 勝義')
    expect(result.customerMasterNameById.get('c3')).toBe('鈴木花子')
  })

  it('getDocsFromServer()が失敗した場合はエラーをそのまま呼出元へ伝播する(fail-closed、もみ消さない)', async () => {
    mockGetDocsFromServer.mockRejectedValue(new Error('server unreachable'))
    const { fetchFreshCustomerIdentityLookup } = await import('../useMasters')

    await expect(fetchFreshCustomerIdentityLookup()).rejects.toThrow('server unreachable')
  })
})
