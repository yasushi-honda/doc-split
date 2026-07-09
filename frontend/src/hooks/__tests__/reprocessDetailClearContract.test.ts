/**
 * 再処理3経路の detail/main 同時クリア配線契約テスト (ADR-0018 Phase D PR4b, Issue #547)
 *
 * functions/test/ocrProcessorDetailDualWriteContract.test.ts /
 * scripts/lib/backfillScriptContract.test.ts と同じ grep-based 契約パターン。
 * 「再処理クリアは全経路 appendReprocessClearToBatch ヘルパー経由」という
 * 1点への集約をソース文字列レベルで lock-in する。
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
  it('ヘルパー: 親docの status:pending + getReprocessClearFields を batch に積む', () => {
    const helper = useDocumentsSrc.match(
      /export async function appendReprocessClearToBatch[\s\S]*?\n\}/
    )
    expect(helper, 'appendReprocessClearToBatch が定義されていること').not.toBeNull()
    expect(helper![0]).toMatch(/status: 'pending',\s*\.\.\.getReprocessClearFields\(\)/)
  })

  it('ヘルパー: detail/main は存在確認(getDoc)の上、存在時のみ getReprocessDetailClearFields でクリアする', () => {
    const helper = useDocumentsSrc.match(
      /export async function appendReprocessClearToBatch[\s\S]*?\n\}/
    )![0]
    // rules は detail の create を禁止しているため、不在 doc への update() は
    // not-found で batch 全体を落とす。存在確認 → 条件付き update が必須配線
    expect(helper).toMatch(/doc\(db, 'documents', documentId, 'detail', 'main'\)/)
    expect(helper).toMatch(/await getDoc\(detailRef\)/)
    expect(helper).toMatch(
      /if \(detailSnap\.exists\(\)\) \{\s*batch\.update\(detailRef, getReprocessDetailClearFields\(\)\)/
    )
  })

  it.each([
    ['useDocuments.ts useReprocessDocument', () => useDocumentsSrc, /await appendReprocessClearToBatch\(batch, documentId\)/],
    ['useErrors.ts requestReprocess', () => useErrorsSrc, /await appendReprocessClearToBatch\(batch, firstDoc\.id\)/],
    ['DocumentsPage.tsx handleBulkReprocess', () => documentsPageSrc, /chunk\.map\(\(docId\) => appendReprocessClearToBatch\(batch, docId\)\)/],
  ])('%s はヘルパー経由でクリアする', (_name, getSrc, pattern) => {
    expect(getSrc()).toMatch(pattern)
  })

  it("ヘルパーの外に detail/main への書込配線が存在しない (経路追加時のクリア漏れ・rules違反の値設定を構造的に防ぐ)", () => {
    // useDocuments.ts では appendReprocessClearToBatch 内の1箇所のみ許可
    const detailPathCount = [...useDocumentsSrc.matchAll(/'detail', 'main'/g)].length
    expect(detailPathCount, 'useDocuments.ts の detail/main パス構築はヘルパー内の1箇所のみ').toBe(1)
    // 他2ファイルは detail/main パスを直接構築しない (全てヘルパー委譲)
    expect(useErrorsSrc).not.toMatch(/'detail'/)
    expect(documentsPageSrc).not.toMatch(/'detail'/)
  })

  it('DocumentsPage: CHUNK_SIZE は 250 (最大500 update/チャンク。hard limitは2023年撤廃済みだが、payload上限と部分成功粒度の保守値として維持)', () => {
    expect(documentsPageSrc).toMatch(/const CHUNK_SIZE = 250/)
  })
})
