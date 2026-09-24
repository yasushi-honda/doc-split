/**
 * CSVインポートのID照合（Issue #1036）
 *
 * CSVインポート時、ID列を持つ顧客・事業所は既存の名前ベース照合より前段でID一致判定を
 * 行う（優先順位が逆だと、名前を書き換えた行が名前照合で「新規」判定され重複追加される）。
 * 書類種別・ケアマネはFirestore doc ID=名前（改名は削除→再作成）の設計のため、ID列を
 * 追加しても名前突合と実質同じで付加価値が無く、常に名前照合（remainingRows）へ回す
 * （existingRecordsにundefinedを渡す）。
 *
 * 顧客・事業所のCSV改名は既存documentsコレクション側（customerName等）との参照整合性を
 * 壊しうるため許可しない（/plan-crossreview codex 2パス反映#6）。ID一致行の書込みデータ
 * （resolvedData）はnameを常に既存値で固定する。
 */

export interface CsvRowWithId {
  id?: string
  name: string
}

export interface ExistingRecordWithId {
  id: string
  name: string
}

export interface IdMatchedRow<T extends CsvRowWithId> {
  /** 元のCSV行（id・CSV側で書き換えようとした名前を含む。プレビュー表示用） */
  csvRow: T
  /** 一致した既存レコード */
  existing: ExistingRecordWithId
  /** 書込み用に確定したデータ。nameは常に既存値で固定する（CSVでの改名は反映しない） */
  resolvedData: T
}

export interface IdMatchResult<T extends CsvRowWithId> {
  idMatchRows: IdMatchedRow<T>[]
  /** 名前照合へ回す行（ID無し・IDがDBに未存在・対象マスターがID突合非対応・ID重複行） */
  remainingRows: T[]
  /** CSV内でID列が重複していた値の一覧（1件でもあればUI側でインポート不可としてエラー表示する） */
  duplicateIds: string[]
}

/**
 * CSV行をID一致/名前照合対象に振り分ける
 * @param csvRows パース済みCSV行（id列を含む可能性がある）
 * @param existingRecords ID突合対象マスターの既存レコード一覧。undefinedならID突合非対応
 *   （書類種別・ケアマネ）として全行を名前照合へ回す
 */
export function matchRowsById<T extends CsvRowWithId>(
  csvRows: T[],
  existingRecords: ExistingRecordWithId[] | undefined
): IdMatchResult<T> {
  if (!existingRecords) {
    return { idMatchRows: [], remainingRows: csvRows, duplicateIds: [] }
  }

  const existingById = new Map(existingRecords.map(r => [r.id, r]))

  // CSV内のID重複を検出(貼り付けミス等で別レコードを意図せず上書きするリスクへの対策)
  const idCounts = new Map<string, number>()
  for (const row of csvRows) {
    if (row.id) {
      idCounts.set(row.id, (idCounts.get(row.id) ?? 0) + 1)
    }
  }
  const duplicateIds = [...idCounts.entries()].filter(([, count]) => count > 1).map(([id]) => id)
  const duplicateIdSet = new Set(duplicateIds)

  const idMatchRows: IdMatchedRow<T>[] = []
  const remainingRows: T[] = []

  for (const row of csvRows) {
    if (row.id && !duplicateIdSet.has(row.id)) {
      const existing = existingById.get(row.id)
      if (existing) {
        idMatchRows.push({
          csvRow: row,
          existing,
          resolvedData: { ...row, name: existing.name },
        })
        continue
      }
    }
    // ID無し・IDがDBに未存在・ID重複行は名前照合へフォールバック
    remainingRows.push(row)
  }

  return { idMatchRows, remainingRows, duplicateIds }
}
