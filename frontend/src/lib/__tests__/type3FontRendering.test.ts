// @vitest-environment node
/**
 * Issue #794 回帰テスト: Type3フォント(/FontDescriptorに/FontName欠落、
 * mozilla/pdf.js#19954と同一条件)を含むPDFで、pdfjs-distがフォント読込に
 * 失敗しないことを確認する。
 *
 * 実機(kanameone本番)では罫線は表示されるが記入文字だけが消える不具合として現れた。
 * `page.getOperatorList()` はcanvasへの実描画なしにフォント翻訳(loadFont/translateFont)
 * を発生させるため、jsdom環境のcanvas制約を受けずに検証できる
 * (`@vitest-environment node` でこのファイルのみNode環境に切替え)。
 *
 * pdfjs-dist 4.8.69で本テストを実行すると
 * `Warning: loadFont - translateFont failed: "FormatError: invalid font name".`
 * が発生し失敗することを手動確認済み(react-pdf 9→10アップグレードでpdfjs-dist
 * 5.4.296に上がり、mozilla/pdf.js#19955で解消)。
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

pdfjs.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/legacy/build/pdf.worker.mjs'

const FIXTURE_PATH = path.resolve(__dirname, '../../../../scripts/fixtures/with-type3-font.pdf')

describe('Type3フォントPDFのレンダリング(Issue #794回帰)', () => {
  it('フォント読込エラーなしにoperatorListを生成できる', async () => {
    const data = new Uint8Array(fs.readFileSync(FIXTURE_PATH))

    // pdf.jsのwarn()はソース上console.warnを呼ぶが、legacy Node buildの
    // fake worker実行パスでは実際にはconsole.log経由で出力されることを実機確認済み
    // (Node 24 + pdfjs-dist 4.8.69/5.4.296双方で検証)。環境差異に頑健にするため両方フックする
    const logs: string[] = []
    const originalLog = console.log
    const originalWarn = console.warn
    const capture = (...args: unknown[]) => {
      logs.push(args.join(' '))
    }
    console.log = capture
    console.warn = capture

    const doc = await pdfjs.getDocument({ data }).promise
    const page = await doc.getPage(1)
    const opList = await page.getOperatorList()

    console.log = originalLog
    console.warn = originalWarn

    // 罫線(パス描画)は常に生成されるため、operatorList自体は空にならない
    expect(opList.fnArray.length).toBeGreaterThan(0)

    // mozilla/pdf.js#19954: /FontDescriptorが/FontNameを欠く場合のフォント読込失敗
    const fontLoadWarnings = logs.filter(
      (l) => l.includes('translateFont failed') || l.includes('invalid font name')
    )
    expect(fontLoadWarnings).toEqual([])

    await doc.destroy()
  })
})
