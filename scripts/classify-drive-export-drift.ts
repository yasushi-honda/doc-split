#!/usr/bin/env ts-node
/**
 * Issue #811/#823 remediation: exported document の物理状態(Drive上のdriveFileId)を
 * 検査し、破損(404/trashed/誤配置)しているdocumentをread-onlyで検出する。
 *
 * 対象は`driveExportStatus==='exported'`のdocument全件(既定はkanameoneテナント全体、
 * `--care-manager`で絞り込み可)。判定は本番の`exportDocument.ts`の`resolveDriveFile()`と
 * 同一の順序・同一の判定関数(`isDriveFileNotFoundError`)で行う
 * (`scripts/investigate-caremanager-folder-duplicate.ts`は例外を全て404扱いしていた
 * 誤りがあったため転用しない、詳細は`scripts/lib/driveExportDriftClassifier.ts`参照)。
 *
 * 期待される親フォルダの解決には`functions/src/drive/childFolderResolver.ts`の
 * `resolveExistingChildFile()`(2段階検索: active→trashed、作成・復元は一切行わない)を
 * 使う。`investigate-caremanager-folder-duplicate.ts`内の`searchFolderExact()`
 * (`trashed=false`固定)は本番ロジックと乖離しているため使わない。
 *
 * 本スクリプトはread-only(Firestore/Drive/Storageいずれも書き込みを一切行わない)。
 * 検出結果を修復する`execute-drive-export-repair.ts`は別途実装・別途承認のうえ実施する
 * (`~/.claude/plans/sharded-mapping-squid.md`参照、2026-08-28 plan-crossreviewにより
 * 本セッションのスコープはclassifyのみに縮小)。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=docsplit-kanameone npx ts-node scripts/classify-drive-export-drift.ts \
 *     --out /tmp/plan.json
 *   FIREBASE_PROJECT_ID=docsplit-kanameone npx ts-node scripts/classify-drive-export-drift.ts \
 *     --care-manager "森 奈穂美" --out /tmp/plan.json
 *
 * オプション:
 *   --care-manager <名前>   documents.careManagerの完全一致で絞り込み(省略時は全ケアマネ対象)
 *   --limit <N>             検査対象document数の上限(安全弁。適用時は必ずログに明示)
 *   --skip-storage-check    Storage実体の存在確認をスキップ(既定は実施する)
 *   --sleep-ms <N>          Drive API呼び出し間のウェイト(既定0、レート制限回避用)
 *   --out <path>            plan JSON の出力先(必須)
 */

import * as admin from 'firebase-admin';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import type { drive_v3 } from 'googleapis';
import type { Document, CustomerMaster, DriveFolderTemplate } from '../shared/types';
import {
  classifyDriftEvidence,
  summarizeClassifications,
  summarizeByCareManager,
  type DriftClassification,
  type DriveFileGetResult,
} from './lib/driveExportDriftClassifier';

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID 環境変数を設定してください');
  process.exit(1);
}
const storageBucket = process.env.STORAGE_BUCKET;

const args = process.argv.slice(2);
let careManager: string | undefined;
let limit: number | undefined;
let skipStorageCheck = false;
let sleepMs = 0;
let outPath: string | undefined;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--care-manager' && args[i + 1]) {
    careManager = args[i + 1];
    i++;
  } else if (args[i] === '--limit' && args[i + 1]) {
    limit = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--skip-storage-check') {
    skipStorageCheck = true;
  } else if (args[i] === '--sleep-ms' && args[i + 1]) {
    sleepMs = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--out' && args[i + 1]) {
    outPath = args[i + 1];
    i++;
  }
}
if (!outPath) {
  console.error('--out <path> を指定してください(plan JSONの出力先)');
  process.exit(1);
}

admin.initializeApp({ projectId, storageBucket });
const db = admin.firestore();

const MASTER_PATHS_CUSTOMERS = 'masters/customers/items';
const PAGE_SIZE = 500;

interface TargetEntry {
  docId: string;
  careManager: string;
  customerName: string;
  category: 'missing-404' | 'trashed' | 'healthy' | 'misplaced';
  oldDriveFileId: string;
  oldParents: string[] | undefined;
  oldFileTrashed: boolean | undefined;
  expectedLeafFolderId: string;
  storageObjectExists: boolean | null;
}

