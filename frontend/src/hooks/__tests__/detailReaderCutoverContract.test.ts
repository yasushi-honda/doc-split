/**
 * FE 読者の detail/main 切替 配線契約テスト (ADR-0018 Phase E 前提ゲート, Issue #547)
 *
 * scripts/lib/detailReaderCutoverContract.test.ts (AC9, PR-D4) /
 * functions/test/detailReadCutoverContract.test.ts (PR-D2) と同じ grep-based 契約パターン。
 * frontend/src 配下に、許可リスト外で documents/{docId} 本体の ocrResult/pageResults を
 * 直接参照する「読者」が存在しないことを保証する。
 *
 * Phase D で FE は detail/main 優先 + 親フォールバック (`resolveDetailFields()`,
 * useDocuments.ts) にすでに切替済みだが、この配線漏れを構造的に検出する契約テストは
 * これまで scripts/ 側にしか存在しなかった。Phase E (親からの実フィールド削除) の
 * 前提ゲートとして FE 側にも同等のテストを新設する。1読者でも切替が漏れていると、
 * Phase E 後にその読者が空データを受け取り、silent な機能停止が起きる。
 *
 * 検出パターンは `.ocrResult`/`.pageResults` のドット参照だけでなく、`'ocrResult'`/
 * `'pageResults'` の文字列リテラル参照(ブラケット記法や型の索引アクセスも含む)も
 * 対象に含める(scripts側と同一パターン)。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve } from 'node:path'

// Vite は `new URL('literal', import.meta.url)` 形式をアセット解決用に静的解析するため、
// リテラルでの相対パス指定 (`new URL('../..', import.meta.url)`) は変換時に壊れる。
// 自ファイルパスを一度 fileURLToPath で得てから node:path で遡る形にして回避する。
const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * 許可リスト: documents/{docId} 本体の ocrResult/pageResults への直接参照が
 * 意図的に必要、または既に detail 優先で解決済みの値のみを扱うファイル
 * (frontend/src からの相対パス)。新規ファイルが未許可のまま親を直接参照した場合、
 * 下記 AC9 相当テストが検出する。安易な追記は禁止 — 追記時は理由をコメントで明記すること。
 */
const ALLOWLIST = new Set([
  // detail優先+親フォールバックの解決ロジック本体 (resolveDetailFields) と、その
  // フォールバック元となる Firestore→Document 変換 (firestoreToDocument は親ドキュメントの
  // 全フィールドを読む必要があり、resolveDetailFields が親フォールバックとして使う値の
  // 取得元そのもの)。detail/main 側の読取ヘルパー (fetchDocumentDetail) と型定義
  // (DocumentDetailFields) もここに集約されている — 「切替の配線そのもの」を対象とする。
  'hooks/useDocuments.ts',
  // resolveDetailFields() で解決済みの値 (`resolved.ocrResult`/`resolved.pageResults`) の
  // みを参照する。MobileContentPopup へ渡す document prop、PdfSplitModal へ渡す
  // documentForSplit もすべて resolved 経由で構築しており、親doc (document.ocrResult 等)
  // を直接読む箇所はない。本テストは文字列一致ベースの検出のため resolved.* の参照にも
  // ヒットするが、いずれも detail 優先解決後の値であり配線漏れではない。
  'components/DocumentDetailModal.tsx',
  // 唯一の呼出元 DocumentDetailModal.tsx が resolveDetailFields() で解決済みの
  // pageResults のみを渡す (`{ ...document, pageResults: resolved.pageResults }`)。
  // props の型注釈は親 Document 型のままだが、実行時に親docの生値を読むことはない。
  'components/PdfSplitModal.tsx',
  // 過去のフィールド切替を記録した doc コメントのみに `doc.ocrResult` という文字列が
  // 現れる ("参照元を `doc.ocrResult` から軽量抜粋フィールド `doc.ocrExcerpt` に切替")。
  // 実コード (getOcrExcerpt) は doc.ocrExcerpt のみを読み、ocrResult/pageResults への
  // 実参照はない。
  'hooks/useProcessingHistory.ts',
])

const EXCLUDED_DIR_NAMES = new Set(['node_modules', '.git'])

function walkSourceFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDED_DIR_NAMES.has(entry)) continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      walkSourceFiles(full, files)
    } else if (/\.(tsx|ts|jsx|js)$/.test(entry) && !/\.test\.(tsx|ts|jsx|js)$/.test(entry)) {
      files.push(full)
    }
  }
  return files
}

describe('detail reader cutover 配線契約 (ADR-0018 Phase E前提ゲート, Issue #547)', () => {
  it('AC9相当: frontend/src 配下に許可リスト外で親ocrResult/pageResultsを直接参照するファイルが存在しない', () => {
    const allFiles = walkSourceFiles(srcDir)
    const violations: string[] = []
    const detectionPattern = /\.ocrResult\b|\.pageResults\b|'ocrResult'|"ocrResult"|'pageResults'|"pageResults"/
    for (const file of allFiles) {
      const rel = relative(srcDir, file).split('\\').join('/')
      if (ALLOWLIST.has(rel)) continue
      const src = readFileSync(file, 'utf-8')
      if (detectionPattern.test(src)) {
        violations.push(rel)
      }
    }
    expect(
      violations,
      `許可リスト外で親ocrResult/pageResultsを直接参照するファイルが見つかりました: ${JSON.stringify(violations)}。` +
        'detail優先+親フォールバックへの切替が必要、または正当な理由があれば本テストのALLOWLISTに理由付きで追記してください。'
    ).toEqual([])
  })
})
