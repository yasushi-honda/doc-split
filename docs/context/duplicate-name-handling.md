---
title: "同名/同姓同名対応設計"
description: "OCR処理における同姓同名顧客・同名事業所の解決設計"
status: completed
updated: "2026-02-08"
---

# 同名/同姓同名対応設計

## 概要

DocSplitでは、マスターデータ（顧客・事業所）において同じ名前のエントリが複数存在する場合があります。OCR処理で抽出した名前をマスターデータと照合する際、同名/同姓同名を適切に処理する必要があります。

## マスターデータ別の特性

| マスター | 同名可否 | OCR対象 | 対応方針 |
|----------|----------|---------|----------|
| **顧客** | 同姓同名あり得る | ○ | 同姓同名検知 → 候補提示 → ユーザー選択 |
| **事業所** | 同名あり得る（支店等） | ○ | 同名検知 → 候補提示 → ユーザー選択 |
| **書類種別** | ユニークであるべき | ○ | 名前をドキュメントIDとして重複防止 |
| **ケアマネ** | - | × | 顧客経由で設定（OCR対象外のため不要） |

## 統一アーキテクチャ

顧客と事業所で同じパターンを適用し、一貫性と保守性を確保します。

```
┌─────────────────────────────────────────────────────────────┐
│                    同名/同姓同名解決フロー                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │  インポート   │ →  │   OCR処理    │ →  │   UI解決     │  │
│  │   (マスター)  │    │ (ドキュメント) │    │  (ユーザー)  │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│         │                   │                   │          │
│         ▼                   ▼                   ▼          │
│   同名自動検知        候補リスト生成        選択確定       │
│   isDuplicate設定     Confirmed=false      監査ログ記録    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## データモデル

### Document（書類）

```typescript
interface Document {
  // 既存フィールド
  customerName: string;
  officeName: string;

  // 顧客解決フィールド（Phase 7実装済み）
  customerId?: string | null;
  customerConfirmed?: boolean;
  customerCandidates?: CustomerCandidateInfo[];
  confirmedBy?: string | null;
  confirmedAt?: Timestamp | null;

  // 事業所解決フィールド（追加予定）
  officeId?: string | null;
  officeConfirmed?: boolean;
  officeCandidates?: OfficeCandidateInfo[];
  officeConfirmedBy?: string | null;
  officeConfirmedAt?: Timestamp | null;
}
```

### CustomerMaster（顧客マスタ）

```typescript
interface CustomerMaster {
  id: string;              // ドキュメントID
  name: string;            // 顧客名
  nameKey: string;         // 正規化キー（検索用）
  furigana: string;        // フリガナ
  isDuplicate: boolean;    // 同姓同名フラグ（自動検知）
  careManagerName?: string; // 担当ケアマネジャー
  aliases?: string[];      // 許容される別表記（学習機能）
  notes?: string;          // 備考
}
```

### OfficeMaster（事業所マスタ）

```typescript
interface OfficeMaster {
  id: string;              // ドキュメントID（追加）
  name: string;            // 事業所名
  nameKey: string;         // 正規化キー（追加）
  shortName?: string;      // 短縮名
  isDuplicate: boolean;    // 同名フラグ（追加）
  aliases?: string[];      // 許容される別表記（学習機能）
  notes?: string;          // 備考
}
```

### 許容表記（aliases）学習機能

マスターに登録されている正式名称以外に、OCRで検出される可能性のある別表記を登録できます。

```
【例】事業所マスター
正式名称: 北名古屋東部地域包括
aliases: ["北名古屋市東部地域包括支援センター", "東部地域包括"]

→ OCRで「北名古屋市東部地域包括支援センター」を検出した場合も自動マッチ
```

**学習フロー:**
1. ユーザーが手動で事業所を選択
2. 「この表記を記憶する」チェックボックスをON
3. OCRで検出された表記がaliasesに追加
4. 次回以降は自動マッチ

### 候補情報

```typescript
// 顧客候補
interface CustomerCandidateInfo {
  customerId: string;
  customerName: string;
  customerNameKana?: string;
  isDuplicate: boolean;
  careManagerName?: string;
  score: number;           // 類似度スコア (0-100)
  matchType: 'exact' | 'partial' | 'fuzzy';
}

// 事業所候補
interface OfficeCandidateInfo {
  officeId: string;
  officeName: string;
  shortName?: string;
  isDuplicate: boolean;
  score: number;
  matchType: 'exact' | 'partial' | 'fuzzy';
}
```

### 監査ログ

```typescript
// 顧客解決ログ（実装済み）
interface CustomerResolutionLog {
  documentId: string;
  previousCustomerId: string | null;
  newCustomerId: string | null;
  newCustomerName: string;
  resolvedBy: string;
  resolvedByEmail: string;
  resolvedAt: Timestamp;
  reason?: string;
}

// 事業所解決ログ（追加予定）
interface OfficeResolutionLog {
  documentId: string;
  previousOfficeId: string | null;
  newOfficeId: string | null;
  newOfficeName: string;
  resolvedBy: string;
  resolvedByEmail: string;
  resolvedAt: Timestamp;
  reason?: string;
}
```

## 処理フロー詳細

### 1. インポート時（マスター登録）

CSVインポート時に同名を自動検知し、`isDuplicate`フラグを設定します。

```
1. CSVを読み込み
2. 名前の出現回数をカウント
3. 2回以上出現する名前を「同名」として検出
4. 該当するエントリに isDuplicate: true を設定
5. Firestoreに保存
```

**ユーザー入力が不要な項目**:
- `isDuplicate`: システムが自動検知
- `nameKey`: システムが自動生成

### 2. OCR処理時（候補解決）

```
1. OCRで名前を抽出
2. 名前を正規化（nameKey生成）
3. マスターデータを nameKey で検索

