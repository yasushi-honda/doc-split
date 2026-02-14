/**
 * 抽出理由ポップオーバー
 * メタ情報（顧客名・事業所名・書類種別）がなぜその値に設定されたかを表示
 */

import { Info } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import type {
  Document,
  OcrFieldExtraction,
} from '@shared/types'

type FieldType = 'customer' | 'office' | 'documentType'

interface ExtractionInfoPopoverProps {
  fieldType: FieldType
  document: Document
}

/** マッチタイプを日本語に変換 */
function matchTypeLabel(matchType: string | undefined): string {
  switch (matchType) {
    case 'exact': return '完全一致'
    case 'partial': return '部分一致'
    case 'fuzzy': return 'あいまい一致'
    case 'none': return '一致なし'
    default: return '不明'
  }
}

/** フィールドごとの抽出情報を取得 */
function getFieldInfo(fieldType: FieldType, document: Document): {
  fieldLabel: string
  currentValue: string
  ocrField: OcrFieldExtraction | undefined
  matchType: string | undefined
  score: number | undefined
  candidates: Array<{ name: string; score: number; matchType: string; isCurrent: boolean }> | undefined
  keywords: string[] | undefined
} {
  const extraction = document.ocrExtraction
  const details = document.extractionDetails
  const scores = document.extractionScores

  switch (fieldType) {
    case 'customer': {
      const candidates = document.customerCandidates?.map(c => ({
        name: c.customerName,
        score: c.score,
        matchType: c.matchType,
        isCurrent: c.customerName === document.customerName,
      }))
      return {
        fieldLabel: '顧客名',
        currentValue: document.customerName || '未判定',
        ocrField: extraction?.customer,
        matchType: details?.customerMatchType ?? extraction?.customer?.matchType,
        score: scores?.customerName ?? extraction?.customer?.confidence,
        candidates,
        keywords: undefined,
      }
    }
    case 'office': {
      const candidates = document.officeCandidates?.map(c => ({
        name: c.officeName,
        score: c.score,
        matchType: c.matchType,
        isCurrent: c.officeName === document.officeName,
      }))
      return {
        fieldLabel: '事業所名',
        currentValue: document.officeName || '未判定',
        ocrField: extraction?.office,
        matchType: details?.officeMatchType ?? extraction?.office?.matchType,
        score: scores?.officeName ?? extraction?.office?.confidence,
        candidates,
        keywords: undefined,
      }
    }
    case 'documentType': {
      return {
        fieldLabel: '書類種別',
        currentValue: document.documentType || '未判定',
        ocrField: extraction?.documentType,
        matchType: details?.documentMatchType ?? extraction?.documentType?.matchType,
        score: scores?.documentType ?? extraction?.documentType?.confidence,
        candidates: undefined,
        keywords: details?.documentKeywords,
      }
    }
  }
}

/** 抽出理由のメッセージを生成 */
function getReasonMessage(info: ReturnType<typeof getFieldInfo>): string {
  const { currentValue, matchType, score, keywords } = info

  if (currentValue === '未判定' || currentValue === '不明顧客' || currentValue === '不明文書') {
    return 'OCRテキストからマスターデータに一致する情報が見つかりませんでした。'
  }

  const parts: string[] = []

  if (matchType === 'exact') {
    parts.push(`OCRテキスト内の表記がマスターデータの「${currentValue}」と完全に一致しました。`)
  } else if (matchType === 'partial') {
    if (keywords && keywords.length > 0) {
      parts.push(`OCRテキスト内のキーワード「${keywords.join('」「')}」がマスターデータの「${currentValue}」と部分的に一致しました。`)
    } else {
      parts.push(`OCRテキストの一部がマスターデータの「${currentValue}」と部分的に一致しました。`)
    }
  } else if (matchType === 'fuzzy') {
    parts.push(`OCRテキストの表記がマスターデータの「${currentValue}」と類似していると判定されました（あいまい一致）。`)
  }

  if (score !== undefined && score > 0) {
    parts.push(`確信度: ${score}点`)
  }

  return parts.join(' ')
}

export function ExtractionInfoPopover({ fieldType, document }: ExtractionInfoPopoverProps) {
  const info = getFieldInfo(fieldType, document)

  // 表示する情報がない場合はアイコンを表示しない
  const hasInfo = info.ocrField || info.matchType || info.score !== undefined ||
    (info.candidates && info.candidates.length > 0) || info.keywords

  if (!hasInfo) return null

  const reasonMessage = getReasonMessage(info)
  const candidates = info.candidates?.filter(c => !c.isCurrent)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center justify-center rounded-full p-0.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 transition-colors"
          aria-label={`${info.fieldLabel}の抽出理由を表示`}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 text-sm"
        side="left"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="space-y-3">
          {/* ヘッダー */}
          <p className="font-medium text-gray-700">
            なぜこの{info.fieldLabel}？
          </p>

          {/* 抽出理由 */}
          <div className="rounded bg-gray-50 p-2.5 text-xs leading-relaxed text-gray-600">
            {reasonMessage}
          </div>

          {/* マッチ情報サマリー */}
          {info.matchType && (
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                判定: <span className="font-medium text-gray-700">{matchTypeLabel(info.matchType)}</span>
              </span>
              {info.score !== undefined && info.score > 0 && (
                <span className="flex items-center gap-1">
                  確信度: <span className="font-medium text-gray-700">{info.score}点</span>
                </span>
              )}
            </div>
          )}

          {/* 書類種別: マッチしたキーワード */}
          {info.keywords && info.keywords.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-500">マッチしたキーワード</p>
              <div className="flex flex-wrap gap-1">
                {info.keywords.map((kw, i) => (
                  <span key={i} className="inline-block rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700">
                    {kw}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 顧客・事業所: 他の候補 */}
          {candidates && candidates.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-500">他の候補</p>
              <div className="space-y-0.5">
                {candidates.slice(0, 4).map((c, i) => (
                  <div key={i} className="flex items-center justify-between text-xs text-gray-500">
                    <span className="truncate">{c.name}</span>
                    <span className="ml-2 flex-shrink-0 text-gray-400">
                      {c.score}点・{matchTypeLabel(c.matchType)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
