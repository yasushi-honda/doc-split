/**
 * マスターデータ読み込み共通関数。
 *
 * 3 コレクション（documents/customers/offices）を並列取得し、各サニタイザで型崩れを
 * 除去したマスターデータを返す。OCR 処理と PDF 分割提案の両系列で使う。
 */

import type * as admin from 'firebase-admin';
import type { CustomerMaster, DocumentMaster, OfficeMaster } from './extractors';
import { MASTER_PATHS } from './masterPaths';
import {
  sanitizeCustomerMasters,
  sanitizeDocumentMasters,
  sanitizeOfficeMasters,
} from './sanitizeMasterData';

export interface LoadedMasterData {
  documents: DocumentMaster[];
  customers: CustomerMaster[];
  offices: OfficeMaster[];
}

/** Firestore から読み出した生ドキュメントデータ (unknown 型のフィールド集合) */
type RawDoc = FirebaseFirestore.DocumentData;

function toDocumentMaster(id: string, raw: RawDoc): DocumentMaster {
  return {
    id,
    name: raw.name as string,
    category: raw.category as string | undefined,
    keywords: raw.keywords as string[] | undefined,
    aliases: raw.aliases as string[] | undefined,
    dateMarker: raw.dateMarker as string | undefined,
  };
}

function toCustomerMaster(id: string, raw: RawDoc): CustomerMaster {
  return {
    id,
    name: raw.name as string,
    furigana: raw.furigana as string | undefined,
    isDuplicate: raw.isDuplicate as boolean | undefined,
    careManagerName: raw.careManagerName as string | undefined,
    aliases: raw.aliases as string[] | undefined,
  };
}

function toOfficeMaster(id: string, raw: RawDoc): OfficeMaster {
  return {
    id,
    name: raw.name as string,
    shortName: raw.shortName as string | undefined,
    isDuplicate: raw.isDuplicate as boolean | undefined,
    aliases: raw.aliases as string[] | undefined,
  };
}

export async function loadMasterData(
  db: admin.firestore.Firestore
): Promise<LoadedMasterData> {
  const [documentSnap, customerSnap, officeSnap] = await Promise.all([
    db.collection(MASTER_PATHS.documents).get(),
    db.collection(MASTER_PATHS.customers).get(),
    db.collection(MASTER_PATHS.offices).get(),
  ]);

  return {
    documents: sanitizeDocumentMasters(
      documentSnap.docs.map((d) => toDocumentMaster(d.id, d.data()))
    ),
    customers: sanitizeCustomerMasters(
      customerSnap.docs.map((d) => toCustomerMaster(d.id, d.data()))
    ),
    offices: sanitizeOfficeMasters(
      officeSnap.docs.map((d) => toOfficeMaster(d.id, d.data()))
    ),
  };
}
