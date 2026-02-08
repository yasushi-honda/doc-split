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
 *   node import-masters.js --dry-run --all ./data/    # 解析+バリデーションのみ
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
// FIREBASE_PROJECT_IDを最優先（.envrcのGCLOUD_PROJECTより優先させるため）
const projectId = process.env.FIREBASE_PROJECT_ID
  || process.env.GCLOUD_PROJECT
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

// BOM除去
function removeBOM(content) {
  if (content.charCodeAt(0) === 0xFEFF) {
    return content.slice(1);
  }
  // UTF-8 BOM as decoded string
  if (content.startsWith('\xEF\xBB\xBF')) {
    return content.slice(3);
  }
  return content;
}

// RFC 4180準拠のCSV行パーサー（クォートフィールド対応）
function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          // エスケープされたダブルクォート
          current += '"';
          i += 2;
        } else {
          // クォート終了
          inQuotes = false;
          i++;
        }
      } else {
        current += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ',') {
        fields.push(current.trim());
        current = '';
        i++;
      } else {
        current += ch;
        i++;
      }
    }
  }
  if (inQuotes) {
    return null; // クォート未閉じ
  }
  fields.push(current.trim());
  return fields;
}

// CSV解析（RFC 4180準拠）
function parseCSV(content, filePath) {
  content = removeBOM(content);
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  // 空行をフィルタ（ヘッダー行は保持）
  if (lines.length === 0) {
    console.error(`ERROR: CSVファイルが空です: ${filePath || '(unknown)'}`);
    process.exit(1);
  }

  const headers = parseCSVLine(lines[0]);
  const rows = [];
  const warnings = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue; // 空行スキップ

    const values = parseCSVLine(lines[i]);

    if (values === null) {
      warnings.push(`  警告: 行${i + 1} クォートが閉じられていません → スキップ`);
      continue;
    }

    if (values.length !== headers.length) {
      warnings.push(`  警告: 行${i + 1} カラム数不一致（期待${headers.length}, 実際${values.length}）→ スキップ`);
      continue;
    }

    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    rows.push(row);
  }

  if (warnings.length > 0) {
    warnings.forEach((w) => console.warn(w));
  }

  return rows;
}

// バリデーション: 必須フィールドの空チェック
function validateRows(rows, requiredFields, filePath) {
  const errors = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    for (const fieldGroup of requiredFields) {
      // fieldGroupは候補の配列（例: ['name', '顧客氏名']）
      const value = fieldGroup.map((f) => row[f]).find((v) => v);
      if (!value) {
        errors.push(`  行${i + 2}: 必須フィールド（${fieldGroup.join(' / ')}）が空です`);
      }
    }
  }
  if (errors.length > 0) {
    console.error(`バリデーションエラー (${filePath}):`);
    errors.forEach((e) => console.error(e));
    process.exit(1);
  }
}

/**
 * 重複する名前を検出
 * @param {Array<Object>} rows - CSVパース結果
 * @param {string[]} nameFields - 名前フィールドの候補（優先順）
 * @returns {string[]} 重複している名前のリスト
 */
function detectDuplicateNames(rows, nameFields) {
  const nameCounts = {};
  for (const row of rows) {
    const name = nameFields.map((f) => row[f]).find((v) => v) || '';
    if (name) {
      nameCounts[name] = (nameCounts[name] || 0) + 1;
    }
  }
  return Object.keys(nameCounts).filter((name) => nameCounts[name] > 1);
}

