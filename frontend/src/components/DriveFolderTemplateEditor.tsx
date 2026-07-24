/**
 * Google Driveフォルダ階層テンプレートエディタ(ADR-0022)
 * `settings/drive.template`(DriveFolderTemplate)を編集する完全制御コンポーネント。
 */

import { Plus, Trash2, ChevronUp, ChevronDown, AlertCircle, Folder, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { useId, useMemo, useState } from 'react'
import { useDocumentMasters } from '@/hooks/useDocuments'
import type { DriveFolderSegment, DriveFolderTemplate } from '@shared/types'
import { DRIVE_SEGMENT_SEPARATOR_DEFAULT } from '@shared/types'
import {
  SEGMENT_TYPES,
  DriveFolderSegmentType,
  addSegment,
  removeSegment,
  moveSegment,
  updateSegment,
  describeSegment,
  segmentTypeLabel,
  validateTemplate,
  buildDetailed5TierPreset,
  SIMPLE_3TIER_PRESET_TEMPLATE,
} from '@/lib/driveFolderTemplate'

/**
 * プリセット図解での表示ラベル。segmentTypeLabel()を単一の真実源としつつ、
 * 実際に入力/条件が必要なfixed・dateのみ短い補足を付与する(下部の編集エリアの
 * ラベル(ケアマネ/書類カテゴリ等)と用語が食い違わないようにするため、他は据え置き)
 */
function presetDiagramLabel(type: DriveFolderSegmentType): string {
  if (type === 'fixed') return `${segmentTypeLabel('fixed')}（入力）`
  if (type === 'date') return `${segmentTypeLabel('date')}（対象書類のみ）`
  return segmentTypeLabel(type)
}

interface DriveFolderTemplateEditorProps {
  template: DriveFolderTemplate
  furiganaFallback: 'stop' | 'useNameInitial'
  onChange: (template: DriveFolderTemplate) => void
  onFuriganaFallbackChange: (value: 'stop' | 'useNameInitial') => void
}

export function DriveFolderTemplateEditor({
  template,
  furiganaFallback,
  onChange,
  onFuriganaFallbackChange,
}: DriveFolderTemplateEditorProps) {
  const [newSegmentType, setNewSegmentType] = useState<DriveFolderSegmentType>('fixed')
  const warnings = validateTemplate(template)
  const { data: documentMasters } = useDocumentMasters()

  const hasFuriganaCustomerSegment = template.some(
    (s) => s.type === 'customer' && s.format === 'furiganaInitialSpaceName'
  )

  // プリセット適用時にそのテナントの現在の書類マスタ名を反映する(ハードコードすると
  // 他テナントのマスタと一致せず日付階層が常に生成されなくなるため)
  const detailedPreset = useMemo(
    () => buildDetailed5TierPreset((documentMasters ?? []).map((m) => m.name)),
    [documentMasters]
  )

  return (
    <div className="space-y-3">
      {warnings.length > 0 && (
        <div className="rounded-md bg-amber-50 border border-amber-200 p-3 space-y-1">
          {warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 text-sm text-amber-800">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {template.map((segment, index) => (
          <SegmentRow
            key={index}
            segment={segment}
            index={index}
            isFirst={index === 0}
            isLast={index === template.length - 1}
            onUpdate={(s) => onChange(updateSegment(template, index, s))}
            onRemove={() => onChange(removeSegment(template, index))}
            onMove={(direction) => onChange(moveSegment(template, index, direction))}
          />
        ))}
        {template.length === 0 && (
          <p className="text-sm text-gray-500">フォルダ階層が設定されていません</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
        <select
          aria-label="追加するセグメント種別"
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={newSegmentType}
          onChange={(e) => setNewSegmentType(e.target.value as DriveFolderSegmentType)}
        >
          {SEGMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {segmentTypeLabel(t)}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange(addSegment(template, newSegmentType))}
        >
          <Plus className="h-4 w-4 mr-1" />
          階層を追加
        </Button>
      </div>

      <div className="space-y-2 pt-2">
        <p className="text-xs font-medium text-gray-500">ひな形から選んで始める</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <PresetPreviewCard
            title="5階層（詳細）"
            description="書類カテゴリ・日付まで細かく振り分ける構成"
            template={detailedPreset}
            onApply={() => onChange(detailedPreset)}
          />
          <PresetPreviewCard
            title="3階層（シンプル）"
            description="利用者フォルダまでシンプルに振り分ける構成"
            template={SIMPLE_3TIER_PRESET_TEMPLATE}
            onApply={() => onChange(SIMPLE_3TIER_PRESET_TEMPLATE)}
          />
        </div>
      </div>

      {hasFuriganaCustomerSegment && (
        <div className="rounded-md border p-3 space-y-2">
          <Label className="text-sm font-medium">フリガナ欠損時の挙動</Label>
          <select
            aria-label="フリガナ欠損時の挙動"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm w-full"
            value={furiganaFallback}
            onChange={(e) => onFuriganaFallbackChange(e.target.value as 'stop' | 'useNameInitial')}
          >
            <option value="stop">エクスポートを停止する（推奨）</option>
            <option value="useNameInitial">氏名の先頭文字で代替する</option>
          </select>
          {furiganaFallback === 'useNameInitial' && (
            <p className="text-xs text-amber-700 flex items-start gap-1">
              <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
              誤った利用者フォルダへ配置されるリスクがあります。フリガナ登録の徹底を推奨します。
            </p>
          )}
        </div>
      )}
    </div>
  )
}

interface PresetPreviewCardProps {
  title: string
  description: string
  template: DriveFolderTemplate
  onApply: () => void
}

/**
 * プリセットの内容をフォルダ階層図解付きでプレビューし、クリックで適用するカード。
 * aria-labelはbutton配下の全テキストの読み上げを置き換えてしまうため、descriptionは
 * aria-describedbyで別途アナウンスされるようにする(code-review指摘: aria-label単独だと
 * 視覚で見えているdescription文言がスクリーンリーダーで欠落する)
 */
function PresetPreviewCard({ title, description, template, onApply }: PresetPreviewCardProps) {
  const descriptionId = useId()
  const pathSummary = [...template.map((s) => presetDiagramLabel(s.type)), '書類ファイル'].join(' › ')

  return (
    <button
      type="button"
      onClick={onApply}
      aria-label={`${title}を適用（${pathSummary}）`}
      aria-describedby={descriptionId}
      className="flex flex-col gap-2 rounded-lg border p-3 text-left transition-colors hover:border-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{title}</span>
        <span className="rounded-full border px-2 py-0.5 text-xs text-gray-500">{template.length}階層</span>
      </div>
      <p id={descriptionId} className="text-xs text-gray-500">{description}</p>
      <FolderTreeDiagram template={template} />
    </button>
  )
}

/** フォルダ階層の見た目を簡易ツリー図として表示する装飾的な図解(SVGアイコンで構成)。テキストは重複読み上げを避けるためaria-hiddenにし、カード側のaria-labelを正とする */
function FolderTreeDiagram({ template }: { template: DriveFolderTemplate }) {
  const rows = template.map((s) => presetDiagramLabel(s.type))

  return (
    <div aria-hidden="true" className="space-y-0.5">
      {rows.map((label, i) => (
        <div key={i} className="flex items-center gap-1 text-xs text-gray-600" style={{ paddingLeft: `${i * 14}px` }}>
          {i > 0 && <span className="text-gray-300">└</span>}
          <Folder className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" />
          <span className="truncate">{label}</span>
        </div>
      ))}
      <div
        className="flex items-center gap-1 text-xs text-gray-500"
        style={{ paddingLeft: `${rows.length * 14}px` }}
      >
        <span className="text-gray-300">└</span>
        <FileText className="h-3.5 w-3.5 flex-shrink-0 text-blue-500" />
        <span className="truncate">書類ファイル</span>
      </div>
    </div>
  )
}

interface SegmentRowProps {
  segment: DriveFolderSegment
  index: number
  isFirst: boolean
  isLast: boolean
  onUpdate: (segment: DriveFolderSegment) => void
  onRemove: () => void
  onMove: (direction: 'up' | 'down') => void
}

function SegmentRow({ segment, index, isFirst, isLast, onUpdate, onRemove, onMove }: SegmentRowProps) {
  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-gray-500">
          {index + 1}階層目: {segmentTypeLabel(segment.type)}
        </span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={isFirst}
            onClick={() => onMove('up')}
            title="上へ移動"
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={isLast}
            onClick={() => onMove('down')}
            title="下へ移動"
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-red-500 hover:text-red-700"
            onClick={onRemove}
            title="削除"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <SegmentFields segment={segment} onUpdate={onUpdate} />

      <p className="text-xs text-gray-500">{describeSegment(segment)}</p>
    </div>
  )
}

function SegmentFields({
  segment,
  onUpdate,
}: {
  segment: DriveFolderSegment
  onUpdate: (segment: DriveFolderSegment) => void
}) {
  if (segment.type === 'fixed') {
    return (
      <Input
        aria-label="固定文字列"
        value={segment.value}
        onChange={(e) => onUpdate({ ...segment, value: e.target.value })}
        placeholder="フォルダ名を入力"
      />
    )
  }

  if (segment.type === 'careManager') {
    return (
      <div className="flex flex-wrap gap-2">
        <select
          aria-label="ケアマネの表示形式"
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={segment.format}
          onChange={(e) =>
            onUpdate({ ...segment, format: e.target.value as typeof segment.format })
          }
        >
          <option value="surnameInitialSpaceName">姓頭文字＋スペース＋氏名</option>
          <option value="nameOnly">氏名のみ</option>
        </select>
        {segment.format === 'surnameInitialSpaceName' && (
          <select
            aria-label="ケアマネのセパレータ"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={segment.separator ?? DRIVE_SEGMENT_SEPARATOR_DEFAULT.careManager}
            onChange={(e) =>
              onUpdate({ ...segment, separator: e.target.value as 'half' | 'full' })
            }
          >
            <option value="half">半角スペース</option>
            <option value="full">全角スペース</option>
          </select>
        )}
      </div>
    )
  }

  if (segment.type === 'customer') {
    return (
      <div className="flex flex-wrap gap-2">
        <select
          aria-label="利用者の表示形式"
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={segment.format}
          onChange={(e) =>
            onUpdate({ ...segment, format: e.target.value as typeof segment.format })
          }
        >
          <option value="furiganaInitialSpaceName">フリガナ頭文字＋スペース＋氏名</option>
          <option value="nameOnly">氏名のみ</option>
        </select>
        {segment.format === 'furiganaInitialSpaceName' && (
          <select
            aria-label="利用者のセパレータ"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={segment.separator ?? DRIVE_SEGMENT_SEPARATOR_DEFAULT.customer}
            onChange={(e) =>
              onUpdate({ ...segment, separator: e.target.value as 'half' | 'full' })
            }
          >
            <option value="half">半角スペース</option>
            <option value="full">全角スペース</option>
          </select>
        )}
      </div>
    )
  }

  if (segment.type === 'documentCategory') {
    return <p className="text-sm text-gray-500">書類の種別名がそのままフォルダ名になります</p>
  }

  // date
  return <DateSegmentFields segment={segment} onUpdate={onUpdate} />
}

function DateSegmentFields({
  segment,
  onUpdate,
}: {
  segment: Extract<DriveFolderSegment, { type: 'date' }>
  onUpdate: (segment: DriveFolderSegment) => void
}) {
  const { data: documentMasters } = useDocumentMasters()
  const masterNames = documentMasters?.map((m) => m.name) ?? []
  // 保存値にあるがマスタから消えた(改名/削除された)名前も、外せるように描画する(fail-visible)
  const staleNames = segment.onlyForCategories.filter((name) => !masterNames.includes(name))
  const allNames = [...masterNames, ...staleNames]

  const toggle = (name: string, checked: boolean) => {
    const next = checked
      ? [...segment.onlyForCategories, name]
      : segment.onlyForCategories.filter((n) => n !== name)
    onUpdate({ ...segment, onlyForCategories: next })
  }

  if (allNames.length === 0) {
    return <p className="text-sm text-gray-500">書類種別マスターが未登録です</p>
  }

  return (
    <div>
      <p className="text-xs text-gray-500 mb-1">対象書類種別（この階層が生成される書類のみチェック）</p>
      <div className="max-h-40 overflow-y-auto space-y-1 border rounded-md p-2">
        {allNames.map((name) => {
          const isStale = staleNames.includes(name)
          const checked = segment.onlyForCategories.includes(name)
          return (
            <label key={name} className="flex items-center gap-2 text-sm">
              <Checkbox checked={checked} onCheckedChange={(v) => toggle(name, v === true)} />
              <span>{name}</span>
              {isStale && (
                <span className="text-xs text-red-600">（マスタに存在しません）</span>
              )}
            </label>
          )
        })}
      </div>
    </div>
  )
}
