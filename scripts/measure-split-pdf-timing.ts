#!/usr/bin/env ts-node
/**
 * splitPdf の所要時間計測スクリプト(dev専用)
 *
 * 「全ページを1ページずつ分割」ボタン(最大249分割)が、splitPdfのtimeoutSeconds=300以内に
 * 終わるかを実測する。dev環境に合成PDF(ページごとに非圧縮性のノイズ画像入り=FAXスキャン相当の
 * サイズ)とstatus:'processed'のテスト書類を作り、fixtureユーザーのID tokenでsplitPdfを
 * HTTPS呼び出しして所要時間を出力する。終了時(失敗時も)テストデータを全て削除する。
 *
 * ID tokenは customToken → signInWithCustomToken で取得する。customTokenの署名にSAキーが
 * 必要なため、ユーザーADCのローカル実行では動かない(GHA "Run Operations Script" で実行する)。
 *
 * 使用方法:
 *   GHA: Actions → "Run Operations Script" → environment: dev /
 *        script: measure-split-pdf-timing
 *   必須env: FIREBASE_PROJECT_ID(doc-split-dev) / STORAGE_BUCKET / FIREBASE_WEB_API_KEY
 *   任意引数: --pages <N>(既定250。分割数は min(N,249))
 */

import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { PDFDocument } from 'pdf-lib';

const ALLOWED_PROJECT_ID = 'doc-split-dev';
const MAX_SEGMENTS = 249; // splitPdfのbatch書込上限(2N+1<=500)に合わせる
const REQUEST_TIMEOUT_MS = 330_000; // サーバーのtimeoutSeconds=300 + 余裕

const projectId = process.env.FIREBASE_PROJECT_ID || '';
if (projectId !== ALLOWED_PROJECT_ID) {
  console.error(
    `❌ このスクリプトは ${ALLOWED_PROJECT_ID} 専用です (指定されたプロジェクト: ${projectId || '(未設定)'})。`
  );
  process.exit(1);
}
const storageBucket = process.env.STORAGE_BUCKET || '';
const apiKey = process.env.FIREBASE_WEB_API_KEY || '';
if (!storageBucket || !apiKey) {
  console.error('❌ STORAGE_BUCKET と FIREBASE_WEB_API_KEY を設定してください');
  process.exit(1);
}

function getArg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const pages = Number(getArg('--pages') ?? '250');
if (!Number.isInteger(pages) || pages < 2 || pages > 400) {
  console.error('❌ --pages は2〜400の整数を指定してください');
  process.exit(1);
}

admin.initializeApp({ projectId, storageBucket });
const db = admin.firestore();
const bucket = admin.storage().bucket();

const crcTable = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let r = 0xffffffff;
  for (const x of buf) r = crcTable[(r ^ x) & 255] ^ (r >>> 8);
  return (r ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** 非圧縮性のグレースケールノイズPNG(300x400で約120KB) */
function noisePng(w: number, h: number): Buffer {
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) {
    crypto.randomFillSync(raw.subarray(y * (w + 1) + 1, (y + 1) * (w + 1)));
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

async function buildPdf(pageCount: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([595, 842]);
    const img = await doc.embedPng(noisePng(300, 400));
    page.drawImage(img, { x: 0, y: 0, width: 595, height: 842 });
  }
  return Buffer.from(await doc.save());
}

async function getIdToken(fixtureUid: string): Promise<string> {
  await db.doc(`users/${fixtureUid}`).set({
    role: 'admin',
    displayName: 'split timing fixture',
    email: 'split-timing-fixture@doc-split-dev.invalid',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    purpose: 'split-timing-measure',
  });
  const customToken = await admin.auth().createCustomToken(fixtureUid);
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  );
  const json = (await res.json()) as { idToken?: string };
  if (!json.idToken) {
    throw new Error(`signInWithCustomToken failed: HTTP ${res.status}`);
  }
  return json.idToken;
}

