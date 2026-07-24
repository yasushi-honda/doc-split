/**
 * Google Driveフォルダ階層テンプレート(`DriveFolderTemplate`)の編集ロジック(ADR-0022)。
 * React/Firestoreに依存しない純粋関数のみ。UIコンポーネント側から呼び出す。
 */

import { DriveFolderSegment, DriveFolderTemplate, DRIVE_SEGMENT_SEPARATOR_DEFAULT } from '@shared/types'

export type DriveFolderSegmentType = DriveFolderSegment['type']

const SEGMENT_TYPE_LABELS: Record<DriveFolderSegmentType, string> = {
  fixed: '固定文字列',
  careManager: 'ケアマネ',
  customer: '利用者',
  documentCategory: '書類カテゴリ',
  date: '日付',
}

/**
 * SEGMENT_TYPE_LABELS(Recordで型的に全種別の網羅が保証される)から導出する。
 * ここを独立したリテラル配列として二重管理すると、新種別追加時にLABELS側の更新は
 * コンパイルエラーで検知できてもこちらの更新漏れは検知できず、「階層を追加」の
 * ドロップダウンにだけ新種別が出現しないというサイレントな欠落を招く。
 */
export const SEGMENT_TYPES: DriveFolderSegmentType[] = Object.keys(
  SEGMENT_TYPE_LABELS
) as DriveFolderSegmentType[]

/** セグメント種別ごとのデフォルト値で新規セグメントを生成する */
function createDefaultSegment(type: DriveFolderSegmentType): DriveFolderSegment {
  switch (type) {
    case 'fixed':
      return { type: 'fixed', value: '' }
    case 'careManager':
      return { type: 'careManager', format: 'surnameInitialSpaceName' }
    case 'customer':
      return { type: 'customer', format: 'furiganaInitialSpaceName' }
    case 'documentCategory':
      return { type: 'documentCategory' }
    case 'date':
      return { type: 'date', format: 'YYYY年MM月', onlyForCategories: [] }
  }
}

export function addSegment(template: DriveFolderTemplate, type: DriveFolderSegmentType): DriveFolderTemplate {
  return [...template, createDefaultSegment(type)]
}

export function removeSegment(template: DriveFolderTemplate, index: number): DriveFolderTemplate {
  if (index < 0 || index >= template.length) return [...template]
  return template.filter((_, i) => i !== index)
}

export function moveSegment(
  template: DriveFolderTemplate,
  index: number,
  direction: 'up' | 'down'
): DriveFolderTemplate {
  const targetIndex = direction === 'up' ? index - 1 : index + 1
  if (index < 0 || index >= template.length || targetIndex < 0 || targetIndex >= template.length) {
    return [...template]
  }
  const next = [...template]
  // 直前の範囲チェックによりindex/targetIndexは共にnext内の有効な要素を指す
  const a = next[index] as DriveFolderSegment
  const b = next[targetIndex] as DriveFolderSegment
  next[index] = b
  next[targetIndex] = a
  return next
}

export function updateSegment(
  template: DriveFolderTemplate,
  index: number,
  newSegment: DriveFolderSegment
): DriveFolderTemplate {
  if (index < 0 || index >= template.length) return [...template]
  return template.map((s, i) => (i === index ? newSegment : s))
}

const CARE_MANAGER_FORMAT_LABELS: Record<Extract<DriveFolderSegment, { type: 'careManager' }>['format'], string> = {
  surnameInitialSpaceName: '姓頭文字＋スペース＋氏名',
  nameOnly: '氏名のみ',
}

const CUSTOMER_FORMAT_LABELS: Record<Extract<DriveFolderSegment, { type: 'customer' }>['format'], string> = {
  furiganaInitialSpaceName: 'フリガナ頭文字＋スペース＋氏名',
  nameOnly: '氏名のみ',
}

const SEPARATOR_LABELS: Record<'half' | 'full', string> = {
  half: '半角スペース',
  full: '全角スペース',
}

