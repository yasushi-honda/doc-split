/**
 * deriveSummaryDisplayState 単体テスト(ADR-0027 PR4c)
 *
 * 背景: DocumentDetailModal.tsxのAI要約表示はデスクトップ(アコーディオン)とモバイル
 * (MobileContentPopup、手組みDOM)の2系統に同じ分岐ロジックを重複実装しており、#193型の
 * 食い違いを起こしやすい。7 kindの判定を純関数へ切り出し、優先順位の交差・境界値・
 * 後方互換(summaryStateフィールドが存在しない旧文書)を検証する。
 */

import { describe, it, expect } from 'vitest'
import {
  deriveSummaryDisplayState,
  summaryErrorMessage,
  SUMMARY_MIN_OCR_LENGTH,
  type DeriveSummaryDisplayStateInput,
} from '../summaryDisplayState'

const base: DeriveSummaryDisplayStateInput = {
  summary: undefined,
  summaryState: undefined,
  summaryErrorKind: undefined,
  ocrResult: 'あ'.repeat(SUMMARY_MIN_OCR_LENGTH),
  isDetailError: false,
  isGeneratingSummary: false,
}

describe('deriveSummaryDisplayState', () => {
  it('kind=0 detail-error: isDetailErrorかつ要約なしの場合', () => {
    const result = deriveSummaryDisplayState({ ...base, isDetailError: true })
    expect(result.kind).toBe('detail-error')
  })

  it('kind=1 generating: isGeneratingSummaryがtrueの場合', () => {
    const result = deriveSummaryDisplayState({ ...base, isGeneratingSummary: true })
    expect(result.kind).toBe('generating')
  })

  it('kind=1 generating: summaryState===processingの場合', () => {
    const result = deriveSummaryDisplayState({ ...base, summaryState: 'processing' })
    expect(result.kind).toBe('generating')
  })

  it('kind=2 generated: summary.textありの場合', () => {
    const result = deriveSummaryDisplayState({
      ...base,
      summary: { text: '要約本文', truncated: false },
    })
    expect(result.kind).toBe('generated')
    expect(result.summaryText).toBe('要約本文')
  })

  it('kind=3 queued: summaryState===pendingの場合', () => {
    const result = deriveSummaryDisplayState({ ...base, summaryState: 'pending' })
    expect(result.kind).toBe('queued')
  })

  it('kind=4 failed: summaryState===errorの場合', () => {
    const result = deriveSummaryDisplayState({
      ...base,
      summaryState: 'error',
      summaryErrorKind: 'quota',
    })
    expect(result.kind).toBe('failed')
    expect(result.errorMessage).toBe(summaryErrorMessage('quota'))
  })

  it('kind=5 unavailable: summaryState===skippedの場合', () => {
    const result = deriveSummaryDisplayState({ ...base, summaryState: 'skipped' })
    expect(result.kind).toBe('unavailable')
  })

  it('kind=5 unavailable: OCR結果が境界未満(99字)の場合', () => {
    const result = deriveSummaryDisplayState({ ...base, ocrResult: 'あ'.repeat(SUMMARY_MIN_OCR_LENGTH - 1) })
    expect(result.kind).toBe('unavailable')
  })

  it('kind=6 absent: OCR結果が境界値(100字ちょうど)でsummaryStateフィールドがない場合', () => {
    const result = deriveSummaryDisplayState({ ...base, ocrResult: 'あ'.repeat(SUMMARY_MIN_OCR_LENGTH) })
    expect(result.kind).toBe('absent')
  })

  it('kind=6 absent: ocrResultがundefinedの場合はunavailableとして扱う', () => {
    const result = deriveSummaryDisplayState({ ...base, ocrResult: undefined })
    expect(result.kind).toBe('unavailable')
  })

  it('kind=6 absent: ocrResultが空文字列の場合はunavailableとして扱う', () => {
    const result = deriveSummaryDisplayState({ ...base, ocrResult: '' })
    expect(result.kind).toBe('unavailable')
  })

  describe('優先順位の交差', () => {
    it('summaryState===processingかつ要約ありでもgeneratingを優先する', () => {
      const result = deriveSummaryDisplayState({
        ...base,
        summaryState: 'processing',
        summary: { text: '旧要約', truncated: false },
      })
      expect(result.kind).toBe('generating')
      // 生成中でも下に薄く表示するため、既存要約テキストは保持する
      expect(result.summaryText).toBe('旧要約')
    })

    it('summaryState===errorでも要約ありならgeneratedを優先する(要約本文が最優先)', () => {
      const result = deriveSummaryDisplayState({
        ...base,
        summaryState: 'error',
        summaryErrorKind: 'blocked',
        summary: { text: '過去に成功した要約', truncated: false },
      })
      expect(result.kind).toBe('generated')
    })

    it('isDetailErrorでも要約ありならgeneratedを優先する', () => {
      const result = deriveSummaryDisplayState({
        ...base,
        isDetailError: true,
        summary: { text: '要約本文', truncated: false },
      })
      expect(result.kind).toBe('generated')
    })

    // codex review P2指摘反映: isDetailError(FE側のdetail取得失敗)とバックエンド側の
    // summaryStateは独立した条件であり同時成立しうる。修正前はsummaryState==='processing'の
    // 判定がisDetailErrorより先に評価され、detail-errorが隠れてqueued/generating/failedを
    // 誤って提示していた(本来ブロックすべき生成操作を提示してしまう)。この交差を固定する。
    it('isDetailErrorはsummaryState===processingより優先する(要約なし)', () => {
      const result = deriveSummaryDisplayState({ ...base, isDetailError: true, summaryState: 'processing' })
      expect(result.kind).toBe('detail-error')
    })

    it('isDetailErrorはsummaryState===pendingより優先する(要約なし)', () => {
      const result = deriveSummaryDisplayState({ ...base, isDetailError: true, summaryState: 'pending' })
      expect(result.kind).toBe('detail-error')
    })

    it('isDetailErrorはsummaryState===errorより優先する(要約なし)', () => {
      const result = deriveSummaryDisplayState({
        ...base,
        isDetailError: true,
        summaryState: 'error',
        summaryErrorKind: 'unknown',
      })
      expect(result.kind).toBe('detail-error')
    })

    it('isDetailErrorはsummaryState===skippedより優先する(要約なし)', () => {
      const result = deriveSummaryDisplayState({ ...base, isDetailError: true, summaryState: 'skipped' })
      expect(result.kind).toBe('detail-error')
    })

    it('isGeneratingSummary(ローカル操作)はisDetailErrorより優先する', () => {
      // ユーザーが今回のクリックで能動的に開始した操作のため、isDetailErrorより優先する
      const result = deriveSummaryDisplayState({ ...base, isDetailError: true, isGeneratingSummary: true })
      expect(result.kind).toBe('generating')
    })
  })

  describe('後方互換(非回帰): summaryStateフィールドが存在しない旧文書', () => {
    it('summaryStateがundefinedでもsummary.textがあればgeneratedになる(PR4a以前に生成された既存文書)', () => {
      const result = deriveSummaryDisplayState({
        ...base,
        summaryState: undefined,
        summary: { text: 'PR4a以前の要約', truncated: false },
      })
      expect(result.kind).toBe('generated')
      expect(result.summaryText).toBe('PR4a以前の要約')
    })
  })

  describe('OCR処理中との同時成立(防御的分岐、通常到達しない)', () => {
    it('summaryState===pendingかつisGeneratingSummary=falseでは、summaryStateの分岐がそのまま使われる', () => {
      // OCR完了と同一トランザクションでsummaryStateが確定するため、OCR処理中とsummaryState
      // pendingが同時に成立するのは通常フローでは到達しない。ここでは純粋にkind判定のみ検証する。
      const result = deriveSummaryDisplayState({ ...base, summaryState: 'pending' })
      expect(result.kind).toBe('queued')
    })
  })
})

describe('summaryErrorMessage', () => {
  it('fabrication_suspected: 固有名詞捏造検知の専用文言', () => {
    expect(summaryErrorMessage('fabrication_suspected')).toContain('固有名詞')
  })

  it('blocked: 安全フィルタの専用文言', () => {
    expect(summaryErrorMessage('blocked')).toContain('安全フィルタ')
  })

  it('quota: 一時的なエラーの文言', () => {
    expect(summaryErrorMessage('quota')).toContain('一時的')
  })

  it('transient: quotaと同じ一時的なエラーの文言', () => {
    expect(summaryErrorMessage('transient')).toBe(summaryErrorMessage('quota'))
  })

  it('unknown: 汎用の失敗文言', () => {
    expect(summaryErrorMessage('unknown')).toBe('要約の生成に失敗しました')
  })

  it('null: unknownと同じ汎用の失敗文言にフォールバックする', () => {
    expect(summaryErrorMessage(null)).toBe(summaryErrorMessage('unknown'))
  })

  it('undefined: unknownと同じ汎用の失敗文言にフォールバックする(Firestore上の未設定値)', () => {
    expect(summaryErrorMessage(undefined)).toBe(summaryErrorMessage('unknown'))
  })
})
