/**
 * 再処理3経路の detail/main 同時クリア配線契約テスト (ADR-0018 Phase D PR4b, Issue #547)
 *
 * functions/test/ocrProcessorDetailDualWriteContract.test.ts /
 * scripts/lib/backfillScriptContract.test.ts と同じ grep-based 契約パターン。
 * 「親docクリアと detail/main クリアが同一 writeBatch に含まれる」配線を
 * ソース文字列レベルで lock-in する。
 *
 * 1経路でも detail クリアが漏れると、そのパスで再処理された doc は
 * detail/main に再処理前の古い OCR 内容が残存し、Phase D 以降の detail-first
 * 読者(pageResultsReuse 等)が古いデータを「有効」と誤判定する品質破壊が起きる
 * (Phase C で実在を確認した stale detail の新規発生経路)。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8')

const useDocumentsSrc = read('../useDocuments.ts')
const useErrorsSrc = read('../useErrors.ts')
const documentsPageSrc = read('../../pages/DocumentsPage.tsx')

describe('reprocess-clear detail/main 配線契約 (ADR-0018 PR4b)', () => {
  it('useReprocessDocument: 親update と同一batchで detail/main を getReprocessDetailClearFields でクリアする', () => {
    expect(useDocumentsSrc).toMatch(
      /batch\.update\(\s*doc\(db, 'documents', documentId, 'detail', 'main'\),\s*getReprocessDetailClearFields\(\)\s*\)/
    )
  })

  it('useErrors requestReprocess: firstDoc 存在時に detail/main を同一batchでクリアする', () => {
    expect(useErrorsSrc).toMatch(
      /batch\.update\(\s*doc\(db, 'documents', firstDoc\.id, 'detail', 'main'\),\s*getReprocessDetailClearFields\(\)\s*\)/
    )
  })

  it('DocumentsPage handleBulkReprocess: チャンクループ内で doc ごとに detail/main をクリアする', () => {
    expect(documentsPageSrc).toMatch(
      /const detailClearFields = getReprocessDetailClearFields\(\)/
    )
    expect(documentsPageSrc).toMatch(
      /batch\.update\(doc\(db, 'documents', docId, 'detail', 'main'\), detailClearFields\)/
    )
  })

  it('DocumentsPage: CHUNK_SIZE は 250 (1doc=2update で 500 ops = batch 上限ちょうど。増やすと commit が失敗する)', () => {
    expect(documentsPageSrc).toMatch(/const CHUNK_SIZE = 250/)
  })

  it("detail/main へ値を設定する batch.update が存在しない (rules は削除のみ許可、'''化は permission-denied)", () => {
    // detail/main への update は全経路 getReprocessDetailClearFields (deleteFieldのみ) 経由。
    // ocrResult: '' のような値設定が紛れ込むと rules 拒否で batch 全体が失敗する
    for (const src of [useDocumentsSrc, useErrorsSrc, documentsPageSrc]) {
      const detailUpdates = [...src.matchAll(/'detail', 'main'\),\s*\{([^}]*)\}/g)]
      for (const m of detailUpdates) {
        expect(m[1]).not.toMatch(/ocrResult:\s*['"`]/)
      }
    }
  })
})
