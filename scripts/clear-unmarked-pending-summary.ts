#!/usr/bin/env ts-node
/**
 * 手動依頼の印のない`summaryState:'pending'`を「要約なし」へ戻す(要約の手動・非同期化 PR-C、展開手順0)。
 *
 * 背景・方針は`scripts/lib/clearUnmarkedPendingSummary.ts`を参照。デプロイ前に実行して、
 * 過去の自動生成・canary由来のpendingが画面に「作成待ち」のまま残らないようにする。
 *
 * 使用方法(FIREBASE_PROJECT_IDは必須、dev/kanameone/cocoroのみ):
 *   (引数なし)    dry-run: 対象の件数とdoc_idを表示するだけ(書込みなし)
 *   --execute     実書込み(対象を1件ずつトランザクションで再確認して、状態系フィールドを削除)
 *
 * 安全策:
 *   - 対象はpendingかつ印なしのみ。書込みトランザクション内で再確認し、その間に手動依頼された(印が付いた)
 *     文書・処理中に移った文書は書き換えない(スキップ件数として報告)。
 *   - 件数が上限(MAX_CLEAR_COUNT=500)を超える場合は1件も書かずに中断する。
 *   - 既存の要約本文(summary)・summaryProviderは触らない。取得するのは状態フィールドのみ(fieldMask)。
 * 復旧: 状態フィールドの削除のみ。要約本文は残るため、必要なら手動で再依頼すれば再生成できる。
 */
import * as admin from 'firebase-admin';
import {
  CLEAR_FIELDS,
  checkClearCount,
  isUnmarkedPending,
  selectUnmarkedPendingIds,
  type PendingSnapshot,
} from './lib/clearUnmarkedPendingSummary';

const ALLOWED_PROJECT_IDS = ['doc-split-dev', 'docsplit-kanameone', 'docsplit-cocoro'];
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || '';
if (!ALLOWED_PROJECT_IDS.includes(PROJECT_ID)) {
  console.error(`❌ FIREBASE_PROJECT_ID は ${ALLOWED_PROJECT_IDS.join('/')} のいずれかを指定してください (指定: ${PROJECT_ID})`);
  process.exit(1);
}

const execute = process.argv.includes('--execute');

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

async function main(): Promise<void> {
  console.log(`対象プロジェクト: ${PROJECT_ID} (${execute ? '実書込み' : 'dry-run'})`);

  // summaryState==pending は単一フィールドの等価クエリ(複合インデックス不要)。印の有無はメモリで判定する。
  const snap = await db
    .collection('documents')
    .where('summaryState', '==', 'pending')
    .select('summaryState', 'summaryManualRequestedAt')
    .get();
  const snapshots: PendingSnapshot[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
  const ids = selectUnmarkedPendingIds(snapshots);

  console.log(`pending総数: ${snapshots.length}件 / 印なし(消去対象): ${ids.length}件 / 手動依頼あり(対象外): ${snapshots.length - ids.length}件`);
  const check = checkClearCount(ids.length);
  if (!check.ok) {
    console.error(`❌ ${check.reason}`);
    process.exit(1);
  }
  if (ids.length > 0) console.log(`消去対象のdoc_id: ${ids.join(', ')}`);

  if (!execute) {
    console.log('dry-runのため書込みはしません。--execute で実行します。');
    return;
  }

  let cleared = 0;
  let skipped = 0;
  for (const id of ids) {
    const ref = db.doc(`documents/${id}`);
    const done = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(ref);
      if (!fresh.exists || !isUnmarkedPending({ id, ...(fresh.data() as Record<string, unknown>) })) return false;
      const update: Record<string, FirebaseFirestore.FieldValue> = {};
      for (const field of CLEAR_FIELDS) update[field] = admin.firestore.FieldValue.delete();
      tx.update(ref, update);
      return true;
    });
    if (done) cleared++;
    else skipped++;
  }
  console.log(`✅ 消去: ${cleared}件 / スキップ(実行中に状態が変わった): ${skipped}件`);
}

main().catch((err) => {
  console.error('❌ 失敗:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
