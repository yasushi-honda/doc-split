#!/usr/bin/env node
/**
 * 顧客マスター整合性チェックスクリプト(同姓同名リスク対応、2026-07-25)
 *
 * Drive連携(ADR-0022)のフォルダ名は`customerName`文字列のみで決まりcustomerIdを
 * 参照しないため、同姓同名の別人は同一フォルダに合流しうる。本スクリプトは
 * `masters/customers/items`と`documents`(verified==true)を読み取り専用で走査し、
 * Phase D(flag ON)着手前に潰しておくべき項目を可視化する。
 *
 * `check-master-data.js`のfirebase-adminパターン(初期化・環境変数)に準拠。
 * 書込みは一切行わない(--fixオプションなし)。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=docsplit-kanameone node scripts/check-customer-master-integrity.js
 */

const admin = require('firebase-admin');

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID を設定してください');
  process.exit(1);
}

admin.initializeApp({ projectId });
const db = admin.firestore();

const PAGE_SIZE = 500;

/** `functions/src/utils/similarity.ts`の`normalizeText()`と同一の正規化(空白・中黒等の除去)。 */
function normalizeName(text) {
  return (text || '')
    .replace(/[\s　]+/g, '')
    .replace(/[・．.]/g, '')
    .toLowerCase();
}

/** `check-master-data.js`が検出対象とする型崩れ(配列混入等)に対しても例外を投げず空文字扱いにする。 */
function asString(value) {
  return typeof value === 'string' ? value : '';
}

async function fetchAllCustomers() {
  const snap = await db.collection('masters/customers/items').get();
  const malformed = [];
  // customerAmbiguityGate.ts側は`customerMaster?.name ?? null`(name↔id乖離チェックの対象)を
  // 使うため、undefined/null(フィールド欠損)はnullとして区別して保持する(code-review指摘、
  // 2026-07-25: asString()でtrim済みnameだけを使うと欠損が空文字に潰れ、実際にはBEがスキップする
  // 判定を「乖離」と誤分類してしまう)。
  const idToRawName = new Map();
  const customers = snap.docs.map((d) => {
    const data = d.data();
    if (typeof data.name !== 'undefined' && typeof data.name !== 'string') malformed.push(`${d.id}.name`);
    if (typeof data.furigana !== 'undefined' && typeof data.furigana !== 'string') malformed.push(`${d.id}.furigana`);
    if (typeof data.careManagerName !== 'undefined' && typeof data.careManagerName !== 'string') {
      malformed.push(`${d.id}.careManagerName`);
    }
    idToRawName.set(d.id, typeof data.name === 'string' ? data.name : null);
    return {
      id: d.id,
      // customerAmbiguityGate.ts側はdoc.customerNameをtrimしてから照合するため、name側も
      // trimしておかないと衝突検出(グループ化)がBEのゲートと乖離しうる(code-review high
      // Finding 4、2026-07-25)。
      name: asString(data.name).trim(),
      furigana: asString(data.furigana).trim(),
      careManagerName: asString(data.careManagerName).trim(),
      isDuplicate: data.isDuplicate === true,
    };
  });
  return { customers, malformed, idToRawName };
}

/**
 * `documents`(verified==true)をページングで走査する。
 * `drive-export-status-report.ts`と同じPAGE_SIZE=500パターン。
 */
async function fetchVerifiedDocuments() {
  const docs = [];
  let lastDoc = null;
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
      const data = docSnap.data();
      docs.push({
        id: docSnap.id,
        customerName: data.customerName || '',
        customerId: data.customerId,
        customerConfirmed: data.customerConfirmed,
        needsManualCustomerSelection: data.needsManualCustomerSelection,
      });
    }
    lastDoc = snapshot.docs[snapshot.docs.length - 1];
    hasMore = snapshot.docs.length === PAGE_SIZE;
  }
  return docs;
}

/** `functions/src/drive/customerAmbiguityGate.ts`のCUSTOMER_INVALID_SENTINELSと同一値。 */
const CUSTOMER_INVALID_SENTINELS = new Set(['未判定', '不明顧客']);

/** `classifyCustomerConfirmation()`がdocを未確定と判定した理由(内訳集計・個別doc診断用)。 */
const UNCONFIRMED_REASON = {
  INVALID_NAME: '顧客名未設定/sentinel値',
  NAME_ID_MISMATCH: 'customerId↔name乖離',
  UNCONFIRMED_COLLISION: '同名衝突未確定',
};

