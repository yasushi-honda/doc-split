/**
 * deriveSummaryDisplayState 単体テスト(ADR-0027 PR4c)
 *
 * 背景: DocumentDetailModal.tsxのAI要約表示はデスクトップ(アコーディオン)とモバイル
 * (MobileContentPopup、手組みDOM)の2系統に同じ分岐ロジックを重複実装しており、#193型の
 * 食い違いを起こしやすい。7 kindの判定を純関数へ切り出し、優先順位の交差・境界値・
 * 後方互換(summaryStateフィールドが存在しない旧文書)を検証する。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  deriveSummaryDisplayState,
  summaryErrorMessage,
  SUMMARY_MIN_OCR_LENGTH,
  SUMMARY_MAX_INPUT_LENGTH,
  SUMMARY_QUEUED_MESSAGE,
  SUMMARY_PREVIOUS_FAILED_MESSAGE,
  SUMMARY_SKIPPED_MESSAGE,
  shouldShowSummaryTruncationNotice,
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
    expect(result.summaryText).toBeUndefined()
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

  // codex review P2指摘反映: Sarashina L2ゲートのallowlist除外時、バックエンドはOCR長に
  // 関係なくsummaryState:'skipped'にする。OCR長が十分な場合はabsent(既存のregenerateSummary
  // 手動生成経路、Sarashina L2ゲートとは独立)を維持し、実際に短い場合のみunavailableにする。
  it('kind=6 absent: summaryState===skippedでもOCR結果が十分(100字以上)なら手動生成を許可する', () => {
    const result = deriveSummaryDisplayState({ ...base, summaryState: 'skipped' })
    expect(result.kind).toBe('absent')
  })

  it('kind=6 absent: 要約なしでsummaryState===skipped(依頼が実行できなかった)なら、理由(errorMessage)を伴ってボタンを残す', () => {
    // 手動依頼がallowlist外・原文の読込失敗・OCR未完了でskippedになった場合、何も説明せずに元のボタンへ
    // 戻ると「受付済みのはずが無反応」に見える(silent-failure-hunter H1指摘)。
    const result = deriveSummaryDisplayState({ ...base, summaryState: 'skipped' })
    expect(result.kind).toBe('absent')
    expect(result.errorMessage).toBe(SUMMARY_SKIPPED_MESSAGE)
  })

  it('kind=6 absent: summaryStateが未設定・doneなら理由は付かない(通常の初期状態)', () => {
    expect(deriveSummaryDisplayState({ ...base, summaryState: undefined }).errorMessage).toBeUndefined()
  })

  it('kind=5 unavailable: summaryState===skippedかつOCR結果が実際に短い場合', () => {
    const result = deriveSummaryDisplayState({
      ...base,
      summaryState: 'skipped',
      ocrResult: 'あ'.repeat(SUMMARY_MIN_OCR_LENGTH - 1),
    })
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

    it('summaryState===errorかつ要約あり → 旧要約を残したままgenerated-with-failure(失敗を隠さない)', () => {
      const result = deriveSummaryDisplayState({
        ...base,
        summaryState: 'error',
        summaryErrorKind: 'blocked',
        summary: { text: '過去に成功した要約', truncated: false },
      })
      expect(result.kind).toBe('generated-with-failure')
      expect(result.summaryText).toBe('過去に成功した要約')
      expect(result.errorMessage).toBe(summaryErrorMessage('blocked'))
    })

    it('generated-with-failure: summaryErrorKindがnull/undefinedなら汎用の失敗文言', () => {
      const result = deriveSummaryDisplayState({
        ...base,
        summaryState: 'error',
        summaryErrorKind: null,
        summary: { text: '旧要約', truncated: false },
      })
      expect(result.kind).toBe('generated-with-failure')
      expect(result.errorMessage).toBe(summaryErrorMessage('unknown'))
    })

    it('再生成依頼中(pending)かつ要約あり → queuedを優先しつつ旧要約を保持する', () => {
      const result = deriveSummaryDisplayState({
        ...base,
        summaryState: 'pending',
        summary: { text: '旧要約', truncated: false },
      })
      expect(result.kind).toBe('queued')
      expect(result.summaryText).toBe('旧要約')
    })

    it('再生成依頼中(pending)かつ要約あり: isDetailErrorでも旧要約を見せ続ける(queued)', () => {
      const result = deriveSummaryDisplayState({
        ...base,
        isDetailError: true,
        summaryState: 'pending',
        summary: { text: '旧要約', truncated: false },
      })
      expect(result.kind).toBe('queued')
      expect(result.summaryText).toBe('旧要約')
    })

    it('ローカル依頼中(isGeneratingSummary)かつ要約あり → generating + 旧要約保持', () => {
      const result = deriveSummaryDisplayState({
        ...base,
        isGeneratingSummary: true,
        summaryState: 'done',
        summary: { text: '旧要約', truncated: false },
      })
      expect(result.kind).toBe('generating')
      expect(result.summaryText).toBe('旧要約')
    })

    it('summaryState===skippedかつ要約ありはgenerated-with-failure(再生成がskippedになっても旧要約を「生成済み」に見せず失敗を伝える)', () => {
      // 再生成の依頼後、原文を読み込めない・allowlistから外れた等でバッチがskippedにした場合、
      // 旧要約は温存されるが、今回の依頼は成功していない(codex review P2指摘)。
      const result = deriveSummaryDisplayState({
        ...base,
        summaryState: 'skipped',
        summaryErrorKind: null,
        summary: { text: '旧要約', truncated: false },
      })
      expect(result.kind).toBe('generated-with-failure')
      expect(result.summaryText).toBe('旧要約')
      expect(result.errorMessage).toBe(SUMMARY_SKIPPED_MESSAGE)
    })

    it('summaryState===done/未設定かつ要約ありはgenerated(summaryText保持、errorMessageなし)', () => {
      for (const summaryState of ['done', undefined] as const) {
        const result = deriveSummaryDisplayState({ ...base, summaryState, summary: { text: '要約', truncated: false } })
        expect(result.kind).toBe('generated')
        expect(result.errorMessage).toBeUndefined()
      }
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

describe('オフロード文書(ocrResultUrlあり、detail側ocrResult=\'\')の判定 (ADR-0018 / ADR-0027)', () => {
  it('ocrResultが空でもocrResultUrlがあればabsent(ボタン表示)', () => {
    const result = deriveSummaryDisplayState({ ...base, ocrResult: '', ocrResultUrl: 'gs://bucket/ocr/doc.txt' })
    expect(result.kind).toBe('absent')
  })

  it('ocrResultがundefinedでもocrResultUrlがあればabsent', () => {
    const result = deriveSummaryDisplayState({ ...base, ocrResult: undefined, ocrResultUrl: 'gs://bucket/ocr/doc.txt' })
    expect(result.kind).toBe('absent')
  })

  it('ocrResultUrlが空文字・null・undefinedなら従来どおりunavailable(OCR空)', () => {
    for (const ocrResultUrl of ['', null, undefined]) {
      const result = deriveSummaryDisplayState({ ...base, ocrResult: '', ocrResultUrl })
      expect(result.kind).toBe('unavailable')
    }
  })

  it('ocrResultUrlがあってもisDetailError(detail取得失敗)はdetail-errorのまま(要約なし)', () => {
    const result = deriveSummaryDisplayState({ ...base, ocrResult: undefined, ocrResultUrl: 'gs://b/o', isDetailError: true })
    expect(result.kind).toBe('detail-error')
  })

  it('ocrResultUrlありでも summaryState===error ならfailed、pendingならqueued(状態が優先)', () => {
    expect(
      deriveSummaryDisplayState({ ...base, ocrResult: '', ocrResultUrl: 'gs://b/o', summaryState: 'error' }).kind
    ).toBe('failed')
    expect(
      deriveSummaryDisplayState({ ...base, ocrResult: '', ocrResultUrl: 'gs://b/o', summaryState: 'pending' }).kind
    ).toBe('queued')
  })
})

describe('判定順の全組み合わせ(要約あり/なし × summaryState × OCR長 × ocrResultUrl)', () => {
  const states = [undefined, 'pending', 'processing', 'done', 'error', 'skipped'] as const
  const ocrCases = [
    { name: 'OCR99字', ocrResult: 'あ'.repeat(SUMMARY_MIN_OCR_LENGTH - 1), ocrResultUrl: undefined, enough: false },
    { name: 'OCR100字', ocrResult: 'あ'.repeat(SUMMARY_MIN_OCR_LENGTH), ocrResultUrl: undefined, enough: true },
    { name: '空+URLなし', ocrResult: '', ocrResultUrl: undefined, enough: false },
    { name: '空+URLあり', ocrResult: '', ocrResultUrl: 'gs://b/o', enough: true },
  ]

  for (const summaryState of states) {
    for (const oc of ocrCases) {
      it(`要約なし/${String(summaryState)}/${oc.name}`, () => {
        const { kind } = deriveSummaryDisplayState({
          ...base,
          summaryState,
          ocrResult: oc.ocrResult,
          ocrResultUrl: oc.ocrResultUrl,
        })
        const expected =
          summaryState === 'processing'
            ? 'generating'
            : summaryState === 'pending'
              ? 'queued'
              : summaryState === 'error'
                ? 'failed'
                : oc.enough
                  ? 'absent'
                  : 'unavailable'
        expect(kind).toBe(expected)
      })

      it(`要約あり/${String(summaryState)}/${oc.name}(OCR長は無関係)`, () => {
        const { kind, summaryText } = deriveSummaryDisplayState({
          ...base,
          summary: { text: '旧要約', truncated: false },
          summaryState,
          ocrResult: oc.ocrResult,
          ocrResultUrl: oc.ocrResultUrl,
        })
        const expected =
          summaryState === 'processing'
            ? 'generating'
            : summaryState === 'pending'
              ? 'queued'
              : summaryState === 'error' || summaryState === 'skipped'
                ? 'generated-with-failure'
                : 'generated'
        expect(kind).toBe(expected)
        expect(summaryText).toBe('旧要約')
      })
    }
  }
})

describe('案内文言の定数', () => {
  it('queued案内は受付・バックグラウンド・目安・自動表示を含む', () => {
    expect(SUMMARY_QUEUED_MESSAGE).toContain('受け付けました')
    expect(SUMMARY_QUEUED_MESSAGE).toContain('バックグラウンド')
    expect(SUMMARY_QUEUED_MESSAGE).toContain('数分〜10分')
    expect(SUMMARY_QUEUED_MESSAGE).toContain('自動で表示')
  })

  it('旧要約+再生成失敗の文言', () => {
    expect(SUMMARY_PREVIOUS_FAILED_MESSAGE).toBe('前回の要約です。今回の再作成は失敗しました')
  })

  it('SUMMARY_MAX_INPUT_LENGTHはbackendのMAX_SUMMARY_INPUT_LENGTHと一致する(契約)', () => {
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../../../functions/src/ocr/summaryPromptBuilder.ts'),
      'utf8'
    )
    const m = src.match(/export const MAX_SUMMARY_INPUT_LENGTH\s*=\s*(\d+)/)
    expect(m).not.toBeNull()
    expect(SUMMARY_MAX_INPUT_LENGTH).toBe(Number(m![1]))
  })
})

describe('shouldShowSummaryTruncationNotice(先頭約8,000字の注記)', () => {
  it('8000字ちょうどは注記なし、8001字は注記あり(境界)', () => {
    expect(shouldShowSummaryTruncationNotice('あ'.repeat(SUMMARY_MAX_INPUT_LENGTH), undefined)).toBe(false)
    expect(shouldShowSummaryTruncationNotice('あ'.repeat(SUMMARY_MAX_INPUT_LENGTH + 1), undefined)).toBe(true)
  })

  it('オフロード文書(ocrResultUrlあり)はOCR全文が手元になくても常に注記あり', () => {
    expect(shouldShowSummaryTruncationNotice('', 'gs://b/o')).toBe(true)
    expect(shouldShowSummaryTruncationNotice(undefined, 'gs://b/o')).toBe(true)
  })

  it('OCR未取得・空・URLなしは注記なし', () => {
    expect(shouldShowSummaryTruncationNotice(undefined, undefined)).toBe(false)
    expect(shouldShowSummaryTruncationNotice('', null)).toBe(false)
    expect(shouldShowSummaryTruncationNotice('', '')).toBe(false)
  })
})