async function main(): Promise<void> {
  const runId = `${Date.now()}`;
  const docId = `split-timing-${runId}`;
  // 並走実行のcleanupが互いのfixtureユーザーを消さないよう、実行ごとに別UIDにする
  const fixtureUid = `split-timing-${runId}-uid`;
  let splitStartedAt = 0;
  const sourcePath = `original/${docId}.pdf`;

  try {
    const t0 = Date.now();
    const pdf = await buildPdf(pages);
    console.log(`PDF生成: ${pages}ページ / ${(pdf.length / 1024 / 1024).toFixed(1)}MiB / ${Date.now() - t0}ms`);

    await bucket.file(sourcePath).save(pdf, { contentType: 'application/pdf', resumable: false });

    const pageResults = Array.from({ length: pages }, (_, i) => ({
      pageNumber: i + 1,
      text: '',
      detectedDocumentType: null,
      detectedCustomerName: null,
      detectedOfficeName: null,
      matchScore: 0,
    }));
    const ref = db.collection('documents').doc(docId);
    await db.runTransaction(async (tx) => {
      tx.set(ref, {
        id: docId,
        processedAt: admin.firestore.Timestamp.now(),
        fileId: docId,
        fileName: `${docId}.pdf`,
        mimeType: 'application/pdf',
        documentType: '',
        customerName: '',
        officeName: '',
        fileUrl: `gs://${storageBucket}/${sourcePath}`,
        fileDate: null,
        isDuplicateCustomer: false,
        totalPages: pages,
        targetPageNumber: 1,
        status: 'processed',
        sourceType: 'upload',
      });
      tx.set(ref.collection('detail').doc('main'), { ocrResult: '', pageResults });
    });

    // 先頭から1ページずつ(最大248件)+残りを1セグメントにまとめて、合計 min(pages,249) 分割にする
    const segmentCount = Math.min(pages, MAX_SEGMENTS);
    // documentType/customerName/officeNameはsplitPdfが子docにそのまま書くため必須(undefinedはFirestoreに拒否される)
    const segment = (startPage: number, endPage: number) => ({
      startPage,
      endPage,
      documentType: '',
      customerName: '',
      officeName: '',
    });
    const segments = [] as ReturnType<typeof segment>[];
    for (let p = 1; p < segmentCount; p++) segments.push(segment(p, p));
    segments.push(segment(segmentCount, pages));
    const splitPoints = segments.slice(1).map((s) => s.startPage - 1);

    const idToken = await getIdToken(fixtureUid);
    console.log(`splitPdf呼び出し: ${segments.length}分割`);
    const t1 = Date.now();
    splitStartedAt = t1;
    const res = await fetch(
      `https://asia-northeast1-${projectId}.cloudfunctions.net/splitPdf`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ data: { documentId: docId, splitPoints, segments } }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }
    ).catch((err: unknown) => {
      console.log(`RESULT: 通信エラー/クライアントタイムアウト elapsed=${((Date.now() - t1) / 1000).toFixed(1)}s ${String(err)}`);
      return null;
    });
    if (res) {
      const elapsed = ((Date.now() - t1) / 1000).toFixed(1);
      const body = (await res.json()) as {
        result?: { createdDocuments?: string[] };
        error?: { status?: string; message?: string };
      };
      console.log(
        `RESULT: HTTP ${res.status} elapsed=${elapsed}s created=${body.result?.createdDocuments?.length ?? 0} ` +
          `error=${body.error ? `${body.error.status}: ${body.error.message}` : 'none'}`
      );
    }
  } finally {
    await cleanup(docId, sourcePath, fixtureUid, splitStartedAt);
  }
}

async function cleanup(
  docId: string,
  sourcePath: string,
  fixtureUid: string,
  splitStartedAt: number
): Promise<void> {
  // 応答を受け取れなかった場合(通信断・クライアントタイムアウト)でもサーバー側でsplitが
  // commit済みのことがあるため、子docは応答ではなくparentDocumentIdのクエリで拾う。
  // 子はstatus:'pending'でOCRパイプラインの対象になるので取り残さない
  const childIds = (await db.collection('documents').where('parentDocumentId', '==', docId).select().get()).docs.map(
    (d) => d.id
  );
  console.log(`[cleanup] 親1件・子${childIds.length}件・fixtureユーザーを削除`);
  const refs = [docId, ...childIds].flatMap((id) => {
    const ref = db.collection('documents').doc(id);
    return [ref.collection('detail').doc('main'), ref];
  });
  for (let i = 0; i < refs.length; i += 400) {
    const batch = db.batch();
    refs.slice(i, i + 400).forEach((r) => batch.delete(r));
    await batch.commit();
  }
  await bucket.file(sourcePath).delete({ ignoreNotFound: true });
  for (const id of childIds) {
    await bucket.deleteFiles({ prefix: `processed/${id}/` });
  }
  await db.doc(`users/${fixtureUid}`).delete();
  await admin.auth().deleteUser(fixtureUid).catch(() => undefined);
  await reportOrphans(childIds, splitStartedAt);
  console.log('[cleanup] done');
}

/**
 * splitPdfがタイムアウト等で途中終了すると、子docのbatch commit前にアップロード済みの
 * processed/<子ID>/配下のPDFが孤児として残る(子docが無いので上のクエリでは拾えない)。
 * 他の書込と区別できないため削除はせず、実行開始以降に作られたものを件数だけ報告する。
 */
async function reportOrphans(committedChildIds: string[], splitStartedAt: number): Promise<void> {
  if (!splitStartedAt) return;
  const [files] = await bucket.getFiles({ prefix: 'processed/' });
  const known = new Set(committedChildIds);
  const orphans = files.filter((f) => {
    const created = Date.parse(String(f.metadata.timeCreated ?? ''));
    return created >= splitStartedAt && !known.has(f.name.split('/')[1]);
  });
  if (orphans.length > 0) {
    console.log(
      `[cleanup] ⚠️ 実行開始以降に作成された孤児候補 ${orphans.length}件 (processed/配下、未削除): ` +
        orphans.slice(0, 3).map((f) => f.name).join(', ') + ' ...'
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('ERROR:', err);
    process.exit(1);
  });
