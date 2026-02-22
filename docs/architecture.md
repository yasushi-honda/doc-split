# アーキテクチャ

## システム全体構成

```mermaid
flowchart TB
    subgraph Client["クライアント"]
        Browser["ブラウザ"]
    end

    subgraph Firebase["Firebase"]
        Hosting["Firebase Hosting<br/>(React SPA)"]
        Auth["Firebase Auth<br/>(Google認証)"]
    end

    subgraph GCP["Google Cloud Platform"]
        subgraph Functions["Cloud Functions"]
            CheckGmail["checkGmailAttachments<br/>(5分間隔)"]
            ProcessOCR["processOCR<br/>(1分間隔ポーリング)"]
            DetectSplit["detectSplitPoints<br/>(Callable)"]
            SplitPdf["splitPdf<br/>(Callable)"]
            RotatePdf["rotatePdfPages<br/>(Callable)"]
            UploadPdf["uploadPdf<br/>(Callable)"]
        end

        Firestore["Firestore<br/>(データベース)"]
        Storage["Cloud Storage<br/>(PDFファイル)"]
        SecretManager["Secret Manager<br/>(認証情報)"]
    end

    subgraph External["外部サービス"]
        Gmail["Gmail API"]
        Gemini["Gemini 2.5 Flash<br/>(Vertex AI)"]
    end

    Browser --> Hosting
    Hosting --> Auth
    Browser --> Firestore
    Browser --> Functions

    CheckGmail --> Gmail
    CheckGmail --> Storage
    CheckGmail --> Firestore

    ProcessOCR --> Storage
    ProcessOCR --> Gemini
    ProcessOCR --> Firestore

    DetectSplit --> Storage
    DetectSplit --> Gemini
    SplitPdf --> Storage

    Functions --> SecretManager
```

## データフロー

### 書類取得フロー

```mermaid
sequenceDiagram
    participant Scheduler as Cloud Scheduler
    participant CheckGmail as checkGmailAttachments
    participant Gmail as Gmail API
    participant Storage as Cloud Storage
    participant Firestore as Firestore

    Scheduler->>CheckGmail: 5分間隔でトリガー
    CheckGmail->>Firestore: 設定取得
    CheckGmail->>Gmail: 新規メール検索
    Gmail-->>CheckGmail: メール一覧

    loop 各メール
        CheckGmail->>Gmail: 添付ファイル取得
        Gmail-->>CheckGmail: PDFファイル
        CheckGmail->>Storage: PDF保存
        CheckGmail->>Firestore: documentsに登録(status: pending)
    end
```

### OCR処理フロー

```mermaid
sequenceDiagram
    participant Scheduler as Cloud Scheduler
    participant ProcessOCR as processOCR
    participant Storage as Cloud Storage
    participant Gemini as Gemini 2.5 Flash
    participant Firestore as Firestore

    Note over Scheduler,ProcessOCR: 1分間隔ポーリング（ADR-0010: processOCROnCreate廃止）
    Scheduler->>ProcessOCR: 1分間隔でトリガー
    ProcessOCR->>Firestore: pending書類取得 + processingスタック救済

    loop 各書類
        ProcessOCR->>Storage: PDF取得
        ProcessOCR->>Gemini: OCR実行
        Gemini-->>ProcessOCR: 抽出結果(顧客名,日付,書類種別,要約)
        ProcessOCR->>Firestore: マスターデータ照合
        ProcessOCR->>Firestore: 書類更新(status: completed)
    end
```

## コンポーネント詳細

### Cloud Functions

| 関数名 | トリガー | 説明 |
|--------|----------|------|
| `checkGmailAttachments` | Scheduled (5分) | Gmail添付ファイル取得 |
| `processOCR` | Scheduled (1分) | AI OCR処理（ポーリング一本化、ADR-0010） |
| `detectSplitPoints` | Callable | PDF分割候補検出 |
| `splitPdf` | Callable | PDF分割実行 |
| `rotatePdfPages` | Callable | PDFページ回転（永続保存） |
| `uploadPdf` | Callable | ローカルPDFアップロード |
| `deleteDocument` | Callable | ドキュメント削除（管理者のみ） |
| `getOcrText` | Callable | OCR全文取得 |
| `regenerateSummary` | Callable | AI要約再生成 |
| `searchDocuments` | Callable | 全文検索（日付パース対応） |
| `onDocumentWriteSearchIndex` | Firestore Trigger | 検索インデックス自動更新 |
| `onDocumentWrite` | Firestore Trigger | ドキュメントグループ更新 |
| `addMasterAlias` | Callable | マスターエイリアス追加 |
| `removeMasterAlias` | Callable | マスターエイリアス削除 |
| `seedDocumentMasters` | Callable | マスターデータ初期投入 |
| `seedAllMasters` | Callable | 全マスターデータ初期投入 |
| `initTenantSettings` | Callable | テナント初期設定 |
| `registerAdminUser` | Callable | 管理者ユーザー登録 |
| `exchangeGmailAuthCode` | Callable | Gmail OAuth認証コード交換 |

### Firestore コレクション

```mermaid
erDiagram
    documents ||--o{ errors : "エラー記録"
    documents }o--|| customers : "顧客紐付け"
    documents }o--|| documentTypes : "書類種別"
    documents }o--|| offices : "事業所"

    documents {
        string id PK
        string status "pending/processing/processed/error/split"
        string customerName
        string documentType
        date fileDate
        string storagePath
        timestamp processedAt
        string summary "AI要約"
        boolean verified "確認済みフラグ"
        string verifiedBy "確認者UID"
        timestamp verifiedAt "確認日時"
    }

    customers {
        string id PK
        string name
        string furigana
        boolean isDuplicate
        string careManagerName
    }

    documentTypes {
        string id PK
        string name
        string category
        array keywords
    }

    offices {
        string id PK
        string name
        string shortName
        string type
    }

    users {
        string uid PK
        string email
        string role "admin/user"
    }
```

## セキュリティ設計

```mermaid
flowchart LR
    subgraph Public["パブリック"]
        Internet["インターネット"]
    end

    subgraph Auth["認証レイヤー"]
        FirebaseAuth["Firebase Auth<br/>(Google OAuth)"]
        Whitelist["ホワイトリスト<br/>(users コレクション)"]
    end

    subgraph App["アプリケーション"]
        Frontend["React SPA"]
        Functions["Cloud Functions"]
    end

    subgraph Data["データレイヤー"]
        Firestore["Firestore<br/>(セキュリティルール)"]
        Storage["Cloud Storage<br/>(セキュリティルール)"]
    end

    Internet --> FirebaseAuth
    FirebaseAuth --> Whitelist
    Whitelist -->|認証済み| Frontend
    Frontend --> Functions
    Frontend --> Firestore
    Frontend --> Storage

    style Whitelist fill:#f9f,stroke:#333
```

## インフラ構成

| リソース | 設定 |
|----------|------|
| リージョン | `asia-northeast1` (東京) |
| Functions | 2nd gen, Node.js 20 |
| Firestore | Native mode |
| Storage | Standard |
| Hosting | Firebase Hosting (PWA対応) |
