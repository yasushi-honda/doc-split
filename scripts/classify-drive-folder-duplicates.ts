#!/usr/bin/env ts-node
/**
 * Issue #811 Phase B Part A: Google Drive フォルダ重複統合の分類(read-only)
 *
 * `scripts/classify-collision-docs.ts`(Issue #432、実装済み)のPlan/Gate設計を
 * Google Driveフォルダ重複統合ドメインへ移植したもの。canonicalフォルダ(重複解消後の
 * 統合先)配下と、duplicateフォルダ群(統合元、trashed込み)の実データをDrive APIで
 * 直接走査し、各ファイルをmove-to-canonical/manual-reviewに分類してPlan JSONへ出力する。
 * Firestore/Drive双方への書き込みは一切行わない。
 *
 * 4回の独立診断(codex)で確定した必須要件を反映:
 *   - canonicalフォルダの健全性をfail-closedで検証(active・rootFolderId直下・
 *     duplicate-idsに含まれない)
 *   - rootFolderId直下の名前重複を再走査し、duplicate-idsの完全性を確認
 *   - duplicateフォルダの全ページ列挙(trashed込み)。1件でも走査失敗したら
 *     Plan全体をexit 2(未走査subtreeを見逃したまま「統合完了」と誤認しないため)
 *   - 複数親・shortcut・担当替え・移動先競合は全てmanual-reviewに分類(自動move禁止)
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=docsplit-kanameone npx ts-node scripts/classify-drive-folder-duplicates.ts \
 *     --canonical-id <folderId> --duplicate-ids <id1,id2,...> --out plan-output.json
 */

import * as admin from 'firebase-admin';
import * as fs from 'fs';
import type { drive_v3 } from 'googleapis';
import {
  classifyDuplicateFile,
  type FileEvidence,
} from './lib/folderDuplicateClassifier';
import {
  FOLDER_MERGE_PLAN_SCHEMA_VERSION,
  PROVENANCE_REQUIRED_BY_ACTION,
  computeFirestoreSnapshotHash,
  type Classification,
  type FolderProvenanceSnapshot,
  type Operation,
  type Plan,
  type PlanSummary,
  type RecommendedAction,
} from './lib/folderMergePlanTypes';
import { readDriveApiVersionSnapshot } from './lib/driveApiVersionGate';
import { resolveExportCategory } from './lib/resolveExportCategory';

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID を設定してください');
  process.exit(1);
}

function getOpt(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const canonicalFolderIdArg = getOpt('--canonical-id');
const duplicateIdsRaw = getOpt('--duplicate-ids');
const outFile = getOpt('--out') ?? 'plan-output.json';

if (!canonicalFolderIdArg || !duplicateIdsRaw) {
  console.error('--canonical-id <folderId> と --duplicate-ids <id1,id2,...> は必須です');
  process.exit(1);
}
// TypeScriptはconstの絞り込みを閉包(async function main()等)を跨いで保持しないため、
// 明示的にstring型の定数へ再代入する(closure内でも`string | null`に戻らないようにする)。
const canonicalFolderId: string = canonicalFolderIdArg;
const duplicateFolderIds = duplicateIdsRaw.split(',').map((s) => s.trim()).filter(Boolean);
if (duplicateFolderIds.length === 0) {
  console.error('--duplicate-ids は最低1件のIDを含む必要があります');
  process.exit(1);
}
if (duplicateFolderIds.includes(canonicalFolderId)) {
  console.error('FATAL: --canonical-id が --duplicate-ids に含まれています(自己参照)');
  process.exit(2);
}

admin.initializeApp({ projectId });
const db = admin.firestore();

const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

interface RawDriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  trashed: boolean;
  version: string;
  md5Checksum: string | null;
  headRevisionId: string | null;
  appProperties: Record<string, string> | null;
}