// 顧客マスターをインポート
async function importCustomers(filePath, dryRun) {
  console.log(`顧客マスター${dryRun ? '（検証のみ）' : 'をインポート'}: ${filePath}`);

  const content = fs.readFileSync(filePath, 'utf8');
  const rows = parseCSV(content, filePath);
  validateRows(rows, [['name', '顧客氏名']], filePath);

  // 同姓同名を自動検知
  const duplicateNames = detectDuplicateNames(rows, ['name', '顧客氏名']);
  if (duplicateNames.length > 0) {
    console.log(`  同姓同名を検知: ${duplicateNames.join(', ')}`);
  }

  console.log(`  ✓ ${rows.length}件の顧客を解析しました`);
  if (dryRun) return;

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
      // 同姓同名フラグはシステムが自動検知（CSV入力は不要）
      isDuplicate: duplicateNames.includes(name),
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
    // エイリアスがある場合のみ追加
    const aliases = parseAliases(row['aliases'] || row['別表記'] || '');
    if (aliases.length > 0) {
      data.aliases = aliases;
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
async function importDocuments(filePath, dryRun) {
  console.log(`書類マスター${dryRun ? '（検証のみ）' : 'をインポート'}: ${filePath}`);

  const content = fs.readFileSync(filePath, 'utf8');
  const rows = parseCSV(content, filePath);
  validateRows(rows, [['name', '書類名']], filePath);

  console.log(`  ✓ ${rows.length}件の書類を解析しました`);
  if (dryRun) return;

  const batch = db.batch();
  let count = 0;

  for (const row of rows) {
    // 期待するカラム: name, dateMarker, category, keywords
    const name = row['name'] || row['書類名'] || '';
    const docRef = db.collection('masters/documents/items').doc(name);
    const keywords = parseKeywords(row['keywords'] || row['キーワード'] || '');
    const docData = {
      name,
      dateMarker: row['dateMarker'] || row['日付位置'] || '',
      category: row['category'] || row['カテゴリー'] || '',
      keywords,
    };
    // エイリアスがある場合のみ追加
    const aliases = parseAliases(row['aliases'] || row['別表記'] || '');
    if (aliases.length > 0) {
      docData.aliases = aliases;
    }
    batch.set(docRef, docData);
    count++;
  }

  await batch.commit();
  console.log(`  ✓ ${count}件の書類をインポートしました`);
}

// 事業所マスターをインポート
async function importOffices(filePath, dryRun) {
  console.log(`事業所マスター${dryRun ? '（検証のみ）' : 'をインポート'}: ${filePath}`);

  const content = fs.readFileSync(filePath, 'utf8');
  const rows = parseCSV(content, filePath);
  validateRows(rows, [['name', '事業所名']], filePath);

  // 同名事業所の検出
  const duplicateNames = detectDuplicateNames(rows, ['name', '事業所名']);
  if (duplicateNames.length > 0) {
    console.log(`  同名事業所を検出: ${duplicateNames.join(', ')}`);
  }

  console.log(`  ✓ ${rows.length}件の事業所を解析しました`);
  if (dryRun) return;

  const batch = db.batch();
  let count = 0;

  for (const row of rows) {
    // 期待するカラム: name, shortName (optional)
    const name = row['name'] || row['事業所名'] || '';
    const docRef = db.collection('masters/offices/items').doc();
    const data = {
      id: docRef.id,
      name,
      // 同名フラグはシステムが自動検知（CSV入力は不要）
      isDuplicate: duplicateNames.includes(name),
    };
    // 短縮名がある場合のみ追加
    const shortName = row['shortName'] || row['短縮名'] || '';
    if (shortName) {
      data.shortName = shortName;
    }
    // エイリアスがある場合のみ追加
    const aliases = parseAliases(row['aliases'] || row['別表記'] || '');
    if (aliases.length > 0) {
      data.aliases = aliases;
    }
    batch.set(docRef, data);
    count++;
  }

  await batch.commit();
  console.log(`  ✓ ${count}件の事業所をインポートしました`);
}

// エイリアス文字列を配列に変換（パイプ区切り）
function parseAliases(aliasesStr) {
  if (!aliasesStr) return [];
  return aliasesStr
    .split('|')
    .map((a) => a.trim())
    .filter((a) => a.length > 0);
}

// ケアマネジャーマスターをインポート
async function importCareManagers(filePath, dryRun) {
  console.log(`ケアマネジャーマスター${dryRun ? '（検証のみ）' : 'をインポート'}: ${filePath}`);

  const content = fs.readFileSync(filePath, 'utf8');
  const rows = parseCSV(content, filePath);
  validateRows(rows, [['name', 'ケアマネ名']], filePath);

  console.log(`  ✓ ${rows.length}件のケアマネジャーを解析しました`);
  if (dryRun) return;

  const batch = db.batch();
  let count = 0;

  for (const row of rows) {
    // 期待するカラム: name, email
    const name = row['name'] || row['ケアマネ名'] || '';
    const docRef = db.collection('masters/caremanagers/items').doc();
    const data = {
      id: docRef.id,
      name,
    };
    // メールアドレスがある場合のみ追加
    const email = row['email'] || row['メール'] || row['メールアドレス'] || '';
    if (email) {
      data.email = email;
    }
    batch.set(docRef, data);
    count++;
  }

  await batch.commit();
  console.log(`  ✓ ${count}件のケアマネジャーをインポートしました`);
}

// メイン処理
async function main() {
  const rawArgs = process.argv.slice(2);

  // --dry-run フラグの抽出
  const dryRun = rawArgs.includes('--dry-run');
  const args = rawArgs.filter((a) => a !== '--dry-run');

  if (args.length < 2) {
    console.log('使用方法:');
    console.log('  node import-masters.js --customers customers.csv');
    console.log('  node import-masters.js --documents documents.csv');
    console.log('  node import-masters.js --offices offices.csv');
    console.log('  node import-masters.js --caremanagers caremanagers.csv');
    console.log('  node import-masters.js --all ./data/');
    console.log('  node import-masters.js --dry-run --all ./data/  # 解析+バリデーションのみ');
    process.exit(1);
  }

  if (dryRun) {
    console.log('[DRY-RUN] DB投入は行いません（解析+バリデーションのみ）\n');
  }

  const option = args[0];
  const pathArg = args[1];

  try {
    if (option === '--customers') {
      await importCustomers(pathArg, dryRun);
    } else if (option === '--documents') {
      await importDocuments(pathArg, dryRun);
    } else if (option === '--offices') {
      await importOffices(pathArg, dryRun);
    } else if (option === '--caremanagers') {
      await importCareManagers(pathArg, dryRun);
    } else if (option === '--all') {
      // ディレクトリ内のCSVを全てインポート
      const dir = pathArg;
      const files = fs.readdirSync(dir);

      for (const file of files) {
        const filePath = path.join(dir, file);
        if (file.includes('customer')) {
          await importCustomers(filePath, dryRun);
        } else if (file.includes('document')) {
          await importDocuments(filePath, dryRun);
        } else if (file.includes('office')) {
          await importOffices(filePath, dryRun);
        } else if (file.includes('caremanager')) {
          await importCareManagers(filePath, dryRun);
        }
      }
    } else {
      console.log(`不明なオプション: ${option}`);
      process.exit(1);
    }

    console.log(dryRun ? '\n検証完了！（問題なし）' : '\nインポート完了！');
    process.exit(0);
  } catch (error) {
    console.error('エラー:', error.message);
    process.exit(1);
  }
}

main();
