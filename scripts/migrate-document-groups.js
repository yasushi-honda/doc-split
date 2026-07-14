#!/usr/bin/env node
/**
 * ドキュメントグループ マイグレーションスクリプト
 *
 * 既存のdocumentsにグループキーを付与し、documentGroupsコレクションを初期構築
 *
 * 注意: キー導出(normalizeGroupKey/generateGroupKeys)とグループ集計ロジック
 * (resolveGroupKeyAndDisplay/rebuildAllGroupAggregations、careManager未設定書類の
 * 「CM未設定」グループへのフォールバックを含む)は functions/src/utils/groupAggregation.ts
 * を唯一の実装源とし、functions/lib/functions/src/utils/groupAggregation.js から直接
 * requireする(scripts/diagnose-caremanager-group-gap.jsと同一パターン)。手書きコピーは
 * 持たない — 本体だけ直して本スクリプトを直さないと、次回実行時に旧ロジックで
 * documentGroupsが再構築され、修正済みの集計バグ(担当CM別集計の非対称性)が本番で
 * 再発するため(GOAL.md タスクD)。
 *
 * 実行前に functions/ で `npm run build` を実行し lib/ を最新化すること
 * (GitHub Actions run-ops-script.yml は実行前に自動でnpm run buildする)。
 *
 * Usage:
 *   node scripts/migrate-document-groups.js [--project <project-id>] [--dry-run]
 *   node scripts/migrate-document-groups.js --backfill-cm-unassigned [--project <project-id>] [--dry-run]
 *
 * Options:
 *   --project                  Firebase プロジェクトID (デフォルト: doc-split-dev)
 *   --dry-run                  実際には書き込まない
 *   --backfill-cm-unassigned   GOAL.md タスクG: CM未設定グループ(担当CM別集計の
 *                              非対称性バグ修正)のみを対象にした狭いスコープの
 *                              バックフィル。既存のPhase1/Phase2(初期構築・全崩壊時
 *                              再構築用)は実行しない。実行モードでは集計所属変更を
 *                              伴う書込み経路(OCR確定/split/顧客マスター同期)を
 *                              メンテナンスゲートで一時停止してから安全に作成する
 *                              (functions/src/utils/maintenanceGate.ts、
 *                              /codex plan セカンドオピニオンで設計確定)。
 *   --drain-wait-ms <ms>       --backfill-cm-unassigned実行モードのドレイン待機時間
 *                              (デフォルト: 600000 = 10分、Cloud Functions最大実行時間
 *                              540秒を上回るバリア)。dev環境での動作確認や、Cloud
 *                              Functionsのタイムアウト設定が変わった場合の調整用。
 */

const path = require('path');
const admin = require('firebase-admin');

// コマンドライン引数解析
const args = process.argv.slice(2);
// GitHub Actions run-ops-script.yml の汎用フォールバック分岐は FIREBASE_PROJECT_ID 環境変数で
// プロジェクトIDを渡す(diagnose-caremanager-group-gap.js等と同一convention)。--project未指定時は
// これをフォールバックにする(--projectは引き続きローカル動作確認用に優先)。
let projectId = process.env.FIREBASE_PROJECT_ID || 'doc-split-dev';
let dryRun = false;
let backfillCmUnassigned = false;
let drainWaitMs = 10 * 60 * 1000;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--project' && args[i + 1]) {
    projectId = args[i + 1];
    i++;
  } else if (args[i] === '--dry-run') {
    dryRun = true;
  } else if (args[i] === '--backfill-cm-unassigned') {
    backfillCmUnassigned = true;
  } else if (args[i] === '--drain-wait-ms' && args[i + 1]) {
    drainWaitMs = parseInt(args[i + 1], 10);
    i++;
  }
}

console.log(`📦 プロジェクト: ${projectId}`);
console.log(`🔧 ドライラン: ${dryRun ? 'はい' : 'いいえ'}`);
console.log('');

// Firebase Admin 初期化
admin.initializeApp({
  projectId,
});

const db = admin.firestore();

// groupAggregation.ts のSSoTを直接require（手書きコピー禁止）
const {
  generateGroupKeys,
  generateGroupId,
  resolveGroupKeyAndDisplay,
  rebuildAllGroupAggregations,
  backfillUnassignedCareManagerGroup,
} = require(
  path.resolve(__dirname, '../functions/lib/functions/src/utils/groupAggregation.js'),
);
// CM未設定グループの予約key/groupIdは shared/types.ts の CONSTANTS + generateGroupId から
// 導出する(文字列リテラルのハードコピー禁止。/code-review high指摘: ハードコードすると
// CONSTANTS.UNASSIGNED_CARE_MANAGER_KEYが将来変わった際にdry-runプレビューだけ乖離する)。
const { CONSTANTS } = require(
  path.resolve(__dirname, '../functions/lib/shared/types.js'),
);
const CM_UNASSIGNED_GROUP_ID = generateGroupId('careManager', CONSTANTS.UNASSIGNED_CARE_MANAGER_KEY);

