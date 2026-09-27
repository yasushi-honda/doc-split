/**
 * summarizeBulkVerifyOutcomes / runWithConcurrency 単体テスト(Issue #1044)
 *
 * 背景: handleBulkVerify(DocumentsPage.tsx)の文書ごとの判定・集計ロジックが未検証だった
 * (PR #1041のpr-test-analyzer指摘)。全件成功+確定、fresh lookup失敗時のfail-closed、
 * 混在成功/失敗時のpartition・選択保持、runWithConcurrencyの並列数上限・エラー分離を検証する。
 */

import { describe, it, expect } from 'vitest'
import { summarizeBulkVerifyOutcomes, runWithConcurrency, type BulkVerifyDocOutcome } from '../bulkVerifyOutcome'

const confirmed: BulkVerifyDocOutcome['decisions'] = {
  customer: { action: 'confirm' },
  office: { action: 'confirm' },
}
const skippedInvalidName: BulkVerifyDocOutcome['decisions'] = {
  customer: { action: 'skip', reason: 'invalid-name' },
  office: { action: 'skip', reason: 'invalid-name' },
}

const ok = (docId: string, overrides: Partial<BulkVerifyDocOutcome> = {}): BulkVerifyDocOutcome => ({
  docId,
  status: 'ok',
  decisions: confirmed,
  alreadyFullyConfirmed: false,
  ...overrides,
})

const error = (docId: string): BulkVerifyDocOutcome => ({
  docId,
  status: 'error',
  decisions: null,
  alreadyFullyConfirmed: false,
})

describe('summarizeBulkVerifyOutcomes', () => {
  it('全件成功+確定: succeeded/failed分割・confirmedCount・選択クリアを正しく決定する', () => {
    const summary = summarizeBulkVerifyOutcomes([ok('doc-1'), ok('doc-2')], false)

    expect(summary.succeeded).toHaveLength(2)
    expect(summary.failed).toHaveLength(0)
    expect(summary.confirmedCount).toBe(2)
    expect(summary.identityLookupWarningNeeded).toBe(false)
    expect(summary.selectionAfterSuccess).toBe('clear')
    expect(summary.selectionAfterPostWriteFailure).toBe('keep-all')
  })

  it('confirmedCount: customer/officeどちらもskipの書類はカウントしない', () => {
    const summary = summarizeBulkVerifyOutcomes(
      [ok('doc-1', { decisions: skippedInvalidName }), ok('doc-2')],
      false
    )

    expect(summary.confirmedCount).toBe(1)
  })

  it('混在成功/失敗: failedのみ選択保持する(再実行できるようにする)', () => {
    const summary = summarizeBulkVerifyOutcomes([ok('doc-1'), error('doc-2'), error('doc-3')], false)

    expect(summary.succeeded.map((o) => o.docId)).toEqual(['doc-1'])
    expect(summary.failed.map((o) => o.docId)).toEqual(['doc-2', 'doc-3'])
    expect(summary.identityLookupWarningNeeded).toBe(false)
    expect(summary.selectionAfterSuccess).toBe('keep-failed-only')
    expect(summary.selectionAfterPostWriteFailure).toBe('keep-failed-only')
  })

  describe('fetchFreshCustomerIdentityLookup失敗時のfail-closed動作', () => {
    it('identityLookup失敗 + 成功した書類が未確定(alreadyFullyConfirmed:false)なら警告要・選択は全件維持', () => {
      const summary = summarizeBulkVerifyOutcomes([ok('doc-1', { alreadyFullyConfirmed: false })], true)

      expect(summary.identityLookupWarningNeeded).toBe(true)
      expect(summary.selectionAfterSuccess).toBe('keep-all')
    })

    it('identityLookup失敗でも、成功した書類が全て既に両方確定済みなら警告不要(実害なし)', () => {
      const summary = summarizeBulkVerifyOutcomes([ok('doc-1', { alreadyFullyConfirmed: true })], true)

      expect(summary.identityLookupWarningNeeded).toBe(false)
      expect(summary.selectionAfterSuccess).toBe('clear')
    })

    // codex review指摘(P2、Issue #1042と同型): 失敗した書類があっても、identityLookup失敗による
    // 警告が優先される(部分失敗で成功した書類だけ選択解除すると、確定スキップされた書類を
    // 選び直して再実行する手段がなくなる)。
    it('identityLookup失敗 + 部分失敗が両方発生した場合はidentityLookup警告を優先し、選択を全件維持する', () => {
      const summary = summarizeBulkVerifyOutcomes(
        [ok('doc-1', { alreadyFullyConfirmed: false }), error('doc-2')],
        true
      )

      expect(summary.identityLookupWarningNeeded).toBe(true)
      expect(summary.selectionAfterSuccess).toBe('keep-all')
      expect(summary.selectionAfterPostWriteFailure).toBe('keep-all')
    })

    it('identityLookup失敗 + 部分失敗だが成功分は全て既に両方確定済みなら、失敗分のみ選択保持する', () => {
      const summary = summarizeBulkVerifyOutcomes(
        [ok('doc-1', { alreadyFullyConfirmed: true }), error('doc-2')],
        true
      )

      expect(summary.identityLookupWarningNeeded).toBe(false)
      expect(summary.selectionAfterSuccess).toBe('keep-failed-only')
      expect(summary.selectionAfterPostWriteFailure).toBe('keep-failed-only')
    })
  })

  it('境界値: outcomes空配列でも例外を投げず、クリア方針を返す', () => {
    const summary = summarizeBulkVerifyOutcomes([], false)

    expect(summary.succeeded).toHaveLength(0)
    expect(summary.failed).toHaveLength(0)
    expect(summary.confirmedCount).toBe(0)
    expect(summary.identityLookupWarningNeeded).toBe(false)
    expect(summary.selectionAfterSuccess).toBe('clear')
  })
})

describe('runWithConcurrency', () => {
  it('items.length < limitでも全件処理し、結果を入力順のまま返す', async () => {
    const results = await runWithConcurrency([1, 2, 3], 20, async (n) => n * 10)

    expect(results).toEqual([10, 20, 30])
  })

  it('1件のエラーが他の処理結果を汚染しない(呼び出し元でtry/catchしたfnの戻り値をそのまま集約する)', async () => {
    const results = await runWithConcurrency(['a', 'b', 'c'], 2, async (item) => {
      if (item === 'b') {
        return { status: 'error' as const, item }
      }
      return { status: 'ok' as const, item }
    })

    expect(results).toEqual([
      { status: 'ok', item: 'a' },
      { status: 'error', item: 'b' },
      { status: 'ok', item: 'c' },
    ])
  })

  it('limitを超える並列実行を行わない(実行中カウントの最大値がlimit以下)', async () => {
    let concurrent = 0
    let maxConcurrent = 0
    const items = Array.from({ length: 10 }, (_, i) => i)

    await runWithConcurrency(items, 3, async (i) => {
      concurrent++
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await new Promise((resolve) => setTimeout(resolve, 1))
      concurrent--
      return i
    })

    expect(maxConcurrent).toBeLessThanOrEqual(3)
    expect(maxConcurrent).toBeGreaterThan(0)
  })

  it('境界値: 空配列を渡すと空配列を返す', async () => {
    const results = await runWithConcurrency([], 20, async (n: number) => n)

    expect(results).toEqual([])
  })
})
