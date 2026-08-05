/**
 * react-pdf(pdfjs-dist)のworkerSrc設定を一元管理する。
 *
 * pdfjs-distはAPI本体とworkerのバージョンが一致しないと描画が全面的に壊れるため、
 * CDN(unpkg等)からの実行時取得ではなくViteの `?url` importでバンドルにworkerファイル
 * 自体を同梱し、インストール済みのpdfjs-distと常に同一バージョンになるようにする
 * (Issue #794: react-pdf 9→10アップグレードのタイミングでCDN依存を解消)。
 *
 * PDFを描画するコンポーネント(PdfViewer/PdfSplitPreview等)は、react-pdfをimportする
 * ファイルの先頭でこのモジュールをimportするだけでよい(副作用でworkerSrcが設定される)。
 */
import { pdfjs } from 'react-pdf'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
