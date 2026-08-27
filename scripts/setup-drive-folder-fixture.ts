#!/usr/bin/env ts-node
/**
 * Issue #811 Phase B: dev 環境に Drive フォルダ重複統合の fixture を投入(idempotent)
 *
 * `scripts/setup-collision-fixture.ts`(Issue #432)のADR-0016 devリハーサル規律を踏襲する:
 * kanameone本番でexecute pathが初動するリスクを避けるため、devに意図的な重複+ケース分岐を
 * 作り、classify→execute(dry-run→execute)を本番前に検証する。
 *
 * 投入内容(識別可能なfixture名`フィクスチャ*`、実行毎にランダムsuffix付き):
 *   - canonicalフォルダ1件(rootFolderId直下)
 *   - duplicateフォルダ2件(同名、うち1件はtrashed) — 配下に customer/category の
 *     ネストフォルダ + fixtureファイルを作成
 *     - move-to-canonical期待: docSplitDocIdがFirestore fixture documentに解決でき、
 *       careManagerが一致するファイル
 *     - manual-review期待: careManagerが一致しない(担当替えシナリオ)ファイル
 *   - 対応するFirestore fixture document(`documents/pr-x-fixture-*`)
 *
 * codex review指摘対応(2点):
 *   - canonicalフォルダ名は固定文字列ではなく、fixture documentのcareManager値を
 *     実際のテンプレートで解決した結果を使う(classifyDuplicateFile()のcareManager一致判定は
 *     Firestoreの生値をresolveFolderSegments()で解決した名前とDriveフォルダ名を比較するため、
 *     両者を同じ計算で導出しないと"move-to-canonical"期待のfixtureが必ずmanual-review化する)
 *   - careManager raw値自体に実行毎のランダムsuffixを含める(canonicalフォルダ名もそこから
 *     自動的に一意になる)。固定名だと、2回目以降の投入時に前回runのtrashed化された
 *     フォルダ群が同名で残り続け、classifyのroot直下名前重複再走査(完全性チェック)が
 *     「想定外の余剰フォルダ」を検知してfail-closedするため、devリハーサルの2周実行が
 *     成立しなかった。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=doc-split-dev npx ts-node scripts/setup-drive-folder-fixture.ts [--cleanup]
 *
 * --cleanup: fixtureを削除する(再投入前のリセット用)
 *
 * --repair-scenario: Issue #811/#823 remediation(`scripts/classify-drive-export-drift.ts`)の
 *   devリハーサル用fixtureを投入する(上記の重複統合フレームワーク用fixtureとは独立、
 *   `--cleanup`とは併用不可でどちらか一方を指定する)。exported かつ driveFileId が
 *   trashed/404/healthy の3document(`driveExportStatus`/`driveFileId`/`fileUrl`等の
 *   フィールドを持たない既存fixtureでは今回のシナリオを再現できないため新設)を投入する:
 *     - repair-healthy: 正しいフォルダに実体があるファイル(healthy判定の陰性対照)
 *     - repair-trashed: 実体はあるがゴミ箱内にあるファイル(trashed判定)
 *     - repair-404: driveFileIdがDrive上に存在しない(missing-404判定。#823調査で判明した
 *       「404以外の例外も混ざりうる」懸念(R1)を、実際のDrive APIレスポンスで確定させる
 *       のがこのfixtureの主目的)
 */

import * as admin from 'firebase-admin';
import * as crypto from 'crypto';

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID を設定してください');
  process.exit(1);
}
if (!projectId.includes('dev')) {
  console.error(`FATAL: setup-drive-folder-fixture は dev 環境専用です。projectId=${projectId} は dev を含みません。`);
  process.exit(2);
}

const cleanup = process.argv.includes('--cleanup');
const repairScenario = process.argv.includes('--repair-scenario');
if (repairScenario && cleanup) {
  console.error('❌ --repair-scenario と --cleanup は併用できません(cleanupは常に両fixture種別を対象に実施されるため、--repair-scenario単体では不要です)。');
  process.exit(1);
}

admin.initializeApp({ projectId, storageBucket: process.env.STORAGE_BUCKET });
const db = admin.firestore();

