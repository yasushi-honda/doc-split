/**
 * fetchGroupDocuments 単体テスト (Issue #1046)
 *
 * hasMore算出が「除外(split等)後の件数」だけを見ており、生スナップショットが
 * limit(pageSize*2)ちょうどで返ってきた場合(=Firestore側に後続docが残っている
 * 可能性がある)を無視していた。除外対象が生バッチの過半数を占めると、除外後件数が
 * pageSize以下になり早期打ち切りが発生しうる。
 *
 * カーソル(lastDoc)も「除外後リストの末尾」基準だったため、素朴に生バッチの消化状況を
 * hasMoreへ足すだけだと、除外後0件のケースでlastDoc=nullかつhasMore=trueとなり、
 * startAfterが適用されず同じ生バッチを無限に再取得するループに陥るリスクがあった。
 */

import { describe, it, expect, vi } from 'vitest'

const mockGetDocs = vi.fn()

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, path: string) => ({ path })),
  query: vi.fn((...args: unknown[]) => ({ args })),
  where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
  orderBy: vi.fn((field: string, direction: string) => ({ field, direction })),
  limit: vi.fn((n: number) => ({ limit: n })),
  startAfter: vi.fn((doc: unknown) => ({ startAfter: doc })),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
}))

vi.mock('@/lib/firebase', () => ({
  db: { type: 'firestore' },
}))

import { fetchGroupDocuments } from '../useDocumentGroups'

function fakeDoc(id: string, status: string) {
  return { id, data: () => ({ status }) }
}

describe('fetchGroupDocuments (Issue #1046)', () => {
  it('生バッチが上限未満(コレクション終端)で除外後件数もpageSize以下 → hasMore:false', async () => {
    // pageSize=2 → limit(4)。生3件(終端、上限未消化)のうち1件split除外 → 除外後2件(<=pageSize)。
    mockGetDocs.mockResolvedValueOnce({
      docs: [fakeDoc('a', 'processed'), fakeDoc('b', 'split'), fakeDoc('c', 'processed')],
    })

    const result = await fetchGroupDocuments('customer', '山田太郎', 2, undefined)

    expect(result.hasMore).toBe(false)
    expect(result.documents.map((d) => d.id)).toEqual(['a', 'c'])
  })

  it('除外後件数がpageSizeを超える(excessバッファあり) → hasMore:true、カーソルは除外後リストの末尾', async () => {
    // pageSize=2 → limit(4)。生4件、除外なし → 除外後4件 > pageSize(2)。
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        fakeDoc('a', 'processed'),
        fakeDoc('b', 'processed'),
        fakeDoc('c', 'processed'),
        fakeDoc('d', 'processed'),
      ],
    })

    const result = await fetchGroupDocuments('customer', '山田太郎', 2, undefined)

    expect(result.hasMore).toBe(true)
    expect(result.documents.map((d) => d.id)).toEqual(['a', 'b'])
    expect(result.lastDoc?.id).toBe('b')
  })

  it('生バッチが上限ちょうど埋まり、除外後件数がpageSize以下 → hasMore:true(早期打ち切り回帰防止)', async () => {
    // pageSize=2 → limit(4)。生4件(上限ちょうど)のうち3件がsplitで除外 → 除外後1件 <= pageSize(2)。
    // 修正前は allDocs.length(1) > pageSize(2) が false のため hasMore:false に誤判定していた。
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        fakeDoc('a', 'split'),
        fakeDoc('b', 'split'),
        fakeDoc('c', 'processed'),
        fakeDoc('d', 'split'),
      ],
    })

    const result = await fetchGroupDocuments('customer', '山田太郎', 2, undefined)

    expect(result.hasMore).toBe(true)
    expect(result.documents.map((d) => d.id)).toEqual(['c'])
  })

  it('生バッチが上限ちょうど埋まり、除外後0件でも無限ループしない(カーソルが生バッチ末尾へフォールバック)', async () => {
    // pageSize=2 → limit(4)。生4件全てsplitで除外 → 除外後0件。
    // 修正前は lastDoc=null かつ hasMore=true となり、次ページのstartAfterが
    // 適用されず同じ生バッチを無限に再取得するループに陥っていた。
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        fakeDoc('a', 'split'),
        fakeDoc('b', 'split'),
        fakeDoc('c', 'split'),
        fakeDoc('d', 'split'),
      ],
    })

    const result = await fetchGroupDocuments('customer', '山田太郎', 2, undefined)

    expect(result.hasMore).toBe(true)
    expect(result.documents).toEqual([])
    // カーソルがnullではなく生バッチ末尾のdocへフォールバックしていること
    // (startAfterに渡せる値があり、次ページ取得が前進する)
    expect(result.lastDoc?.id).toBe('d')
  })
})
