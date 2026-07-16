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
 *   node scripts/migrate-document-groups.js --rebuild-groups <groupId1> [--rebuild-groups <groupId2> ...] [--project <project-id>] [--dry-run]
 *   node scripts/migrate-document-groups.js --seed-aggregation-states [--project <project-id>] [--dry-run]
 *   node scripts/migrate-document-groups.js --reopen-gate [--project <project-id>] [--dry-run]
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
 *   --rebuild-groups <id>      Issue #660派生ミッション タスクJ4: Issue #660の非冪等
 *                              トリガーによって蓄積したドリフトが特定少数のgroupIdに
 *                              局在している場合、対象groupId(繰り返し指定、
 *                              scripts/diagnose-caremanager-group-gap.jsの出力形式
 *                              例: careManager_奥村敬子)のみを生データから完全再導出
 *                              して置換する。documentGroups全体の全削除
 *                              (rebuildAllGroupAggregations)は本番環境で影響範囲が
 *                              過大なため、対象個別グループのみに限定した安全な代替
 *                              (/codex plan セカンドオピニオンで設計確定)。カンマ区切り
 *                              ではなく繰り返し引数形式にしているのは、groupKeyが
 *                              自由入力の名前由来でカンマを含みうるため(codex review
 *                              P1指摘、CSVだと誤分割されるリスクがある)。
 *                              --backfill-cm-unassignedと同じメンテナンスゲート制御
 *                              (クローズ→ドレイン待機→処理→finally再開)で実行する。
 *   --seed-aggregation-states  Issue #664修正(ADR-0021)の移行手順: 集計トリガーの
 *                              計算モデルを「event.before/afterの履歴差分適用」から
 *                              「documentAggregationStates(前回適用済みcontribution)
 *                              との差分」に変更するデプロイ前に必須。既存の全document
 *                              (`FieldPath.documentId()`順の無条件フルスキャン、
 *                              status/processedAt未設定文書も含む。`buildContribution()`
 *                              自身のstatus==='split'判定に母集団定義を委ねる。`/codex
 *                              review`P1指摘: Firestoreの`where('status','!=','split')`
 *                              クエリだとそれらのフィールドを持たない文書が暗黙に除外
 *                              されていた)に対してcontributionを算出し
 *                              documentAggregationStates/{docId}をseedする。これを
 *                              新トリガーコード配備**前**に実行しないと、配備後の
 *                              最初のイベントでstate不在(previousContribution=[])
 *                              として扱われ、既にdocumentGroupsへ計上済みの寄与が
 *                              二重加算される(`/codex plan`セカンドオピニオン指摘)。
 *                              メンテナンスゲートはseed完了後も**閉じたまま維持**し、
 *                              再開しない(`--backfill-cm-unassigned`/`--rebuild-groups`
 *                              とは異なりfinallyで自動再開しない)。新トリガーコードの
 *                              デプロイはこのスクリプトの責務外(運用者が別途実行)であり、
 *                              seed完了と同時にゲートが再開されると、seed完了〜デプロイ
 *                              完了までの間隙で発生した集計所属変更が旧トリガーで
 *                              documentGroupsへ反映されつつdocumentAggregationStatesには
 *                              反映されず、デプロイ後の次回イベントで二重適用される
 *                              (`/codex review`P1指摘、当初はオプトインの
 *                              `--keep-gate-closed`フラグだったが、指定し忘れる
 *                              フットガンを排除するため必須の既定動作に変更)。デプロイ
 *                              成功確認後、`--reopen-gate`で明示的にゲートを再開すること。
 *   --reopen-gate              `--seed-aggregation-states`実行・新トリガーコードの
 *                              デプロイ完了確認後に、メンテナンスゲートを明示的に
 *                              再開する。ドレイン待機は不要(seed実行時に既に完了済み)。
 *                              `--dry-run`併用時は実際の書き込みを行わずプレビューのみ
 *                              行う(`/codex review`P2指摘: dry-runなのに実際にゲートを
 *                              再開してしまうと、他の全モードの「dry-runは書き込みなし」
 *                              という契約に反する)。
 *   --drain-wait-ms <ms>       --backfill-cm-unassigned/--rebuild-groups/
 *                              --seed-aggregation-states実行モードのドレイン待機時間
 *                              (デフォルト: 600000 = 10分、Cloud Functions最大実行
 *                              時間540秒を上回るバリア)。dev環境での動作確認や、
 *                              タイムアウト設定が変わった場合の調整用。
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
let seedAggregationStates = false;
let reopenGate = false;
let drainWaitMs = 10 * 60 * 1000;
// --rebuild-groupsは繰り返し引数形式(--rebuild-groups <id> --rebuild-groups <id> ...)。
// review指摘対応: CSVのカンマ区切りだと、groupKeyが自由入力文字列由来のためカンマを
// 含むケース(理論上ありうる)で誤分割される。繰り返し引数なら曖昧性がない
// (codex review P1指摘)。CSV→複数--rebuild-groups引数への展開はGHA側(run-ops-script.yml)
// の責務とする。
const rebuildGroupIds = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--project' && args[i + 1]) {
    projectId = args[i + 1];
    i++;
  } else if (args[i] === '--dry-run') {
    dryRun = true;
  } else if (args[i] === '--backfill-cm-unassigned') {
    backfillCmUnassigned = true;
  } else if (args[i] === '--seed-aggregation-states') {
    seedAggregationStates = true;
  } else if (args[i] === '--reopen-gate') {
    reopenGate = true;
  } else if (args[i] === '--drain-wait-ms' && args[i + 1]) {
    drainWaitMs = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--rebuild-groups') {
    // review指摘対応(codex review P1): 値が欠落/空/次の引数が別フラグの場合、
    // 危険な既定モード(全件再構築、Phase1でdocuments全件update)へ静かに
    // フォールバックしないよう、ここで即座にエラー終了する。
    const value = args[i + 1];
    if (!value || value.startsWith('--')) {
      console.error('❌ --rebuild-groups には値(groupId)を指定してください(例: --rebuild-groups careManager_佐藤花子)');
      process.exit(1);
    }
    rebuildGroupIds.push(value);
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
  rebuildSingleGroupAggregation,
  buildContribution,
  aggregationStateRef,
  buildAggregationStateEntry,
} = require(
  path.resolve(__dirname, '../functions/lib/functions/src/utils/groupAggregation.js'),
);

