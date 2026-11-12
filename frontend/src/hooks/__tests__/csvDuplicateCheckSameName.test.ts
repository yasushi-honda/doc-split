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

describe('checkCustomerDuplicatesWithDetails(比較する項目・表記ゆれ)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // 同名2件。区別は担当・フリガナ・備考・別表記のどれか1つだけ(最後のbと違う値を持つaを、各項目で引き当てる)
  const base = { name: '架空太郎', furigana: 'かくうたろう', careManagerName: '担当甲', notes: 'メモ甲', aliases: ['甲', '乙'] }

  it.each([
    ['furigana', { furigana: 'べつふりがな' }, { furigana: 'べつふりがな' }],
    ['careManagerName', { careManagerName: '担当乙' }, { careManagerName: '担当乙' }],
    ['notes', { notes: 'メモ乙' }, { notes: 'メモ乙' }],
    ['aliases', { aliases: ['丙', '丁'] }, { aliases: '丙|丁' }],
  ] as const)('顧客: %s だけが違う既存を、最後以外でも引き当てる', async (_key, storedOverride, csvOverride) => {
    mockGetDocs.mockResolvedValue(snapshotOf([
      { id: 'target', data: { ...base, ...storedOverride } },
      { id: 'last', data: { ...base } },
    ]))
    const { checkCustomerDuplicatesWithDetails } = await import('../useMasters')

    const [result] = await checkCustomerDuplicatesWithDetails([
      { name: '架空太郎', furigana: 'かくうたろう', careManagerName: '担当甲', notes: 'メモ甲', aliases: '甲|乙', ...csvOverride },
    ])

    expect(result?.existingData?.id).toBe('target')
  })

  it('別表記の表記ゆれ(区切りの前後の空白・末尾の区切り)があっても、保存済みの別表記と同じと見なして引き当てる', async () => {
    mockGetDocs.mockResolvedValue(snapshotOf([
      { id: 'target', data: { ...base, aliases: ['丙', '丁'] } },
      { id: 'last', data: { ...base } },
    ]))
    const { checkCustomerDuplicatesWithDetails } = await import('../useMasters')

    const [result] = await checkCustomerDuplicatesWithDetails([
      { name: '架空太郎', furigana: 'かくうたろう', careManagerName: '担当甲', notes: 'メモ甲', aliases: ' 丙 | 丁 |' },
    ])

    expect(result?.existingData?.id).toBe('target')
    // プレビュー・書込みに渡るCSV側の値は、書込み側のパース結果(丙・丁)と同じ整形後の形
    expect(result?.csvData.aliases).toBe('丙|丁')
  })

  it('フリガナが半角カナでも、書込み側と同じ正規化(全角カナ)で既存と比べる', async () => {
    mockGetDocs.mockResolvedValue(snapshotOf([
      { id: 'target', data: { ...base, furigana: 'カクウタロウ' } },
      { id: 'last', data: { ...base } },
    ]))
    const { checkCustomerDuplicatesWithDetails } = await import('../useMasters')

    const [result] = await checkCustomerDuplicatesWithDetails([
      { name: '架空太郎', furigana: 'ｶｸｳﾀﾛｳ', careManagerName: '担当甲', notes: 'メモ甲', aliases: '甲|乙' },
    ])

    expect(result?.existingData?.id).toBe('target')
    expect(result?.csvData.furigana).toBe('カクウタロウ')
  })

  it('別表記が空欄のCSV行は、別表記の違いで候補を選ばない(空欄=変更しない)', async () => {
    mockGetDocs.mockResolvedValue(snapshotOf([
      { id: 'target', data: { ...base, aliases: ['丙', '丁'] } },
      { id: 'last', data: { ...base, careManagerName: '担当乙' } },
    ]))
    const { checkCustomerDuplicatesWithDetails } = await import('../useMasters')

    const [result] = await checkCustomerDuplicatesWithDetails([
      { name: '架空太郎', furigana: 'かくうたろう', careManagerName: '担当甲' },
    ])

    expect(result?.existingData?.id).toBe('target')
    expect(result?.csvData.aliases).toBe('')
  })

  it('氏名に全角スペースがあるCSV行も、正規化した氏名で同名の既存を引き当てる', async () => {
    mockGetDocs.mockResolvedValue(snapshotOf([
      { id: 'target', data: { ...base, name: '架空 太郎' } },
      { id: 'last', data: { ...base, name: '架空 太郎', careManagerName: '担当乙' } },
    ]))
    const { checkCustomerDuplicatesWithDetails } = await import('../useMasters')

    const [result] = await checkCustomerDuplicatesWithDetails([
      { name: '架空　太郎', furigana: 'かくうたろう', careManagerName: '担当甲' },
    ])

    expect(result?.existingData?.id).toBe('target')
    expect(result?.sameNameExistingCount).toBe(2)
  })

  it('同じ内容の既存が2件(完全な重複)なら、従来どおり後ろの1件と照合する', async () => {
    mockGetDocs.mockResolvedValue(snapshotOf([
      { id: 'd1', data: { ...base } },
      { id: 'd2', data: { ...base } },
    ]))
    const { checkCustomerDuplicatesWithDetails } = await import('../useMasters')

    const [result] = await checkCustomerDuplicatesWithDetails([
      { name: '架空太郎', furigana: 'かくうたろう', careManagerName: '担当甲', notes: 'メモ甲', aliases: '甲|乙' },
    ])

    expect(result?.existingData?.id).toBe('d2')
  })

  it('値のある項目だけの行が最後以外の既存と一致すれば、その既存の値(別表記を含む)が返る', async () => {
    mockGetDocs.mockResolvedValue(snapshotOf([
      { id: 'target', data: { ...base } },
      { id: 'last', data: { ...base, careManagerName: '担当乙', aliases: ['丙'] } },
    ]))
    const { checkCustomerDuplicatesWithDetails } = await import('../useMasters')

    const [result] = await checkCustomerDuplicatesWithDetails([
      { name: '架空太郎', furigana: 'かくうたろう', careManagerName: '担当甲' },
    ])

    expect(result?.existingData).toMatchObject({
      id: 'target',
      careManagerName: '担当甲',
      notes: 'メモ甲',
      aliases: '甲|乙',
    })
  })
})

