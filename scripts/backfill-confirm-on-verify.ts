#!/usr/bin/env ts-node
/**
 * 「確認済み」統合の既存データbackfillスクリプト(Issue #1034)
 *
 * 「確認済み」にする操作(単体トグル・一括確認済み)は、shared/confirmOnVerify.tsの
 * ルール(同姓同名等の危険なケースを除き顧客/事業所も同時に確定する)で今後書き込まれる。
 * 本スクリプトは、既に`verified:true`になっている既存本番データへ同じルールを遡及適用する。
 *
 * 安全設計は`scripts/backfill-drive-export.ts`(ADR-0022 Phase D/E、kanameone/cocoro本番展開
 * 実績あり)をそのまま踏襲する(codexレビュー指摘: 同種のbackfillが既に安全に実装済みと判明、
 * 車輪の再発明をしない):
 * - `--limit`/`--expected-count`/`--manifest-out`/`--rollback`によるcanary安全策
 * - `writeBatch`ではなく個別`ref.update(data, {lastUpdateTime})`(1件の並行更新衝突で
 *   無関係な他の文書まで巻き込まない。writeBatchは1件でもprecondition不一致だとバッチ
 *   全体が失敗するため不採用)
 *
 * `confirmedBy`/`officeConfirmedBy`は書かない(shared/confirmOnVerify.tsのactor:null経路、
 * `functions/src/ocr/confirmedFieldMerge.ts`の既存契約「確定者UIDは人間確定時のみ設定」を
 * 破らないため)。`editLogs`も書かない(人間操作の監査ログ契約の外に置く)。追跡・ロールバックは
 * `--manifest-out`で出力するJSONが一次情報になる。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=doc-split-dev npx ts-node scripts/backfill-confirm-on-verify.ts --dry-run
 *   FIREBASE_PROJECT_ID=doc-split-dev npx ts-node scripts/backfill-confirm-on-verify.ts \
 *     --limit 5 --expected-count 5 --manifest-out /tmp/canary-manifest.json
 *   FIREBASE_PROJECT_ID=doc-split-dev npx ts-node scripts/backfill-confirm-on-verify.ts \
 *     --rollback /tmp/canary-manifest.json --dry-run
 *
 * オプション:
 *   --dry-run             書込みを行わず対象件数・理由別内訳・Drive状態別内訳をプレビュー
 *   --limit N              対象を先頭からN件に制限(canary実行用)
 *   --expected-count N     対象件数がNと一致することを書込み前にアサート(誤操作防止)
 *   --manifest-out <path>  確定した内容をJSONで出力(runId/projectId/timestamp/entries付き)
 *   --rollback <manifest>  manifestに記載のdocIdのうち、backfill後に人間の確定操作が
 *                          入っていないものだけをbackfill実行前の値へ戻す(選択的rollback)
 */

import * as admin from 'firebase-admin';
import { randomUUID } from 'node:crypto';
import { writeFileSync, readFileSync } from 'node:fs';
import { MASTER_PATHS } from '../functions/src/utils/masterPaths';
import { findSameNameCollisionNames } from '../shared/customerIdentity';
import { planConfirmOnVerify, buildConfirmOnVerifyUpdate, type ConfirmOnVerifyDecisions } from '../shared/confirmOnVerify';
import { applyLimit, assertExpectedCount, ExpectedCountMismatchError } from './lib/driveExportBackfillHelpers';
import {
  isConfirmOnVerifyCandidate,
  isValidConfirmedFieldValue,
  tallyConfirmOnVerifyDecisions,
  tallyDriveExportStatus,
  buildConfirmOnVerifyManifest,
  isRollbackEligibleByUpdateTime,
  computeRollbackInstructions,
  isValidManifest,
  type ConfirmOnVerifyManifestEntry,
  type ConfirmOnVerifyBackfillManifest,
} from './lib/confirmOnVerifyBackfillHelpers';

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID 環境変数を設定してください');
  process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');

/** scripts/backfill-drive-export.tsと同じ規約: 値省略/別フラグとの衝突を誤操作として弾く。 */
function getArg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i < 0) return undefined;
  const value = process.argv[i + 1];
  if (value === undefined || value.startsWith('--')) {
    console.error(`${name} には値を指定してください(値が省略されているか、別のフラグと衝突しています)`);
    process.exit(1);
  }
  return value;
}