const FIXTURE_PREFIX = 'pr-x-fixture';
const FIXTURE_DOC_MATCH = `${FIXTURE_PREFIX}-doc-match`;
const FIXTURE_DOC_REASSIGNED = `${FIXTURE_PREFIX}-doc-reassigned`;
const FIXTURE_CUSTOMER_ID = `${FIXTURE_PREFIX}-customer-match`;
const REPAIR_FIXTURE_DOC_HEALTHY = `${FIXTURE_PREFIX}-doc-repair-healthy`;
const REPAIR_FIXTURE_DOC_TRASHED = `${FIXTURE_PREFIX}-doc-repair-trashed`;
const REPAIR_FIXTURE_DOC_404 = `${FIXTURE_PREFIX}-doc-repair-404`;
// 実在しないことが保証されたDrive fileId(Drive IDは英数字+'-'/'_'のbase64url類似形式、
// 44文字前後が一般的。この文字列が偶然実在のファイルと衝突する確率は無視できる)。
const REPAIR_FIXTURE_FAKE_404_FILE_ID = '1FIXTURE404-does-not-exist-0000000000000';
// cleanup時の広域sweep用(実行毎のランダムsuffixに関わらず、過去runの残骸を全て対象にする)
const FIXTURE_NAME_SWEEP_TOKEN = 'フィクスチャ';

const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

