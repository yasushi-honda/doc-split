# マスターデータCSVサンプル

## 概要

このディレクトリには、顧客セットアップ時に使用するマスターデータのCSVサンプルが含まれています。

## ファイル一覧

| ファイル | 説明 | 必須 |
|---------|------|------|
| `customers.csv` | 顧客マスター | ○ |
| `documents.csv` | 書類種別マスター | ○ |
| `offices.csv` | 事業所マスター | ○ |
| `caremanagers.csv` | ケアマネージャーマスター | △ |

## 使用方法

```bash
# 顧客マスター投入
node scripts/import-masters.js --type customers --file scripts/samples/customers.csv

# 書類マスター投入
node scripts/import-masters.js --type documents --file scripts/samples/documents.csv

# 事業所マスター投入
node scripts/import-masters.js --type offices --file scripts/samples/offices.csv

# ケアマネマスター投入（オプション）
node scripts/import-masters.js --type caremanagers --file scripts/samples/caremanagers.csv
```

## カラム仕様

### customers.csv

| カラム | 型 | 必須 | 説明 |
|--------|-----|------|------|
| name | string | ○ | 顧客氏名（一意キー） |
| furigana | string | ○ | フリガナ（OCR照合用） |
| isDuplicate | boolean | ○ | 同姓同名フラグ |
| careManagerName | string | △ | 担当ケアマネ名 |
| notes | string | - | 備考 |

### documents.csv

| カラム | 型 | 必須 | 説明 |
|--------|-----|------|------|
| name | string | ○ | 書類種別名（一意キー） |
| dateMarker | string | ○ | 日付抽出マーカー（例: "発行日"） |
| category | string | ○ | カテゴリ |
| keywords | string | ○ | 判定キーワード（セミコロン区切り） |

### offices.csv

| カラム | 型 | 必須 | 説明 |
|--------|-----|------|------|
| name | string | ○ | 事業所名（一意キー） |
| type | string | ○ | 事業所種別 |
| address | string | - | 住所 |
| phone | string | - | 電話番号 |
| notes | string | - | 備考 |

### caremanagers.csv

| カラム | 型 | 必須 | 説明 |
|--------|-----|------|------|
| name | string | ○ | ケアマネ名（一意キー） |
| office | string | ○ | 所属事業所名 |
| phone | string | - | 電話番号 |
| email | string | - | メールアドレス |
| notes | string | - | 備考 |

## 注意事項

1. **文字コード**: UTF-8で保存してください
2. **改行コード**: LF（Unix）推奨
3. **同姓同名**: 同姓同名の顧客がいる場合、両方の`isDuplicate`を`true`に設定
4. **キーワード**: 複数キーワードはセミコロン（`;`）で区切り

## 顧客へのテンプレート提供

1. このサンプルをコピーして顧客に提供
2. 顧客がExcel等で編集
3. CSV形式で保存
4. `import-masters.js`で投入