function getIntArg(name: string): number | undefined {
  const raw = getArg(name);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    console.error(`${name} には0以上の整数を指定してください(受け取った値: "${raw}")`);
    process.exit(1);
  }
  return n;
}

const limit = getIntArg('--limit');
const expectedCount = getIntArg('--expected-count');
const manifestOutPath = getArg('--manifest-out');
const rollbackManifestPath = getArg('--rollback');

admin.initializeApp({ projectId });
const db = admin.firestore();

const PAGE_SIZE = 200;

interface Candidate {
  ref: FirebaseFirestore.DocumentReference;
  id: string;
  fileName: string;
  updateTime: FirebaseFirestore.Timestamp;
  data: FirebaseFirestore.DocumentData;
  decisions: ConfirmOnVerifyDecisions;
}

/** collectCandidates()が除外した「型契約違反」文書(pr-review-toolkit指摘、書込み前に弾く)。 */
interface FieldTypeAnomaly {
  id: string;
  fileName: string;
  field: 'customerConfirmed' | 'officeConfirmed';
}

/**
 * `verified==true`をページングし、`planConfirmOnVerify`で実際にconfirm対象になるdocだけを
 * 候補として集める。`--limit`指定時は候補がその件数に達した時点でページングを打ち切る
 * (backfill-drive-export.tsのcollectCandidates()と同じ、canary実行のFirestore読取コスト削減)。
 */
async function collectCandidates(
  customerMasterNameById: ReadonlyMap<string, string | null>,
  sameNameCollisionNames: ReadonlySet<string>,
  stopAt: number | undefined
): Promise<{
  totalScanned: number;
  candidates: Candidate[];
  scanIncomplete: boolean;
  fieldTypeAnomalies: FieldTypeAnomaly[];
}> {
  let totalScanned = 0;
  const candidates: Candidate[] = [];
  const fieldTypeAnomalies: FieldTypeAnomaly[] = [];
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  let hasMore = true;

  while (hasMore) {
    let query = db
      .collection('documents')
      .where('verified', '==', true)
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(PAGE_SIZE);
    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();
    if (snapshot.empty) {
      hasMore = false;
      break;
    }

    for (const docSnap of snapshot.docs) {
      totalScanned++;
      const data = docSnap.data();
      if (!isConfirmOnVerifyCandidate(data)) continue;

      const customerId = typeof data.customerId === 'string' ? data.customerId : null;
      const decisions = planConfirmOnVerify(data, {
        customerMasterName: customerId ? (customerMasterNameById.get(customerId) ?? null) : null,
        sameNameCollisionNames,
      });
      if (decisions.customer.action !== 'confirm' && decisions.office.action !== 'confirm') continue;

      // pr-review-toolkit指摘: customerConfirmed/officeConfirmedは契約上boolean|フィールド不在
      // だが、実データの充足率は未確認。契約違反(null・文字列等)のままmanifestへ書き込むと、
      // --rollback実行時にisValidManifestEntryがその1件を理由にmanifest全体を無効判定し、
      // 正常な残り全件のロールバックまで巻き込む。書込み前(ここ)で弾き、対象外として集計する。
      const fileName = (data.fileName as string) || '(no name)';
      if (decisions.customer.action === 'confirm' && !isValidConfirmedFieldValue(data.customerConfirmed)) {
        fieldTypeAnomalies.push({ id: docSnap.id, fileName, field: 'customerConfirmed' });
        continue;
      }
      if (decisions.office.action === 'confirm' && !isValidConfirmedFieldValue(data.officeConfirmed)) {
        fieldTypeAnomalies.push({ id: docSnap.id, fileName, field: 'officeConfirmed' });
        continue;
      }

      candidates.push({
        ref: docSnap.ref,
        id: docSnap.id,
        fileName,
        updateTime: docSnap.updateTime,
        data,
        decisions,
      });
      if (stopAt !== undefined && candidates.length >= stopAt) {
        return { totalScanned, candidates, scanIncomplete: true, fieldTypeAnomalies };
      }
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];
    hasMore = snapshot.docs.length === PAGE_SIZE;
  }

  return { totalScanned, candidates, scanIncomplete: false, fieldTypeAnomalies };
}

/**
 * 個別`update()` + `lastUpdateTime`precondition でrace-freeに書込む
 * (backfill-drive-export.tsのmarkAsBackfillTarget()と同じ設計)。
 */
