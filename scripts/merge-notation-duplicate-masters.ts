#!/usr/bin/env ts-node
/**
 * 表記ゆれ重複マスター統合スクリプト(2026-07-27)
 *
 * `check-customer-master-integrity.js`の[B]表記ゆれ重複候補(正規化後は一致するが生文字列は
 * 相違、姓名間スペースの有無等)を、1件のマスターへ統合する。明示的な`isDuplicate`フラグが
 * 立たない=同姓同名の別人ではないという判断(decision-maker確認済み、2026-07-27)による。
 *
 * ポリシー: 紐づく書類数が多い方を正式表記(canonical)として残し、書類の付け替え件数を
 * 最小化する。敗者側の生名は、既存の「許容表記」機構(`CustomerMaster.aliases`)へ追加する
 * (新規の仕組みは導入しない)。furigana/careManagerNameはcanonical側が欠損している場合のみ
 * 敗者から補完する(上書きしない)。
 *
 * 判定ロジックは`scripts/lib/notationDuplicateMerge.ts`の純粋関数を使用。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=docsplit-kanameone npx ts-node scripts/merge-notation-duplicate-masters.ts               # dry-run(既定)
 *   FIREBASE_PROJECT_ID=docsplit-kanameone npx ts-node scripts/merge-notation-duplicate-masters.ts --execute      # 実行
 */

import * as admin from 'firebase-admin';
import {
  CustomerRecord,
  groupNotationDuplicates,
  pickCanonical,
  buildMergedMasterUpdate,
  buildDocumentRepointPayload,
} from './lib/notationDuplicateMerge';

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID を設定してください');
  process.exit(1);
}

const execute = process.argv.includes('--execute');

admin.initializeApp({ projectId });
const db = admin.firestore();

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

async function fetchAllCustomers(): Promise<CustomerRecord[]> {
  const snap = await db.collection('masters/customers/items').get();
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      name: asString(data.name).trim(),
      furigana: asString(data.furigana).trim(),
      careManagerName: asString(data.careManagerName).trim(),
      aliases: Array.isArray(data.aliases) ? data.aliases.filter((a: unknown) => typeof a === 'string') : [],
      isDuplicate: data.isDuplicate === true,
    };
  });
}

async function countDocumentsByCustomerId(customerId: string): Promise<number> {
  const snap = await db.collection('documents').where('customerId', '==', customerId).count().get();
  return snap.data().count;
}

async function main(): Promise<void> {
  console.log(`プロジェクト: ${projectId}`);
  console.log(`モード: ${execute ? '実行(書込みあり)' : 'dry-run(書込みゼロ)'}`);
  console.log('---\n');

  const customers = await fetchAllCustomers();
  const groups = groupNotationDuplicates(customers);
  console.log(`[B] 表記ゆれ重複候補: ${groups.length}組\n`);

  if (groups.length === 0) {
    console.log('対象なし。終了します。');
    process.exit(0);
  }

  let totalDocsRepointed = 0;

  for (const group of groups) {
    const counts = new Map<string, number>();
    for (const member of group.members) {
      counts.set(member.id, await countDocumentsByCustomerId(member.id));
    }

    const choice = pickCanonical(group, counts);
    const update = buildMergedMasterUpdate(choice);

    console.log(`グループ: ${group.members.map((m) => `「${m.name}」(${counts.get(m.id)}件)`).join(' / ')}`);
    console.log(`  → canonical: 「${choice.canonical.name}」(id=${choice.canonical.id.slice(0, 12)}…)`);
    for (const loser of choice.losers) {
      const loserCount = counts.get(loser.id) ?? 0;
      console.log(`  → 敗者: 「${loser.name}」(id=${loser.id.slice(0, 12)}…, 書類${loserCount}件を付け替え)`);
      totalDocsRepointed += loserCount;
    }
    if (update.aliasesToAdd.length > 0) {
      console.log(`  → aliases追加: ${update.aliasesToAdd.map((a) => `「${a}」`).join(', ')}`);
    }
    if (update.furigana) console.log(`  → furigana補完: 「${update.furigana}」`);
    if (update.careManagerName) console.log(`  → careManagerName補完: 「${update.careManagerName}」`);

    if (execute) {
      for (const loser of choice.losers) {
        const docsSnap = await db.collection('documents').where('customerId', '==', loser.id).get();
        const payload = buildDocumentRepointPayload(choice.canonical);
        for (const docSnap of docsSnap.docs) {
          await docSnap.ref.update(payload);
        }
        console.log(`  ✔ 書類${docsSnap.size}件を付け替え済み`);
      }

      const masterUpdate: Record<string, unknown> = {};
      if (update.aliasesToAdd.length > 0) {
        masterUpdate.aliases = admin.firestore.FieldValue.arrayUnion(...update.aliasesToAdd);
      }
      if (update.furigana) masterUpdate.furigana = update.furigana;
      if (update.careManagerName) masterUpdate.careManagerName = update.careManagerName;
      if (Object.keys(masterUpdate).length > 0) {
        await db.doc(`masters/customers/items/${choice.canonical.id}`).update(masterUpdate);
        console.log('  ✔ canonicalマスターを更新済み');
      }

      for (const loser of choice.losers) {
        await db.doc(`masters/customers/items/${loser.id}`).delete();
        console.log(`  ✔ 敗者マスター(${loser.id.slice(0, 12)}…)を削除済み`);
      }
    }
    console.log('');
  }

  console.log(`合計: ${groups.length}組、書類${totalDocsRepointed}件${execute ? 'を付け替え' : 'が付け替え対象'}`);
  console.log(`\n=== ${projectId} ${execute ? '実行完了' : 'dry-run完了(書き込みゼロ)'} ===`);
  process.exit(0);
}

main().catch((err) => {
  console.error('エラー:', err);
  process.exit(1);
});
