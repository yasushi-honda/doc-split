---
title: "ビジネスロジック移行分析"
description: "元GAS実装からGCP/Firebaseへのビジネスロジック移行状況"
status: completed
updated: "2026-02-08"
---

# ビジネスロジック移行分析

## 概要

元GAS実装から新アーキテクチャへのビジネスロジック移行状況を整理。
「制約回避策」と「ビジネスロジック」を分離し、後者のみを昇華対象とする。
Phase 6で移行完了済み。

## 元GASの関数分類

### 🚫 不要（制約回避策）

| 関数名 | 目的 | 新アーキテクチャでの対応 |
|--------|------|------------------------|
| `initializeSecureCredentials_()` | GASのSA認証管理 | ADCで自動 |
| `getServiceAccountCredentialsFromSecretManager_()` | Secret Manager取得 | ADCで不要 |
| `getOAuth2Service_()` | OAuth2認証 | Service Accountのみで十分 |
| `getIdTokenForCloudFunction_()` | CF呼び出し用トークン | 直接呼び出し可能 |
| `checkSystemReady()` | GAS初期化チェック | Cloud Functionsで不要 |
| `CLOUD_FUNCTION_INVOCATION_URL` 経由処理 | GAS→Gemini制約回避 | Vertex AI直接呼び出し |

### ✅ 移植済み（基本実装）

| 元GAS関数 | 現在の実装 | 状態 |
|-----------|-----------|------|
| `calculateLevenshteinDistance_()` | `levenshteinDistance()` | ✅ 同等 |
| `calculateSimilarity_()` | `similarityScore()` | ✅ 同等 |
| `normalizeText_()` | `normalizeText()` | ⚠️ 簡易版 |
| `getBestMatchingDocumentName_()` | `extractDocumentType()` | ⚠️ 簡易版 |
| `getBestMatchingOffice_()` | `extractOfficeName()` | ✅ 同等 |
| `getDateFromOCR_()` | `extractDate()` | ⚠️ 簡易版 |

### ⚠️ 未移植（要昇華）

| 元GAS関数 | 機能 | 優先度 |
|-----------|------|--------|
| `getBestMatchingCustomerCandidates_()` | 複数顧客候補抽出 | 高 |
| `generateOptimalFileName_()` | 最適ファイル名生成 | 高 |
| `analyzeCustomerEntries_()` | 顧客エントリ分析 | 高 |
| `selectMostReasonableDate_()` | 妥当な日付選択 | 中 |
| `convertFullWidthToHalfWidth_()` | 全角→半角変換 | 中 |
| `ensureCustomerEntries_()` | 顧客エントリ保証 | 中 |
| `extractRawDate_()` | 高度な日付パターン | 低 |
| `convertEraToWesternYear_()` | 和暦→西暦変換 | 低（既存で対応済み） |

---

## 詳細差分分析

### 1. 顧客候補抽出の差分

**元GAS `getBestMatchingCustomerCandidates_()`**:
```javascript
// 複数の顧客候補を返す
// ページごとに全候補を収集
// マッチタイプ（exact/partial/fuzzy）を記録
// 同姓同名フラグを考慮
```

**現在の `extractCustomerName()`**:
```typescript
// 1件のみ返す
// 同姓同名時のみ全候補を収集
```

**改善ポイント**:
- 全候補を常に返す
- ページ番号との紐付け
- マッチタイプの詳細記録

### 2. ファイル名生成の差分

**元GAS `generateOptimalFileName_()`**:
```javascript
// 複数顧客対応
// - 1顧客: 「書類名_事業所_日付_顧客名」
// - 複数顧客（同属性）: 「書類名_事業所_日付_顧客A_顧客B」
// - 複数顧客（異属性）: ファイル分割推奨
// 属性統一チェック
// ファイルID短縮形の付与
```

**現在の実装**:
```typescript
// シンプルな結合のみ
// 複数顧客非対応
```

**改善ポイント**:
- 顧客パターン分析
- 属性統一チェック
- 分割推奨ロジック

### 3. 日付抽出の差分

**元GAS `getDateFromOCR_()` + `selectMostReasonableDate_()`**:
```javascript
// 複数の日付候補を抽出
// 日付マーカー（「発行日」等）周辺を優先
// 妥当性チェック（未来日付は除外等）
// 最も妥当な日付を選択
```

**現在の `extractDate()`**:
```typescript
// 最初にマッチした日付を返す
// マーカー対応あり
// 妥当性チェックなし
```

**改善ポイント**:
- 複数候補抽出
- 妥当性チェック追加
- 最適日付選択ロジック

### 4. テキスト正規化の差分

**元GAS `normalizeText_()` + `convertFullWidthToHalfWidth_()`**:
```javascript
// 全角英数字→半角
// 空白除去
// カタカナ正規化
```

**現在の `normalizeText()`**:
```typescript
// 空白除去のみ
// 大文字小文字統一
```

