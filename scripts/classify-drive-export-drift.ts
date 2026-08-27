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
 * 使用方法(STORAGE_BUCKETは`scripts/clients/<env>.env`のSTORAGE_BUCKET値を必ず指定すること。
 * 未設定のまま`--skip-storage-check`も指定せずに実行すると、Firebase Admin SDKの
 * `admin.storage().bucket()`が`storage/invalid-argument`をthrowして即座に失敗する
 * (`node_modules/firebase-admin/lib/storage/storage.js`で実装を確認済み。暗黙に
 * `<projectId>.appspot.com`等へフォールバックすることはない)。fail-fastではあるが
 * 読みにくいSDKのエラーで落ちる前に、分かりやすいメッセージで早期に案内する):
 *   FIREBASE_PROJECT_ID=docsplit-kanameone STORAGE_BUCKET=docsplit-kanameone.firebasestorage.app \
 *     npx ts-node scripts/classify-drive-export-drift.ts --out /tmp/plan.json
 *   FIREBASE_PROJECT_ID=docsplit-kanameone STORAGE_BUCKET=docsplit-kanameone.firebasestorage.app \
 *     npx ts-node scripts/classify-drive-export-drift.ts --care-manager "森 奈穂美" --out /tmp/plan.json
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
  type BlockedReason,
  type DriftClassification,
  type DriveFileGetResult,
} from './lib/driveExportDriftClassifier';

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID 環境変数を設定してください');
  process.exit(1);
}

const args = process.argv.slice(2);
let careManager: string | undefined;
let limit: number | undefined;
let skipStorageCheck = false;
let sleepMs = 0;
let outPath: string | undefined;
// codex review P2指摘: `args[i] === '--xxx' && args[i+1]`という判定は、値を要求するフラグが
// 末尾に置かれ値を伴わない場合(例: `--limit`が最後の引数)、条件全体がfalseになり
// 「フラグ自体が指定されなかった」のと無言で同じ扱いになってしまう(`--limit`のつもりが
// 無制限スキャンに、`--care-manager`のつもりが絞り込みなし全件対象になる)。値必須フラグは
// 名前が一致した時点で判定を分離し、値が無ければ即エラー終了する。
function requireValue(flag: string, index: number): string {
  const value = args[index + 1];
  if (value === undefined) {
    console.error(`${flag} には値を指定してください(値が省略されています)`);
    process.exit(1);
  }
  return value;
}
function requireNonNegativeIntValue(flag: string, index: number): number {
  const raw = requireValue(flag, index);
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    console.error(`${flag} には非負整数を指定してください(受け取った値: "${raw}")`);
    process.exit(1);
  }
  return parsed;
}
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--care-manager') {
    careManager = requireValue('--care-manager', i);
    i++;
  } else if (args[i] === '--limit') {
    limit = requireNonNegativeIntValue('--limit', i);
    i++;
  } else if (args[i] === '--skip-storage-check') {
    skipStorageCheck = true;
  } else if (args[i] === '--sleep-ms') {
    sleepMs = requireNonNegativeIntValue('--sleep-ms', i);
    i++;
  } else if (args[i] === '--out') {
    outPath = requireValue('--out', i);
    i++;
  } else {
    // codex review(14回目)指摘: 未知のフラグを無言で無視すると、例えば`--care-manger`
    // (タイポ)のように意図した絞り込みフラグが静かに無効化され、絞り込みなしで
    // テナント全体をスキャンしてしまう(#823調査対象の森奈穂美1人分のつもりが、
    // 11,000件超の全ケアマネ分に無自覚に広がる)。未知の引数はfail-closedで即エラー
    // 終了する。
    console.error(`未知の引数です: "${args[i]}"(タイポの可能性があります。ヘッダーコメントの使用方法を参照してください)`);
    process.exit(1);
  }
}
if (!outPath) {
  console.error('--out <path> を指定してください(plan JSONの出力先)');
  process.exit(1);
}

