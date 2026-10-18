#!/usr/bin/env ts-node
/**
 * 指定した書類のPDFページ寸法・画素数を測る(read-only診断)。
 *
 * 目的: paddle-ocr の `signal 9`(2026-10-15 kanameone)で、失敗したページと成功したページの
 * 寸法を比べ、画素数との関係を調べる。実書類を扱うため、クラウド側(GitHub Actions)で実行し、
 * ローカルにはPDFを持ち込まない。
 *
 * 使用方法(FIREBASE_PROJECT_ID・STORAGE_BUCKETは必須):
 *   --target-ids id1,id2,...,id10   対象の書類ID(1〜10件)
 *   --dpi N                      画素数の計算に使うdpi(既定200、paddle-ocrのPADDLE_PDF_RENDER_DPIに合わせる)
 *
 * 出力: 書類IDごとのページ数・ページ別の寸法(pt)・回転・画素数・1ページ抽出後のバイト数。
 * 書類名・顧客名・Storageのパスは出力しない(公開リポジトリのActionsログに残るため)。
 * FirestoreはfileUrlのみ読み(fieldMask)、書込みはしない。
 * 出力は `{` を含めない行形式にする(Actionsのログマスキングで `{` が伏字になるため)。
 *
 * 終了コード: 全件測定できれば0、1件でも測定できなければ1。
 */
import * as admin from 'firebase-admin';
import { measurePdfPages, parseDocIds } from './lib/pdfPageDimensions';

const DEFAULT_DPI = 200;
/** paddle-ocr の既定 MAX_PIXELS(本番の環境変数と同値) */
const PADDLE_MAX_PIXELS = 40_000_000;

interface CliOptions {
  docIds: string[];
  dpi: number;
}

function parseArgs(argv: string[]): CliOptions {
  let docIdsCsv: string | null = null;
  let dpi = DEFAULT_DPI;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--target-ids') docIdsCsv = argv[++i] ?? '';
    else if (argv[i] === '--dpi') dpi = Number(argv[++i]);
    else throw new Error(`不明な引数: ${argv[i]}`);
  }
  if (docIdsCsv === null) throw new Error('--target-ids は必須です');
  if (!Number.isInteger(dpi) || dpi < 1 || dpi > 1200) throw new Error('--dpi は1〜1200の整数');
  return { docIds: parseDocIds(docIdsCsv), dpi };
}

function pathIfBucketMatches(url: unknown, bucket: string): string | null {
  if (typeof url !== 'string') return null;
  const m = url.match(/^gs:\/\/([^/]+)\/(.+)$/);
  return m && m[1] === bucket ? m[2] : null;
}

async function measureOne(docId: string, bucketName: string, dpi: number): Promise<boolean> {
  const snap = await admin.firestore().collection('documents').doc(docId).select('fileUrl').get();
  if (!snap.exists) {
    console.log(`doc=${docId} status=not_found`);
    return false;
  }
  const objectPath = pathIfBucketMatches(snap.get('fileUrl'), bucketName);
  if (!objectPath) {
    console.log(`doc=${docId} status=fileUrl_unusable`);
    return false;
  }
  const [bytes] = await admin.storage().bucket(bucketName).file(objectPath).download();
  const result = await measurePdfPages(bytes, dpi);
  console.log(
    `doc=${docId} status=ok fileBytes=${bytes.length} pages=${result.pageCount} ` +
      `maxPixels=${result.maxPixels} overPaddleMax=${result.maxPixels > PADDLE_MAX_PIXELS}`
  );
  result.pages.forEach((p, i) => {
    console.log(
      `  page=${i + 1} mediaPt=${p.mediaWidthPt}x${p.mediaHeightPt} effectivePt=${p.effectiveWidthPt}x${p.effectiveHeightPt} ` +
        `cropBox=${p.hasCropBox} rotation=${p.rotation} userUnit=${p.userUnit ?? 'none'} ` +
        `pixels@${dpi}dpi=${p.pixels} singlePageBytes=${p.singlePageBytes}`
    );
  });
  return true;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const bucketName = process.env.STORAGE_BUCKET;
  if (!projectId || !bucketName) throw new Error('FIREBASE_PROJECT_ID と STORAGE_BUCKET が必要です');
  admin.initializeApp({ projectId, storageBucket: bucketName });

  let failed = 0;
  for (const docId of opts.docIds) {
    try {
      if (!(await measureOne(docId, bucketName, opts.dpi))) failed++;
    } catch (err) {
      // メッセージにStorageのパス(書類名を含みうる)が入る可能性があるため、種別のみ出す
      console.log(`doc=${docId} status=error kind=${err instanceof Error ? err.name : 'unknown'}`);
      failed++;
    }
  }
  console.log(`done total=${opts.docIds.length} failed=${failed} dpi=${opts.dpi}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