const MAINTENANCE_FLAGS_DOC_PATH = 'system/maintenanceFlags';

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * CM未設定グループのバックフィル対象を読み取り専用でプレビューする(書き込み・ゲート操作なし)
 */
async function previewBackfillCmUnassigned() {
  const groupRef = db.collection('documentGroups').doc(CM_UNASSIGNED_GROUP_ID);
  const existing = await groupRef.get();
  console.log(`  CM未設定グループ: ${existing.exists ? `既存(count=${existing.data().count})` : '未作成'}`);

  let scanned = 0;
  let matched = 0;
  let lastDoc = null;
  const batchSize = 500;

  while (true) {
    let query = db.collection('documents')
      .where('status', '!=', 'split')
      .orderBy('status')
      .orderBy('processedAt', 'desc')
      .limit(batchSize);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();
    if (snapshot.empty) break;

    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      const keys = generateGroupKeys(data);
      // resolveGroupKeyAndDisplay()を直接呼び、実行モード(backfillUnassignedCareManagerGroup)
      // と完全に同じ判定条件を共有する(手書きコピー禁止)。
      const resolved = resolveGroupKeyAndDisplay('careManager', keys.careManagerKey, data.careManager, !!keys.customerKey);
      if (resolved && resolved.key === CONSTANTS.UNASSIGNED_CARE_MANAGER_KEY) {
        matched++;
      }
      scanned++;
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];
  }

  console.log(`  スキャン: ${scanned} 件 / CM未設定計上見込み: ${matched} 件`);
  return { scanned, matched, alreadyExists: existing.exists };
}

/**
 * CM未設定グループをメンテナンスゲート制御下で安全にバックフィルする
 */
