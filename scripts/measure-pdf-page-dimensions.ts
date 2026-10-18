#!/usr/bin/env ts-node
/**
 * 指定した書類のPDFページ寸法・画素数を測る(read-only診断)。
 *
 * 目的: paddle-ocr の `signal 9`(2026-10-15 kanameone)で、失敗したページと成功したページの
 * 寸法を比べ、画素数との関係を調べる。実書類を扱うため、クラウド側(GitHub Actions)で実行し、
 * ローカルにはPDFを持ち込まない。
 *
 * 使用方法(FIREBASE_PROJECT_ID・STORAGE_BUCKETは必須):
 *   --target-ids id1,id2,...,id10   対象の書類ID(1〜10件、重複は除く)
 *   --dpi N                         画素数の計算に使うdpi(既定200、paddle-ocrのPADDLE_PDF_RENDER_DPIに合わせる)。
 *                                   ローカル実行専用で、ワークフロー(run-ops-script)経由では常に既定の200
 *
 * 出力(1行1事実、`{`を含めない。Actionsのログマスキングで`{`が伏字になるため):
 *   doc=<id> status=start                       書類ごとの処理前に出す。done行が無ければ異常終了(OOM等)の手がかり
 *   doc=<id> status=ok ...  / page=N ...        ページ数・寸法(pt)・回転・UserUnit・画素数・1ページ抽出後のバイト数
 *   page=N status=error stage=... kind=...      ページ単位の失敗(測れたページの結果は残す)
 *   doc=<id> status=<reason/error> ...          書類単位の失敗
 *   done total=<重複除去後の件数> failed=<失敗した書類数> dpi=<dpi>
 * 書類名・顧客名・Storageのパス・バケット名・例外メッセージは出さない(公開リポジトリのログに残るため)。
 * 失敗は段階(stage)と例外クラス名(kind)のみ出す。FirestoreはfileUrlのみ読み(fieldMask)、書込みはしない。
 *
 * 終了コード: 全書類の全ページを測定できれば0、1つでも失敗(書類・ページ単位とも)があれば1。
 */
import * as admin from 'firebase-admin';
import { MeasureError, measurePdfPages, parseDocIds, safeErrorKind } from './lib/pdfPageDimensions';

const DEFAULT_DPI = 200;
/** paddle-ocr の既定 MAX_PIXELS(本番の環境変数と同値) */
const PADDLE_MAX_PIXELS = 40_000_000;

/** 引数の誤り。メッセージは自前の固定文言なので出力してよい */
class ArgError extends Error {}

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
    else throw new ArgError(`不明な引数: ${argv[i]}`);
  }
  if (docIdsCsv === null) throw new ArgError('--target-ids は必須です');
  if (!Number.isInteger(dpi) || dpi < 1 || dpi > 1200) throw new ArgError('--dpi は1〜1200の整数');
  try {
    return { docIds: parseDocIds(docIdsCsv), dpi };
  } catch (err) {
    throw new ArgError(err instanceof Error ? err.message : String(err));
  }
}

type FileUrlProblem = 'missing' | 'not_string' | 'not_gs' | 'bucket_mismatch';

/** バケット一致のobject pathを返す。使えない場合は理由(固定語彙)を返す */
function resolveObjectPath(url: unknown, bucket: string): { path: string } | { problem: FileUrlProblem } {
  if (url === undefined || url === null || url === '') return { problem: 'missing' };
  if (typeof url !== 'string') return { problem: 'not_string' };
  const m = url.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!m) return { problem: 'not_gs' };
  if (m[1] !== bucket) return { problem: 'bucket_mismatch' };
  return { path: m[2] };
}

/** 書類を測る。全ページ測定できれば true */
async function measureOne(
  docId: string,
  bucketName: string,
  dpi: number,
  setStage: (stage: 'firestore' | 'download') => void
): Promise<boolean> {
  console.log(`doc=${docId} status=start`);
  setStage('firestore');

  const db = admin.firestore();
  const [snap] = await db.getAll(db.collection('documents').doc(docId), { fieldMask: ['fileUrl'] });
  if (!snap.exists) {
    console.log(`doc=${docId} status=not_found`);
    return false;
  }
  const resolved = resolveObjectPath(snap.get('fileUrl'), bucketName);
  if ('problem' in resolved) {
    console.log(`doc=${docId} status=fileUrl_unusable reason=${resolved.problem}`);
    return false;
  }

  setStage('download');
  const [bytes] = await admin.storage().bucket(bucketName).file(resolved.path).download();
  const result = await measurePdfPages(bytes, dpi);
  const userUnitPages = result.pages.filter((p) => p.userUnit !== null).length;
  console.log(
    `doc=${docId} status=${result.failures.length === 0 ? 'ok' : 'partial'} fileBytes=${bytes.length} ` +
      `pages=${result.pageCount} measured=${result.pages.length} failedPages=${result.failures.length} ` +
      `maxPixels=${result.maxPixels} overPaddleMax=${result.maxPixels > PADDLE_MAX_PIXELS} ` +
      // UserUnitを持つページは画素数に反映していないため、overPaddleMaxは目安にとどまる
      `userUnitPages=${userUnitPages}`
  );
  for (const p of result.pages) {
    console.log(
      `  page=${p.pageNumber} mediaPt=${p.mediaWidthPt}x${p.mediaHeightPt} effectivePt=${p.effectiveWidthPt}x${p.effectiveHeightPt} ` +
        `cropBox=${p.hasCropBox} rotation=${p.rotation} userUnit=${p.userUnit ?? 'none'} ` +
        `pixels@${dpi}dpi=${p.pixels} singlePageBytes=${p.singlePageBytes}`
    );
  }
  for (const f of result.failures) {
    console.log(
      `  page=${f.pageNumber} status=error stage=${f.stage} kind=${f.kind}${f.detail ? ` ${f.detail}` : ''}`
    );
  }
  return result.failures.length === 0;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const bucketName = process.env.STORAGE_BUCKET;
  if (!projectId || !bucketName) throw new ArgError('FIREBASE_PROJECT_ID と STORAGE_BUCKET が必要です');
  admin.initializeApp({ projectId, storageBucket: bucketName });

  let failed = 0;
  for (const docId of opts.docIds) {
    // measureOne内のどこで落ちたか(firestore/download。PDF処理の段階はMeasureErrorが持つ)を出力に残す
    let stage: string = 'firestore';
    try {
      const ok = await measureOne(docId, bucketName, opts.dpi, (s) => (stage = s));
      if (!ok) failed++;
    } catch (err) {
      // メッセージにStorageのパス(書類名を含みうる)が入る可能性があるため、段階と例外クラス名のみ出す
      const errStage = err instanceof MeasureError ? err.stage : stage;
      console.log(`doc=${docId} status=error stage=${errStage} kind=${safeErrorKind(err)}`);
      failed++;
    }
  }
  console.log(`done total=${opts.docIds.length} failed=${failed} dpi=${opts.dpi}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  // 自前の固定文言(ArgError)だけメッセージを出し、想定外の例外は種別のみにする
  console.error(err instanceof ArgError ? err.message : `unexpected error kind=${safeErrorKind(err)}`);
  process.exit(1);
});
