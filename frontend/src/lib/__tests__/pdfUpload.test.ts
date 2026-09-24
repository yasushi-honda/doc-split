/**
 * pdfUpload.ts 単体テスト (Issue #1031)
 *
 * PdfUploadModal.tsxから移設した純粋関数(claim系)の既存テストに加え、
 * バックグラウンド化のために新設した関数(mapDocumentStatusToStep /
 * summarizeUploads / deriveUploadToast)を検証する。
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/callFunction', () => ({
  getCallableErrorMessage: (_err: unknown, fallback: string) => fallback,
}))

import {
  claimFileName,
  releaseRowClaims,
  isNameClaimedByOther,
  mapDocumentStatusToStep,
  isActiveStep,
  summarizeUploads,
  deriveUploadToast,
  type FileUploadItem,
} from '../pdfUpload'

describe('claimedFileNames 予約ロジック(純粋関数、Issue #815から移設)', () => {
  it('claimFileNameは未予約の名前を予約できる', () => {
    const claimed = claimFileName(new Map(), 'a.pdf', 'row-1')
    expect(claimed?.get('a.pdf')).toBe('row-1')
  })

  it('claimFileNameは他の行が予約済みの名前を奪えない', () => {
    const claimed = claimFileName(new Map([['a.pdf', 'row-1']]), 'a.pdf', 'row-2')
    expect(claimed).toBeNull()
  })

  it('claimFileNameは自分自身の既存予約は上書きできる', () => {
    const claimed = claimFileName(new Map([['a.pdf', 'row-1']]), 'a.pdf', 'row-1')
    expect(claimed?.get('a.pdf')).toBe('row-1')
  })

  it('releaseRowClaimsは指定行が予約した名前のみ解放する', () => {
    const map = new Map([['a.pdf', 'row-1'], ['b.pdf', 'row-2']])
    const released = releaseRowClaims(map, 'row-1')
    expect(released.has('a.pdf')).toBe(false)
    expect(released.get('b.pdf')).toBe('row-2')
  })

  it('isNameClaimedByOtherは他行の予約のみtrueを返す', () => {
    const map = new Map([['a.pdf', 'row-1']])
    expect(isNameClaimedByOther(map, 'a.pdf', 'row-2')).toBe(true)
    expect(isNameClaimedByOther(map, 'a.pdf', 'row-1')).toBe(false)
    expect(isNameClaimedByOther(map, 'unknown.pdf', 'row-2')).toBe(false)
  })
})

describe('mapDocumentStatusToStep', () => {
  it('pending/processing/processedをそのままstepへ変換する', () => {
    expect(mapDocumentStatusToStep({ status: 'pending' })).toEqual({ step: 'pending' })
    expect(mapDocumentStatusToStep({ status: 'processing' })).toEqual({ step: 'processing' })
    expect(mapDocumentStatusToStep({ status: 'processed' })).toEqual({ step: 'processed' })
  })

  it('splitはprocessed扱いにする(判断1)', () => {
    expect(mapDocumentStatusToStep({ status: 'split' })).toEqual({ step: 'processed' })
  })

  it('errorはlastErrorMessageを引き継ぐ', () => {
    expect(mapDocumentStatusToStep({ status: 'error', lastErrorMessage: 'OCR失敗' })).toEqual({
      step: 'error',
      error: 'OCR失敗',
    })
  })

  it('errorでlastErrorMessageがない場合はデフォルトメッセージを使う', () => {
    expect(mapDocumentStatusToStep({ status: 'error' })).toEqual({
      step: 'error',
      error: 'OCR処理に失敗しました',
    })
  })

  it('dataがundefined(文書消失・購読エラー相当)はerror終端として扱う(plan-crossreview High#2/Medium#3)', () => {
    const result = mapDocumentStatusToStep(undefined)
    expect(result.step).toBe('error')
    expect(result.error).toBeTruthy()
  })

  it('未知のstatus値もerror終端として扱い、pendingのまま固まらせない(plan-crossreview Medium#3)', () => {
    const result = mapDocumentStatusToStep({ status: 'unexpected-future-status' })
    expect(result.step).toBe('error')
    expect(result.error).toBeTruthy()
  })
})

describe('isActiveStep', () => {
  it('uploading/pending/processingをactiveと判定する', () => {
    expect(isActiveStep('uploading')).toBe(true)
    expect(isActiveStep('pending')).toBe(true)
    expect(isActiveStep('processing')).toBe(true)
  })

  it('idle/processed/error/duplicateはactiveではない', () => {
    expect(isActiveStep('idle')).toBe(false)
    expect(isActiveStep('processed')).toBe(false)
    expect(isActiveStep('error')).toBe(false)
    expect(isActiveStep('duplicate')).toBe(false)
  })
})

function makeItem(step: FileUploadItem['step']): FileUploadItem {
  return { id: crypto.randomUUID(), file: new File(['x'], 'a.pdf'), step }
}

describe('summarizeUploads', () => {
  it('空配列ではallDoneはfalseになる(plan-crossreview Medium#9)', () => {
    expect(summarizeUploads([], false)).toEqual({ total: 0, active: 0, needsAttention: false, allDone: false })
  })

  it('全件processedのときのみallDoneがtrueになる', () => {
    const summary = summarizeUploads([makeItem('processed'), makeItem('processed')], false)
    expect(summary.allDone).toBe(true)
    expect(summary.total).toBe(2)
  })

  it('1件でもprocessed以外が残っていればallDoneはfalse', () => {
    const summary = summarizeUploads([makeItem('processed'), makeItem('error')], false)
    expect(summary.allDone).toBe(false)
  })

  it('activeなステップの行数をactiveとして数える', () => {
    const summary = summarizeUploads([makeItem('uploading'), makeItem('pending'), makeItem('idle')], false)
    expect(summary.active).toBe(2)
  })

  it('active行が0件かつerror/duplicateが残っていればneedsAttentionはtrue', () => {
    const summary = summarizeUploads([makeItem('error'), makeItem('duplicate')], false)
    expect(summary.needsAttention).toBe(true)
  })

  it('isAnyUploadInFlightがtrueの間はneedsAttentionをtrueにしない(バッチループの行間ギャップ対策)', () => {
    const summary = summarizeUploads([makeItem('error')], true)
    expect(summary.needsAttention).toBe(false)
  })

  it('active行が残っていればneedsAttentionはfalse', () => {
    const summary = summarizeUploads([makeItem('error'), makeItem('uploading')], false)
    expect(summary.needsAttention).toBe(false)
  })
})

describe('deriveUploadToast', () => {
  it('モーダルが開いていれば常にdismiss', () => {
    expect(deriveUploadToast({ total: 1, active: 1, needsAttention: false, allDone: false }, true)).toEqual({
      kind: 'dismiss',
    })
  })

  it('非表示+allDoneはsuccess', () => {
    const spec = deriveUploadToast({ total: 1, active: 0, needsAttention: false, allDone: true }, false)
    expect(spec?.kind).toBe('success')
  })

  it('非表示+needsAttentionはerror+アクションラベル付き', () => {
    const spec = deriveUploadToast({ total: 1, active: 0, needsAttention: true, allDone: false }, false)
    expect(spec?.kind).toBe('error')
    expect((spec as { actionLabel: string }).actionLabel).toBeTruthy()
  })

  it('非表示+activeありはloading', () => {
    const spec = deriveUploadToast({ total: 1, active: 1, needsAttention: false, allDone: false }, false)
    expect(spec?.kind).toBe('loading')
  })

  it('非表示+何もない(Empty/Staged)場合はnull', () => {
    expect(deriveUploadToast({ total: 0, active: 0, needsAttention: false, allDone: false }, false)).toBeNull()
    expect(deriveUploadToast({ total: 1, active: 0, needsAttention: false, allDone: false }, false)).toBeNull()
  })
})
