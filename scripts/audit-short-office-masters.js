#!/usr/bin/env node
/**
 * 短文字列 office マスター監査スクリプト (read-only)
 *
 * `masters/offices/items` 全件を取得し、name.length が閾値以下のエントリを列挙する。
 * Issue #501 の 3 層防御 (sanitize length>=4 ガード) が legitimate な短マスターを
 * 巻き込まないか確認するために使用。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=<project-id> node scripts/audit-short-office-masters.js [--max-length N]
 *
 * オプション:
 *   --max-length N              name.length <= N のエントリを出力 (default: 3)
 *   --fail-on-detected          length<=N のエントリが 1件でも見つかれば exit 1 (legitimate 含む)
 *   --fail-on-collision         PR #507 review Critical #2 対応: legitimate 短マスター (collision なし)
 *                               を除外し、common short master (PR #502 v2 と同じ collision 判定)
 *                               のみで exit 1 する。scheduled audit から呼ぶ場合の推奨 flag。
 *   --fail-on-id-equals-name    Issue #707: Firestore doc ID が name 文字列そのものになっている
 *                               signature を、name の文字数に依存しない独立チェックとして検出し、
 *                               1件でもあれば exit 1 する。--max-length の閾値では捕捉できない
 *                               長い name (例:「訪問介護かいと」) の網の穴に対応する。
 *
 *                               注意: doc.id===name 単体は CSV import 由来の contamination の
 *                               必要十分条件ではない (dev環境の scripts/samples/offices.csv 由来
 *                               サンプルマスター等、legitimate なケースでも成立する)。実際に
 *                               contamination と確定するには #704 のように「同一/類似名の
 *                               正規 auto-ID マスターが別途存在するか」の手動確認が必要。
 *                               このため scheduled audit の自動 fail 条件には使わず、本 flag は
 *                               手動調査 (run-ops-script.yml 経由) 専用とする。
 */

const admin = require('firebase-admin');

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID 環境変数を設定してください');
  process.exit(1);
}

const args = process.argv.slice(2);
let maxLength = 3;
let failOnDetected = false;
let failOnCollision = false;
let failOnIdEqualsName = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--max-length' && args[i + 1]) {
    const n = parseInt(args[i + 1], 10);
    if (!Number.isInteger(n) || n < 0) {
      console.error(`--max-length は非負整数を指定してください (got: ${args[i + 1]})`);
      process.exit(1);
    }
    maxLength = n;
    i++;
  } else if (args[i] === '--fail-on-detected') {
    // length<=N で 1 件でも検出 → exit 1 (legitimate 短マスター含む)
    failOnDetected = true;
  } else if (args[i] === '--fail-on-collision') {
    // #507 review Critical #2: legitimate (collision なし) を除外し、common short master のみで exit 1
    failOnCollision = true;
  } else if (args[i] === '--fail-on-id-equals-name') {
    // #707: id===name signature (length非依存) の独立チェック
    failOnIdEqualsName = true;
  }
}

// shared collision 判定 (PR #502 v2 と同等) + id===name 判定 (#707)。Bridge 経由で ts-node から TS を require
const { computeCommonShortMasters, computeIdEqualsNameMasters } = require('./lib/officeMasterValidationBridge');

admin.initializeApp({ projectId });
const db = admin.firestore();

// 関連 documents の件数 (officeName 完全一致 / officeId 参照) を出力する共通ヘルパー
async function printRelatedDocumentCounts(name, id) {
  const [byName, byId] = await Promise.all([
    db.collection('documents').where('officeName', '==', name).count().get(),
    db.collection('documents').where('officeId', '==', id).count().get(),
  ]);
  console.log(`  関連 documents (officeName=="${name}"): ${byName.data().count}件`);
  console.log(`  関連 documents (officeId=="${id}"): ${byId.data().count}件`);
}

