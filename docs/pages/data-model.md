# データモデル

## Firestore コレクション構成

```mermaid
erDiagram
    users ||--o{ documents : "アクセス"
    documents ||--o{ errors : "エラー記録"
    documents }o--|| customers : "顧客紐付け"
    documents }o--|| documentTypes : "書類種別"
    documents }o--|| offices : "事業所"
    customers }o--|| careManagers : "担当ケアマネ"

    users {
        string uid PK "Firebase Auth UID"
        string email "メールアドレス"
        string name "表示名"
        string role "admin | user"
        timestamp createdAt
        timestamp updatedAt
    }

    documents {
        string id PK "自動生成"
        string status "pending | processing | completed | error"
        string customerName "顧客名"
        string documentType "書類種別"
        date fileDate "書類日付"
        string officeName "事業所名"
        string originalFileName "元ファイル名"
        string storagePath "Storage パス"
        string gmailMessageId "メールID"
        map ocrResult "OCR結果"
        timestamp processedAt
        timestamp createdAt
    }

    customers {
        string id PK "自動生成"
        string name "顧客名"
        string furigana "フリガナ"
        boolean isDuplicate "同姓同名フラグ"
        string careManagerName "担当ケアマネ"
        string notes "備考"
    }

    documentTypes {
        string id PK "自動生成"
        string name "書類種別名"
        string category "カテゴリ"
        array keywords "マッチングキーワード"
    }

    offices {
        string id PK "自動生成"
        string name "事業所名"
        string shortName "略称"
        string type "種別"
    }

    careManagers {
        string id PK "自動生成"
        string name "氏名"
        string officeName "所属事業所"
    }

    errors {
        string id PK "自動生成"
        string documentId "対象書類ID"
        string errorType "エラー種別"
        string errorMessage "エラーメッセージ"
        string status "open | resolved"
        timestamp errorDate
    }

    settings {
        string id PK "app"
        array targetLabels "監視ラベル"
        string labelSearchOperator "AND | OR"
        string gmailAccount "監視Gmail"
        array errorNotificationEmails "通知先"
    }
```

## コレクション詳細

### users

ホワイトリスト認証用のユーザー情報。

| フィールド | 型 | 必須 | 説明 |
|------------|-----|------|------|
| uid | string | ✓ | Firebase Auth UID（ドキュメントID） |
| email | string | ✓ | メールアドレス |
| name | string | | 表示名 |
| role | string | ✓ | `admin` または `user` |
| createdAt | timestamp | ✓ | 作成日時 |
| updatedAt | timestamp | ✓ | 更新日時 |

### documents

取得・処理された書類情報。

| フィールド | 型 | 必須 | 説明 |
|------------|-----|------|------|
| id | string | ✓ | 自動生成ID |
| status | string | ✓ | `pending`, `processing`, `completed`, `error` |
| customerName | string | | 顧客名（OCR結果） |
| documentType | string | | 書類種別（OCR結果） |
| fileDate | date | | 書類日付（OCR結果） |
| officeName | string | | 事業所名（OCR結果） |
| originalFileName | string | ✓ | 元のファイル名 |
| storagePath | string | ✓ | Cloud Storageパス |
| gmailMessageId | string | | Gmail メッセージID |
| ocrResult | map | | OCR生結果 |
| processedAt | timestamp | | 処理完了日時 |
| createdAt | timestamp | ✓ | 作成日時 |

**status遷移:**
```mermaid
stateDiagram-v2
    [*] --> pending: Gmail取得
    pending --> processing: OCR開始
    processing --> completed: OCR成功
    processing --> error: OCRエラー
    error --> pending: 再処理
```

### customers

顧客マスター。OCRでの顧客名マッチングに使用。

| フィールド | 型 | 必須 | 説明 |
|------------|-----|------|------|
| id | string | ✓ | 自動生成ID |
| name | string | ✓ | 顧客名 |
| furigana | string | | フリガナ（マッチング用） |
| isDuplicate | boolean | | 同姓同名フラグ |
| careManagerName | string | | 担当ケアマネ名 |
| notes | string | | 備考 |

### documentTypes

書類種別マスター。

| フィールド | 型 | 必須 | 説明 |
|------------|-----|------|------|
| id | string | ✓ | 自動生成ID |
| name | string | ✓ | 書類種別名 |
| category | string | | カテゴリ |
| keywords | array | | マッチングキーワード |

### offices

事業所マスター。

| フィールド | 型 | 必須 | 説明 |
|------------|-----|------|------|
| id | string | ✓ | 自動生成ID |
| name | string | ✓ | 正式名称 |
| shortName | string | | 略称 |
| type | string | | 事業所種別 |

### errors

エラー履歴。

| フィールド | 型 | 必須 | 説明 |
|------------|-----|------|------|
| id | string | ✓ | 自動生成ID |
| documentId | string | | 対象書類ID |
| errorType | string | ✓ | エラー種別 |
| errorMessage | string | ✓ | エラーメッセージ |
| status | string | ✓ | `open`, `resolved` |
| errorDate | timestamp | ✓ | 発生日時 |

### settings

アプリ設定（単一ドキュメント `settings/app`）。

| フィールド | 型 | 必須 | 説明 |
|------------|-----|------|------|
| targetLabels | array | | 監視対象ラベル |
| labelSearchOperator | string | | `AND` または `OR` |
| gmailAccount | string | | 監視Gmailアカウント |
| errorNotificationEmails | array | | エラー通知先 |

## インデックス

### 複合インデックス

| コレクション | フィールド | 用途 |
|--------------|------------|------|
| documents | status ASC, processedAt ASC | OCR処理キュー |
| documents | status ASC, processedAt DESC | 書類一覧（ステータス別） |
| documents | customerName ASC, fileDate DESC | 顧客別書類一覧 |
| documents | documentType ASC, processedAt DESC | 種別別書類一覧 |
| errors | status ASC, errorDate DESC | エラー一覧 |
| errors | errorType ASC, errorDate DESC | エラー種別別一覧 |

## Cloud Storage 構成

```
gs://<project-id>-documents/
├── pending/           # 処理待ち
│   └── {documentId}.pdf
├── processed/         # 処理済み
│   └── {YYYY}/{MM}/
│       └── {documentId}.pdf
└── split/            # 分割結果
    └── {originalDocId}/
        └── segment_{n}.pdf
```
