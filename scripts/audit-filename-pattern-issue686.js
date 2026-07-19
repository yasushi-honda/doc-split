#!/usr/bin/env node
/**
 * Issue #686 影響範囲調査スクリプト（read-only）
 *
 * PR #689 で修正した extractFilenameInfo() のバグ（旧正規表現 /^(.+?)-L\d+-/ が
 * 非fax由来ファイル名の偶然一致で prefix を誤って切り詰め、tokenizer.ts の検索
 * インデックスから内容が脱落する）について、実データへの影響件数を確認する。
 *
 * documents コレクションの fileName を全件スキャンし、旧正規表現にマッチするが
 * 修正後の新正規表現 /^(.+?)-L\d+-(\d{14})$/ にマッチしないもの
 * （= バグの影響を受けていた実データ）を一覧表示する。書き込みは一切行わない。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=<project-id> node scripts/audit-filename-pattern-issue686.js
 */

const admin = require('firebase-admin');

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID を設定してください');
  process.exit(1);
}

admin.initializeApp({ projectId });
const db = admin.firestore();

const OLD_RE = /^(.+?)-L\d+-/;
const NEW_RE = /^(.+?)-L\d+-(\d{14})$/;

async function main() {
  console.log(`[${projectId}] documents コレクションをスキャン中...`);
  const snapshot = await db.collection('documents').select('fileName').get();
  console.log(`[${projectId}] 総件数: ${snapshot.size}`);

  const affected = [];
  snapshot.forEach((doc) => {
    const fileName = doc.get('fileName');
    if (typeof fileName !== 'string' || !fileName) return;
    const baseName = fileName.replace(/\.[^.]+$/, '');
    if (OLD_RE.test(baseName) && !NEW_RE.test(baseName)) {
      affected.push({ id: doc.id, fileName });
    }
  });

  console.log(`[${projectId}] バグ影響対象件数: ${affected.length}`);
  affected.forEach((a) => console.log(`  - ${a.id}: ${a.fileName}`));

  process.exit(0);
}

main().catch((err) => {
  console.error(`[${projectId}] エラー:`, err);
  process.exit(1);
});