/**
 * `functions/src/drive/customerAmbiguityGate.ts`の`isCustomerUnconfirmed()`と同一ロジック
 * (ADR-0022顧客未確定ゲート再設計、2026-07-25)。ゲートが実際にブロックするdocと、その理由を
 * 事前に特定する。
 *
 * 守備範囲は「同姓同名マスターの衝突」だけでなく、顧客名未設定/sentinel値・customerId↔name乖離の
 * 3系統(decision-maker確認済み、2026-07-25追記: 当初「同姓同名の衝突のみ」と要約していたが、
 * 実データ監査でcocoro(同名衝突0組)でも36件ブロックされることが判明し、要約が実態と乖離して
 * いたため訂正。ADR-0022・customerAmbiguityGate.tsのコメントも同様に訂正済み)。
 *
 * `collisionNames`はバケット[A]で既に計算済みの同名グループ集合(呼出元main()参照)。
 * `idToName`は`fetchAllCustomers()`が返す`idToRawName`(id→raw name、フィールド欠損/非文字列は
 * null、追加Firestore読み込みなし)。trim済みの`customers[].name`ではなくraw値を使う理由は
 * name↔id乖離チェック内のコメント参照(code-review指摘、2026-07-25)。
 * 曖昧性の判定に保存済み`isDuplicate`フラグを使わない理由は本ファイル冒頭のコメント参照。
 *
 * @returns 確定済みなら`{ unconfirmed: false, reason: null }`、未確定ならreasonに理由を格納
 */