// codex review P1指摘(セカンドオピニオンI7で「暗黙フォールバック」という当初の理解自体が
// 不正確と判明・訂正): STORAGE_BUCKET未設定のまま`admin.storage().bucket()`を呼ぶと、
// Firebase Admin SDKは`<projectId>.appspot.com`等へ暗黙フォールバックするのではなく
// `storage/invalid-argument`をthrowする(node_modules/firebase-admin/lib/storage/storage.js
// で実装を直接確認済み)。挙動自体はfail-closed(暗黙の誤判定は起きない)だが、
// SDKの生の例外は原因(STORAGE_BUCKET未設定)が分かりにくいため、ここで先回りして
// 分かりやすいメッセージを出す。GitHub Actions経由(run-ops-script.yml)は既に
// STORAGE_BUCKETを渡しているため影響しない。--skip-storage-check時はStorageに
// 一切触れないため不要。
const storageBucket = process.env.STORAGE_BUCKET;
if (!storageBucket && !skipStorageCheck) {
  console.error(
    'STORAGE_BUCKET 環境変数を設定してください(scripts/clients/<env>.env のSTORAGE_BUCKET参照。' +
      '未設定のまま実行するとFirebase Admin SDKの`admin.storage().bucket()`が' +
      '`storage/invalid-argument`エラーで失敗します。' +
      'Storageを使わない場合は代わりに--skip-storage-checkを指定してください)'
  );
  process.exit(1);
}

admin.initializeApp({ projectId, storageBucket });
const db = admin.firestore();

const MASTER_PATHS_CUSTOMERS = 'masters/customers/items';
const PAGE_SIZE = 500;

// セカンドオピニオンI3指摘: missing-404/trashedのtargetはexpectedLeafFolderIdが空文字列
// (=期待パスが未解決)になりうるが、その原因が「対象フォルダがまだ作成されていないだけ」
// (would-create、修復実行時にフォルダ作成から始めればよい)なのか、「フォルダ名重複で
// 機械的に一意解決できない」(ambiguous-path、人間の手動整理が必要)なのか、「Drive API
// 呼び出し自体が失敗した」(api-error、再試行が必要)なのかを、これまでのtargetsは区別
// できていなかった。将来の執行フェーズ(execute-drive-export-repair.ts)が「新規フォルダ
// 作成して良いか/絶対に触るべきでないか」を判断するために必須の情報のため、targetにも
// (blockedと同様に)明示する。
type ExpectedPathStatus = 'resolved' | 'not-created' | 'unresolved-ambiguous' | 'unresolved-api-error';

interface TargetEntry {
  docId: string;
  careManager: string;
  customerName: string;
  category: 'missing-404' | 'trashed' | 'healthy' | 'misplaced';
  oldDriveFileId: string;
  oldParents: string[] | undefined;
  oldFileTrashed: boolean | undefined;
  expectedLeafFolderId: string;
  expectedPathStatus: ExpectedPathStatus;
  expectedPathUnresolvedDetail?: string;
  storageObjectExists: boolean | null;
}

interface BlockedEntry {
  docId: string;
  careManager: string;
  reason: BlockedReason;
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
  const { resolveExistingChildFile, AmbiguousChildFolderError } = await import(
    '../functions/src/drive/childFolderResolver'
  );
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
  // pr-review-toolkit(code-reviewer)セカンドオピニオンC1指摘: `--skip-storage-check`指定時は
  // STORAGE_BUCKET未設定を許容する設計(上記ガード参照)なので、admin.storage().bucket()を
  // 無条件で呼ぶとFirebase Admin SDKが`storage/invalid-argument`をthrowしてクラッシュする
  // (`--skip-storage-check`という回避策自体が機能しなくなる)。Storageを実際に使う場合のみ
  // 遅延評価する。
  const bucket = skipStorageCheck ? null : admin.storage().bucket();

