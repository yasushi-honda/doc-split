#!/usr/bin/env ts-node
/**
 * compare-gemini-ocr-models-confirmed.ts のサンプリング条件(#548 confirmed replay方式)が
 * kanameone pilot実行(N=30)で0件だった原因を診断するための集計専用スクリプト。
 *
 * read-only厳守: Firestoreへの書込は一切行わない。count()集計クエリのみを使い、
 * 個人情報を含むフィールド(customerName/officeName/fileName等)は取得しない
 * (フォールバック集計でも .select('confirmedBy', 'officeConfirmedBy') で限定)。
 * 出力するのは各条件段階での件数のみ。
 */
import * as admin from 'firebase-admin';

const ALLOWED_PROJECT_IDS = ['docsplit-kanameone', 'docsplit-cocoro'];
const PROJECT_ID =
  process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || '';

if (!ALLOWED_PROJECT_IDS.includes(PROJECT_ID)) {
  console.error(
    `❌ このスクリプトは ${ALLOWED_PROJECT_IDS.join('/')} 専用です (指定されたプロジェクト: ${PROJECT_ID})。`
  );
  process.exit(1);
}

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

async function count(query: FirebaseFirestore.Query): Promise<number> {
  const snap = await query.count().get();
  return snap.data().count;
}

async function main(): Promise<void> {
  const col = db.collection('documents');
  console.log(`=== confirmed replay サンプリング条件診断 (${PROJECT_ID}) ===`);
  console.log('個人情報は一切出力しません。各条件段階の件数のみを出力します。\n');

  const totalDocs = await count(col);
  console.log(`全文書数: ${totalDocs}`);

  // kanameone本番デプロイ前のベースライン取得用(status別内訳)。デプロイ後の異常検知の
  // 比較対象として使う(処理中/エラー件数が急増していないか等)。
  console.log('\n--- status別内訳(デプロイ前ベースライン) ---');
  for (const s of ['pending', 'processing', 'processed', 'error']) {
    const c = await count(col.where('status', '==', s));
    console.log(`status=${s}: ${c}`);
  }
  console.log('');

  const processed = await count(col.where('status', '==', 'processed'));
  console.log(`status=processed: ${processed}`);

  const customerConfirmed = await count(
    col.where('status', '==', 'processed').where('customerConfirmed', '==', true)
  );
  console.log(`+ customerConfirmed=true (単独): ${customerConfirmed}`);

  const officeConfirmed = await count(col.where('status', '==', 'processed').where('officeConfirmed', '==', true));
  console.log(`+ officeConfirmed=true (単独): ${officeConfirmed}`);

  const documentTypeConfirmed = await count(
    col.where('status', '==', 'processed').where('documentTypeConfirmed', '==', true)
  );
  console.log(`+ documentTypeConfirmed=true (単独): ${documentTypeConfirmed}`);

  const allThreeQuery = col
    .where('status', '==', 'processed')
    .where('customerConfirmed', '==', true)
    .where('officeConfirmed', '==', true)
    .where('documentTypeConfirmed', '==', true);
  const allThree = await count(allThreeQuery);
  console.log(`3条件AND (customer/office/documentType全てtrue): ${allThree}`);

  if (allThree > 0) {
    // Firestoreのcount()集計クエリは != null 条件を直接サポートしないため、
    // 3条件AND該当文書のみ取得し手元でconfirmedBy/officeConfirmedByの非null判定を行う。
    // select()で対象2フィールドのみ取得しPII含有フィールドには一切触れない。
    const snap = await allThreeQuery.select('confirmedBy', 'officeConfirmedBy').get();
    const humanConfirmed = snap.docs.filter((d) => {
      const data = d.data();
      return data.confirmedBy != null && data.officeConfirmedBy != null;
    }).length;
    console.log(`  うちconfirmedBy/officeConfirmedBy両方非null: ${humanConfirmed}`);
  } else {
    console.log('  (3条件ANDが0件のため、confirmedBy/officeConfirmedByの内訳確認は省略)');
  }

  // kanameoneデプロイ後のcanary検証用: confirmedFieldProtection(再OCR時の確定フィールド保護)を
  // 実データで確認するため、customerConfirmed/officeConfirmed両方trueの処理済み文書を1件選ぶ。
  // ドキュメントIDのみを出力し、氏名等のPIIは一切取得・出力しない。
  const canarySnap = await col
    .where('status', '==', 'processed')
    .where('customerConfirmed', '==', true)
    .where('officeConfirmed', '==', true)
    .orderBy('__name__')
    .limit(1)
    .select()
    .get();
  console.log('\n--- canary検証用ドキュメントID(confirmed済み1件、PII非出力) ---');
  if (canarySnap.empty) {
    console.log('該当文書なし');
  } else {
    console.log(`CANARY_DOC_ID=${canarySnap.docs[0].id}`);
  }

  console.log('\n=== 診断完了 ===');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ エラー:', err instanceof Error ? err.constructor.name : typeof err);
    process.exit(1);
  });