function classifyCustomerConfirmation(doc, collisionNames, idToName) {
  const name = (doc.customerName || '').trim();
  if (!name || CUSTOMER_INVALID_SENTINELS.has(name)) {
    return { unconfirmed: true, reason: UNCONFIRMED_REASON.INVALID_NAME };
  }

  // customerIdが指すマスター名とdoc.customerNameが乖離(マスター改名の取り残し等)している場合、
  // customerAmbiguityGate.tsはhumanConfirmed判定より先にこれを検知しブロックする(exportDocument.ts
  // が既に読み込み済みのmaster docを再利用する追加検知)。本スクリプトはfetchAllCustomers()で
  // 全マスターのid/nameを既にメモリ上に保持しているため、追加読み込みなしで同じ判定を再現できる
  // (codex review指摘、2026-07-25: 従来はこのチェックを省略しており、乖離を持つdocが実際には
  // Phase Dでブロックされるにも関わらず監査結果で過小報告される穴があった)。
  // idToNameはid→raw name(フィールド欠損/非文字列はnull、customerAmbiguityGate.tsの
  // `customerMaster?.name ?? null`と同一のnull集合)。Map miss(id不明)のundefinedと
  // 欠損のnullを両方skip扱いにしないと、マスターdocのname未設定を「乖離」と誤分類する
  // (code-review指摘、2026-07-25)。
  if (doc.customerId) {
    const masterName = idToName.get(doc.customerId);
    if (masterName !== undefined && masterName !== null && masterName !== name) {
      return { unconfirmed: true, reason: UNCONFIRMED_REASON.NAME_ID_MISMATCH };
    }
  }

  const humanConfirmed = doc.customerConfirmed !== undefined
    ? doc.customerConfirmed
    : doc.needsManualCustomerSelection !== undefined
      ? !doc.needsManualCustomerSelection
      : false; // 両方未設定(レガシーdoc)は「未確定」として扱い、曖昧性チェックに委ねる(customerAmbiguityGate.tsと同一規約)
  if (humanConfirmed) return { unconfirmed: false, reason: null };

  if (collisionNames.has(name)) {
    return { unconfirmed: true, reason: UNCONFIRMED_REASON.UNCONFIRMED_COLLISION };
  }
  return { unconfirmed: false, reason: null };
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

async function main() {
  console.log(`プロジェクト: ${projectId}`);
  console.log('モード: read-only(書込みなし)');
  console.log('---\n');

  const { customers, malformed, idToRawName } = await fetchAllCustomers();
  console.log(`顧客マスター総数: ${customers.length}件`);
  if (malformed.length > 0) {
    console.log(
      `⚠️ 型崩れフィールド検出: ${malformed.length}件（空文字扱いで処理を継続、check-master-data.js --fixでの修正を推奨）`
    );
    for (const m of malformed.slice(0, 20)) console.log(`  - ${m}`);
    if (malformed.length > 20) console.log(`  …他${malformed.length - 20}件`);
  }
  console.log('');

  // (a) 完全一致の同姓同名グループ + (c) isDuplicateフラグ突合
  const exactGroups = [...groupBy(customers, (c) => c.name).entries()].filter(([, g]) => g.length > 1);
  console.log(`[A] 完全一致の同姓同名グループ: ${exactGroups.length}組`);
  for (const [name, group] of exactGroups) {
    const flagOk = group.every((c) => c.isDuplicate);
    console.log(`  「${name}」×${group.length} ${flagOk ? '(isDuplicateフラグ整合)' : '(⚠️フラグ不整合: 片側のみtrue)'}`);
    for (const c of group) {
      console.log(
        `    - ${c.id.slice(0, 12)}… isDuplicate=${c.isDuplicate} ケアマネ=${c.careManagerName || '(なし)'} フリガナ=${c.furigana || '(欠損)'}`
      );
    }
  }

  // (b) 表記ゆれ重複候補(正規化後は一致するが生文字列は異なる)
  const normGroups = [...groupBy(customers, (c) => normalizeName(c.name)).entries()].filter(
    ([, g]) => g.length > 1 && new Set(g.map((c) => c.name)).size > 1
  );
  console.log(`\n[B] 表記ゆれ重複候補(正規化後に一致・生文字列は相違): ${normGroups.length}組`);
  for (const [, group] of normGroups) {
    console.log(`  ${group.map((c) => `「${c.name}」`).join(' / ')}`);
  }

  // フリガナ欠損(furiganaFallback:'stop'でエクスポート停止する対象)
  const noFurigana = customers.filter((c) => !c.furigana);
  console.log(`\n[C] フリガナ欠損: ${noFurigana.length}件(furiganaFallback:'stop'でエクスポート停止する対象)`);
  for (const c of noFurigana.slice(0, 30)) {
    console.log(`  - 「${c.name}」`);
  }
  if (noFurigana.length > 30) console.log(`  …他${noFurigana.length - 30}件`);

  // (d) verified済み未確定doc数(ゲートと同一ロジック)
  const collisionNames = new Set(exactGroups.map(([name]) => name));
  const verifiedDocs = await fetchVerifiedDocuments();
  console.log(`\nverified済みdocument総数: ${verifiedDocs.length}件`);

  const classified = verifiedDocs.map((d) => ({ doc: d, ...classifyCustomerConfirmation(d, collisionNames, idToRawName) }));
  const unconfirmed = classified.filter((c) => c.unconfirmed);
  console.log(`[D] 顧客未確定(customerAmbiguityGate.tsのゲートと同一ロジック、Phase D以降ブロック対象): ${unconfirmed.length}件`);
  const reasonCounts = new Map();
  for (const c of unconfirmed) {
    reasonCounts.set(c.reason, (reasonCounts.get(c.reason) ?? 0) + 1);
  }
  const reasonSummary = Object.values(UNCONFIRMED_REASON)
    .map((reason) => `${reason}=${reasonCounts.get(reason) ?? 0}件`)
    .join(', ');
  console.log(`  内訳: ${reasonSummary}`);
  for (const c of unconfirmed.slice(0, 20)) {
    console.log(`  - ${c.doc.id.slice(0, 12)}… customerName=「${c.doc.customerName}」 理由=${c.reason}`);
  }
  if (unconfirmed.length > 20) console.log(`  …他${unconfirmed.length - 20}件`);

  // (e) customerId null/空のdoc数
  const noCustomerId = verifiedDocs.filter((d) => !d.customerId);
  console.log(
    `\n[E] customerId null/空: ${noCustomerId.length}件(furiganaFallback:'useNameInitial'テナントではフリガナ参照がスキップされ素通りしうる)`
  );

  console.log(`\n=== ${projectId} 検査完了(書き込みゼロ) ===`);
  process.exit(0);
}

main().catch((err) => {
  console.error('エラー:', err);
  process.exit(1);
});