describe('checkOfficeDuplicatesWithDetails(件数・比較する項目・別表記)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const base = { name: '架空事業所', shortName: '甲支店', notes: '北', aliases: ['甲', '乙'] }

  it('同名が0件なら新規(existingData: null・件数0)', async () => {
    mockGetDocs.mockResolvedValue(snapshotOf([{ id: 'z', data: { ...base, name: '別の事業所' } }]))
    const { checkOfficeDuplicatesWithDetails } = await import('../useMasters')

    const [result] = await checkOfficeDuplicatesWithDetails([{ name: '架空事業所', shortName: '甲支店' }])

    expect(result?.existingData).toBeNull()
    expect(result?.isDuplicate).toBe(false)
    expect(result?.sameNameExistingCount).toBe(0)
  })

  it('同名が1件なら、CSV行が一致しなくてもその1件と照合する(従来どおり)', async () => {
    mockGetDocs.mockResolvedValue(snapshotOf([{ id: 'only', data: { ...base } }]))
    const { checkOfficeDuplicatesWithDetails } = await import('../useMasters')

    const [result] = await checkOfficeDuplicatesWithDetails([{ name: '架空事業所', shortName: '別の略称' }])

    expect(result?.existingData?.id).toBe('only')
    expect(result?.sameNameExistingCount).toBe(1)
  })

  it.each([
    ['shortName', { shortName: '乙支店' }, { shortName: '乙支店' }],
    ['notes', { notes: '南' }, { notes: '南' }],
    ['aliases', { aliases: ['丙', '丁'] }, { aliases: ' 丙 | 丁 |' }],
  ] as const)('事業所: %s だけが違う既存を、最後以外でも引き当てる(別表記は表記ゆれがあっても)', async (_key, storedOverride, csvOverride) => {
    mockGetDocs.mockResolvedValue(snapshotOf([
      { id: 'target', data: { ...base, ...storedOverride } },
      { id: 'last', data: { ...base } },
    ]))
    const { checkOfficeDuplicatesWithDetails } = await import('../useMasters')

    const [result] = await checkOfficeDuplicatesWithDetails([
      { name: '架空事業所', shortName: '甲支店', notes: '北', aliases: '甲|乙', ...csvOverride },
    ])

    expect(result?.existingData?.id).toBe('target')
  })
})
