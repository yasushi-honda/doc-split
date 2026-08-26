#!/usr/bin/env ts-node
/**
 * ケアマネジャー Google Drive フォルダ 実物理状態調査スクリプト（read-only、Issue #811 Phase A）
 *
 * investigate-caremanager-duplicate.js（Firestoreのみの調査、PR #819）では、kanameone実データで
 * 「森奈穂美」の表記ゆれは全て「森 奈穂美」（半角スペース入り）に統一されており、完全一致の重複は
 * 0件だった。しかし`resolveCareManagerSegment`（folderPath.ts）はPR #752(2026-07-28)で
 * `stripInternalSpaces()`が既に追加済みのため、Firestore上の表記ゆれの有無だけでは
 * 「Drive上に物理的な重複フォルダが実在するか」を証明も反証もできない（PR #752より前に
 * 作成された古いフォルダが残存している可能性があるため）。
 *
 * 本スクリプトは、対象ケアマネに紐づく実document群の`driveFileId`から実際のDrive上の
 * 親フォルダIDを辿り、テンプレート上の careManager セグメントに対応する階層まで遡って、
 * 全documentが単一の物理フォルダIDに収束しているかを直接検証する（フォルダ名の文字列一致
 * だけに頼らない）。あわせて、現在の設定・現在のロジックで新規documentが解決するはずの
 * フォルダ（"期待パス"）も検索し、実際の物理フォルダ群と一致するかを比較する。
 *
 * documentCategoryセグメントの値はmasters/documents/itemsのcategory優先ロジック
 * （exportDocument.tsのresolvedCategory）を再現していない点に注意: そのロジックは
 * フォルダ「名前」を左右するだけで、セグメント配列の「段数」には影響しない
 * （documentCategoryセグメントは値が何であれ必ず1段としてカウントされる、date セグメントのみ
 * onlyForCategoriesの判定次第で省略されうる）。本スクリプトが必要とするのは各documentの
 * セグメント配列の「段数」（親フォルダを何回遡るか）だけなので、doc.category||doc.documentType
 * という単純なフォールバック値で十分（フォルダ名としての厳密性ではなく空文字によるthrow回避が目的）。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=docsplit-kanameone npx ts-node scripts/investigate-caremanager-folder-duplicate.ts \
 *     --name "森 奈穂美"
 *
 * オプション:
 *   --name <ケアマネ名>   調査対象（documents.careManagerの完全一致値。事前にinvestigate-caremanager-duplicate.js
 *                        等で実際にFirestoreに存在する表記を確認してから指定する）
 *   --limit <N>          物理チェックを行うdocument数の上限（省略時は無制限。Drive API呼び出し回数の
 *                        安全弁。適用時は必ずその旨をログに出す — 無音の件数キャップはしない）
 */

import * as admin from 'firebase-admin';
import type { drive_v3 } from 'googleapis';
import type { Document, CustomerMaster, DriveFolderTemplate } from '../shared/types';

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID 環境変数を設定してください');
  process.exit(1);
}

const args = process.argv.slice(2);
let careManagerName: string | undefined;
let limit: number | undefined;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--name' && args[i + 1]) {
    careManagerName = args[i + 1];
    i++;
  } else if (args[i] === '--limit' && args[i + 1]) {
    limit = parseInt(args[i + 1], 10);
    i++;
  }
}
if (!careManagerName) {
  console.error('--name <ケアマネ名> を指定してください（例: --name "森 奈穂美"）');
  process.exit(1);
}

admin.initializeApp({ projectId });
const db = admin.firestore();

const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const MASTER_PATHS_CUSTOMERS = 'masters/customers/items';

interface AncestorResult {
  docId: string;
  driveFileId: string;
  ancestorId: string;
  ancestorName: string | null;
  ancestorTrashed: boolean;
  expectedKey: string; // cmSegmentsをjoinした値。この階層に対応する"あるべき"フォルダ名列
}

interface SkippedDoc {
  docId: string;
  reason: string;
}