async function main() {
  console.log(`プロジェクト: ${projectId}`);
  console.log(`抽出条件: name.length <= ${maxLength}\n`);

  const snap = await db.collection('masters/offices/items').get();
  console.log(`masters/offices/items 全件: ${snap.size}\n`);

  // #507 review Critical #2: collision 判定で legitimate と汚染を区別
  const allMasters = snap.docs.map((doc) => ({
    id: doc.id,
    name: typeof doc.data().name === 'string' ? doc.data().name : '',
  }));

  const short = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    const name = typeof data.name === 'string' ? data.name : '';
    if (name.length === 0) {
      short.push({ id: doc.id, name, length: 0, data });
      continue;
    }
    if (name.length <= maxLength) {
      short.push({ id: doc.id, name, length: name.length, data });
    }
  }

  console.log(`=== name.length <= ${maxLength} のマスター: ${short.length}件 ===\n`);
  if (short.length === 0) {
    console.log('該当なし\n');
  } else {
    for (const entry of short) {
      console.log(`id=${entry.id}`);
      console.log(`  name="${entry.name}" (length=${entry.length})`);
      console.log(`  shortName="${entry.data.shortName || ''}"`);
      console.log(`  aliases=${JSON.stringify(entry.data.aliases || [])}`);
      console.log(`  isDuplicate=${entry.data.isDuplicate ?? false}`);
      console.log(`  notes="${entry.data.notes || ''}"`);
      await printRelatedDocumentCounts(entry.name, entry.id);
      console.log('');
    }
  }

  const commonShortIds = computeCommonShortMasters(allMasters);
  const collisionDetected = short.filter((s) => commonShortIds.has(s.id));

  // Issue #707: doc.id === name signature の独立チェック (name の文字数に依存しない)
  const idEqualsNameIds = computeIdEqualsNameMasters(allMasters);
  const masterById = new Map(snap.docs.map((doc) => [doc.id, doc.data()]));
  console.log(`=== doc.id === name パターン (Issue #707): ${idEqualsNameIds.size}件 ===\n`);
  if (idEqualsNameIds.size === 0) {
    console.log('該当なし\n');
  } else if (!failOnIdEqualsName) {
    // --fail-on-id-equals-name 未指定時 (scheduled audit の日次実行はこちら) は
    // legitimate なケース(サンプルマスター等)でも件数が出るため、関連 documents の
    // count クエリを伴う詳細表示は省略し、件数のみ記録する (code-reviewer指摘対応:
    // 無関係な運用コスト・ログノイズを削減)。詳細確認は
    // `--fail-on-id-equals-name` 付きで手動実行すること。
    console.log(`(詳細表示は --fail-on-id-equals-name 指定時のみ。件数のみ記録)\n`);
  } else {
    for (const id of idEqualsNameIds) {
      const data = masterById.get(id) || {};
      const name = typeof data.name === 'string' ? data.name : '';
      console.log(`id=${id}`);
      console.log(`  name="${name}" (length=${name.length})`);
      console.log(`  shortName="${data.shortName || ''}"`);
      console.log(`  isDuplicate=${data.isDuplicate ?? false}`);
      await printRelatedDocumentCounts(name, id);
      console.log('');
    }
  }

  console.log(`\n=== サマリー ===`);
  console.log(`プロジェクト: ${projectId}`);
  console.log(`全件: ${snap.size}`);
  console.log(`length <= ${maxLength}: ${short.length}件`);
  console.log(`うち common short master (collision 検出): ${collisionDetected.length}件`);
  if (collisionDetected.length > 0) {
    console.log('common short master id:');
    for (const c of collisionDetected) {
      console.log(`  - ${c.id} (name="${c.name}")`);
    }
  }
  console.log(`doc.id === name パターン: ${idEqualsNameIds.size}件`);
  if (idEqualsNameIds.size > 0) {
    console.log('id===name master id:');
    for (const id of idEqualsNameIds) {
      console.log(`  - ${id}`);
    }
  }
  return {
    detectedCount: short.length,
    collisionCount: collisionDetected.length,
    idEqualsNameCount: idEqualsNameIds.size,
  };
}

main()
  .then(({ detectedCount, collisionCount, idEqualsNameCount }) => {
    // #507 review: --fail-on-collision (新規) を優先評価 → legitimate 短マスターでは
    // exit 0、bug pattern (collision 検出) でのみ exit 1。scheduled audit からは
    // 本 flag を使うことで false-positive Issue を抑制する。
    if (failOnCollision && collisionCount > 0) {
      console.error(`\n[FAIL] --fail-on-collision: common short master ${collisionCount}件が検出されたため exit 1`);
      process.exit(1);
    }
    // #707: doc.id===name は legitimate なケース(サンプルデータ等)でも成立しうるため
    // scheduled audit の自動 fail 条件には使わない。本 flag は手動調査専用。
    if (failOnIdEqualsName && idEqualsNameCount > 0) {
      console.error(`\n[FAIL] --fail-on-id-equals-name: id===name パターン ${idEqualsNameCount}件が検出されたため exit 1`);
      process.exit(1);
    }
    if (failOnDetected && detectedCount > 0) {
      console.error(`\n[FAIL] --fail-on-detected: ${detectedCount}件の短マスターが検出されたため exit 1 (legitimate 含む)`);
      process.exit(1);
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error('エラー:', err);
    process.exit(1);
  });