■ 0件マッチ:
   - confirmed = false（未解決）
   - candidates = []

■ 1件マッチ:
   - id を設定
   - confirmed = true（自動確定）

■ 複数件マッチ:
   - candidates に候補リストを格納
   - confirmed = false（要手動選択）
```

### 3. UI解決（ユーザー選択）

```
1. confirmed = false のドキュメントを一覧表示
2. ユーザーが候補から選択（または「該当なし」）
3. 選択内容でドキュメントを更新
4. 監査ログに記録
```

## 正規化キー（nameKey）の生成ルール

検索精度向上とインデックス効率化のため、名前を正規化します。

```typescript
function generateNameKey(name: string): string {
  return name
    // 全角英数字 → 半角
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) =>
      String.fromCharCode(s.charCodeAt(0) - 0xFEE0)
    )
    // 大文字 → 小文字
    .toLowerCase()
    // 空白除去（全角・半角）
    .replace(/[\s\u3000]/g, '')
    // 記号除去（オプション）
    .replace(/[・\-_]/g, '')
    .trim();
}
```

**例**:
- `山田　太郎` → `山田太郎`
- `さくらケアセンター　東京支店` → `さくらけあせんたー東京支店`
- `ＡＢＣＤ` → `abcd`

## 実装優先順位

| 優先度 | タスク | 努力量 | 説明 |
|--------|--------|--------|------|
| 1 | データモデル拡張 | Quick | Document, OfficeMasterにフィールド追加 |
| 2 | 正規化キー導入 | Short | nameKey生成ユーティリティ、既存データ移行 |
| 3 | インポート時の同名検知 | Short | OfficeMasterインポートに同名検知追加 |
| 4 | OCR時の事業所候補解決 | Short | processOCRに事業所候補解決ロジック追加 |
| 5 | UI解決モーダル | Short | 顧客モーダルを汎用化して事業所対応 |
| 6 | 監査ログ | Quick | officeResolutionLogs追加 |

**全体努力量**: Medium（1-2日）

## Firestoreインデックス

```json
{
  "collectionGroup": "masters/customers/items",
  "fields": [
    { "fieldPath": "nameKey", "order": "ASCENDING" }
  ]
},
{
  "collectionGroup": "masters/offices/items",
  "fields": [
    { "fieldPath": "nameKey", "order": "ASCENDING" }
  ]
}
```

## セキュリティルール

```javascript
// 事業所解決ログ（追加）
match /officeResolutionLogs/{logId} {
  allow read: if isWhitelisted();
  allow create: if isWhitelisted()
    && request.resource.data.resolvedBy == request.auth.uid
    && request.resource.data.documentId is string
    && request.resource.data.documentId.size() > 0;
  allow update, delete: if false;
}
```

## エッジケースと対策（Codexアーキテクトレビュー済み）

### 1. OCR名前バリエーション

OCRが名前を漢字/カナ、全角/半角、余分なスペースなど異なる形式で抽出する場合があります。

**対策**:
- nameKeyの正規化を強化（上記関数参照）
- 生のOCRテキストも保存し、後から分析可能に

```typescript
interface Document {
  // 正規化後の名前
  customerName: string;
  // 生のOCR抽出テキスト（デバッグ用）
  customerNameRaw?: string;
}
```

### 2. CSV再インポートによる同名状態の変化

CSVを再インポートすると、同名状態（isDuplicate）が変化する可能性があります。

**対策**:
- 再インポート時も同名検知ロジックを実行
- 既存ドキュメントの`confirmed`状態は維持（ユーザー選択を尊重）

### 3. 「該当なし」選択の保護

ユーザーが「該当なし」を選択した後、再OCR処理で上書きされないようにする。

**対策**:
- 三状態の`confirmed`を使用:
  - `null/undefined`: 未レビュー（自動割当可能）
  - `false`: レビュー済み・該当なし（再処理で上書き禁止）
  - `true`: 確定済み

```typescript
// OCR処理時のチェック
if (document.customerConfirmed === false) {
  // ユーザーが「該当なし」を選択済み - スキップ
  return;
}
```

### 4. 同時編集（競合）

複数ユーザーが同じドキュメントを同時に解決しようとする場合。

**対策**:
- Firestoreトランザクションを使用
- 楽観的ロック（`confirmedAt`のタイムスタンプチェック）

### 5. 同名だがフリガナが異なる場合

同姓同名でもフリガナや担当ケアマネが異なる場合、識別に利用。

**対策**:
- 候補情報にフリガナ・担当CMを含める
- UIでこれらの情報を表示して選択を支援

### 6. 候補生成の理由表示

非技術者ユーザーが「なぜこの候補が表示されているか」を理解できるようにする。

**推奨改善**（将来実装）:
```typescript
interface CustomerCandidateInfo {
  // 既存フィールド...
  matchReason?: string;      // 例: "名前が完全一致"
  ocrSnippet?: string;       // マッチしたOCRテキストの抜粋
}
```

## 実装状況

| 機能 | 顧客 | 事業所 |
|------|------|--------|
| 同名自動検知（インポート時） | ✅ 完了 | ✅ 完了 |
| 候補リスト生成（OCR時） | ✅ 完了 | ✅ 完了 |
| UI解決モーダル | ✅ 完了 | ✅ 完了 |
| 監査ログ | ✅ 完了 | ✅ 完了 |
| 三状態confirmed | ⏳ 改善予定 | - |
| 競合対策 | ⏳ 改善予定 | - |

## 関連ドキュメント

- [データモデル](./data-model.md)
- [機能要件](./functional-requirements.md)
- [エラーハンドリング](./error-handling-policy.md)