async function main(): Promise<void> {
  const { getDriveSettings, getDriveClient } = await import('../functions/src/utils/driveAuth');
  const { SUPPORTS_ALL_DRIVES, escapeQueryValue } = await import('../functions/src/drive/driveApiConstants');
  const { resolveFolderSegments } = await import('../functions/src/drive/folderPath');
  type FolderPathDocInput = import('../functions/src/drive/folderPath').FolderPathDocInput;
  const drive = await getDriveClient();

  const settings = await getDriveSettings();
  const { rootFolderId, template } = settings;
  if (!rootFolderId || !template || template.length === 0) {
    console.error('❌ dev の settings/drive.rootFolderId または template が未設定です。Drive連携を先に接続してください。');
    process.exit(1);
  }
  const cmIndex = template.findIndex((s) => s.type === 'careManager');
  if (cmIndex === -1) {
    console.error('❌ テンプレートに careManager セグメントが存在しません。');
    process.exit(1);
  }
  const cmTemplatePrefix = template.slice(0, cmIndex + 1);
  const opts = { furiganaFallback: settings.furiganaFallback };

  // ─── careManagerセグメントより前の'fixed'階層をfind-or-createで解決する ──
  // codex review 7巡目P1指摘対応(classify-drive-folder-duplicates.ts側の修正と対)。
  // かなめ本番相当(事業所固定→ケアマネ→…)のレイアウトをdevリハーサルでも再現しないと、
  // 修正後のclassifyが期待する「canonicalの親は固定階層配下」という前提を検証できない。
  const preCmSegments = template.slice(0, cmIndex);
  const fixedPrefixNames: string[] = [];
  for (const seg of preCmSegments) {
    if (seg.type !== 'fixed') {
      console.error(
        `❌ careManagerセグメントより前に'fixed'以外のsegment種別("${seg.type}")があり、fixtureの配置方法が未対応です。`
      );
      process.exit(1);
    }
    fixedPrefixNames.push(seg.value);
  }
  let fixtureParentId = rootFolderId;
  for (const name of fixedPrefixNames) {
    const query: string = `'${fixtureParentId}' in parents and name='${escapeQueryValue(name)}' and mimeType='${FOLDER_MIME_TYPE}'`;
    const listResult: { data: { files?: { id?: string | null }[] } } = await drive.files.list({
      q: query,
      fields: 'files(id)',
      includeItemsFromAllDrives: true,
      ...SUPPORTS_ALL_DRIVES,
    });
    const files = listResult.data.files ?? [];
    if (files.length > 1) {
      console.error(`❌ 固定階層"${name}"が親フォルダ${fixtureParentId}配下で複数件マッチし解決できません。`);
      process.exit(1);
    }
    if (files.length === 1 && files[0].id) {
      fixtureParentId = files[0].id;
      continue;
    }
    const createRes = await drive.files.create({
      requestBody: { name, mimeType: FOLDER_MIME_TYPE, parents: [fixtureParentId] },
      fields: 'id',
      ...SUPPORTS_ALL_DRIVES,
    });
    if (!createRes.data.id) throw new Error(`固定階層フォルダの作成に失敗: ${name}`);
    fixtureParentId = createRes.data.id;
  }

  console.log(`プロジェクト: ${projectId}`);
  console.log(`rootFolderId: ${rootFolderId}`);
  console.log(`fixtureParentId(固定階層解決後): ${fixtureParentId}${fixedPrefixNames.length > 0 ? ` (= ${fixedPrefixNames.join(' > ')})` : ' (= rootFolderId、固定階層なし)'}`);
  console.log(cleanup ? 'モード: cleanup' : 'モード: cleanup → 再投入(idempotent)');
  console.log('---');

  // ─── cleanup: 既存fixtureを削除(広域sweep、実行毎のsuffixに関わらず全runの残骸を対象) ──
  async function doCleanup(): Promise<void> {
    for (const docId of [
      FIXTURE_DOC_MATCH,
      FIXTURE_DOC_REASSIGNED,
      REPAIR_FIXTURE_DOC_HEALTHY,
      REPAIR_FIXTURE_DOC_TRASHED,
      REPAIR_FIXTURE_DOC_404,
    ]) {
      await db.doc(`documents/${docId}`).delete().catch(() => undefined);
    }
    await db.doc(`masters/customers/items/${FIXTURE_CUSTOMER_ID}`).delete().catch(() => undefined);
    await admin
      .storage()
      .bucket()
      .file(`original/${FIXTURE_PREFIX}-repair.txt`)
      .delete()
      .catch(() => undefined);
    let pageToken: string | undefined;
    const toDelete: string[] = [];
    do {
      const res = await drive.files.list({
        q: `'${fixtureParentId}' in parents and name contains '${escapeQueryValue(FIXTURE_NAME_SWEEP_TOKEN)}' and mimeType='${FOLDER_MIME_TYPE}'`,
        fields: 'nextPageToken, files(id)',
        includeItemsFromAllDrives: true,
        pageSize: 100,
        pageToken,
        ...SUPPORTS_ALL_DRIVES,
      });
      for (const f of res.data.files ?? []) {
        if (f.id) toDelete.push(f.id);
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    for (const id of toDelete) {
      // drive.fileスコープでは完全削除不可、trashedにするのみ(既存fixtureのcleanupなので
      // 復元不能でも実害なし)
      await drive.files
        .update({ fileId: id, requestBody: { trashed: true }, fields: 'id', ...SUPPORTS_ALL_DRIVES })
        .catch(() => undefined);
    }
    console.log(`cleanup完了: Drive fixtureフォルダ${toDelete.length}件をtrashed化、Firestore fixture doc 2件削除`);
  }

  // ─── --repair-scenario: Issue #811/#823 remediation用fixture投入 ──────────
  async function setupRepairScenario(): Promise<void> {
    const { findOrCreateFolder } = await import('../functions/src/drive/findOrCreateFolder');

    const runSuffix = crypto.randomBytes(3).toString('hex');
    const careManagerRaw = `フィクスチャ修復${runSuffix}`;
    const customerName = 'フィクスチャ利用者A';

    await db.doc(`masters/customers/items/${FIXTURE_CUSTOMER_ID}`).set({
      name: customerName,
      furigana: 'フィクスチャリヨウシャエー',
    });

    const now = admin.firestore.Timestamp.now();
    const docInput: import('../functions/src/drive/folderPath').FolderPathDocInput = {
      careManagerName: careManagerRaw,
      customerName,
      customerFurigana: 'フィクスチャリヨウシャエー',
      documentCategory: 'フィクスチャ書類',
      documentType: 'フィクスチャ書類',
      fileDate: now.toDate(),
    };
    const segments = resolveFolderSegments(docInput, template!, opts);

    let leafFolderId = fixtureParentId;
    for (const name of segments) {
      leafFolderId = await findOrCreateFolder(drive, db, leafFolderId, name);
    }
    console.log(`repair-scenario leafFolderId(正しいフォルダ): ${leafFolderId}`);

    // Storage実体を1件だけ用意し、healthy/trashedの両fixtureで共有する(classifyの
    // storageObjectExistsチェック対象。404 fixtureは意図的にStorage側の実在有無を問わない
    // -- driveFileId自体が存在しないため、その手前のDrive files.get()で判定が完結する)。
    const storagePath = `original/${FIXTURE_PREFIX}-repair.txt`;
    await admin.storage().bucket().file(storagePath).save('repair-scenario fixture file', {
      contentType: 'text/plain',
    });
    const fileUrl = `gs://${admin.storage().bucket().name}/${storagePath}`;

    const healthyFileId = await createFixtureFile(leafFolderId, 'repair-healthy.txt', REPAIR_FIXTURE_DOC_HEALTHY);

    const trashedFileId = await createFixtureFile(leafFolderId, 'repair-trashed.txt', REPAIR_FIXTURE_DOC_TRASHED);
    await drive.files.update({
      fileId: trashedFileId,
      requestBody: { trashed: true },
      fields: 'id',
      ...SUPPORTS_ALL_DRIVES,
    });

    const baseDoc = {
      careManager: careManagerRaw,
      customerName,
      customerId: FIXTURE_CUSTOMER_ID,
      category: 'フィクスチャ書類',
      documentType: 'フィクスチャ書類',
      fileDate: now,
      status: 'processed',
      verified: true,
      driveExportStatus: 'exported',
      driveExportedAt: now,
      fileUrl,
      mimeType: 'text/plain',
      fileName: 'repair-fixture.txt',
      displayFileName: 'repair-fixture.txt',
    };
    await db.doc(`documents/${REPAIR_FIXTURE_DOC_HEALTHY}`).set({ ...baseDoc, driveFileId: healthyFileId });
    await db.doc(`documents/${REPAIR_FIXTURE_DOC_TRASHED}`).set({ ...baseDoc, driveFileId: trashedFileId });
    await db
      .doc(`documents/${REPAIR_FIXTURE_DOC_404}`)
      .set({ ...baseDoc, driveFileId: REPAIR_FIXTURE_FAKE_404_FILE_ID });

    console.log('\nrepair-scenario投入完了:');
    console.log(`  careManager: "${careManagerRaw}"`);
    console.log(`  ${REPAIR_FIXTURE_DOC_HEALTHY}: healthy期待(driveFileId=${healthyFileId})`);
    console.log(`  ${REPAIR_FIXTURE_DOC_TRASHED}: trashed期待(driveFileId=${trashedFileId})`);
    console.log(`  ${REPAIR_FIXTURE_DOC_404}: missing-404期待(driveFileId=${REPAIR_FIXTURE_FAKE_404_FILE_ID})`);
    console.log(
      `\n検証コマンド: FIREBASE_PROJECT_ID=${projectId} npx ts-node scripts/classify-drive-export-drift.ts --care-manager "${careManagerRaw}" --out /tmp/repair-scenario-plan.json`
    );
  }

  await doCleanup();
  if (cleanup) {
    await admin.app().delete();
    return;
  }

  if (repairScenario) {
    await setupRepairScenario();
    await admin.app().delete();
    return;
  }

  // ─── careManager raw値(実行毎に一意)を決め、実テンプレートでcanonicalフォルダ名を導出 ──
  const runSuffix = crypto.randomBytes(3).toString('hex');
  const careManagerRawMatch = `フィクスチャ太郎${runSuffix}`;
  const careManagerRawReassigned = `フィクスチャ次郎${runSuffix}`;

  const canonicalCmDocInput: FolderPathDocInput = {
    careManagerName: careManagerRawMatch,
    customerName: '',
    documentCategory: '<n/a>',
    documentType: '<n/a>',
    fileDate: null,
  };
  const cmSegments = resolveFolderSegments(canonicalCmDocInput, cmTemplatePrefix, opts);
  const canonicalName = cmSegments[cmSegments.length - 1];
  if (!canonicalName) {
    console.error('❌ careManagerセグメントの解決に失敗しました。');
    process.exit(1);
  }
  console.log(`careManager raw値(match): "${careManagerRawMatch}" → 解決フォルダ名: "${canonicalName}"`);

  // ─── masters/customers/items fixture(furigana解決用) ──────────────
  // dev実機検証(2026-08-27)で判明: customerセグメントがfurigana必須format
  // (furiganaFallback='stop'がデフォルト)の場合、customerFuriganaが解決できないと
  // resolveFolderSegments()がFuriganaMissingErrorをthrowし、classify側は安全側で
  // destinationConflict=trueへ倒す(=常にmanual-review)。従来customerId:nullで
  // furigana未提供だったため、move-to-canonical期待のfixture-match.txtが
  // 意図通りに分類されず、devリハーサルで発覚した。
  await db.doc(`masters/customers/items/${FIXTURE_CUSTOMER_ID}`).set({
    name: 'フィクスチャ利用者A',
    furigana: 'フィクスチャリヨウシャエー',
  });

  // ─── Firestore fixture documents ───────────────────────
  const now = admin.firestore.Timestamp.now();
  await db.doc(`documents/${FIXTURE_DOC_MATCH}`).set({
    careManager: careManagerRawMatch,
    customerName: 'フィクスチャ利用者A',
    customerId: FIXTURE_CUSTOMER_ID,
    category: 'フィクスチャ書類',
    documentType: 'フィクスチャ書類',
    fileDate: now,
    status: 'processed',
  });
  await db.doc(`documents/${FIXTURE_DOC_REASSIGNED}`).set({
    careManager: careManagerRawReassigned, // canonicalのケアマネと意図的に不一致(担当替えシナリオ)
    customerName: 'フィクスチャ利用者B',
    customerId: null,
    category: 'フィクスチャ書類',
    documentType: 'フィクスチャ書類',
    fileDate: now,
    status: 'processed',
  });

  // ─── canonicalフォルダ + duplicateフォルダ2件を作成 ────────────
  async function createFolder(name: string, parentId: string, trashed: boolean): Promise<string> {
    const res = await drive.files.create({
      requestBody: { name, mimeType: FOLDER_MIME_TYPE, parents: [parentId] },
      fields: 'id',
      ...SUPPORTS_ALL_DRIVES,
    });
    const id = res.data.id;
    if (!id) throw new Error(`fixtureフォルダ作成に失敗: ${name}`);
    if (trashed) {
      await drive.files.update({ fileId: id, requestBody: { trashed: true }, fields: 'id', ...SUPPORTS_ALL_DRIVES });
    }
    return id;
  }

  async function createFixtureFile(
    parentId: string,
    name: string,
    docSplitDocId: string
  ): Promise<string> {
    const res = await drive.files.create({
      requestBody: {
        name,
        parents: [parentId],
        appProperties: { docSplitDocId },
      },
      media: { mimeType: 'text/plain', body: 'phase-b fixture file' },
      fields: 'id',
      ...SUPPORTS_ALL_DRIVES,
    });
    const id = res.data.id;
    if (!id) throw new Error(`fixtureファイル作成に失敗: ${name}`);
    return id;
  }

  const canonicalId = await createFolder(canonicalName, fixtureParentId, false);

  const duplicateAId = await createFolder(canonicalName, fixtureParentId, true);
  const dupASubfolder = await createFolder('フィクスチャ利用者A', duplicateAId, true);
  const dupACategory = await createFolder('フィクスチャ書類', dupASubfolder, true);
  await createFixtureFile(dupACategory, 'fixture-match.txt', FIXTURE_DOC_MATCH);

  const duplicateBId = await createFolder(canonicalName, fixtureParentId, true);
  const dupBSubfolder = await createFolder('フィクスチャ利用者B', duplicateBId, true);
  const dupBCategory = await createFolder('フィクスチャ書類', dupBSubfolder, true);
  await createFixtureFile(dupBCategory, 'fixture-reassigned.txt', FIXTURE_DOC_REASSIGNED);

  console.log('\n投入完了:');
  console.log(`  canonicalFolderId: ${canonicalId}`);
  console.log(`  duplicateFolderIds: ${duplicateAId},${duplicateBId}`);
  console.log('\nこれらのIDを classify-drive-folder-duplicates.ts --canonical-id / --duplicate-ids に渡してください。');
  console.log('期待される分類: fixture-match.txt → move-to-canonical / fixture-reassigned.txt → manual-review');

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