async function main(): Promise<void> {
  // driveAuth.tsはモジュールトップレベルでadmin.firestore()を評価するため、
  // admin.initializeApp()より前に静的importするとFirebaseAppError(no-app)になる
  // (investigate-issue811-root-cause.ts / investigate-caremanager-folder-duplicate.ts
  // と同型の対策)。
  const { getDriveSettings, getDriveClient } = await import('../functions/src/utils/driveAuth');
  const { resolveFolderSegments } = await import('../functions/src/drive/folderPath');
  const { SUPPORTS_ALL_DRIVES, escapeQueryValue } = await import(
    '../functions/src/drive/driveApiConstants'
  );
  type FolderPathDocInput = import('../functions/src/drive/folderPath').FolderPathDocInput;

  console.log(`プロジェクト: ${projectId}`);
  console.log(`canonicalFolderId: ${canonicalFolderId}`);
  console.log(`duplicateFolderIds: ${duplicateFolderIds.join(', ')}`);
  console.log('---');

  const settings = await getDriveSettings();
  const { rootFolderId, template } = settings;
  if (!rootFolderId || !template || template.length === 0) {
    console.error('❌ settings/drive の rootFolderId または template が未設定です。');
    process.exit(1);
  }
  const cmIndex = template.findIndex((s) => s.type === 'careManager');
  if (cmIndex === -1) {
    console.error('❌ テンプレートに careManager セグメントが存在しません。');
    process.exit(1);
  }
  const cmTemplatePrefix = template.slice(0, cmIndex + 1);
  const postCmTemplate = template.slice(cmIndex + 1);
  const opts = { furiganaFallback: settings.furiganaFallback };

  const drive: drive_v3.Drive = await getDriveClient();

  // ─── canonicalフォルダの期待される直接の親を、テンプレートから解決する ──────
  // codex review 7巡目P1指摘対応: 従来はcanonicalの親を常にrootFolderId直下と
  // 決め打っていたが、ADR-0022記載の通りかなめ環境は「事業所（固定）→ ケアマネ→…」
  // という5階層で、careManagerセグメントの前に'fixed'階層が存在する。この場合
  // canonicalの実際の親はrootFolderIdではなくその固定階層フォルダであり、
  // 決め打ちのままでは本番の実レイアウトに対し常にFATAL誤検知してclassifyが
  // 実行不能になる。careManagerセグメントより前の'fixed'セグメントを
  // rootFolderIdから順に解決し、期待される親IDを導出する。
  const preCmSegments = template.slice(0, cmIndex);
  const fixedPrefixNames: string[] = [];
  for (const seg of preCmSegments) {
    if (seg.type !== 'fixed') {
      console.error(
        `❌ careManagerセグメントより前に'fixed'以外のsegment種別("${seg.type}")があり、canonical親フォルダの解決方法が未対応です。`
      );
      process.exit(1);
    }
    fixedPrefixNames.push(seg.value);
  }
  let expectedCanonicalParentId = rootFolderId;
  for (const name of fixedPrefixNames) {
    const fixedQuery: string = `'${expectedCanonicalParentId}' in parents and name='${escapeQueryValue(name)}' and mimeType='${FOLDER_MIME_TYPE}'`;
    const fixedListResult: { data: { files?: { id?: string | null }[] } } = await drive.files.list({
      q: fixedQuery,
      fields: 'files(id)',
      includeItemsFromAllDrives: true,
      ...SUPPORTS_ALL_DRIVES,
    });
    const fixedFiles = fixedListResult.data.files ?? [];
    if (fixedFiles.length !== 1 || !fixedFiles[0].id) {
      console.error(
        `❌ テンプレートの固定階層"${name}"を親フォルダ${expectedCanonicalParentId}配下で一意に解決できません(${fixedFiles.length}件マッチ)。`
      );
      process.exit(1);
    }
    expectedCanonicalParentId = fixedFiles[0].id;
  }

  // ─── canonicalフォルダの健全性確認(fail-closed) ─────────────────
  const canonicalGet = await drive.files.get({
    fileId: canonicalFolderId,
    fields: 'id, name, mimeType, parents, trashed, modifiedTime',
    ...SUPPORTS_ALL_DRIVES,
  });
  if (canonicalGet.data.mimeType !== FOLDER_MIME_TYPE) {
    console.error(`FATAL: canonical-id はフォルダではありません(mimeType=${canonicalGet.data.mimeType})`);
    process.exit(2);
  }
  if (canonicalGet.data.trashed) {
    console.error('FATAL: canonicalフォルダがtrashed状態です。統合先が生きていることを確認してください。');
    process.exit(2);
  }
  const canonicalParents = canonicalGet.data.parents ?? [];
  if (canonicalParents.length !== 1 || canonicalParents[0] !== expectedCanonicalParentId) {
    console.error(
      `FATAL: canonicalフォルダが期待される親フォルダ配下にありません(parents=${JSON.stringify(canonicalParents)}, expected=[${expectedCanonicalParentId}]${fixedPrefixNames.length > 0 ? ` = rootFolderId配下の固定階層 ${fixedPrefixNames.join(' > ')}` : ' = rootFolderId'})`
    );
    process.exit(2);
  }
  const canonicalName = canonicalGet.data.name;
  if (!canonicalName) {
    console.error('FATAL: canonicalフォルダのnameが取得できません');
    process.exit(2);
  }
  console.log(`canonical健全性確認OK: name="${canonicalName}"`);

  // ─── canonicalの親フォルダ配下の名前重複を再走査(duplicate-idsの完全性確認) ──
  // codex review 7巡目P1指摘対応: 重複フォルダはcanonicalと同じ直接の親を持つ
  // (findOrCreateFolder.tsのバグはcanonicalと同じ場所へ兄弟フォルダを作り続ける)。
  // 固定階層がある場合、rootFolderId直下ではなくexpectedCanonicalParentId配下を
  // 再走査しなければ重複を見逃す。
  const rootScanIds = new Set<string>();
  {
    let pageToken: string | undefined;
    do {
      const res = await drive.files.list({
        q: `'${expectedCanonicalParentId}' in parents and name='${escapeQueryValue(canonicalName)}' and mimeType='${FOLDER_MIME_TYPE}'`,
        fields: 'nextPageToken, files(id, trashed)',
        includeItemsFromAllDrives: true,
        pageSize: 100,
        pageToken,
        ...SUPPORTS_ALL_DRIVES,
      });
      for (const f of res.data.files ?? []) {
        if (f.id) rootScanIds.add(f.id);
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
  }
  const expectedIds = new Set([canonicalFolderId, ...duplicateFolderIds]);
  const missingFromScan = [...expectedIds].filter((id) => !rootScanIds.has(id));
  const extraInScan = [...rootScanIds].filter((id) => !expectedIds.has(id));
  if (missingFromScan.length > 0 || extraInScan.length > 0) {
    console.error(
      `FATAL: canonicalの親フォルダ配下の "${canonicalName}" 名フォルダ再走査が --canonical-id/--duplicate-ids と一致しません。` +
        ` missing=${JSON.stringify(missingFromScan)} extra=${JSON.stringify(extraInScan)}`
    );
    console.error('前回調査から状態が変化している可能性があります。investigate-issue811-root-cause.ts --scan-root-duplicates を再実行してください。');
    process.exit(2);
  }
  console.log(`canonicalの親フォルダ配下の名前重複再走査OK: ${rootScanIds.size}件が --canonical-id/--duplicate-ids と一致`);

  // ─── duplicateフォルダのprovenance(健全性スナップショット)取得 ─────────
  const sourceFolderProvenance: FolderProvenanceSnapshot[] = [];
  for (const dupId of duplicateFolderIds) {
    const g = await drive.files.get({
      fileId: dupId,
      fields: 'id, name, mimeType, parents, trashed, modifiedTime',
      ...SUPPORTS_ALL_DRIVES,
    });
    if (g.data.mimeType !== FOLDER_MIME_TYPE) {
      console.error(`FATAL: duplicate-id ${dupId} はフォルダではありません`);
      process.exit(2);
    }
    sourceFolderProvenance.push({
      id: dupId,
      name: g.data.name ?? '<unknown>',
      parents: g.data.parents ?? [],
      trashed: !!g.data.trashed,
      modifiedTime: g.data.modifiedTime ?? '',
      childCountAtClassify: 0, // 後段の再帰走査完了後に更新
    });
  }

  // ─── duplicateフォルダを全ページ・再帰的に列挙(trashed込み) ─────────────
  const unscannedSourceFolderIds: string[] = [];
  const allFiles: Array<{ file: RawDriveFile; sourceRootId: string }> = [];
  const childCountByRoot = new Map<string, number>();

  async function walkFolder(folderId: string, sourceRootId: string): Promise<void> {
    let pageToken: string | undefined;
    do {
      const res = await drive.files.list({
        q: `'${folderId}' in parents`,
        fields:
          'nextPageToken, files(id, name, mimeType, parents, trashed, version, md5Checksum, headRevisionId, appProperties)',
        includeItemsFromAllDrives: true,
        pageSize: 100,
        pageToken,
        ...SUPPORTS_ALL_DRIVES,
      });
      for (const f of res.data.files ?? []) {
        if (!f.id || !f.name || !f.mimeType || !f.version) continue;
        const raw: RawDriveFile = {
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          parents: f.parents ?? [],
          trashed: !!f.trashed,
          version: f.version,
          md5Checksum: f.md5Checksum ?? null,
          headRevisionId: f.headRevisionId ?? null,
          appProperties: (f.appProperties as Record<string, string> | undefined) ?? null,
        };
        if (raw.mimeType === FOLDER_MIME_TYPE) {
          await walkFolder(raw.id, sourceRootId);
        } else {
          allFiles.push({ file: raw, sourceRootId });
          childCountByRoot.set(sourceRootId, (childCountByRoot.get(sourceRootId) ?? 0) + 1);
        }
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
  }

  for (const dupId of duplicateFolderIds) {
    try {
      await walkFolder(dupId, dupId);
    } catch (err) {
      console.error(`⚠️  duplicateフォルダ ${dupId} の走査中にエラー: ${(err as Error).message}`);
      unscannedSourceFolderIds.push(dupId);
    }
  }

  for (const snap of sourceFolderProvenance) {
    snap.childCountAtClassify = childCountByRoot.get(snap.id) ?? 0;
  }

  console.log(
    `全走査対象duplicateフォルダ: ${duplicateFolderIds.length}件、走査成功: ${duplicateFolderIds.length - unscannedSourceFolderIds.length}件、走査失敗: ${unscannedSourceFolderIds.length}件`
  );
  console.log(`発見ファイル総数: ${allFiles.length}件`);

  if (unscannedSourceFolderIds.length > 0) {
    console.error(
      `FATAL: ${unscannedSourceFolderIds.length}件のduplicateフォルダで全ページ列挙が完了しませんでした: ${unscannedSourceFolderIds.join(', ')}`
    );
    console.error('未走査のsubtreeが残ったまま「統合完了」と誤認するリスクを避けるため、Planを出力せず終了します。');
    process.exit(2);
  }

  // ─── canonical配下の既存パスをread-onlyで解決するヘルパー(競合検知用、作成しない) ──
  const resolvedPathCache = new Map<string, string | null | '<ambiguous>'>();
  async function resolveExistingPathReadOnly(segments: string[]): Promise<string | null | '<ambiguous>'> {
    const key = segments.join('/');
    if (resolvedPathCache.has(key)) return resolvedPathCache.get(key)!;
    let parentId: string = canonicalFolderId;
    for (const name of segments) {
      const query: string = `'${parentId}' in parents and name='${escapeQueryValue(name)}' and mimeType='${FOLDER_MIME_TYPE}'`;
      const listResult: { data: { files?: { id?: string | null }[] } } = await drive.files.list({
        q: query,
        fields: 'files(id)',
        includeItemsFromAllDrives: true,
        ...SUPPORTS_ALL_DRIVES,
      });
      const files = listResult.data.files ?? [];
      if (files.length === 0) {
        resolvedPathCache.set(key, null);
        return null;
      }
      // 2件以上は「解決不能」として扱い、呼び出し元でconflict扱い(安全側)にする。
      if (files.length > 1) {
        resolvedPathCache.set(key, '<ambiguous>');
        return '<ambiguous>';
      }
      const nextId = files[0].id;
      if (!nextId) {
        resolvedPathCache.set(key, null);
        return null;
      }
      parentId = nextId;
    }
    resolvedPathCache.set(key, parentId);
    return parentId;
  }

  async function hasDestinationConflict(segments: string[], docSplitDocId: string): Promise<boolean> {
    const targetFolderId = await resolveExistingPathReadOnly(segments);
    if (targetFolderId === null) return false; // 目標フォルダがまだ存在しない = 競合なし
    if (targetFolderId === '<ambiguous>') return true; // 安全側でconflict扱い
    const res = await drive.files.list({
      q: `'${targetFolderId}' in parents and appProperties has { key='docSplitDocId' and value='${escapeQueryValue(docSplitDocId)}' }`,
      fields: 'files(id)',
      includeItemsFromAllDrives: true,
      ...SUPPORTS_ALL_DRIVES,
    });
    return (res.data.files ?? []).length > 0;
  }

  // ─── Firestore document解決キャッシュ ─────────────────────────
  const firestoreDocCache = new Map<string, admin.firestore.DocumentData | null>();
  async function resolveFirestoreDoc(docId: string): Promise<admin.firestore.DocumentData | null> {
    if (firestoreDocCache.has(docId)) return firestoreDocCache.get(docId)!;
    const snap = await db.doc(`documents/${docId}`).get();
    const data = snap.exists ? snap.data()! : null;
    firestoreDocCache.set(docId, data);
    return data;
  }

  const customerFuriganaCache = new Map<string, string | undefined>();
  async function getCustomerFurigana(customerId: string | null | undefined): Promise<string | undefined> {
    if (!customerId) return undefined;
    if (customerFuriganaCache.has(customerId)) return customerFuriganaCache.get(customerId);
    const snap = await db.doc(`masters/customers/items/${customerId}`).get();
    const furigana = snap.exists ? (snap.data() as { furigana?: string }).furigana : undefined;
    customerFuriganaCache.set(customerId, furigana);
    return furigana;
  }

  // ─── 各ファイルを分類 ─────────────────────────────────────
  const operations: Operation[] = [];
  const byClassification: Record<Classification, number> = {
    ConfirmedMatch: 0,
    ManualReviewRequired: 0,
  };
  const byAction: Record<RecommendedAction, number> = {
    'move-to-canonical': 0,
    'manual-review': 0,
  };
  let opCounter = 1;

  for (const { file, sourceRootId } of allFiles) {
    const docSplitDocId = file.appProperties?.docSplitDocId ?? null;
    let firestoreDocForClassifier: { docId: string; careManagerName: string } | null = null;
    let firestoreData: admin.firestore.DocumentData | null = null;

    if (docSplitDocId) {
      firestoreData = await resolveFirestoreDoc(docSplitDocId);
      if (firestoreData) {
        firestoreDocForClassifier = {
          docId: docSplitDocId,
          careManagerName: '', // 下で計算した"期待されるcanonicalフォルダ名"に差し替える
        };
      }
    }

    let targetSegments: string[] = [];
    let destinationConflict = false;
    let expectedCareManagerFolderName: string | null = null;
    // codex review P1/P2指摘対応: hash計算にも使うため、if-block外の変数として保持する
    // (以前はhash側が生のdoc.category/customerFurigana欠如のまま計算しておりtargetSegments
    // 解決と異なる入力を使っていた)。
    let resolvedCustomerId: string | null = null;
    let resolvedCustomerFurigana: string | null = null;
    let resolvedDocumentCategory: string = '';

    if (firestoreData) {
      const careManagerRaw = (firestoreData.careManager as string | undefined) ?? '';
      const cmDocInput: FolderPathDocInput = {
        careManagerName: careManagerRaw,
        customerName: '',
        documentCategory: '<n/a>',
        documentType: '<n/a>',
        fileDate: null,
      };
      try {
        const cmSegments = resolveFolderSegments(cmDocInput, cmTemplatePrefix, opts);
        expectedCareManagerFolderName = cmSegments[cmSegments.length - 1] ?? null;
      } catch {
        expectedCareManagerFolderName = null; // careManager未設定等 → 下のclassifierでreassigned扱いになる
      }

      if (firestoreDocForClassifier) {
        firestoreDocForClassifier.careManagerName = expectedCareManagerFolderName ?? '<unresolved>';
      }

      // documentCategoryは`masters/documents/items`をdocumentType名で引いて解決する
      // (exportDocument.tsと同一ロジック、codex review P1指摘対応: 生のdoc.categoryは
      // documentType手動訂正後に追従更新されず古い配置先になりうる)。careManagerの
      // 一致・不一致に関わらず、hash用に常に解決しておく。
      const documentTypeRaw = (firestoreData.documentType as string | undefined) ?? '';
      resolvedDocumentCategory = await resolveExportCategory(db, documentTypeRaw);

      resolvedCustomerId = (firestoreData.customerId as string | null | undefined) ?? null;
      if (resolvedCustomerId) {
        resolvedCustomerFurigana = (await getCustomerFurigana(resolvedCustomerId)) ?? null;
      }

      if (expectedCareManagerFolderName === canonicalName) {
        // customer/documentCategory以降のセグメントを解決(担当ケアマネが一致する場合のみ、
        // 無駄なDrive呼び出しを避ける)
        const fullDocInput: FolderPathDocInput = {
          careManagerName: careManagerRaw,
          customerName: (firestoreData.customerName as string | undefined) ?? '',
          customerFurigana: resolvedCustomerFurigana ?? undefined,
          documentCategory: resolvedDocumentCategory,
          documentType: documentTypeRaw,
          fileDate: firestoreData.fileDate ? (firestoreData.fileDate as admin.firestore.Timestamp).toDate() : null,
        };
        try {
          targetSegments = resolveFolderSegments(fullDocInput, postCmTemplate, opts);
          destinationConflict = await hasDestinationConflict(targetSegments, docSplitDocId!);
        } catch (err) {
          // segment解決失敗(フリガナ欠損等) → manual-review(evidence側でfirestoreDoc careManager
          // 不一致にはならないため、conflict=trueで安全側に倒す)
          destinationConflict = true;
        }
      }
    }

    const evidence: FileEvidence = {
      driveFileId: file.id,
      name: file.name,
      mimeType: file.mimeType,
      parents: file.parents,
      trashed: file.trashed,
      docSplitDocId,
      firestoreDoc: firestoreDocForClassifier,
      targetCareManagerName: canonicalName,
      destinationConflict,
    };
    const result = classifyDuplicateFile(evidence);

    const operationId = `op-${String(opCounter).padStart(4, '0')}`;
    opCounter += 1;

    const provenanceRequired = PROVENANCE_REQUIRED_BY_ACTION[result.recommendedAction];

    const op: Operation = {
      operationId,
      docId: docSplitDocId ?? '<unresolved>',
      driveFileId: file.id,
      classification: result.classification,
      recommendedAction: result.recommendedAction,
      reason: result.reason,
      expectedParents: file.parents,
      expectedTrashed: file.trashed,
      expectedName: file.name,
      expectedFirestoreSnapshotHash: firestoreData
        ? computeFirestoreSnapshotHash({
            careManager: (firestoreData.careManager as string | undefined) ?? '',
            customerName: (firestoreData.customerName as string | undefined) ?? '',
            customerId: resolvedCustomerId,
            customerFurigana: resolvedCustomerFurigana,
            documentCategory: resolvedDocumentCategory,
            documentType: (firestoreData.documentType as string | undefined) ?? '',
            fileDateIso: firestoreData.fileDate
              ? (firestoreData.fileDate as admin.firestore.Timestamp).toDate().toISOString()
              : null,
          })
        : null,
      sourceFolderId: sourceRootId,
      targetSegments,
      provenanceRequired,
      provenance: provenanceRequired
        ? {
            fileId: file.id,
            md5Checksum: file.md5Checksum,
            version: file.version,
            headRevisionId: file.headRevisionId,
          }
        : null,
    };
    operations.push(op);
    byClassification[result.classification] += 1;
    byAction[result.recommendedAction] += 1;
  }

  const driveApiVersion = readDriveApiVersionSnapshot();

  const summary: PlanSummary = {
    scannedSourceFolders: duplicateFolderIds.length - unscannedSourceFolderIds.length,
    unscannedSourceFolderIds,
    totalFilesScanned: allFiles.length,
    byClassification,
    byAction,
  };

  const plan: Plan = {
    schemaVersion: FOLDER_MERGE_PLAN_SCHEMA_VERSION,
    planId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    createdAt: new Date().toISOString(),
    environment: projectId!,
    projectId: projectId!,
    googleapisLockfileVersion: driveApiVersion.googleapisLockfileVersion,
    lockfileHash: driveApiVersion.lockfileHash,
    canonicalFolderId,
    duplicateFolderIds,
    canonicalProvenance: {
      id: canonicalFolderId,
      name: canonicalName,
      parents: canonicalParents,
      trashed: !!canonicalGet.data.trashed,
      modifiedTime: canonicalGet.data.modifiedTime ?? '',
      childCountAtClassify: 0,
    },
    sourceFolderProvenance,
    summary,
    operations,
  };

  fs.writeFileSync(outFile, JSON.stringify(plan, null, 2));
  console.log(`\nPlan written to ${outFile}`);
  console.log(JSON.stringify(summary, null, 2));

  await admin.app().delete();
}

main().catch(async (err) => {
  console.error('Failed:', err);
  try {
    await admin.app().delete();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