// groupIdの逆パース用。GroupType自体はTypeScript型でJS実行時には存在しないため、
// generateGroupId()が使う4種の既知prefixをローカルに列挙する(4値は互いに他の接頭辞
// にならないため、先頭一致判定で一意にgroupType/groupKeyへ分解できる)。
const GROUP_TYPES = ['customer', 'office', 'documentType', 'careManager'];

function parseGroupId(groupId) {
  for (const type of GROUP_TYPES) {
    const prefix = `${type}_`;
    if (groupId.startsWith(prefix)) {
      const parsed = { groupType: type, groupKey: groupId.slice(prefix.length) };
      // review指摘対応(type-design-analyzer): generateGroupId()との往復(round-trip)が
      // 一致することをここで検証する。dry-run(previewRebuildGroups、生groupId文字列を
      // 直接documentGroupsの参照に使う)と実行(executeRebuildGroups、parseGroupIdで
      // 分解後generateGroupIdで再構築したgroupIdを使う)の対象特定経路が異なるため、
      // 往復が一致しない場合に静かに別groupを操作してしまうリスクを実行時に検知する。
      if (generateGroupId(parsed.groupType, parsed.groupKey) !== groupId) {
        throw new Error(
          `parseGroupId: groupId "${groupId}" の分解結果がgenerateGroupId()で再構築した値と一致しません ` +
          `(groupType=${parsed.groupType}, groupKey=${parsed.groupKey})。往復不一致は対象取り違えの` +
          'リスクがあるため中断します。'
        );
      }
      return parsed;
    }
  }
  throw new Error(`未知のgroupId形式です(customer_/office_/documentType_/careManager_のいずれのprefixにも一致しません): ${groupId}`);
}
// CM未設定グループの予約key/groupIdは shared/types.ts の CONSTANTS + generateGroupId から
// 導出する(文字列リテラルのハードコピー禁止。/code-review high指摘: ハードコードすると
// CONSTANTS.UNASSIGNED_CARE_MANAGER_KEYが将来変わった際にdry-runプレビューだけ乖離する)。
const { CONSTANTS } = require(
  path.resolve(__dirname, '../functions/lib/shared/types.js'),
);
const CM_UNASSIGNED_GROUP_ID = generateGroupId('careManager', CONSTANTS.UNASSIGNED_CARE_MANAGER_KEY);