async function executeBackfillCmUnassigned() {
  console.log('🔒 メンテナンスゲートを閉じます...');
  await db.doc(MAINTENANCE_FLAGS_DOC_PATH).set(
    { groupAggregationGateOpen: false, gateClosedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );

  // Cloud Functions最大実行時間(processOCR: 540秒)を上回るドレイン待機。ゲートクローズ前に
  // 開始していた実行(OCR確定/split/顧客マスター同期)が確実に完了/タイムアウト済みである
  // ことを保証するバリア(/codex plan指摘: 時間待ちに根拠を持たせる、デフォルト10分)。
  console.log(`⏳ ドレイン確認のため ${drainWaitMs / 1000} 秒待機します(Cloud Functions最大実行時間を上回るバリア)...`);
  await sleep(drainWaitMs);

  console.log('📊 CM未設定グループを作成します...');
  let result;
  try {
    result = await backfillUnassignedCareManagerGroup(db, 500);
  } finally {
    // バックフィル成功・失敗いずれでも必ずゲートを再開する(閉じたまま放置しない)
    console.log('🔓 メンテナンスゲートを再開します...');
    await db.doc(MAINTENANCE_FLAGS_DOC_PATH).set(
      { groupAggregationGateOpen: true, gateOpenedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
  }

  console.log(`\n✅ CM未設定グループ作成完了: スキャン ${result.scanned} 件 / 対象 ${result.matched} 件 / count ${result.count}`);
  console.log('次のステップ: scripts/diagnose-caremanager-group-gap.js で customer合計とcareManager合計の一致を検証してください。');
  return result;
}

/**
 * メイン処理
 */
async function main() {
  const startTime = Date.now();

  if (backfillCmUnassigned) {
    console.log('🎯 モード: CM未設定グループ バックフィル(GOAL.md タスクG)\n');

    if (dryRun) {
      await previewBackfillCmUnassigned();
      console.log('\n⚠️  ドライランモードで実行しました。ゲート操作・書き込みは行っていません。');
    } else {
      await executeBackfillCmUnassigned();
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n⏱️  実行時間: ${elapsed} 秒`);
    return;
  }

  console.log('🚀 マイグレーション開始...\n');

  // Phase 1: 既存documentsにグループキーを付与
  console.log('📝 Phase 1: グループキー付与');
  let processed = 0;
  let updated = 0;
  let lastDoc = null;
  const batchSize = 500;

  while (true) {
    let query = db.collection('documents')
      .orderBy('processedAt', 'desc')
      .limit(batchSize);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();
    if (snapshot.empty) break;

    const batch = db.batch();
    let batchUpdates = 0;

    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      const keys = generateGroupKeys(data);

      const needsUpdate =
        data.customerKey !== keys.customerKey ||
        data.officeKey !== keys.officeKey ||
        data.documentTypeKey !== keys.documentTypeKey ||
        data.careManagerKey !== keys.careManagerKey;

      if (needsUpdate) {
        if (!dryRun) {
          batch.update(docSnap.ref, keys);
        }
        batchUpdates++;
        updated++;
      }

      processed++;
    }

    if (batchUpdates > 0 && !dryRun) {
      await batch.commit();
    }

    console.log(`  処理: ${processed} 件 (更新: ${updated} 件)`);
    lastDoc = snapshot.docs[snapshot.docs.length - 1];
  }

  console.log(`\n✅ Phase 1 完了: ${processed} 件処理, ${updated} 件更新\n`);

  // Phase 2: documentGroupsを再構築
  console.log('📊 Phase 2: グループ集計');

  let scanned;
  let groupCount;
  const typeCounts = { customer: 0, office: 0, documentType: 0, careManager: 0 };

  if (dryRun) {
    // rebuildAllGroupAggregations()は削除+書き込みを行うためdry-runでは呼べない。
    // 同一のkey導出・フォールバック関数(generateGroupKeys/resolveGroupKeyAndDisplay)を
    // 使った読み取り専用プレビューで代替する(書き込みロジックはFirestoreへ触れない)。
    const groupMap = new Map();
    scanned = 0;
    lastDoc = null;

    while (true) {
      // rebuildAllGroupAggregations()と同一のFirestoreクエリに統一する(session131指摘④の解消)。
      // JS側での`status === 'split'`除外はstatus未設定文書を誤って含めてしまう非対称性が
      // あったため廃止し、Firestoreの`!=`クエリ(status未設定文書を自動的に除外する)に一本化する。
      let query = db.collection('documents')
        .where('status', '!=', 'split')
        .orderBy('status')
        .orderBy('processedAt', 'desc')
        .limit(batchSize);

      if (lastDoc) {
        query = query.startAfter(lastDoc);
      }

      const snapshot = await query.get();
      if (snapshot.empty) break;

      for (const docSnap of snapshot.docs) {
        const data = docSnap.data();

        const keys = generateGroupKeys(data);
        const types = [
          { type: 'customer', key: keys.customerKey, display: data.customerName },
          { type: 'office', key: keys.officeKey, display: data.officeName },
          { type: 'documentType', key: keys.documentTypeKey, display: data.documentType },
          { type: 'careManager', key: keys.careManagerKey, display: data.careManager },
        ];

        for (const { type, key, display } of types) {
          const resolved = resolveGroupKeyAndDisplay(type, key, display, !!keys.customerKey);
          if (!resolved) continue;

          const groupId = generateGroupId(type, resolved.key);
          const existing = groupMap.get(groupId);
          if (existing) {
            existing.count++;
          } else {
            groupMap.set(groupId, { groupType: type, count: 1 });
          }
        }

        scanned++;
      }

      console.log(`  スキャン: ${scanned} 件`);
      lastDoc = snapshot.docs[snapshot.docs.length - 1];
    }

    groupCount = groupMap.size;
    for (const { groupType } of groupMap.values()) {
      typeCounts[groupType]++;
    }

    console.log('\n⚠️  ドライランのためdocumentGroupsは変更していません（プレビューのみ）。');
  } else {
    const result = await rebuildAllGroupAggregations(db, batchSize);
    scanned = result.processed;
    groupCount = result.groups;

    const groupsSnap = await db.collection('documentGroups').get();
    groupsSnap.forEach((doc) => {
      const groupType = doc.data().groupType;
      if (typeCounts[groupType] !== undefined) {
        typeCounts[groupType]++;
      }
    });
  }

  // 結果サマリー
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n' + '='.repeat(50));
  console.log('📊 マイグレーション結果');
  console.log('='.repeat(50));
  console.log(`  処理ドキュメント: ${scanned} 件`);
  console.log(`  キー更新: ${updated} 件`);
  console.log(`  グループ作成: ${groupCount} 件`);

  console.log('\n  グループ内訳:');
  console.log(`    - 顧客別: ${typeCounts.customer} グループ`);
  console.log(`    - 事業所別: ${typeCounts.office} グループ`);
  console.log(`    - 書類種別: ${typeCounts.documentType} グループ`);
  console.log(`    - 担当CM別: ${typeCounts.careManager} グループ`);

  console.log(`\n⏱️  実行時間: ${elapsed} 秒`);
  console.log(dryRun ? '\n⚠️  ドライランモードで実行しました。実際の書き込みは行われていません。' : '\n✅ マイグレーション完了!');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ エラー:', error);
    process.exit(1);
  });
