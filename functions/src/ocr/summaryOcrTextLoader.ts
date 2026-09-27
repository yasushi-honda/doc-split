/**
 * 要約生成用のOCR全文読込 (ADR-0027 PR4)
 *
 * `getOcrText.ts`(Callable、Storageオフロード対応)と同じ読込パターンを、要約生成の
 * 2経路(`generateSummaryBatch`・`regenerateSummary`)から共通利用できる関数として切り出す。
 * `resolveDetailFields()`が返す`ocrResult`は、10万字超でStorageへオフロードされた文書では
 * 空文字列のままになる(`ocrResultUrl`が真の格納先)。この関数を経由せず`ocrResult`を直接
 * 読むと、大きな文書ほど「OCR結果が短すぎる」と誤判定してしまう。
 */

import type { Firestore, DocumentReference } from 'firebase-admin/firestore';
import type { Bucket } from '@google-cloud/storage';
import { resolveDetailFields, readDocWithDetail } from './documentDetail';

/**
 * 要約生成に必要な文書フィールドのOCR全文を読み込む。
 * @returns docが存在しない場合はnull。それ以外は`documentType`とOCR全文(オフロード時は
 *   Storageから復元、なければ`''`のまま)。
 */
export async function loadOcrTextForSummary(
  db: Firestore,
  bucket: Bucket,
  docRef: DocumentReference
): Promise<{ ocrResult: string; documentType: string } | null> {
  const [docSnap, detailSnap] = await readDocWithDetail(db, docRef, [
    'ocrResult',
    'ocrResultUrl',
    'documentType',
  ]);
  if (!docSnap.exists) return null;

  const docData = docSnap.data()!;
  const ocrResultUrl = docData.ocrResultUrl as string | undefined;
  const documentType = (docData.documentType as string | undefined) ?? '';
  const { ocrResult: resolvedOcrResult } = resolveDetailFields(detailSnap.data(), docData);

  if (!ocrResultUrl) {
    return { ocrResult: resolvedOcrResult ?? '', documentType };
  }

  const filePath = ocrResultUrl.replace(`gs://${bucket.name}/`, '');
  const file = bucket.file(filePath);
  const [exists] = await file.exists();
  if (!exists) {
    return { ocrResult: '', documentType };
  }
  const [content] = await file.download();
  return { ocrResult: content.toString('utf-8'), documentType };
}