// system/maintenanceFlagsのパスもmaintenanceGate.tsのSSoTから直接require(手書きコピー禁止、
// code-simplifier指摘)。
const { MAINTENANCE_FLAGS_DOC_PATH } = require(
  path.resolve(__dirname, '../functions/lib/functions/src/utils/maintenanceGate.js'),
);

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
 * メンテナンスゲート制御(クローズ→ドレイン待機→fn実行→finally再開)を共通化する
 * ヘルパー(code-review指摘対応)。
 *
 * 従来`executeBackfillCmUnassigned`/`executeRebuildGroups`/`executeSeedAggregationStates`
 * の3箇所に同型のゲート制御コードが独立に複製されており、うち`executeRebuildGroups`
 * にのみ「ゲート再開自体の書込み失敗でfn節の元の例外が握りつぶされないよう、再開処理を
 * catchして両方を明示的にログ出力する」安全策(silent-failure-hunter H3対応)が入って
 * いた。他の2箇所には未適用のまま残っており、直し忘れによる事故のリスクがあったため、
 * 単一のヘルパーに統合しfnを渡す形に統一する。
 *
 * Cloud Functions最大実行時間(processOCR: 540秒)を上回るドレイン待機は、ゲートクローズ前に
 * 開始していた実行(OCR確定/split/顧客マスター同期)が確実に完了/タイムアウト済みである
 * ことを保証するバリア(/codex plan指摘: 時間待ちに根拠を持たせる、デフォルト10分)。
 */
/**
 * @param {number} drainWaitMsValue
 * @param {() => Promise<any>} fn
 * @param {{ reopenAfter?: boolean }} [options] - `reopenAfter: false`の場合、fn完了後も
 *   ゲートを閉じたまま維持する(呼び出し元が別途`--reopen-gate`で明示的に再開する責務を負う)。
 *   `--seed-aggregation-states`用(`/codex review`P1指摘: seed完了と同時にゲートが再開される
 *   と、デプロイ完了までの間隙で発生した集計所属変更が新旧トリガー間で二重適用されるリスクが
 *   あるため、この移行モードでは常にゲートを閉じたまま維持する)。
 */
