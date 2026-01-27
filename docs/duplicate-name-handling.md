# 同名/同姓同名対応設計

> **Note**: これはGitHub Pages用の簡略版です。開発時は [docs/context/duplicate-name-handling.md](context/duplicate-name-handling.md) を参照してください。

## 概要

DocSplitでは、マスターデータ（顧客・事業所）において同じ名前のエントリが複数存在する場合があります。OCR処理で抽出した名前をマスターデータと照合する際、同名/同姓同名を適切に処理する必要があります。

## マスターデータ別の特性

| マスター | 同名可否 | OCR対象 | 対応方針 |
|----------|----------|---------|----------|
| **顧客** | 同姓同名あり得る | ○ | 同姓同名検知 → 候補提示 → ユーザー選択 |
| **事業所** | 同名あり得る（支店等） | ○ | 同名検知 → 候補提示 → ユーザー選択 |
| **書類種別** | ユニークであるべき | ○ | 名前をドキュメントIDとして重複防止 |
| **ケアマネ** | - | × | 顧客経由で設定（OCR対象外） |

## 統一アーキテクチャ

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

## 処理フロー

### 1. インポート時（マスター登録）

CSVインポート時に同名を自動検知し、`isDuplicate`フラグを設定します。

- 名前の出現回数をカウント
- 2回以上出現する名前を「同名」として検出
- 該当するエントリに `isDuplicate: true` を設定

**ユーザー入力が不要な項目**:
- `isDuplicate`: システムが自動検知
- `nameKey`: システムが自動生成

## CSVテンプレート構造

マスターデータの一括インポート用CSVテンプレートです。`isDuplicate`はシステムが自動検知するため、CSVには含まれません。

### 顧客マスター（customers_template.csv）

| カラム | 説明 | 必須 |
|--------|------|------|
| name | 顧客名 | ✓ |
| furigana | フリガナ | |
| careManagerName | 担当ケアマネ名 | |
| notes | 備考 | |

### 事業所マスター（offices_template.csv）

| カラム | 説明 | 必須 |
|--------|------|------|
| name | 事業所名 | ✓ |
| type | 種別 | |
| address | 住所 | |
| phone | 電話番号 | |
| notes | 備考 | |

### 書類種別マスター（documents_template.csv）

| カラム | 説明 | 必須 |
|--------|------|------|
| name | 書類種別名 | ✓ |
| dateMarker | 日付マーカー | |
| category | カテゴリ | |
| keywords | キーワード（;区切り） | |

### ケアマネマスター（caremanagers_template.csv）

| カラム | 説明 | 必須 |
|--------|------|------|
| name | ケアマネ名 | ✓ |
| office | 所属事業所 | |
| phone | 電話番号 | |
| email | メール | |
| notes | 備考 | |

> **注意**: 顧客・事業所の`isDuplicate`フラグは、インポート時にシステムが同名を検出して自動設定します。CSVに`isDuplicate`カラムを含める必要はありません。

### 2. OCR処理時（候補解決）

| マッチ結果 | 処理 |
|------------|------|
| 0件マッチ | `confirmed = false`（未解決）、`candidates = []` |
| 1件マッチ | `id`を設定、`confirmed = true`（自動確定） |
| 複数件マッチ | `candidates`に候補リストを格納、`confirmed = false`（要手動選択） |

### 3. UI解決（ユーザー選択）

1. `confirmed = false` のドキュメントを一覧表示
2. ユーザーが候補から選択（または「該当なし」）
3. 選択内容でドキュメントを更新
4. 監査ログに記録

## データモデル

### Document（書類）フィールド

```typescript
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
```

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

## 正規化キー（nameKey）

検索精度向上とインデックス効率化のため、名前を正規化します。

**変換ルール**:
- 全角英数字 → 半角
- 大文字 → 小文字
- 空白除去（全角・半角）
- 記号除去（・、-、_）

**例**:
- `山田　太郎` → `山田太郎`
- `さくらケアセンター　東京支店` → `さくらけあせんたー東京支店`
- `ＡＢＣＤ` → `abcd`

## エッジケース（Codexアーキテクトレビュー済み）

| エッジケース | 対策 |
|-------------|------|
| OCR名前バリエーション（漢字/カナ、全角/半角） | nameKeyの強化正規化、生OCRテキスト保存 |
| CSV再インポートで同名状態変化 | 既存confirmed状態を維持 |
| 「該当なし」選択の保護 | 三状態confirmed（null/false/true） |
| 同時編集の競合 | Firestoreトランザクション使用 |
| 同名だがフリガナ違い | 候補にフリガナ・担当CM表示 |

## 実装状況

| 機能 | 顧客 | 事業所 |
|------|------|--------|
| 同名自動検知（インポート時） | ✅ 完了 | ✅ 完了 |
| 候補リスト生成（OCR時） | ✅ 完了 | ✅ 完了 |
| UI解決モーダル | ✅ 完了 | ✅ 完了 |
| 監査ログ | ✅ 完了 | ✅ 完了 |

## 関連ドキュメント

- [データモデル](data-model.md)
- [機能一覧](features.md)

---

**詳細な技術仕様**: [docs/context/duplicate-name-handling.md](https://github.com/yasushi-honda/doc-split/blob/main/docs/context/duplicate-name-handling.md)
