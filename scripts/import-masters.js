#!/usr/bin/env node
/**
 * マスターデータインポートスクリプト（サポート用）
 *
 * 使用方法:
 *   node import-masters.js --customers customers.csv
 *   node import-masters.js --documents documents.csv
 *   node import-masters.js --offices offices.csv
 *   node import-masters.js --all ./data/
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Firebase初期化
if (!admin.apps.length) {
  admin.initializeApp();
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

  const batch = db.batch();
  let count = 0;

  for (const row of rows) {
    // 期待するカラム: name, furigana, isDuplicate
    const docRef = db.collection('masters/customers/items').doc();
    batch.set(docRef, {
      id: docRef.id,
      name: row['name'] || row['顧客氏名'] || '',
      furigana: row['furigana'] || row['フリガナ'] || '',
      isDuplicate: row['isDuplicate'] === 'true' || row['同姓同名'] === 'true',
    });
    count++;
  }

  await batch.commit();
  console.log(`  ✓ ${count}件の顧客をインポートしました`);
}

// 書類マスターをインポート
async function importDocuments(filePath) {
  console.log(`書類マスターをインポート: ${filePath}`);

  const content = fs.readFileSync(filePath, 'utf8');
  const rows = parseCSV(content);

  const batch = db.batch();
  let count = 0;

  for (const row of rows) {
    // 期待するカラム: name, dateMarker, category
    const name = row['name'] || row['書類名'] || '';
    const docRef = db.collection('masters/documents/items').doc(name);
    batch.set(docRef, {
      name,
      dateMarker: row['dateMarker'] || row['日付位置'] || '',
      category: row['category'] || row['カテゴリー'] || '',
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
    // 期待するカラム: name
    const name = row['name'] || row['事業所名'] || '';
    const docRef = db.collection('masters/offices/items').doc(name);
    batch.set(docRef, {
      name,
    });
    count++;
  }

  await batch.commit();
  console.log(`  ✓ ${count}件の事業所をインポートしました`);
}

// メイン処理
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log('使用方法:');
    console.log('  node import-masters.js --customers customers.csv');
    console.log('  node import-masters.js --documents documents.csv');
    console.log('  node import-masters.js --offices offices.csv');
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