interface BlockedEntry {
  docId: string;
  careManager: string;
  reason: string;
  detail?: string;
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  // functions/src/utils/driveAuth.ts はモジュールトップレベルで admin.firestore() を評価するため、
  // admin.initializeApp() より前に静的importするとFirebaseAppError(no-app)になる
  // (investigate-caremanager-folder-duplicate.ts等と同型の対策)。
  const { getDriveSettings, getDriveClient } = await import('../functions/src/utils/driveAuth');
  const { resolveFolderSegments } = await import('../functions/src/drive/folderPath');
  const { resolveExistingChildFile } = await import('../functions/src/drive/childFolderResolver');
  const { isDriveFileNotFoundError } = await import('../functions/src/drive/exportDocument');
  const { isCustomerUnconfirmed } = await import('../functions/src/drive/customerAmbiguityGate');
  const { resolveExportCategory } = await import('./lib/resolveExportCategory');
  type FolderPathDocInput = import('../functions/src/drive/folderPath').FolderPathDocInput;

  console.log(`プロジェクト: ${projectId}`);
  console.log(`対象ケアマネ: ${careManager ?? '(全ケアマネ)'}`);
  if (limit !== undefined) {
    console.log(`⚠️  --limit ${limit}: 検査対象を先頭${limit}件に制限します(安全弁)`);
  }
  if (skipStorageCheck) {
    console.log('⚠️  --skip-storage-check: Storage実体の存在確認をスキップします');
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

  const drive: drive_v3.Drive = await getDriveClient();
  const bucket = admin.storage().bucket();

  // documentId, careManager でのpagination(等価フィルタ2個はzigzag merge joinで解決され複合index不要、
  // investigate-caremanager-folder-duplicate.tsで実証済みの手法)
  let query = db.collection('documents').where('driveExportStatus', '==', 'exported') as admin.firestore.Query;
  if (careManager) {
    query = query.where('careManager', '==', careManager);
  }
  query = query.orderBy(admin.firestore.FieldPath.documentId()).limit(PAGE_SIZE);

  const docs: { id: string; data: Document }[] = [];
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  let hasMore = true;
  while (hasMore) {
    let pageQuery = query;
    if (lastDoc) {
      pageQuery = pageQuery.startAfter(lastDoc);
    }
    const snapshot = await pageQuery.get();
    if (snapshot.empty) {
      hasMore = false;
      break;
    }
    for (const d of snapshot.docs) {
      docs.push({ id: d.id, data: d.data() as Document });
      if (limit !== undefined && docs.length >= limit) {
        hasMore = false;
        break;
      }
    }
    if (hasMore) {
      lastDoc = snapshot.docs[snapshot.docs.length - 1];
      if (snapshot.size < PAGE_SIZE) hasMore = false;
    }
  }
  console.log(`検査対象document数: ${docs.length}件`);
  console.log('---');

  // customerFurigana/masterName はcustomerIdごとにmemoize(同一顧客のdocumentが多数あるため)
  const customerCache = new Map<string, { furigana: string | undefined; masterName: string | null }>();
  async function getCustomerInfo(
    customerId: string | null | undefined
  ): Promise<{ furigana: string | undefined; masterName: string | null }> {
    if (!customerId) return { furigana: undefined, masterName: null };
    const cached = customerCache.get(customerId);
    if (cached) return cached;
    const snap = await db.doc(`${MASTER_PATHS_CUSTOMERS}/${customerId}`).get();
    const master = snap.exists ? (snap.data() as CustomerMaster) : undefined;
    const result = { furigana: master?.furigana, masterName: master?.name ?? null };
    customerCache.set(customerId, result);
    return result;
  }

  // documentCategory はdocumentTypeごとにmemoize
  const categoryCache = new Map<string, string>();
  async function getCategory(documentType: string): Promise<string> {
    if (!documentType) return documentType;
    const cached = categoryCache.get(documentType);
    if (cached !== undefined) return cached;
    const resolved = await resolveExportCategory(db, documentType);
    categoryCache.set(documentType, resolved);
    return resolved;
  }

  // 期待leafフォルダ解決 はDrive API呼び出しを伴うため(parentId,name)ごとにmemoize
  type SegmentResolution =
    | { status: 'active'; id: string }
    | { status: 'would-restore-trashed'; id: string; name: string }
    | { status: 'would-create' }
    | { status: 'ambiguous'; detail: string };
  const folderCache = new Map<string, SegmentResolution>();
  const restoreFolderAggregate = new Map<
    string,
    { folderId: string; name: string; parentId: string; affectedDocIds: Set<string> }
  >();

  async function resolveExpectedLeaf(
    docId: string,
    segments: string[]
  ): Promise<{ leafFolderId: string; ambiguousAt?: { name: string; parentId: string; detail: string } }> {
    let parentId = rootFolderId!;
    for (const name of segments) {
      const key = `${parentId} ${name}`;
      let resolution = folderCache.get(key);
      if (!resolution) {
        try {
          const existing = await resolveExistingChildFile(drive, parentId, name);
          if (!existing || !existing.id) {
            resolution = { status: 'would-create' };
          } else if (existing.trashed) {
            resolution = { status: 'would-restore-trashed', id: existing.id, name };
          } else {
            resolution = { status: 'active', id: existing.id };
          }
        } catch (err) {
          resolution = { status: 'ambiguous', detail: (err as Error).message };
        }
        folderCache.set(key, resolution);
      }

      if (resolution.status === 'ambiguous') {
        return { leafFolderId: '', ambiguousAt: { name, parentId, detail: resolution.detail } };
      }
      if (resolution.status === 'would-create') {
        // 親が存在しないため以降のセグメントも解決不能。leafFolderId=''(実在しないID)を
        // 返し、classifyDriftEvidence側でparentsとの不一致(misplaced等)として扱わせる。
        return { leafFolderId: '' };
      }
      if (resolution.status === 'would-restore-trashed') {
        const agg = restoreFolderAggregate.get(resolution.id) ?? {
          folderId: resolution.id,
          name: resolution.name,
          parentId,
          affectedDocIds: new Set<string>(),
        };
        agg.affectedDocIds.add(docId);
        restoreFolderAggregate.set(resolution.id, agg);
      }
      parentId = resolution.id;
    }
    return { leafFolderId: parentId };
  }

  const targets: TargetEntry[] = [];
  const blocked: BlockedEntry[] = [];
  const classificationRows: { careManager: string; classification: DriftClassification }[] = [];

  for (let i = 0; i < docs.length; i++) {
    const { id: docId, data: doc } = docs[i];
    const cm = doc.careManager ?? '(未設定)';

    function recordBlocked(reason: string, detail?: string): void {
      blocked.push({ docId, careManager: cm, reason, detail });
      classificationRows.push({ careManager: cm, classification: { kind: 'blocked', reason: reason as never, detail } });
    }

    // 1. driveFileId欠損チェック(files.get自体を呼ばずに済ませる)
    if (!doc.driveFileId) {
      recordBlocked('no-drive-file-id');
      continue;
    }

    // 2. 顧客未確定チェック(exportDocument.tsの実際のガードと同一)
    const { furigana: customerFurigana, masterName: customerMasterName } = await getCustomerInfo(doc.customerId);
    if (await isCustomerUnconfirmed(doc, { firestore: db, customerMasterName })) {
      recordBlocked('customer-unconfirmed');
      continue;
    }

    // 3. セグメント解決(exportDocument.tsと同一ロジック)
    const category = await getCategory(doc.documentType);
    const docInput: FolderPathDocInput = {
      careManagerName: doc.careManager ?? '',
      customerName: doc.customerName,
      customerFurigana,
      documentCategory: category || doc.documentType,
      documentType: doc.documentType,
      fileDate: doc.fileDate ? doc.fileDate.toDate() : null,
    };
    let segments: string[];
    try {
      segments = resolveFolderSegments(docInput, template!, { furiganaFallback: settings.furiganaFallback });
    } catch (err) {
      recordBlocked('segment-unresolvable', `${(err as Error).name}: ${(err as Error).message}`);
      continue;
    }

    // 4. 期待leafフォルダ解決(read-only、作成・復元は一切行わない)
    const { leafFolderId, ambiguousAt } = await resolveExpectedLeaf(docId, segments);
    if (ambiguousAt) {
      recordBlocked(
        'ambiguous-path',
        `segment="${ambiguousAt.name}" parentId=${ambiguousAt.parentId}: ${ambiguousAt.detail}`
      );
      continue;
    }

    // 5. Storage実体確認(既定は実施。execute側が実際に再アップロードできるかの前提条件)
    let storageObjectExists: boolean | null = null;
    if (!skipStorageCheck) {
      try {
        const filePath = doc.fileUrl.replace(`gs://${bucket.name}/`, '');
        const [exists] = await bucket.file(filePath).exists();
        storageObjectExists = exists;
        if (!exists) {
          recordBlocked('storage-object-missing', `fileUrl=${doc.fileUrl}`);
          continue;
        }
      } catch (err) {
        recordBlocked('storage-object-missing', `確認失敗: ${(err as Error).message}`);
        continue;
      }
    }

    // 6. driveFileId自体の物理状態確認
    let fileGet: DriveFileGetResult;
    try {
      const res = await drive.files.get({
        fileId: doc.driveFileId,
        fields: 'parents,trashed',
        supportsAllDrives: true,
      });
      fileGet = { kind: 'ok', trashed: !!res.data.trashed, parents: res.data.parents ?? undefined };
    } catch (err) {
      if (isDriveFileNotFoundError(err)) {
        fileGet = { kind: 'not-found' };
      } else {
        fileGet = { kind: 'api-error', errorMessage: (err as Error).message || String(err) };
      }
    }

    const classification = classifyDriftEvidence({
      driveFileId: doc.driveFileId,
      fileGet,
      expectedLeafFolderId: leafFolderId,
    });
    classificationRows.push({ careManager: cm, classification });

    if (classification.kind === 'blocked') {
      blocked.push({
        docId,
        careManager: cm,
        reason: classification.reason,
        detail: classification.detail,
      });
    } else {
      targets.push({
        docId,
        careManager: cm,
        customerName: doc.customerName,
        category: classification.category,
        oldDriveFileId: doc.driveFileId,
        oldParents: fileGet.kind === 'ok' ? fileGet.parents : undefined,
        oldFileTrashed: fileGet.kind === 'ok' ? fileGet.trashed : undefined,
        expectedLeafFolderId: leafFolderId,
        storageObjectExists,
      });
    }

    if ((i + 1) % 25 === 0) {
      console.log(`  進捗: ${i + 1}/${docs.length}件処理済み`);
    }
    await sleep(sleepMs);
  }

  console.log('---');
  const summary = summarizeClassifications(classificationRows.map((r) => r.classification));
  console.log(
    `結果: scanned=${summary.scanned} healthy=${summary.healthy} missing404=${summary.missing404} ` +
      `trashed=${summary.trashed} misplaced=${summary.misplaced} blocked=${JSON.stringify(summary.blocked)}`
  );

  const byCareManager = summarizeByCareManager(classificationRows);
  const wouldRestoreFolders = [...restoreFolderAggregate.values()].map((agg) => ({
    folderId: agg.folderId,
    name: agg.name,
    parentId: agg.parentId,
    affectedDocCount: agg.affectedDocIds.size,
  }));
  if (wouldRestoreFolders.length > 0) {
    console.log(`⚠️  修復実行時にゴミ箱から復元されうるフォルダ: ${wouldRestoreFolders.length}件`);
    for (const f of wouldRestoreFolders) {
      console.log(`  folderId=${f.folderId} name="${f.name}" 影響document数=${f.affectedDocCount}`);
    }
  }

  const plan = {
    schemaVersion: 'drive-export-drift-plan-v1',
    planId: randomUUID(),
    projectId,
    generatedAt: new Date().toISOString(),
    scope: { careManager: careManager ?? null, limit: limit ?? null, storageChecked: !skipStorageCheck },
    driveSettings: { rootFolderId, template, furiganaFallback: settings.furiganaFallback ?? null },
    summary,
    byCareManager,
    wouldRestoreFolders,
    targets,
    blocked,
  };

  writeFileSync(outPath!, JSON.stringify(plan, null, 2), 'utf8');
  console.log(`---`);
  console.log(`plan JSON書き出し完了: ${outPath}`);
  console.log('調査完了。');
  process.exit(0);
}

main().catch((err) => {
  console.error('エラー:', err);
  process.exit(1);
});