**改善ポイント**:
- 全角→半角変換追加
- カタカナ正規化

---

## 移行優先度マトリクス

| 機能 | ビジネスインパクト | 実装難易度 | 優先度 |
|------|------------------|-----------|--------|
| 複数顧客候補抽出 | 高（精度向上） | 中 | **1** |
| ファイル名生成ロジック | 高（ユーザビリティ） | 中 | **2** |
| 日付選択ロジック | 中（精度向上） | 低 | **3** |
| テキスト正規化強化 | 中（精度向上） | 低 | **4** |
| PDF分割候補検出 | 高（新機能） | 高 | **5** |

---

## 方針決定事項（2026-01-18）

| 項目 | 決定 | 理由 |
|------|------|------|
| 書類名・事業所名抽出 | **改善する** | マスターデータ照合が精度の要 |
| ファイル命名ルール | **元GAS踏襲** | 互換性維持、変更不要 |
| テストデータ | **SEED対応** | scripts/import-masters.js活用 |

---

## 推奨実装順序（Codex指摘反映版）

### Phase 6A: 基盤強化（前処理・候補抽出）

**目的**: 全ての抽出処理の土台を整える

| 順序 | 実装項目 | 元GAS関数 | 理由 |
|------|----------|-----------|------|
| 1 | 全角→半角変換 | `convertFullWidthToHalfWidth_()` | 正規化の基盤 |
| 2 | テキスト正規化強化 | `normalizeText_()` | 全抽出器の前処理統一 |
| 3 | 日付候補抽出強化 | `extractRawDate_()` | 選択の前に候補が必要 |
| 4 | 和暦→西暦変換強化 | `convertEraToWesternYear_()` | 日付候補の網羅性 |

### Phase 6B: 情報抽出精度向上

**目的**: マスターデータとの照合精度を上げる

| 順序 | 実装項目 | 元GAS関数 | 理由 |
|------|----------|-----------|------|
| 1 | 書類名抽出強化 | `getBestMatchingDocumentName_()` | マスター照合の要 |
| 2 | 事業所名抽出強化 | `getBestMatchingOffice_()` | マスター照合の要 |
| 3 | 複数顧客候補抽出 | `getBestMatchingCustomerCandidates_()` | 上限10件、閾値70% |
| 4 | 妥当日付選択 | `selectMostReasonableDate_()` | 6Aの候補から選択 |
| 5 | 顧客エントリ保証 | `ensureCustomerEntries_()` | 6Cの前提条件 |

### Phase 6C: ファイル名生成

**目的**: 抽出結果を適切なファイル名に変換

| 順序 | 実装項目 | 元GAS関数 | 理由 |
|------|----------|-----------|------|
| 1 | 顧客エントリ分析 | `analyzeCustomerEntries_()` | 複数顧客パターン判定 |
| 2 | 最適ファイル名生成 | `generateOptimalFileName_()` | 元GAS命名ルール踏襲 |
| 3 | ファイル名サニタイズ | `sanitizeFileName_()` | 禁止文字・長さ制限 |

### Phase 6D: PDF分割強化

**目的**: 複数書類PDFの自動分割精度向上

| 順序 | 実装項目 | 説明 |
|------|----------|------|
| 1 | 顧客変更点検出 | ページ間で顧客が変わる点を検出 |
| 2 | 分割候補精度向上 | 6B/6Cの結果を活用 |

---

## アーキテクチャ方針

### 責務分離

```
functions/src/utils/
├── textNormalizer.ts   # 前処理（6A）
├── similarity.ts       # 抽出ロジック（6B）
├── fileNaming.ts       # 命名ロジック（6C）★新規
└── pdfAnalyzer.ts      # PDF分析（6D）★新規

functions/src/ocr/
└── processOCR.ts       # オーケストレーションのみ
```

### 候補数制御

```typescript
// 候補爆発防止
const MAX_CANDIDATES = 10;
const MIN_SCORE_THRESHOLD = 70;
```

---

## テスト戦略

### SEEDデータ活用

```bash
# マスターデータ投入
node scripts/import-masters.js --csv scripts/samples/

# テスト用書類データ作成
# → scripts/samples/ にテスト用CSV追加
```

### 精度検証

| 指標 | 目標 | 測定方法 |
|------|------|----------|
| 顧客名一致率 | 90%以上 | SEEDデータで検証 |
| 書類名一致率 | 95%以上 | SEEDデータで検証 |
| 日付抽出率 | 85%以上 | SEEDデータで検証 |

---

## 元GASコード参照

主要ファイル:
- `docs/reference/gas-source/main-ocr-processor/processFolderOCR.js`
  - L1783: `getBestMatchingCustomerCandidates_()`
  - L1363: `generateOptimalFileName_()`
  - L2565: `getDateFromOCR_()`
  - L2704: `selectMostReasonableDate_()`
  - L2851: `convertFullWidthToHalfWidth_()`