async function applyConfirmOnVerify(
  candidate: Candidate
): Promise<{ status: 'ok'; entry: ConfirmOnVerifyManifestEntry } | { status: 'precondition-failed' }> {
  const { update } = buildConfirmOnVerifyUpdate(candidate.decisions, candidate.data, { uid: null });
  try {
    const writeResult = await candidate.ref.update(update, { lastUpdateTime: candidate.updateTime });
    return {
      status: 'ok',
      entry: {
        docId: candidate.id,
        customer:
          candidate.decisions.customer.action === 'confirm'
            ? {
                confirmedCustomer: true,
                customerConfirmedBefore: candidate.data.customerConfirmed as boolean | undefined,
                // codexレビュー指摘: buildConfirmOnVerifyUpdate()は顧客確定と同時に
                // needsManualCustomerSelection(true→false)も書き戻すことがある。updateに
                // 実際に含まれているかで判定する(実行前は常にtrueだった場合のみ含まれるため、
                // rollback時はtrueへ戻せば足りる)。
                resetNeedsManualCustomerSelection: 'needsManualCustomerSelection' in update,
              }
            : { confirmedCustomer: false },
        office:
          candidate.decisions.office.action === 'confirm'
            ? { confirmedOffice: true, officeConfirmedBefore: candidate.data.officeConfirmed as boolean | undefined }
            : { confirmedOffice: false },
        // codexレビュー指摘(4回目・P2): rollback可否をconfirmedBy等のactorベースで判定すると、
        // OCR再処理による自動確定(confirmedByはnullのまま新しい値で上書き)を検知できない。
        // backfillが実際に書き込んだ直後のupdateTimeを記録し、rollback時にライブの
        // updateTimeと完全一致するかで「backfill以降一切触れられていないか」を判定する。
        backfillUpdateTime: { seconds: writeResult.writeTime.seconds, nanoseconds: writeResult.writeTime.nanoseconds },
      },
    };
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 9) {
      console.log(`  スキップ(並行書込み検出、precondition不一致): ${candidate.id}`);
      return { status: 'precondition-failed' };
    }
    throw err;
  }
}

