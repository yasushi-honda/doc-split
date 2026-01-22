#!/usr/bin/env node
/**
 * マスターデータインポートスクリプト（サポート用）
 *
 * 使用方法:
 *   node import-masters.js --customers customers.csv
 *   node import-masters.js --documents documents.csv
 *   node import-masters.js --offices offices.csv
 *   node import-masters.js --caremanagers caremanagers.csv
 *   node import-masters.js --all ./data/
 *
 * 環境変数:
 *   GCLOUD_PROJECT または FIREBASE_PROJECT_ID: プロジェクトID（デフォルト: doc-split-dev）
 *
 * 事前準備:
 *   gcloud auth application-default login
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// プロジェクトID取得（環境変数 > デフォルト）
const projectId = process.env.GCLOUD_PROJECT
  || process.env.FIREBASE_PROJECT_ID
  || process.env.CLOUDSDK_CORE_PROJECT
  || 'doc-split-dev';

// Firebase初期化（ADC使用）
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: projectId,
  });
  console.log(`Firebase初期化: プロジェクト=${projectId}`);
}

const db = admin.firestore();

// CSV解析（シンプル版）
function parseCSV(content) {
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',').map((h) => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map((v) => v.trim());
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    rows.push(row);
  }

  return rows;
}

// 顧客マスターをインポート
async function importCustomers(filePath) {
  console.log(`顧客マスターをインポート: ${filePath}`);

  const content = fs.readFileSync(filePath, 'utf8');
  const rows = parseCSV(content);

  // 同姓同名を自動検知：名前の出現回数をカウント
  const nameCounts = {};
  for (const row of rows) {
    const name = row['name'] || row['顧客氏名'] || '';
    if (name) {
      nameCounts[name] = (nameCounts[name] || 0) + 1;
    }
  }

  // 同姓同名の名前リスト
  const duplicateNames = Object.keys(nameCounts).filter((name) => nameCounts[name] > 1);
  if (duplicateNames.length > 0) {
    console.log(`  同姓同名を検知: ${duplicateNames.join(', ')}`);
  }

  const batch = db.batch();
  let count = 0;

  for (const row of rows) {
    // 期待するカラム: name, furigana, careManagerName, notes
    const name = row['name'] || row['顧客氏名'] || '';
    const docRef = db.collection('masters/customers/items').doc();
    const data = {
      id: docRef.id,
      name,
      furigana: row['furigana'] || row['フリガナ'] || '',
      // 同姓同名フラグは自動検知（手動入力は後方互換性のため残す）
      isDuplicate: duplicateNames.includes(name) || row['isDuplicate'] === 'true' || row['同姓同名'] === 'true',
    };
    // 担当ケアマネがある場合のみ追加
    const careManagerName = row['careManagerName'] || row['担当ケアマネ'] || row['担当CM'] || '';
    if (careManagerName) {
      data.careManagerName = careManagerName;
    }
    // 備考がある場合のみ追加
    const notes = row['notes'] || row['備考'] || '';
    if (notes) {
      data.notes = notes;
    }
    batch.set(docRef, data);
    count++;
  }

  await batch.commit();
  console.log(`  ✓ ${count}件の顧客をインポートしました`);
}

// キーワード文字列を配列に変換（セミコロン区切り、2文字未満除外）
function parseKeywords(keywordsStr) {
  if (!keywordsStr) return [];
  return keywordsStr
    .split(';')
    .map((k) => k.trim())
    .filter((k) => k.length >= 2);
}

// 書類マスターをインポート
async function importDocuments(filePath) {
  console.log(`書類マスターをインポート: ${filePath}`);

  const content = fs.readFileSync(filePath, 'utf8');
  const rows = parseCSV(content);

  const batch = db.batch();
  let count = 0;

  for (const row of rows) {
    // 期待するカラム: name, dateMarker, category, keywords
    const name = row['name'] || row['書類名'] || '';
    const docRef = db.collection('masters/documents/items').doc(name);
    const keywords = parseKeywords(row['keywords'] || row['キーワード'] || '');
    batch.set(docRef, {
      name,
      dateMarker: row['dateMarker'] || row['日付位置'] || '',
      category: row['category'] || row['カテゴリー'] || '',
      keywords,
    });
    count++;
  }

  await batch.commit();
  console.log(`  ✓ ${count}件の書類をインポートしました`);
}

// 事業所マスターをインポート
async function importOffices(filePath) {
  console.log(`事業所マスターをインポート: ${filePath}`);

  const content = fs.readFileSync(filePath, 'utf8');
  const rows = parseCSV(content);

  const batch = db.batch();
  let count = 0;

  for (const row of rows) {
    // 期待するカラム: name, shortName (optional)
    const name = row['name'] || row['事業所名'] || '';
    const docRef = db.collection('masters/offices/items').doc(name);
    const data = { name };
    // 短縮名がある場合のみ追加
    const shortName = row['shortName'] || row['短縮名'] || '';
    if (shortName) {
      data.shortName = shortName;
    }
    batch.set(docRef, data);
    count++;
  }

  await batch.commit();
  console.log(`  ✓ ${count}件の事業所をインポートしました`);
}

// ケアマネージャーマスターをインポート
async function importCareManagers(filePath) {
  console.log(`ケアマネージャーマスターをインポート: ${filePath}`);

  const content = fs.readFileSync(filePath, 'utf8');
  const rows = parseCSV(content);

  const batch = db.batch();
  let count = 0;

  for (const row of rows) {
    // 期待するカラム: name, office, phone, email, notes
    const name = row['name'] || row['ケアマネ名'] || '';
    const docRef = db.collection('masters/caremanagers/items').doc(name);
    batch.set(docRef, {
      name,
      office: row['office'] || row['事業所'] || '',
      phone: row['phone'] || row['電話番号'] || '',
      email: row['email'] || row['メール'] || '',
      notes: row['notes'] || row['備考'] || '',
    });
    count++;
  }

  await batch.commit();
  console.log(`  ✓ ${count}件のケアマネージャーをインポートしました`);
}

// メイン処理
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log('使用方法:');
    console.log('  node import-masters.js --customers customers.csv');
    console.log('  node import-masters.js --documents documents.csv');
    console.log('  node import-masters.js --offices offices.csv');
    console.log('  node import-masters.js --caremanagers caremanagers.csv');
    console.log('  node import-masters.js --all ./data/');
    process.exit(1);
  }

  const option = args[0];
  const pathArg = args[1];

  try {
    if (option === '--customers') {
      await importCustomers(pathArg);
    } else if (option === '--documents') {
      await importDocuments(pathArg);
    } else if (option === '--offices') {
      await importOffices(pathArg);
    } else if (option === '--caremanagers') {
      await importCareManagers(pathArg);
    } else if (option === '--all') {
      // ディレクトリ内のCSVを全てインポート
      const dir = pathArg;
      const files = fs.readdirSync(dir);

      for (const file of files) {
        const filePath = path.join(dir, file);
        if (file.includes('customer')) {
          await importCustomers(filePath);
        } else if (file.includes('document')) {
          await importDocuments(filePath);
        } else if (file.includes('office')) {
          await importOffices(filePath);
        } else if (file.includes('caremanager')) {
          await importCareManagers(filePath);
        }
      }
    } else {
      console.log(`不明なオプション: ${option}`);
      process.exit(1);
    }

    console.log('\nインポート完了！');
    process.exit(0);
  } catch (error) {
    console.error('エラー:', error.message);
    process.exit(1);
  }
}

main();