async function main(): Promise<void> {
  // functions/src/utils/driveAuth.ts はモジュールトップレベルで admin.firestore() を評価するため、
  // admin.initializeApp() より前に静的importするとFirebaseAppError(no-app)になる
  // (measure-summary-cost.ts / verify-candidate-extraction-document-level.ts と同型の対策)。
  const { getDriveSettings, getDriveClient } = await import('../functions/src/utils/driveAuth');
  const { resolveFolderSegments } = await import('../functions/src/drive/folderPath');
  const { SUPPORTS_ALL_DRIVES, escapeQueryValue } = await import('../functions/src/drive/driveApiConstants');
  type FolderPathDocInput = import('../functions/src/drive/folderPath').FolderPathDocInput;

  console.log(`プロジェクト: ${projectId}`);
  console.log(`調査対象ケアマネ名(完全一致): "${careManagerName}"`);
  if (limit !== undefined) {
    console.log(`⚠️  --limit ${limit}: 物理チェック対象documentを先頭${limit}件に制限します(安全弁)`);
  }
  console.log('---');

  const settings = await getDriveSettings();
  const { rootFolderId } = settings;
  const template: DriveFolderTemplate | undefined = settings.template;
  if (!rootFolderId || !template || template.length === 0) {
    console.error('❌ settings/drive の rootFolderId または template が未設定です。Drive連携が未接続の可能性があります。');
    process.exit(1);
  }
  console.log(`rootFolderId: ${rootFolderId}`);
  console.log(`template: ${JSON.stringify(template)}`);

  const cmIndex = template.findIndex((s) => s.type === 'careManager');
  if (cmIndex === -1) {
    console.error('❌ テンプレートに careManager セグメントが存在しません。調査対象外です。');
    process.exit(1);
  }
  const cmTemplatePrefix = template.slice(0, cmIndex + 1);
  console.log(`careManagerセグメントのテンプレート内位置: index=${cmIndex}（0始まり、rootから${cmIndex + 1}段目）`);
  console.log('---');

  // 対象ケアマネ名でexported済みのdocumentのみ対象（driveFileIdが物理配置の唯一の手がかりのため）
  const docsSnap = await db
    .collection('documents')
    .where('careManager', '==', careManagerName)
    .where('driveExportStatus', '==', 'exported')
    .get();
  console.log(`documents.careManager="${careManagerName}" かつ driveExportStatus="exported": ${docsSnap.size}件`);

  let targetDocs = docsSnap.docs.filter((d) => !!d.data().driveFileId);
  const noDriveFileId = docsSnap.size - targetDocs.length;
  if (noDriveFileId > 0) {
    console.log(`  うちdriveFileId欠損(データ不整合の可能性): ${noDriveFileId}件 → 物理チェック対象外`);
  }
  if (limit !== undefined && targetDocs.length > limit) {
    console.log(`  --limitにより${targetDocs.length}件中先頭${limit}件のみ処理`);
    targetDocs = targetDocs.slice(0, limit);
  }
  console.log('---');

  const drive: drive_v3.Drive = await getDriveClient();
  const customerFuriganaCache = new Map<string, string | undefined>();

  async function getCustomerFurigana(customerId: string | null | undefined): Promise<string | undefined> {
    if (!customerId) return undefined;
    if (customerFuriganaCache.has(customerId)) return customerFuriganaCache.get(customerId);
    const snap = await db.doc(`${MASTER_PATHS_CUSTOMERS}/${customerId}`).get();
    const furigana = snap.exists ? (snap.data() as CustomerMaster).furigana : undefined;
    customerFuriganaCache.set(customerId, furigana);
    return furigana;
  }

  /** parentId直下でnameと一致するフォルダを検索する（作成は一切行わない、findOrCreateFolder.tsの検索部分のみ再現）。 */
  async function searchFolderExact(parentId: string, name: string): Promise<drive_v3.Schema$File[]> {
    const q = `'${parentId}' in parents and name='${escapeQueryValue(name)}' and mimeType='${FOLDER_MIME_TYPE}' and trashed=false`;
    const res = await drive.files.list({
      q,
      fields: 'files(id, name)',
      includeItemsFromAllDrives: true,
      ...SUPPORTS_ALL_DRIVES,
    });
    return res.data.files ?? [];
  }

  const results: AncestorResult[] = [];
  const skipped: SkippedDoc[] = [];
  // "期待パス"(現在の設定・ロジックで新規documentが解決するはずのフォルダ)のキャッシュ。
  // 通常はテンプレート内でcareManagerより前のセグメントがdocument依存(customer/date)でない限り
  // 全document共通の1キーに収束するはずだが、一般性のためキー単位でキャッシュする。
  const expectedPathCache = new Map<string, { id: string | null; ambiguousAt?: string }>();

  async function resolveExpectedPath(cmSegments: string[]): Promise<{ id: string | null; ambiguousAt?: string }> {
    const key = cmSegments.join('/');
    if (expectedPathCache.has(key)) return expectedPathCache.get(key)!;
    let parentId = rootFolderId!;
    for (const name of cmSegments) {
      const files = await searchFolderExact(parentId, name);
      if (files.length > 1) {
        const result = { id: null, ambiguousAt: name };
        expectedPathCache.set(key, result);
        return result;
      }
      if (files.length === 0) {
        const result = { id: null };
        expectedPathCache.set(key, result);
        return result;
      }
      parentId = files[0].id!;
    }
    const result = { id: parentId };
    expectedPathCache.set(key, result);
    return result;
  }

  for (const docSnap of targetDocs) {
    const docId = docSnap.id;
    const doc = docSnap.data() as Document;
    const driveFileId = doc.driveFileId!;

    let customerFurigana: string | undefined;
    if (doc.customerId) {
      customerFurigana = await getCustomerFurigana(doc.customerId);
    }

    const docInput: FolderPathDocInput = {
      careManagerName: doc.careManager ?? '',
      customerName: doc.customerName,
      customerFurigana,
      documentCategory: doc.category || doc.documentType,
      documentType: doc.documentType,
      fileDate: doc.fileDate ? doc.fileDate.toDate() : null,
    };
    const opts = { furiganaFallback: settings.furiganaFallback };

    let cmSegments: string[];
    try {
      cmSegments = resolveFolderSegments(docInput, cmTemplatePrefix, opts);
    } catch (err) {
      skipped.push({ docId, reason: `careManager階層までのセグメント解決に失敗: ${(err as Error).message}` });
      continue;
    }

    let fullSegments: string[];
    try {
      fullSegments = resolveFolderSegments(docInput, template, opts);
    } catch (err) {
      skipped.push({ docId, reason: `フルパスのセグメント解決に失敗(careManager階層のみでは判定不可): ${(err as Error).message}` });
      continue;
    }

    const levelsUp = fullSegments.length - cmSegments.length;
    if (levelsUp < 0) {
      skipped.push({ docId, reason: `異常値: フルパス段数(${fullSegments.length}) < careManager階層段数(${cmSegments.length})` });
      continue;
    }

    try {
      const fileGet = await drive.files.get({ fileId: driveFileId, fields: 'parents,trashed', supportsAllDrives: true });
      if (fileGet.data.trashed) {
        skipped.push({ docId, reason: 'driveFileId自体がゴミ箱内(trashed) — 親フォルダ調査をスキップ' });
        continue;
      }
      let currentId = (fileGet.data.parents ?? [])[0];
      if (!currentId) {
        skipped.push({ docId, reason: 'driveFileIdに親フォルダが存在しない(parents空)' });
        continue;
      }
      let ancestorName: string | null = null;
      let ancestorTrashed = false;
      for (let i = 0; i < levelsUp; i++) {
        const folderGet = await drive.files.get({ fileId: currentId, fields: 'parents,name,trashed', supportsAllDrives: true });
        ancestorName = folderGet.data.name ?? null;
        ancestorTrashed = !!folderGet.data.trashed;
        const nextParents = folderGet.data.parents ?? [];
        if (nextParents.length === 0) {
          skipped.push({ docId, reason: `祖先チェーンがcareManager階層に到達する前にrootへ達した(${i + 1}/${levelsUp}段目で親なし)` });
          currentId = '';
          break;
        }
        currentId = nextParents[0];
      }
      if (!currentId) continue;

      if (levelsUp === 0) {
        // careManagerがleaf(document直下)の場合、file自身の親がそのままcareManagerフォルダ
        const selfGet = await drive.files.get({ fileId: currentId, fields: 'name,trashed', supportsAllDrives: true });
        ancestorName = selfGet.data.name ?? null;
        ancestorTrashed = !!selfGet.data.trashed;
      }

      results.push({
        docId,
        driveFileId,
        ancestorId: currentId,
        ancestorName,
        ancestorTrashed,
        expectedKey: cmSegments.join('/'),
      });
    } catch (err) {
      const message = (err as Error).message || String(err);
      skipped.push({ docId, reason: `Drive API呼び出し失敗(権限不足/404等の可能性): ${message}` });
    }
  }

  console.log(`物理チェック完了: 成功${results.length}件 / スキップ${skipped.length}件`);
  console.log('---');

  if (skipped.length > 0) {
    console.log('=== スキップ理由一覧 ===');
    for (const s of skipped) {
      console.log(`  docId=${s.docId}: ${s.reason}`);
    }
    console.log('---');
  }

  // expectedKeyごとにグルーピング(通常は1キーに収束するはずだが、一般性のため複数キーもありうる前提で処理)
  const byExpectedKey = new Map<string, AncestorResult[]>();
  for (const r of results) {
    if (!byExpectedKey.has(r.expectedKey)) byExpectedKey.set(r.expectedKey, []);
    byExpectedKey.get(r.expectedKey)!.push(r);
  }

  console.log(`=== 期待パス(careManager階層までのセグメント名列)ごとの判定 ===`);
  console.log(`検出された期待パスの種類数: ${byExpectedKey.size}`);
  if (byExpectedKey.size > 1) {
    console.log('⚠️  対象ケアマネ配下のdocumentから複数の異なる期待パスが導出されました(careManagerより前のセグメントがdocument依存の可能性)。各パスを個別に判定します。');
  }

  let anyDuplicationFound = false;

  for (const [expectedKey, group] of byExpectedKey.entries()) {
    console.log(`\n--- 期待パス: "${expectedKey}" (${group.length}件) ---`);

    const cmSegments = expectedKey.split('/');
    const expected = await resolveExpectedPath(cmSegments);
    if (expected.ambiguousAt) {
      console.log(`  ⚠️  現在の設定・ロジックで検索した結果、"${expected.ambiguousAt}"の段階で同名フォルダが複数件ヒットしました(それ自体が重複の直接証拠)。`);
    } else if (expected.id === null) {
      console.log('  現在の設定・ロジックでは該当フォルダがまだ存在しません(0件ヒット、新規exportで作成される想定)。');
    } else {
      console.log(`  現在の設定・ロジックで解決される"期待フォルダID": ${expected.id}`);
    }

    const byAncestorId = new Map<string, AncestorResult[]>();
    for (const r of group) {
      if (!byAncestorId.has(r.ancestorId)) byAncestorId.set(r.ancestorId, []);
      byAncestorId.get(r.ancestorId)!.push(r);
    }

    console.log(`  実際に物理的に収束している祖先フォルダID数: ${byAncestorId.size}`);
    if (byAncestorId.size > 1) {
      anyDuplicationFound = true;
      console.log('  ❌ 複数の異なる物理フォルダに分散しています(重複の可能性が高い):');
    } else {
      console.log('  ✅ 単一の物理フォルダに収束しています。');
    }

    for (const [ancestorId, docs] of byAncestorId.entries()) {
      const sample = docs[0];
      const matchesExpected = expected.id !== null && expected.id === ancestorId;
      console.log(
        `    ancestorId=${ancestorId} name="${sample.ancestorName}" trashed=${sample.ancestorTrashed} ` +
          `件数=${docs.length} 期待フォルダと一致=${matchesExpected ? 'Yes' : 'No'} ` +
          `(サンプルdocId: ${docs.slice(0, 5).map((d) => d.docId).join(', ')})`
      );
    }
  }

  console.log('\n=== 総括 ===');
  if (anyDuplicationFound) {
    console.log('❌ 物理的なフォルダ重複が検出されました。原因調査(作成日時比較、PR #752前後の判定等)とクリーンアップ方針の検討が必要です(Phase B、本スクリプトの範囲外・別途明示承認のうえ実施)。');
  } else if (results.length === 0) {
    console.log('⚠️  物理チェックが1件も完了しませんでした(スキップ理由を確認してください)。重複の有無を判定できません。');
  } else {
    console.log('✅ 調査した範囲では物理的なフォルダ重複は検出されませんでした。');
  }

  console.log('\n調査完了。');
  process.exit(0);
}

main().catch((err) => {
  console.error('エラー:', err);
  process.exit(1);
});