async function runBackfill(): Promise<void> {
  console.log(`プロジェクト: ${projectId}`);
  console.log(`モード: ${dryRun ? 'DRY RUN(変更なし)' : '実行'}`);
  if (limit !== undefined) console.log(`--limit: ${limit}`);
  if (expectedCount !== undefined) console.log(`--expected-count: ${expectedCount}`);
  console.log('---');

  // 顧客マスター全件・同姓同名集合を実行開始時に1回だけ読み込む(customerAmbiguityGate.tsの
  // ライブクエリとは異なり、backfillは実行時間が長くなりうるため一度きりのスナップショットで
  // 判定する。実行中にマスターが変更されるとズレうる点は運用上の注意事項として計画に明記済み)。
  const customersSnapshot = await db.collection(MASTER_PATHS.customers).get();
  const customerMasterNameById = new Map<string, string | null>(
    customersSnapshot.docs.map((d) => [d.id, typeof d.data().name === 'string' ? (d.data().name as string) : null])
  );
  const sameNameCollisionNames = findSameNameCollisionNames(
    customersSnapshot.docs.map((d) => ({ name: typeof d.data().name === 'string' ? (d.data().name as string) : '' }))
  );
  console.log(`顧客マスター: ${customersSnapshot.size}件読込(同姓同名: ${sameNameCollisionNames.size}組)`);

  const { totalScanned, candidates, scanIncomplete, fieldTypeAnomalies } = await collectCandidates(
    customerMasterNameById,
    sameNameCollisionNames,
    limit
  );
  const targets = applyLimit(candidates, limit);

  const tally = tallyConfirmOnVerifyDecisions(targets.map((c) => c.decisions));
  const driveStatusTally = tallyDriveExportStatus(targets.map((c) => c.data.driveExportStatus as string | undefined));

  if (scanIncomplete) {
    console.log(`検査: ${totalScanned}件走査時点で--limit(${limit})件に到達したためスキャンを打ち切り`);
  } else {
    console.log(`検査: ${totalScanned}件 (verified=true)`);
  }
  if (fieldTypeAnomalies.length > 0) {
    console.log(
      `\n⚠ 想定外の型: ${fieldTypeAnomalies.length}件` +
        '(customerConfirmed/officeConfirmedがboolean・フィールド不在以外の値。backfill対象から除外・要調査)'
    );
    for (const a of fieldTypeAnomalies.slice(0, 20)) {
      console.log(`  ${a.id} [${a.fileName}] field=${a.field}`);
    }
    if (fieldTypeAnomalies.length > 20) {
      console.log(`  ...他${fieldTypeAnomalies.length - 20}件`);
    }
  }
  console.log(`対象: ${targets.length}件`);
  console.log(`  両方確定: ${tally.confirmBoth}件 / 顧客のみ: ${tally.confirmCustomerOnly}件 / 事業所のみ: ${tally.confirmOfficeOnly}件`);
  console.log('対象外の理由別内訳(顧客):', tally.customerSkipReasons);
  console.log('対象外の理由別内訳(事業所):', tally.officeSkipReasons);
  console.log('対象のDriveエクスポート状態別内訳:', driveStatusTally);
  console.log(
    '  ※ driveExportStatus:error/フィールド不在の書類は、confirm実行後に定期リトライ(driveExportScheduled.ts、' +
      '15分毎・1回最大10件)でDriveへ書き出される可能性があります。'
  );
  for (const c of targets.slice(0, 20)) {
    console.log(`  対象: ${c.id} [${c.fileName}] customer=${c.decisions.customer.action} office=${c.decisions.office.action}`);
  }
  if (targets.length > 20) {
    console.log(`  ...他${targets.length - 20}件`);
  }

  try {
    assertExpectedCount(targets.length, expectedCount);
  } catch (err) {
    if (err instanceof ExpectedCountMismatchError) {
      console.error(`\nERROR: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  if (dryRun) {
    console.log('\n--dry-run モードのため変更なし。実行するには --dry-run を外してください。');
    return;
  }

  const runId = randomUUID();
  const entries: ConfirmOnVerifyManifestEntry[] = [];
  let preconditionFailedCount = 0;
  // codexレビュー(second opinion、silent-failure-hunter)指摘: precondition不一致以外の
  // 予期しない例外(ネットワーク断・権限エラー等)がループ途中で発生すると、それまでに
  // 実際にFirestoreへ書込み済みの分がmanifestに一切残らず、rollbackの一次情報を失って
  // しまう(このスクリプトの設計そのものが「manifestがrollbackの一次情報」を前提にして
  // いるにもかかわらず)。try/finallyで、ループが例外で中断してもその時点までのentriesを
  // 必ずmanifestへ書き出す。
  try {
    for (const candidate of targets) {
      // eslint-disable-next-line no-await-in-loop
      const result = await applyConfirmOnVerify(candidate);
      if (result.status === 'ok') {
        entries.push(result.entry);
      } else {
        preconditionFailedCount++;
      }
    }
  } finally {
    if (manifestOutPath && entries.length > 0) {
      const manifest: ConfirmOnVerifyBackfillManifest = buildConfirmOnVerifyManifest({
        runId,
        projectId: projectId as string,
        timestampIso: new Date().toISOString(),
        entries,
      });
      writeFileSync(manifestOutPath, JSON.stringify(manifest, null, 2));
      console.log(`manifest出力: ${manifestOutPath} (runId=${runId}, ${entries.length}件)`);
    }
  }

  console.log(`\n--- 結果 ---`);
  console.log(`確定成功: ${entries.length}件`);
  if (preconditionFailedCount > 0) {
    console.log(`並行書込みによりスキップ: ${preconditionFailedCount}件`);
  }
}

/**
 * `--rollback <manifest>`: manifest記載のdocIdをliveで再取得し、backfill後に人間の確定操作
 * (confirmedBy/officeConfirmedByが設定される操作)が入っていないものだけを、backfill実行前の
 * 値(フィールド不在ならdelete、falseならfalseへset)へ戻す。
 */
async function runRollback(manifestPath: string): Promise<void> {
  const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  // codexレビュー指摘(type-design-analyzer、Issue #1043): 従来はJSON.parse()の戻り値を
  // 型アサーションのみで信頼しており、手編集・別バージョン・部分破損したmanifestが構文
  // エラーなくすり抜け、computeRollbackInstructions()が誤ったロールバックを実行しうる
  // 状態だった。生成側と同じ構造的整合性チェックをランタイムで課し、1件でも不正なentryが
  // あれば書込みを一切行わずここで中断する(fail-closed)。
  if (!isValidManifest(parsed)) {
    console.error(
      `ERROR: manifestの構造が不正です(${manifestPath})。手編集・別バージョン・部分破損したJSONではないか確認してください。`
    );
    process.exit(1);
  }
  const manifest: ConfirmOnVerifyBackfillManifest = parsed;
  console.log(`プロジェクト: ${projectId}`);
  console.log(`モード: ${dryRun ? 'DRY RUN(変更なし)' : '実行'}`);
  console.log(`rollback対象manifest: ${manifestPath} (runId=${manifest.runId}, entries=${manifest.entries.length}件)`);
  console.log('---');

  // codexレビュー指摘: manifestは`projectId`を持つが、実行対象(FIREBASE_PROJECT_ID)と
  // 一致するかを確認していなかった。別テナント/環境向けのmanifestをdocId衝突のまま
  // 誤って実行すると、意図しないプロジェクトの文書を書き換えてしまう。
  if (manifest.projectId !== projectId) {
    console.error(
      `ERROR: manifestのprojectId(${manifest.projectId})と実行対象(${projectId})が一致しません。` +
        '誤操作防止のため中断します。正しいFIREBASE_PROJECT_IDで実行するか、manifestを確認してください。'
    );
    process.exit(1);
  }

  let reverted = 0;
  let skippedNotFound = 0;
  let skippedProgressed = 0;
  let skippedPreconditionFailed = 0;

  for (const entry of manifest.entries) {
    const ref = db.doc(`documents/${entry.docId}`);
    // eslint-disable-next-line no-await-in-loop
    const snap = await ref.get();
    if (!snap.exists) {
      console.log(`  スキップ(doc不在、要調査): ${entry.docId}`);
      skippedNotFound++;
      continue;
    }
    // codexレビュー指摘(4回目・P2): confirmedBy等のactorベースの判定では、OCR再処理による
    // 自動確定(confirmedByはnullのまま新しい値で上書き)を「backfillのまま」と誤検知しうる。
    // backfill書込み直後のupdateTimeとライブのupdateTimeが完全一致する場合のみ、entry全体
    // (顧客・事業所とも)をrollback対象とする(1文字でも異なれば何らかの書込みが発生している)。
    if (!isRollbackEligibleByUpdateTime(entry, { seconds: snap.updateTime!.seconds, nanoseconds: snap.updateTime!.nanoseconds })) {
      console.log(`  スキップ(backfill以降に別の書込みが発生済み): ${entry.docId}`);
      skippedProgressed++;
      continue;
    }
    const instructions = computeRollbackInstructions(entry);
    const update: Record<string, unknown> = {};

    if (instructions.customer) {
      update.customerConfirmed =
        instructions.customer.action === 'delete' ? admin.firestore.FieldValue.delete() : instructions.customer.value;
      // codexレビュー指摘: backfillが顧客確定と同時にneedsManualCustomerSelectionも
      // 書き戻していた場合、customerConfirmedと同じ原子性(同一update呼び出し)で
      // 一緒に元へ戻す(customerConfirmedだけ戻すとレガシーフラグが不整合になる)。
      if (instructions.needsManualCustomerSelection?.action === 'set') {
        update.needsManualCustomerSelection = instructions.needsManualCustomerSelection.value;
      }
    }
    if (instructions.office) {
      update.officeConfirmed =
        instructions.office.action === 'delete' ? admin.firestore.FieldValue.delete() : instructions.office.value;
    }

    if (Object.keys(update).length === 0) continue;

    console.log(`  対象: ${entry.docId}`);
    if (dryRun) continue;

    try {
      // eslint-disable-next-line no-await-in-loop
      await ref.update(update, { lastUpdateTime: snap.updateTime });
      reverted++;
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === 9) {
        console.log(`  スキップ(並行書込み検出、precondition不一致): ${entry.docId}`);
        skippedPreconditionFailed++;
        continue;
      }
      throw err;
    }
  }

  console.log(`\n--- 結果 ---`);
  console.log(`復帰: ${reverted}件`);
  console.log(`スキップ(進行済み/対象外): ${skippedProgressed}件`);
  if (skippedNotFound > 0) {
    console.log(`スキップ(doc不在、要調査): ${skippedNotFound}件`);
  }
  if (skippedPreconditionFailed > 0) {
    console.log(`並行書込みによりスキップ: ${skippedPreconditionFailed}件`);
  }
  if (dryRun) {
    console.log('\n--dry-run モードのため変更なし。実行するには --dry-run を外してください。');
  }
}

async function main(): Promise<void> {
  if (rollbackManifestPath) {
    await runRollback(rollbackManifestPath);
  } else {
    await runBackfill();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('エラー:', err);
  process.exit(1);
});
