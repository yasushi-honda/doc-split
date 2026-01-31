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
            ProcessOCR["processOCR<br/>(5分間隔)"]
            DetectSplit["detectSplitPoints<br/>(Callable)"]
            SplitPdf["splitPdf<br/>(Callable)"]
            RotatePdf["rotatePdfPages<br/>(Callable)"]
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

    Scheduler->>ProcessOCR: 5分間隔でトリガー
    ProcessOCR->>Firestore: pending書類取得

    loop 各書類
        ProcessOCR->>Storage: PDF取得
        ProcessOCR->>Gemini: OCR実行
        Gemini-->>ProcessOCR: 抽出結果(顧客名,日付,書類種別)
        ProcessOCR->>Firestore: マスターデータ照合
        ProcessOCR->>Firestore: 書類更新(status: completed)
    end
```

## コンポーネント詳細

### Cloud Functions

| 関数名 | トリガー | 説明 |
|--------|----------|------|
| `checkGmailAttachments` | Scheduled (5分) | Gmail添付ファイル取得 |
| `processOCR` | Scheduled (5分) | AI OCR処理 |
| `detectSplitPoints` | Callable | PDF分割候補検出 |
| `splitPdf` | Callable | PDF分割実行 |
| `rotatePdfPages` | Callable | PDFページ回転 |
| `regenerateSummary` | Callable | AI要約再生成 |
| `searchDocuments` | Callable | 全文検索（日付パース対応） |
| `onDocumentWriteSearchIndex` | Trigger | 検索インデックス自動更新 |

### Firestore コレクション

```mermaid
erDiagram
    documents ||--o{ errors : "エラー記録"
    documents }o--|| customers : "顧客紐付け"
    documents }o--|| documentTypes : "書類種別"
    documents }o--|| offices : "事業所"

    documents {
        string id PK
        string status "pending/processing/completed/error"
        string customerName
        string documentType
        date fileDate
        string storagePath
        timestamp processedAt
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
| Functions | 2nd gen, Node.js 22 |
| Firestore | Native mode |
| Storage | Standard |
| Hosting | Firebase Hosting |