async function withMaintenanceGate(drainWaitMsValue, fn, options = {}) {
  const { reopenAfter = true } = options;

  console.log('🔒 メンテナンスゲートを閉じます...');
  await db.doc(MAINTENANCE_FLAGS_DOC_PATH).set(
    { groupAggregationGateOpen: false, gateClosedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );

  console.log(`⏳ ドレイン確認のため ${drainWaitMsValue / 1000} 秒待機します(Cloud Functions最大実行時間を上回るバリア)...`);
  await sleep(drainWaitMsValue);

  if (!reopenAfter) {
    // ゲートを閉じたまま維持する。fn失敗時も含め再開しない(呼び出し元の責務)。
    return await fn();
  }

  try {
    return await fn();
  } finally {
    // fn成功・失敗いずれでも必ずゲートを再開する(閉じたまま放置しない)。
    // review指摘対応(silent-failure-hunter H3): ゲート再開自体の書込み失敗でfn節の
    // 元の例外が握りつぶされないよう、ここでcatchして両方を明示的にログ出力する。
    console.log('🔓 メンテナンスゲートを再開します...');
    try {
      await db.doc(MAINTENANCE_FLAGS_DOC_PATH).set(
        { groupAggregationGateOpen: true, gateOpenedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
    } catch (gateError) {
      console.error(
        '❌ メンテナンスゲートの再開に失敗しました。ゲートが閉じたままの可能性があります。' +
        'system/maintenanceFlags の groupAggregationGateOpen を手動で true に戻してください: ',
        gateError
      );
      throw gateError;
    }
  }
}

/**
 * CM未設定グループをメンテナンスゲート制御下で安全にバックフィルする
 */
async function executeBackfillCmUnassigned() {
  console.log('📊 CM未設定グループを作成します...');
  const result = await withMaintenanceGate(drainWaitMs, () => backfillUnassignedCareManagerGroup(db, 500));

  console.log(`\n✅ CM未設定グループ作成完了: スキャン ${result.scanned} 件 / 対象 ${result.matched} 件 / count ${result.count}`);
  console.log('次のステップ: scripts/diagnose-caremanager-group-gap.js で customer合計とcareManager合計の一致を検証してください。');
  return result;
}

/**
 * documentAggregationStatesのseed対象を読み取り専用でプレビューする(書き込み・ゲート操作なし)。
 *
 * `documents`コレクションを`FieldPath.documentId()`順で無条件フルスキャンする
 * (`rebuildAllGroupAggregations()`等の`where('status','!=','split')`クエリとは異なる)。
 * Firestoreの`!=`/`orderBy`クエリは対象フィールドを持たない文書を暗黙に除外するため、
 * `status`/`processedAt`が未設定のレガシー文書がseed対象から漏れる(`/codex review`
 * P1指摘)。本関数の目的は「ライブトリガー(`processDocumentAggregationEvent`→
 * `buildContribution`、`status===undefined`を非split扱いで包含する)が今後計算する値」に
 * 事前一致させることであり、`buildContribution()`自身のstatus判定に母集団定義を委ねる
 * ほうが正確(`scripts/diagnose-caremanager-group-gap.js`の全件スキャン方式と同じ考え方)。
 */
async function previewSeedAggregationStates() {
  let scanned = 0;
  let withContribution = 0;
  let lastDoc = null;
  const batchSize = 500;

  while (true) {
    let query = db.collection('documents')
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(batchSize);

    if (lastDoc) {
      query = query.startAfter(lastDoc.id);
    }

    const snapshot = await query.get();
    if (snapshot.empty) break;

    for (const docSnap of snapshot.docs) {
      const contribution = buildContribution(docSnap.data());
      if (contribution.length > 0) withContribution++;
      scanned++;
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];
  }

  console.log(`  スキャン: ${scanned} 件 / state作成見込み(contribution非空): ${withContribution} 件`);
  return { scanned, withContribution };
}

/**
 * documentAggregationStatesをメンテナンスゲート制御下で全document分seedする
 * (Issue #664修正、ADR-0021の移行手順)。
 *
 * 新トリガーコード配備**前**に実行すること(スクリプトusageコメント参照)。配備後に
 * 実行すると、配備直後〜seed完了までの間に発生したイベントがstate不在として扱われ、
 * 既にdocumentGroupsへ計上済みの寄与を二重加算してしまう。
 *
 * `previewSeedAggregationStates()`と同様、`FieldPath.documentId()`順の無条件フルスキャン
 * を使う(`status`/`processedAt`未設定文書の取りこぼし防止、`/codex review`P1指摘)。
 *
 * contributionが空配列の文書はstateを書かない(readAggregationStateContribution()は
 * state不在時も空配列を返すため、動作上の差はなくwrite数を削減できる)。
 *
 * seed完了後もゲートは閉じたまま維持し、再開しない(`withMaintenanceGate`の`reopenAfter:
 * false`)。新トリガーコードのデプロイはこのスクリプトの責務外(運用者が別途実行する別
 * コマンド)であり、seed完了と同時にゲートが再開されると、seed完了〜デプロイ完了までの
 * 間隙で発生した集計所属変更(OCR確定/split/CM同期、いずれもゲート対象)が旧トリガーに
 * よって`documentGroups`へ正しく反映されるが`documentAggregationStates`には反映されない。
 * デプロイ後にその文書が再び触られると、新トリガーが古いstateとの差分を「新規変化」と誤認し
 * 二重適用してしまう(`/codex review`P1指摘。当初は`--keep-gate-closed`という opt-in
 * フラグだったが、指定し忘れるフットガンを排除するため必須の既定動作に変更した)。デプロイ
 * 完了確認後に`--reopen-gate`で明示的に再開することでこの間隙を解消する。
 */
async function executeSeedAggregationStates() {
  // 新トリガーコードの配備自体は本スクリプトの責務外(運用者が別途デプロイする)。
  // ADR-0021記載の手順通り、本スクリプト完了後に新コード配備 → 検証の順で進めること。
  const { scanned, seeded } = await withMaintenanceGate(drainWaitMs, async () => {
    let scanned = 0;
    let seeded = 0;
    let lastDoc = null;
    const batchSize = 500;

    while (true) {
      let query = db.collection('documents')
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(batchSize);

      if (lastDoc) {
        query = query.startAfter(lastDoc.id);
      }

      const snapshot = await query.get();
      if (snapshot.empty) break;

      const batch = db.batch();
      let batchWrites = 0;

      for (const docSnap of snapshot.docs) {
        const contribution = buildContribution(docSnap.data());
        if (contribution.length > 0) {
          batch.set(aggregationStateRef(db, docSnap.id), buildAggregationStateEntry(contribution));
          batchWrites++;
          seeded++;
        }
        scanned++;
      }

      if (batchWrites > 0) {
        await batch.commit();
      }

      console.log(`  スキャン: ${scanned} 件 (state作成: ${seeded} 件)`);
      lastDoc = snapshot.docs[snapshot.docs.length - 1];
    }

    return { scanned, seeded };
  }, { reopenAfter: false });

  console.log(`\n✅ documentAggregationStates seed完了: スキャン ${scanned} 件 / state作成 ${seeded} 件`);
  console.log('🔒 メンテナンスゲートは閉じたままです(新トリガーコード配備前にゲートが再開されると、');
  console.log('   デプロイ完了までの間隙で発生した集計所属変更が二重適用されるリスクがあるため)。');
  console.log('次のステップ: 新トリガーコード(functions/src/triggers/updateDocumentGroups.ts)を配備し、');
  console.log('デプロイ成功を確認した後、`--reopen-gate` でゲートを再開してください。');
  return { scanned, seeded };
}

/**
 * `--seed-aggregation-states`実行後、新トリガーコードのデプロイ完了を確認してから
 * メンテナンスゲートを明示的に再開する(`/codex review`P1指摘対応)。ドレイン待機は
 * 不要(seed実行時に既に完了済みで、ゲートは閉じられたまま維持されている)。
 */
async function executeReopenGate() {
  console.log('🔓 メンテナンスゲートを再開します...');
  await db.doc(MAINTENANCE_FLAGS_DOC_PATH).set(
    { groupAggregationGateOpen: true, gateOpenedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
  console.log('✅ メンテナンスゲートを再開しました。');
}

/**
 * `--reopen-gate --dry-run`のプレビュー: 現在のゲート状態を表示するのみで書き込みは
 * 行わない(`/codex review`P2指摘: dry-runなのに実際にゲートを再開してしまうと、
 * 他の全モードの「dry-runは書き込みなし」という契約に反する)。
 */
async function previewReopenGate() {
  const snap = await db.doc(MAINTENANCE_FLAGS_DOC_PATH).get();
  const isOpen = !snap.exists || snap.data()?.groupAggregationGateOpen !== false;
  console.log(`  現在のゲート状態: ${isOpen ? '開(既に再開済み)' : '閉'}`);
  console.log('  実行するとgroupAggregationGateOpen: trueに更新します。');
}

/**
 * --rebuild-groups対象のgroupIdを読み取り専用でプレビューする(書き込み・ゲート操作なし)。
 *
 * review指摘対応(code-reviewer Critical): 単に既存の(ドリフトしている可能性がある)
 * documentGroupsの現在値を表示するだけでは、実行したら何件になるか・削除されるかが
 * 事前に分からずdry-runとして機能していなかった。rebuildSingleGroupAggregation()の
 * dryRunオプションで実際に生データを再走査し、現在値→再構築後の値を対比表示する。
 */
async function previewRebuildGroups(groupIds) {
  for (const groupId of groupIds) {
    const { groupType, groupKey } = parseGroupId(groupId);
    const groupRef = db.collection('documentGroups').doc(groupId);
    const existing = await groupRef.get();
    const beforeDesc = existing.exists ? `count=${existing.data().count}` : '未作成';

    const result = await rebuildSingleGroupAggregation(db, groupType, groupKey, { dryRun: true });
    const afterDesc = result.deleted ? '削除予定(対象0件)' : `count=${result.count}`;

    console.log(`  ${groupId}: 現在(${beforeDesc}) → 再構築後(${afterDesc})`);
  }
}

/**
 * --rebuild-groups対象のgroupIdを、メンテナンスゲート制御下で個別に完全再構築する。
 *
 * review指摘対応(silent-failure-hunter H1): forループにtry/catchがなく1件失敗すると
 * 残り全件が未処理のまま中断していたため、失敗groupIdをスキップして残りを処理継続する
 * よう変更。成功/失敗を構造化して記録し、失敗があれば再実行対象を明示する。
 *
 * review指摘対応(silent-failure-hunter M1): groupIdのフォーマット検証(parseGroupId)が
 * 従来ゲートクローズ+10分ドレイン待機の「後」で初めて行われていたため、CSV先頭要素の
 * タイプミス1つで本番の集計関連書込み経路を10分間無駄に止めてから失敗していた。
 * ゲートクローズより前に全groupIdを事前検証する。
 */
async function executeRebuildGroups(groupIds) {
  // ゲートクローズ前の事前検証(silent-failure-hunter M1対応)
  for (const groupId of groupIds) {
    parseGroupId(groupId); // 不正な形式なら例外(ゲート操作前なのでゲートは閉じられない)
  }

  const { succeeded, failed } = await withMaintenanceGate(drainWaitMs, async () => {
    const succeeded = [];
    const failed = [];
    for (const groupId of groupIds) {
      try {
        const { groupType, groupKey } = parseGroupId(groupId);
        console.log(`📊 ${groupId} を再構築します...`);
        const result = await rebuildSingleGroupAggregation(db, groupType, groupKey, { batchSize: 500 });
        console.log(`  → ${result.deleted ? '削除(対象0件)' : `count=${result.count}`}`);
        succeeded.push(result);
      } catch (error) {
        console.error(`  ❌ ${groupId} の再構築に失敗しました:`, error);
        failed.push({ groupId, error: error.message });
      }
    }
    // review指摘対応(silent-failure-hunter H1): 1件失敗しても残りを処理継続するため、
    // ループ自体はtry/catchで囲まずfn全体としては常に正常returnする(例外はwithMaintenanceGate
    // 側のゲート再開処理のみが投げる)。
    return { succeeded, failed };
  });

  const allSucceeded = failed.length === 0;
  console.log(`\n${allSucceeded ? '✅' : '⚠️ '} ${succeeded.length}/${groupIds.length} グループの再構築完了`);
  if (!allSucceeded) {
    console.log(`❌ 失敗したgroupId (${failed.length}件): ${failed.map((f) => f.groupId).join(', ')}`);
    console.log('   失敗したgroupIdのみを対象に再実行してください(rebuildSingleGroupAggregationは冪等)。');
  }
  console.log('次のステップ: scripts/diagnose-caremanager-group-gap.js で全groupIdの一致を再検証してください。');

  // review指摘対応(codex review P2): 一部groupIdの失敗をここで握りつぶしてnormal returnすると、
  // main()の呼び出し元(GitHub Actions)はexit code 0(成功)として扱ってしまい、実際には
  // 一部の補正が未適用のまま「ジョブ成功」と誤認される。ゲート再開(finally)が完了した後、
  // 失敗が1件でもあれば明示的に例外を投げてexit code非0にする。
  if (!allSucceeded) {
    throw new Error(
      `${failed.length}/${groupIds.length} グループの再構築に失敗しました: ` +
      `${failed.map((f) => f.groupId).join(', ')}`
    );
  }
  return { succeeded, failed };
}

/**
 * メイン処理
 */
async function main() {
  const startTime = Date.now();

  if (reopenGate) {
    console.log('🎯 モード: メンテナンスゲート再開(--seed-aggregation-states 実行後の手動再開)\n');

    if (dryRun) {
      await previewReopenGate();
      console.log('\n⚠️  ドライランモードで実行しました。ゲート操作・書き込みは行っていません。');
    } else {
      await executeReopenGate();
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n⏱️  実行時間: ${elapsed} 秒`);
    return;
  }

  if (rebuildGroupIds.length > 0) {
    console.log(`🎯 モード: 個別グループ再構築(GOAL.md タスクJ4、対象 ${rebuildGroupIds.length} 件)\n`);

    if (dryRun) {
      await previewRebuildGroups(rebuildGroupIds);
      console.log('\n⚠️  ドライランモードで実行しました。ゲート操作・書き込みは行っていません。');
    } else {
      await executeRebuildGroups(rebuildGroupIds);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n⏱️  実行時間: ${elapsed} 秒`);
    return;
  }

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

  if (seedAggregationStates) {
    console.log('🎯 モード: documentAggregationStates seed(Issue #664修正、ADR-0021移行手順)\n');

    if (dryRun) {
      await previewSeedAggregationStates();
      console.log('\n⚠️  ドライランモードで実行しました。ゲート操作・書き込みは行っていません。');
    } else {
      await executeSeedAggregationStates();
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
