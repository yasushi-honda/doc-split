#!/usr/bin/env ts-node
/**
 * Issue #871 恒久対応: 既存 divergent claim の expireAt(TTL) を除去する一回限りの移行
 *
 * `markDivergent()`は本対応(PR-B)以降`expireAt`を書かなくなったが、既にdivergent化して
 * いる既存claim(kanameoneで2026-09-16時点で3件確認、うち2件は2026-09-01発生分)は
 * `expireAt`(180日TTL)を持ったまま
 * Firestoreに残っている。kanameoneでは`gcloud firestore fields ttls list
 * --collection-group=driveFolderLocks`で`ttlConfig.state:ACTIVE`を実測確認済みのため、
 * 人手解決前にこのフィールドが原因で無言消滅しうる実在リスクがある。
 *
 * 本スクリプトは`state=='divergent'`の全件を走査し、`expireAt`を持つものだけ
 * `FieldValue.delete()`で除去する(他フィールドは不変)。削除のみの冪等操作のため
 * 比較的低リスクだが、既存の運用スクリプト慣習(`execute-drive-export-repair.ts`)に
 * 倣い既定dry-run・`--execute`必須とする。各更新は走査時の`updateTime`を
 * precondition として使い、走査後に対象claimが変化していた場合はスキップする
 * (通常のfindOrCreateFolder等の並行操作との競合を無視して上書きしないため)。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=docsplit-kanameone npx ts-node scripts/backfill-drive-folder-claim-ttl.ts
 *   FIREBASE_PROJECT_ID=docsplit-kanameone npx ts-node scripts/backfill-drive-folder-claim-ttl.ts --execute
 */

import * as admin from 'firebase-admin';

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID 環境変数を設定してください');
  process.exit(1);
}

let execute = false;
let dryRunFlagSeen = false;
for (const arg of process.argv.slice(2)) {
  if (arg === '--execute') {
    execute = true;
  } else if (arg === '--dry-run') {
    dryRunFlagSeen = true;
  } else {
    console.error(`未知の引数です: ${arg}(指定可能: --dry-run または --execute)`);
    process.exit(1);
  }
}
if (dryRunFlagSeen && execute) {
  console.error('--dry-run と --execute は同時に指定できません');
  process.exit(1);
}

admin.initializeApp({ projectId });
const db = admin.firestore();

const FAILED_PRECONDITION_CODE = 9;

interface Candidate {
  ref: FirebaseFirestore.DocumentReference;
  id: string;
  updateTime: FirebaseFirestore.Timestamp;
  divergentReason: unknown;
}

async function collectCandidates(): Promise<{ totalDivergent: number; candidates: Candidate[] }> {
  const snapshot = await db.collection('driveFolderLocks').where('state', '==', 'divergent').get();
  const candidates: Candidate[] = [];
  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (data.expireAt !== undefined) {
      candidates.push({
        ref: doc.ref,
        id: doc.id,
        updateTime: doc.updateTime,
        divergentReason: data.divergentReason,
      });
    }
  }
  return { totalDivergent: snapshot.size, candidates };
}

async function main(): Promise<void> {
  const { totalDivergent, candidates } = await collectCandidates();

  console.log(
    `state=='divergent' 全${totalDivergent}件中、expireAtを持つもの${candidates.length}件`
  );
  for (const c of candidates) {
    console.log(`  - ${c.id} (divergentReason=${String(c.divergentReason)})`);
  }

  if (!execute) {
    console.log('[DRY-RUN] 上記の対象へexpireAt削除を実行する場合は --execute を指定してください');
    return;
  }

  let migrated = 0;
  let skippedDrift = 0;
  for (const c of candidates) {
    try {
      await c.ref.update({ expireAt: admin.firestore.FieldValue.delete() }, { lastUpdateTime: c.updateTime });
      migrated++;
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code === FAILED_PRECONDITION_CODE) {
        console.warn(`スキップ(precondition不一致、走査後に対象claimが変化): ${c.id}`);
        skippedDrift++;
        continue;
      }
      throw error;
    }
  }
  console.log(`完了: migrated=${migrated} skippedDrift=${skippedDrift}`);

  const { candidates: remaining } = await collectCandidates();
  if (remaining.length > 0) {
    console.error(
      `検証失敗: state=='divergent' かつ expireAt が存在するclaimが${remaining.length}件残っています: ` +
        remaining.map((c) => c.id).join(', ')
    );
    process.exitCode = 1;
    return;
  }
  console.log("検証OK: state=='divergent' かつ expireAt存在 は0件");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