/** セグメントの人間可読な日本語ラベルを返す（プレビュー用）。実効separatorはデフォルト値込みで表示する */
export function describeSegment(segment: DriveFolderSegment): string {
  switch (segment.type) {
    case 'fixed':
      return segment.value.trim() ? `固定: ${segment.value}` : '固定: (未入力)'
    case 'careManager': {
      if (segment.format === 'nameOnly') {
        return `ケアマネ（${CARE_MANAGER_FORMAT_LABELS.nameOnly}）`
      }
      const separator = segment.separator ?? DRIVE_SEGMENT_SEPARATOR_DEFAULT.careManager
      return `ケアマネ（${CARE_MANAGER_FORMAT_LABELS.surnameInitialSpaceName}、${SEPARATOR_LABELS[separator]}）`
    }
    case 'customer': {
      if (segment.format === 'nameOnly') {
        return `利用者（${CUSTOMER_FORMAT_LABELS.nameOnly}）`
      }
      const separator = segment.separator ?? DRIVE_SEGMENT_SEPARATOR_DEFAULT.customer
      return `利用者（${CUSTOMER_FORMAT_LABELS.furiganaInitialSpaceName}、${SEPARATOR_LABELS[separator]}）`
    }
    case 'documentCategory':
      return '書類カテゴリ'
    case 'date':
      return segment.onlyForCategories.length > 0
        ? `日付（${segment.format}、対象: ${segment.onlyForCategories.join('、')}）`
        : '日付（対象書類種別が未選択のため、この階層は常に生成されません）'
  }
}

export function segmentTypeLabel(type: DriveFolderSegmentType): string {
  return SEGMENT_TYPE_LABELS[type]
}

/** 保存をブロックすべき警告メッセージの一覧を返す（空配列なら保存可） */
export function validateTemplate(template: DriveFolderTemplate): string[] {
  const warnings: string[] = []

  if (template.length === 0) {
    warnings.push('フォルダ階層を1つ以上設定してください')
  }

  template.forEach((segment, index) => {
    const position = index + 1
    if (segment.type === 'fixed' && !segment.value.trim()) {
      warnings.push(`${position}階層目（固定文字列）に文字列が入力されていません`)
    }
    if (segment.type === 'date' && segment.onlyForCategories.length === 0) {
      warnings.push(`${position}階層目（日付）は対象書類種別が未選択のため、この階層は常に生成されません`)
    }
  })

  return warnings
}

/**
 * 詳細プリセット(5階層)の静的部分。セグメント種別の並びはfunctions/test/folderPath.test.tsの
 * KANAME_TEMPLATEを参考にしているが、値そのものは汎用化のため異なる(fixedは空欄、dateは
 * buildDetailed5TierPresetで動的に組み立てる)。
 */
export const DETAILED_5TIER_PRESET_BASE: DriveFolderSegment[] = [
  { type: 'fixed', value: '' },
  { type: 'careManager', format: 'surnameInitialSpaceName' },
  { type: 'customer', format: 'furiganaInitialSpaceName' },
  { type: 'documentCategory' },
]

/**
 * 詳細プリセット(5階層)を組み立てるファクトリ関数。
 * dateセグメントのonlyForCategoriesは、実際にresolveFolderSegments/exportDocument.tsが
 * 突合するDocumentMaster.name(書類種別名)をテナントごとに動的に渡す必要がある
 * (ハードコードすると他テナントの書類種別名と一致せず、日付階層が常に生成されなくなるため)。
 */
export function buildDetailed5TierPreset(documentCategoryNames: string[]): DriveFolderTemplate {
  return [
    ...DETAILED_5TIER_PRESET_BASE,
    { type: 'date', format: 'YYYY年MM月', onlyForCategories: documentCategoryNames },
  ]
}

/** シンプルプリセット(3階層)。セグメント構成はfunctions/test/folderPath.test.tsのCOCORO_TEMPLATEを参考 */
export const SIMPLE_3TIER_PRESET_TEMPLATE: DriveFolderTemplate = [
  { type: 'fixed', value: '' },
  { type: 'careManager', format: 'nameOnly' },
  { type: 'customer', format: 'nameOnly' },
]
