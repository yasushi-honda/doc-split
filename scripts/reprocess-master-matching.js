#!/usr/bin/env node
/**
 * マスター照合の再実行スクリプト
 * 既存のOCR結果を使って、マスター照合のみを再実行する
 */

const admin = require('firebase-admin');

// プロジェクトIDを引数から取得
const projectId = process.argv[2];
if (!projectId) {
  console.error('Usage: node reprocess-master-matching.js <project-id>');
  console.error('Example: node reprocess-master-matching.js docsplit-kanameone');
  process.exit(1);
}

// Firebase Admin初期化
process.env.GCLOUD_PROJECT = projectId;
process.env.GOOGLE_CLOUD_PROJECT = projectId;

admin.initializeApp({
  projectId: projectId,
});

const db = admin.firestore();

// extractors.tsのロジックを移植
function normalizeForMatching(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[－‐―ー−]/g, '-')
    .replace(/[（）()「」『』【】]/g, '')
    .normalize('NFKC');
}

function extractKeywordsForMatching(text) {
  const normalized = normalizeForMatching(text);
  const noiseWords = [
    '株式会社', '有限会社', '合同会社', '社会福祉法人', '医療法人',
    '一般社団法人', 'npo法人', 'ケアセンター', 'センター', 'サービス'
  ];
  let cleaned = normalized;
  for (const noise of noiseWords) {
    cleaned = cleaned.replace(new RegExp(noise, 'g'), '');
  }
  const keywords = [];

  // 地名パターン
  const locationPattern = /[一-龯ぁ-んァ-ヶ]+[市区町村]/g;
  const locations = cleaned.match(locationPattern) || [];
  keywords.push(...locations);

  // 施設タイプ
  const facilityTypes = ['ショートステイ', 'デイサービス', 'グループホーム', '特養', '老健', '訪問介護', '訪問看護', '居宅介護'];
  for (const type of facilityTypes) {
    if (cleaned.includes(type.toLowerCase())) {
      keywords.push(type.toLowerCase());
    }
  }

  // カタカナブランド名
  const katakanaPattern = /[ァ-ヶー]{3,}/g;
  const katakanas = cleaned.match(katakanaPattern) || [];
  keywords.push(...katakanas.map(k => k.toLowerCase()));

  // 漢字地名
  const kanjiPattern = /[一-龯]{2,}/g;
  const kanjis = cleaned.match(kanjiPattern) || [];
  keywords.push(...kanjis.filter(k => k.length >= 2 && k.length <= 6).map(k => k.toLowerCase()));

  return [...new Set(keywords)].filter(k => k.length >= 2);
}

function calculateKeywordMatchScore(ocrText, name) {
  const ocrKeywords = extractKeywordsForMatching(ocrText);
  const nameKeywords = extractKeywordsForMatching(name);

  if (nameKeywords.length === 0) return { score: 0, matchedLength: 0 };

  let matchedCount = 0;
  let matchedLength = 0;

  for (const nameKw of nameKeywords) {
    for (const ocrKw of ocrKeywords) {
      if (ocrKw.includes(nameKw) || nameKw.includes(ocrKw)) {
        matchedCount++;
        matchedLength += Math.min(ocrKw.length, nameKw.length);
        break;
      }
    }
  }

  const score = Math.round((matchedCount / nameKeywords.length) * 100);
  return { score, matchedLength };
}