  // documentId, careManager でのpagination(等価フィルタ2個はzigzag merge joinで解決され複合index不要、
  // investigate-caremanager-folder-duplicate.tsで実証済みの手法)
  let query = db.collection('documents').where('driveExportStatus', '==', 'exported') as admin.firestore.Query;
  if (careManager) {
    query = query.where('careManager', '==', careManager);
  }
  query = query.orderBy(admin.firestore.FieldPath.documentId()).limit(PAGE_SIZE);

  const docs: { id: string; data: Document }[] = [];
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  let hasMore = limit === undefined || limit > 0; // codex review P2指摘: --limit 0はページ取得自体を行わない
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
      // codex review P2指摘: 追加"前"にlimit到達を確認する(追加してから確認すると
      // --limit 0でも1件処理してしまい、canaryのゼロ件確認が成立しない)。
      if (limit !== undefined && docs.length >= limit) {
        hasMore = false;
        break;
      }
      docs.push({ id: d.id, data: d.data() as Document });
    }
    if (hasMore) {
      lastDoc = snapshot.docs[snapshot.docs.length - 1];
      if (snapshot.size < PAGE_SIZE) hasMore = false;
      if (limit !== undefined && docs.length >= limit) hasMore = false;
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
    | { status: 'blocked'; reason: 'ambiguous-path' | 'api-error'; detail: string };
  const folderCache = new Map<string, SegmentResolution>();
  const restoreFolderAggregate = new Map<
    string,
    { folderId: string; name: string; parentId: string; affectedDocIds: Set<string> }
  >();

  async function resolveExpectedLeaf(
    docId: string,
    segments: string[]
  ): Promise<{
    leafFolderId: string;
    ambiguousAt?: { name: string; parentId: string; detail: string; reason: 'ambiguous-path' | 'api-error' };
  }> {
    let parentId = rootFolderId!;
    for (const name of segments) {
      const key = `${parentId}::${name}`;
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
          // codex review P2指摘: resolveExistingChildFile()はフォルダ名重複時の
          // AmbiguousChildFolderErrorだけでなく、Drive権限エラー・レート制限・一時的な
          // API障害でも例外を投げうる。前者のみ「重複フォルダの手動整理が必要」を
          // 意味するambiguous-pathとし、後者はapi-error(classifyDriftEvidenceの
          // driveFileId自体のfiles.get失敗時と同じ扱い)として区別する。
          const reason: 'ambiguous-path' | 'api-error' =
            err instanceof AmbiguousChildFolderError ? 'ambiguous-path' : 'api-error';
          resolution = { status: 'blocked', reason, detail: (err as Error).message };
        }
        // セカンドオピニオンC2指摘: `api-error`(権限エラー/レート制限/一時的なAPI障害)は
        // フォルダツリーの安定した性質ではなく一時的な失敗であり、キャッシュしてしまうと
        // 同じセグメントを共有する後続の全document(例: 同じケアマネ配下の数百件)が
        // 再試行の機会すら与えられずblockedになる(1回の一時的な429/503がスキャン全体を
        // 汚染する)。`ambiguous-path`(フォルダ名重複)はDrive上の実在の重複という
        // 安定した事実なのでキャッシュしてよいが、`api-error`はキャッシュしない
        // (次にこのキーが必要なdocumentで再度Drive APIを呼び直す)。
        if (!(resolution.status === 'blocked' && resolution.reason === 'api-error')) {
          folderCache.set(key, resolution);
        }
      }

      if (resolution.status === 'blocked') {
        return {
          leafFolderId: '',
          ambiguousAt: { name, parentId, detail: resolution.detail, reason: resolution.reason },
        };
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

    // codex review P2指摘: --sleep-msによるDrive APIレート制限緩和が、blocked分類による
    // 早期continueではバイパスされてしまう(特にfiles.get()が429/5xxで失敗しapi-errorに
    // 分類されるケースでは、スロットルが効かないまま即座に次のAPI呼び出しへ進み、
    // レート制限状態を悪化させうる)。try/finallyでcontinueの有無に関わらず必ず
    // sleepを実行する。
    try {
      // セカンドオピニオンI5指摘: 以前は`reason: string`+`reason as never`キャストで
      // 呼び出し元の型チェックが実質無効化されていた(存在しないreason文字列を渡しても
      // コンパイルエラーにならない)。`BlockedReason`で型付けし、`ALL_BLOCKED_REASONS`と
      // 実際に使われる値の集合を一致させる。
      const recordBlocked = (reason: BlockedReason, detail?: string): void => {
        blocked.push({ docId, careManager: cm, reason, detail });
        classificationRows.push({ careManager: cm, classification: { kind: 'blocked', reason, detail } });
      };

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

      // 4. 期待leafフォルダ解決(read-only、作成・復元は一切行わない)。この時点ではまだ
      //    blockedにせず`ambiguousAt`として保持するだけに留める(次のコメント参照)。
      const { leafFolderId, ambiguousAt } = await resolveExpectedLeaf(docId, segments);

      // 5. driveFileId自体の物理状態確認。codex review P2指摘対応: 期待パスの解決に失敗した
      //    (ambiguousAt)場合でも、ここで`continue`してfiles.get()自体をスキップしてはならない。
      //    driveFileIdがDrive上で404/trashedかどうかは期待パスの状態と無関係に確定できる事実で、
      //    本ツールが検出すべき本来のdriftそのものだからである。Storage確認より必ず先に行う
      //    (codex review P1指摘対応: Storage側の実体が無いケースを先にblockedとして弾くと、
      //    まさに検出したいdriftがその手前で握り潰されplanに一切現れなくなる)。
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

      if (classification.kind === 'blocked') {
        // 分類自体はfiles.get()の結果(missing-404/trashed等)を優先して確定済み。ここに来るのは
        // driveFileIdが生きていて(404でもtrashedでもない)、かつ期待パスとの比較が必要だったが
        // できなかったケースのみ。ambiguousAtがあれば(期待パス自体が曖昧/API障害で未解決)、
        // classifyDriftEvidenceが返す汎用的な'target-path-not-created'より具体的な原因
        // (ambiguous-path/api-error)で報告する。集計(classificationRows)と一覧(blocked)が
        // 食い違わないよう、最終的なreason/detailを1箇所で確定させてから両方へ反映する。
        // セカンドオピニオンI4指摘: 以前はfinalDetailが`ambiguousAt`の有無だけで判定しており、
        // finalReasonの置換条件(classification.reason === 'target-path-not-created')と
        // 揃っていなかった。そのため、files.get()自体がapi-errorで失敗した場合
        // (finalReasonは正しく'api-error'のまま据え置かれる)でも、たまたまambiguousAtが
        // 設定されていると本来無関係なフォルダパス解決の詳細でdetailが上書きされ、
        // 本物のDrive APIエラーメッセージが失われていた。finalReasonと同一条件でgateする。
        const substituteWithAmbiguousAt = classification.reason === 'target-path-not-created' && !!ambiguousAt;
        const finalReason: typeof classification.reason = substituteWithAmbiguousAt
          ? ambiguousAt!.reason
          : classification.reason;
        const finalDetail = substituteWithAmbiguousAt
          ? `segment="${ambiguousAt!.name}" parentId=${ambiguousAt!.parentId}: ${ambiguousAt!.detail}`
          : classification.detail;
        classificationRows.push({ careManager: cm, classification: { kind: 'blocked', reason: finalReason, detail: finalDetail } });
        blocked.push({ docId, careManager: cm, reason: finalReason, detail: finalDetail });
        continue;
      }
      classificationRows.push({ careManager: cm, classification });

      // セカンドオピニオンI3指摘対応: missing-404/trashedはleafFolderId(expectedLeafFolderId)が
      // 空文字列(未解決)になりうる。healthy/misplacedは判定ロジック上必ず非空(空文字列の場合は
      // 上のblocked分岐でtarget-path-not-createdとして先に確定するため、ここには到達しない)。
      const expectedPathStatus: ExpectedPathStatus = leafFolderId
        ? 'resolved'
        : ambiguousAt
          ? ambiguousAt.reason === 'ambiguous-path'
            ? 'unresolved-ambiguous'
            : 'unresolved-api-error'
          : 'not-created';
      const expectedPathUnresolvedDetail = ambiguousAt
        ? `segment="${ambiguousAt.name}" parentId=${ambiguousAt.parentId}: ${ambiguousAt.detail}`
        : undefined;

      // 6. Storage実体確認(既定は実施。healthyは修復不要なため確認コストを払わない)。
      //    codex review P1指摘対応: 分類が確定した"後"に付随情報として記録するだけで、
      //    blockedへ迂回させて分類結果を握り潰さない(execute側はstorageObjectExists===falseの
      //    targetを別途スキップ判断すればよい)。
      let storageObjectExists: boolean | null = null;
      if (!skipStorageCheck && classification.category !== 'healthy' && bucket) {
        // セカンドオピニオンI6指摘: doc.fileUrlが設定中バケットと異なる形式
        // (`.appspot.com`/`.firebasestorage.app`混在、CLAUDE.md「Storageバケット名」注意点)を
        // 指していた場合、単純な文字列replaceは無言でno-opになり、存在しないパスへの
        // exists()呼び出しがfalseを返す(「実体が無い」という誤った断定)。プレフィックスが
        // 一致しない場合はnull(不明)として区別し、falseで断定しない。
        const expectedPrefix = `gs://${bucket.name}/`;
        if (!doc.fileUrl.startsWith(expectedPrefix)) {
          console.log(
            `  ⚠️  docId=${docId}: fileUrl(${doc.fileUrl})が設定中のバケット(${bucket.name})と異なる形式のため確認不能`
          );
          storageObjectExists = null;
        } else {
          try {
            const filePath = doc.fileUrl.slice(expectedPrefix.length);
            const [exists] = await bucket.file(filePath).exists();
            storageObjectExists = exists;
          } catch (err) {
            console.log(`  ⚠️  docId=${docId}: Storage実体確認に失敗(target化は継続): ${(err as Error).message}`);
            storageObjectExists = null;
          }
        }
      }

      targets.push({
        docId,
        careManager: cm,
        customerName: doc.customerName,
        category: classification.category,
        oldDriveFileId: doc.driveFileId,
        oldParents: fileGet.kind === 'ok' ? fileGet.parents : undefined,
        oldFileTrashed: fileGet.kind === 'ok' ? fileGet.trashed : undefined,
        expectedLeafFolderId: leafFolderId,
        expectedPathStatus,
        expectedPathUnresolvedDetail,
        storageObjectExists,
      });

      if ((i + 1) % 25 === 0) {
        console.log(`  進捗: ${i + 1}/${docs.length}件処理済み`);
      }
    } catch (err) {
      // セカンドオピニオンI1指摘: catchが無いと、customerCache/categoryCache解決や
      // isCustomerUnconfirmed()等が投げた予期しない例外がmain().catch()まで伝播し、
      // スキャン全体が中断してplan JSON(writeFileSync)が一切書き出されない
      // (例: 11,000件中9,000件処理した後に1件失敗しただけで、それまでのDrive API
      // 呼び出しの成果が全て失われる)。1件の異常はそのdocumentをblockedとして
      // 記録し、スキャンは継続する。
      console.log(`  ⚠️  docId=${docId}: 想定外のエラー(このdocumentのみblocked扱いとしスキャンは継続): ${(err as Error).message}`);
      blocked.push({ docId, careManager: cm, reason: 'api-error', detail: (err as Error).message });
      classificationRows.push({
        careManager: cm,
        classification: { kind: 'blocked', reason: 'api-error', detail: (err as Error).message },
      });
    } finally {
      await sleep(sleepMs);
    }
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
