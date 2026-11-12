/**
 * CSV取込の重複チェック: 同名の既存が複数あるとき、CSV行に最も合う既存と照合する
 *
 * 従来は、同名の既存を氏名キーのMapに入れる際に最後の1件だけが残り、CSV行はその1件とだけ比較されて
 * いた。すでにいる人の行でも、最後の1件と違えば完全一致にならず、同名が複数あるときの既定(追加)で
 * 新規マスターとして二重登録されうる(利用者の同姓同名の二重登録の調査、2026-11-12)。
 * 氏名はすべて架空。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetDocs = vi.fn()
const mockCollection = vi.fn((..._args: unknown[]) => ({ _collection: true }))

vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual('firebase/firestore')
  return {
    ...actual,
    collection: (...args: unknown[]) => mockCollection(...args),
    getDocs: (...args: unknown[]) => mockGetDocs(...args),
  }
})

vi.mock('@/lib/firebase', () => ({
  db: { type: 'firestore' },
}))

function snapshotOf(docs: { id: string; data: Record<string, unknown> }[]) {
  return { docs: docs.map(d => ({ id: d.id, data: () => d.data })) }
}

// 同姓同名3件(取得順: a, b, c。後ろのcが従来の「最後の1件」)
const sameNameCustomers = [
  { id: 'a', data: { name: '架空太郎', furigana: 'かくうたろう', careManagerName: '担当甲', notes: '(旧)' } },
  { id: 'b', data: { name: '架空太郎', furigana: 'かくうたろう', careManagerName: '担当乙', notes: '' } },
  { id: 'c', data: { name: '架空太郎', furigana: 'かくうたろう', careManagerName: '担当丙', notes: '(現)' } },
]

describe('checkCustomerDuplicatesWithDetails(同名の既存が複数あるとき)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('CSV行が最後以外の既存(a)と全項目一致なら、aと照合する(最後のcに畳まれない)', async () => {
    mockGetDocs.mockResolvedValue(snapshotOf(sameNameCustomers))
    const { checkCustomerDuplicatesWithDetails } = await import('../useMasters')

    const [result] = await checkCustomerDuplicatesWithDetails([
      { name: '架空太郎', furigana: 'かくうたろう', careManagerName: '担当甲', notes: '(旧)' },
    ])

    expect(result?.isDuplicate).toBe(true)
    expect(result?.existingData?.id).toBe('a')
    expect(result?.existingData?.careManagerName).toBe('担当甲')
    expect(result?.sameNameExistingCount).toBe(3)
  })

  it('CSV行が途中の既存(b)と一致なら、bと照合する', async () => {
    mockGetDocs.mockResolvedValue(snapshotOf(sameNameCustomers))
    const { checkCustomerDuplicatesWithDetails } = await import('../useMasters')

    const [result] = await checkCustomerDuplicatesWithDetails([
      { name: '架空太郎', furigana: 'かくうたろう', careManagerName: '担当乙', notes: '' },
    ])

    expect(result?.existingData?.id).toBe('b')
  })

  it('どの既存とも同じだけしか一致しない行は、従来どおり最後の1件(c)と照合する', async () => {
    mockGetDocs.mockResolvedValue(snapshotOf(sameNameCustomers))
    const { checkCustomerDuplicatesWithDetails } = await import('../useMasters')

    const [result] = await checkCustomerDuplicatesWithDetails([
      { name: '架空太郎', furigana: 'かくうたろう', careManagerName: '担当丁' },
    ])

    expect(result?.existingData?.id).toBe('c')
    expect(result?.sameNameExistingCount).toBe(3)
  })

  it('複数の行を、それぞれ最も合う既存と照合する', async () => {
    mockGetDocs.mockResolvedValue(snapshotOf(sameNameCustomers))
    const { checkCustomerDuplicatesWithDetails } = await import('../useMasters')

    const results = await checkCustomerDuplicatesWithDetails([
      { name: '架空太郎', furigana: 'かくうたろう', careManagerName: '担当甲', notes: '(旧)' },
      { name: '架空太郎', furigana: 'かくうたろう', careManagerName: '担当丙', notes: '(現)' },
    ])

    expect(results.map(r => r.existingData?.id)).toEqual(['a', 'c'])
  })

  it('同名が1件だけなら、その1件と照合する(従来どおり。CSV行が一致しなくても)', async () => {
    mockGetDocs.mockResolvedValue(snapshotOf([sameNameCustomers[0]!]))
    const { checkCustomerDuplicatesWithDetails } = await import('../useMasters')

    const [result] = await checkCustomerDuplicatesWithDetails([
      { name: '架空太郎', furigana: 'かくうたろう', careManagerName: '担当乙' },
    ])

    expect(result?.existingData?.id).toBe('a')
    expect(result?.sameNameExistingCount).toBe(1)
  })

  it('同名の既存が無ければ、新規(existingData: null・isDuplicate: false・件数0)', async () => {
    mockGetDocs.mockResolvedValue(snapshotOf(sameNameCustomers))
    const { checkCustomerDuplicatesWithDetails } = await import('../useMasters')

    const [result] = await checkCustomerDuplicatesWithDetails([
      { name: '別名次郎', furigana: 'べつめいじろう', careManagerName: '担当甲' },
    ])

    expect(result?.existingData).toBeNull()
    expect(result?.isDuplicate).toBe(false)
    expect(result?.sameNameExistingCount).toBe(0)
  })

  it('別の氏名の既存は、照合の候補に混ざらない', async () => {
    mockGetDocs.mockResolvedValue(snapshotOf([
      ...sameNameCustomers,
      { id: 'z', data: { name: '別名次郎', furigana: 'べつめいじろう', careManagerName: '担当甲', notes: '(旧)' } },
    ]))
    const { checkCustomerDuplicatesWithDetails } = await import('../useMasters')

    const [result] = await checkCustomerDuplicatesWithDetails([
      { name: '架空太郎', furigana: 'かくうたろう', careManagerName: '担当甲', notes: '(旧)' },
    ])

    expect(result?.existingData?.id).toBe('a')
    expect(result?.sameNameExistingCount).toBe(3)
  })
})

describe('checkOfficeDuplicatesWithDetails(同名の事業所が複数あるとき)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const sameNameOffices = [
    { id: 'o1', data: { name: '架空事業所', shortName: '甲支店', notes: '北' } },
    { id: 'o2', data: { name: '架空事業所', shortName: '乙支店', notes: '南' } },
    { id: 'o3', data: { name: '架空事業所', shortName: '丙支店', notes: '東' } },
  ]

  it('CSV行が最後以外の既存(o1)と全項目一致なら、o1と照合する', async () => {
    mockGetDocs.mockResolvedValue(snapshotOf(sameNameOffices))
    const { checkOfficeDuplicatesWithDetails } = await import('../useMasters')

    const [result] = await checkOfficeDuplicatesWithDetails([
      { name: '架空事業所', shortName: '甲支店', notes: '北' },
    ])

    expect(result?.existingData?.id).toBe('o1')
    expect(result?.sameNameExistingCount).toBe(3)
  })

  it('どの既存とも同じだけしか一致しない行は、従来どおり最後の1件(o3)と照合する', async () => {
    mockGetDocs.mockResolvedValue(snapshotOf(sameNameOffices))
    const { checkOfficeDuplicatesWithDetails } = await import('../useMasters')

    const [result] = await checkOfficeDuplicatesWithDetails([
      { name: '架空事業所', shortName: '丁支店' },
    ])

    expect(result?.existingData?.id).toBe('o3')
  })
})