function extractCustomerCandidates(ocrText, customerMasters) {
  if (!ocrText || !customerMasters?.length) return { bestMatch: null, candidates: [] };

  const normalizedOcr = normalizeForMatching(ocrText);
  const candidates = [];

  for (const customer of customerMasters) {
    const normalizedName = normalizeForMatching(customer.name);
    let score = 0;
    let matchType = 'none';

    // 完全一致
    if (normalizedOcr.includes(normalizedName)) {
      score = 100;
      matchType = 'exact';
    }

    // エイリアス
    if (matchType === 'none' && customer.aliases?.length) {
      for (const alias of customer.aliases) {
        const normalizedAlias = normalizeForMatching(alias);
        if (normalizedOcr.includes(normalizedAlias)) {
          score = 95;
          matchType = 'alias';
          break;
        }
      }
    }

    // 部分一致
    if (matchType === 'none') {
      const threshold = Math.floor(normalizedName.length * 0.75);
      if (threshold >= 2) {
        const prefix = normalizedName.substring(0, threshold);
        if (normalizedOcr.includes(prefix)) {
          score = 85;
          matchType = 'partial';
        }
      }
    }

    if (score > 0) {
      candidates.push({ ...customer, score, matchType });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return {
    bestMatch: candidates[0] || null,
    candidates: candidates.slice(0, 5),
  };
}

function extractOfficeCandidates(ocrText, officeMasters) {
  if (!ocrText || !officeMasters?.length) return { bestMatch: null, candidates: [] };

  const normalizedOcr = normalizeForMatching(ocrText);
  const candidates = [];

  for (const office of officeMasters) {
    const normalizedName = normalizeForMatching(office.name);
    let score = 0;
    let matchType = 'none';

    // 完全一致
    if (normalizedOcr.includes(normalizedName)) {
      score = 100;
      matchType = 'exact';
    }

    // エイリアス
    if (matchType === 'none' && office.aliases?.length) {
      for (const alias of office.aliases) {
        const normalizedAlias = normalizeForMatching(alias);
        if (normalizedOcr.includes(normalizedAlias)) {
          score = 95;
          matchType = 'alias';
          break;
        }
      }
    }

    // キーワードマッチング
    if (matchType === 'none') {
      const keywordResult = calculateKeywordMatchScore(ocrText, office.name);
      if (keywordResult.score >= 70) {
        const baseScore = 80 + Math.floor((keywordResult.score - 70) / 5);
        const lengthBonus = Math.min(10, Math.floor(keywordResult.matchedLength / 3));
        score = Math.min(95, baseScore + lengthBonus);
        matchType = 'keyword';
      }
    }

    // 部分一致（キーワードマッチングより低い優先度）
    if (matchType === 'none') {
      const threshold = Math.floor(normalizedName.length * 0.75);
      if (threshold >= 2) {
        const prefix = normalizedName.substring(0, threshold);
        if (normalizedOcr.includes(prefix)) {
          score = Math.min(80, 70 + Math.floor(normalizedName.length / 2));
          matchType = 'partial';
        }
      }
    }

    if (score > 0) {
      candidates.push({ ...office, score, matchType });
    }
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (b.name?.length || 0) - (a.name?.length || 0);
  });

  return {
    bestMatch: candidates[0] || null,
    candidates: candidates.slice(0, 5),
  };
}

function extractDocumentTypeCandidates(ocrText, documentTypeMasters) {
  if (!ocrText || !documentTypeMasters?.length) return { bestMatch: null, candidates: [] };

  const normalizedOcr = normalizeForMatching(ocrText);
  const candidates = [];

  for (const docType of documentTypeMasters) {
    const normalizedName = normalizeForMatching(docType.name);
    let score = 0;
    let matchType = 'none';

    if (normalizedOcr.includes(normalizedName)) {
      score = 100;
      matchType = 'exact';
    }

    if (matchType === 'none' && docType.aliases?.length) {
      for (const alias of docType.aliases) {
        const normalizedAlias = normalizeForMatching(alias);
        if (normalizedOcr.includes(normalizedAlias)) {
          score = 95;
          matchType = 'alias';
          break;
        }
      }
    }

    if (score > 0) {
      candidates.push({ ...docType, score, matchType });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return {
    bestMatch: candidates[0] || null,
    candidates: candidates.slice(0, 5),
  };
}

async function main() {
  console.log(`\n🔄 マスター照合の再実行を開始します (${projectId})\n`);

  // マスターデータ取得
  console.log('📚 マスターデータを取得中...');

  const [customersSnap, officesSnap, documentsSnap] = await Promise.all([
    db.collection('masters/customers/items').get(),
    db.collection('masters/offices/items').get(),
    db.collection('masters/documents/items').get(),
  ]);

  const customerMasters = customersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const officeMasters = officesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const documentTypeMasters = documentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  console.log(`  顧客: ${customerMasters.length}件`);
  console.log(`  事業所: ${officeMasters.length}件`);
  console.log(`  書類種別: ${documentTypeMasters.length}件`);

  // 書類取得
  console.log('\n📄 書類を取得中...');
  const docsSnap = await db.collection('documents').get();
  console.log(`  書類: ${docsSnap.size}件\n`);

  let updated = 0;
  let skipped = 0;
  let changed = 0;

  for (const docSnap of docsSnap.docs) {
    const doc = docSnap.data();
    const docId = docSnap.id;

    // OCR結果がない場合はスキップ
    if (!doc.ocrResult) {
      console.log(`⏭️  ${docId}: OCR結果なし - スキップ`);
      skipped++;
      continue;
    }

    const ocrText = doc.ocrResult;

    // マスター照合を再実行
    const customerResult = extractCustomerCandidates(ocrText, customerMasters);
    const officeResult = extractOfficeCandidates(ocrText, officeMasters);
    const docTypeResult = extractDocumentTypeCandidates(ocrText, documentTypeMasters);

    // 変更があるか確認
    const newCustomerName = customerResult.bestMatch?.name || '不明顧客';
    const newOfficeName = officeResult.bestMatch?.name || null;
    const newDocumentType = docTypeResult.bestMatch?.name || '未判定';

    const changes = [];
    if (doc.customerName !== newCustomerName) {
      changes.push(`顧客: "${doc.customerName}" → "${newCustomerName}"`);
    }
    if (doc.officeName !== newOfficeName) {
      changes.push(`事業所: "${doc.officeName}" → "${newOfficeName}"`);
    }
    if (doc.documentType !== newDocumentType) {
      changes.push(`書類種別: "${doc.documentType}" → "${newDocumentType}"`);
    }

    // 更新データ
    const updateData = {
      customerName: newCustomerName,
      customerId: customerResult.bestMatch?.id || null,
      customerCandidates: customerResult.candidates.map(c => ({
        id: c.id,
        name: c.name,
        score: c.score,
        matchType: c.matchType,
      })),
      officeName: newOfficeName,
      officeId: officeResult.bestMatch?.id || null,
      officeCandidates: officeResult.candidates.map(c => ({
        id: c.id,
        name: c.name,
        score: c.score,
        matchType: c.matchType,
      })),
      documentType: newDocumentType,
      documentTypeId: docTypeResult.bestMatch?.id || null,
      documentTypeCandidates: docTypeResult.candidates.map(c => ({
        id: c.id,
        name: c.name,
        score: c.score,
        matchType: c.matchType,
      })),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await docSnap.ref.update(updateData);
    updated++;

    if (changes.length > 0) {
      changed++;
      console.log(`✏️  ${docId}: 変更あり`);
      changes.forEach(c => console.log(`    ${c}`));
    } else {
      console.log(`✅ ${docId}: 変更なし`);
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`📊 完了サマリー`);
  console.log(`${'='.repeat(50)}`);
  console.log(`  処理件数: ${updated}件`);
  console.log(`  変更あり: ${changed}件`);
  console.log(`  スキップ: ${skipped}件`);
  console.log(`${'='.repeat(50)}\n`);

  process.exit(0);
}

main().catch(err => {
  console.error('エラー:', err);
  process.exit(1);
});
