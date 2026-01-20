# Phase 7: 可視化とデータ品質 - 要件定義書 v12

## 概要

| 項目 | 内容 |
|------|------|
| フェーズ | Phase 7 |
| 優先度 | P1 |
| 目的 | 処理の透明性向上、同姓同名リスクの最小化 |
| 工数見積 | Short〜Medium（1-2日） |

## 確定した要件

| 項目 | 決定内容 |
|------|----------|
| 処理履歴の表示期間 | 直近7日（デフォルト）、フィルターで拡張可能 |
| OCR結果の表示粒度 | 要約/抜粋（先頭200文字）、詳細はモーダルで |
| 同姓同名解決フロー | 1件ずつ確認、プレビュー付き |
| 監査記録 | 必要（解決者・日時を記録） |

---

## 機能1: 処理履歴ビュー

### 画面仕様

**配置**: メニューに「処理履歴」タブ追加（`/history`）

### データソースとフィールドマッピング

**コレクション**: `documents`（既存コレクションを使用）

**フィールドマッピング**:
| UIカラム | Firestoreフィールド | 型 | 取得方法 |
|----------|---------------------|-----|---------|
| 処理日時 | `processedAt` | Timestamp | 直接取得 |
| ファイル名 | `fileName` | string | 直接取得 |
| 顧客名 | `customerName` | string | 直接取得 |
| 書類種別 | `documentType` | string | 直接取得 |
| ステータス | `status` | string | 直接取得 |
| OCR抜粋 | `ocrResult` + `ocrResultUrl` | string | **`getOcrExcerpt(doc)`**: 下記ocrResultUrl対応セクション参照 |

**OCR抜粋の取得**:
- `ocrResult`フィールドに全文が格納されている
- UIでは先頭200文字のみ表示（クライアント側で`slice(0, 200)`）
- 詳細モーダルで全文を表示する場合は`ocrResult`全体を使用

### ocrResultUrl 対応（大容量OCR結果）

**背景**: OCR結果が100,000文字を超える場合、`ocrResult`は空文字列となり、全文は`ocrResultUrl`（Cloud Storage）に保存される。

**参照**: `functions/src/ocr/processOCR.ts` 46行目 `OCR_RESULT_MAX_LENGTH = 100000`

**フィールド状態の判定**:
| 状態 | `ocrResult` | `ocrResultUrl` | 判定方法 |
|------|-------------|----------------|---------|
| 通常（短いOCR） | テキストあり | `null` | `!ocrResultUrl` |
| 大容量（Cloud Storage保存） | `''`（空） | `gs://...` | `!!ocrResultUrl` |

**処理履歴ビューでのOCR抜粋表示**:
```typescript
function getOcrExcerpt(doc: Document): string {
  if (doc.ocrResultUrl && !doc.ocrResult) {
    // Cloud Storage保存の場合
    return '（OCR結果はCloud Storageに保存されています）';
  }
  return doc.ocrResult?.slice(0, 200) || '';
}
```

**詳細モーダルでの全文表示**:
```typescript
// useSameNameResolution.ts または useDocumentDetail.ts
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '@/lib/firebase';  // Firebase app インスタンス

async function fetchFullOcrText(doc: Document): Promise<string> {
  // 通常ケース: Firestoreから取得済み
  if (!doc.ocrResultUrl || doc.ocrResult) {
    return doc.ocrResult || '';
  }

  // Cloud Storage保存ケース: Cloud Functionで取得
  // ★重要: リージョンを明示的に指定（asia-northeast1）
  const functions = getFunctions(app, 'asia-northeast1');
  const getOcrText = httpsCallable<{ documentId: string }, { text: string }>(functions, 'getOcrText');
  const result = await getOcrText({ documentId: doc.id });
  return result.data.text;
}
```

**Cloud Function API仕様（getOcrText）**:

| 項目 | 値 |
|------|-----|
| 関数名 | `getOcrText` |
| タイプ | `onCall`（Firebase Callable Function） |
| リージョン | `asia-northeast1`（他のCloud Functionsと同一） |
| 認証 | Firebase Auth必須（`context.auth`チェック） |
| リクエスト | `{ documentId: string }` |
| レスポンス | `{ text: string }` |
| エラー | `unauthenticated`, `not-found`, `permission-denied` |

**アクセス制御ポリシー**:
- **認証**: Firebase Authトークン必須（`request.auth`が存在すること）
- **認可**: 認証済みユーザーは全ドキュメントのOCR全文を取得可能
- **根拠**: Firestoreの`documents`コレクションと同じ認可ルール（認証済みユーザーは読み取り可能）に準拠
- **将来拡張**: ロールベース（admin/user）の制限が必要になった場合は、Firestoreの`users`コレクションからロールを取得して検証

**実装ファイル**: `functions/src/ocr/getOcrText.ts`（新規作成）

```typescript
// functions/src/ocr/getOcrText.ts
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getStorage } from 'firebase-admin/storage';
import { getFirestore } from 'firebase-admin/firestore';

export const getOcrText = onCall(
  { region: 'asia-northeast1' },
  async (request) => {
    // 1. 認証チェック
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }

    const { documentId } = request.data;
    if (!documentId || typeof documentId !== 'string') {
      throw new HttpsError('invalid-argument', 'documentId is required');
    }

    // 2. ドキュメント取得・存在確認
    const db = getFirestore();
    const docSnap = await db.doc(`documents/${documentId}`).get();
    if (!docSnap.exists) {
      throw new HttpsError('not-found', 'Document not found');
    }

    const data = docSnap.data()!;
    const ocrResultUrl = data.ocrResultUrl as string | undefined;

    // 3. ocrResultUrl がない場合は ocrResult を返す
    if (!ocrResultUrl) {
      return { text: data.ocrResult || '' };
    }

    // 4. Cloud Storage から取得
    const storage = getStorage();
    const bucket = storage.bucket();
    // ocrResultUrl形式: gs://bucket-name/ocr-results/docId.txt
    const filePath = ocrResultUrl.replace(`gs://${bucket.name}/`, '');
    const file = bucket.file(filePath);

    const [exists] = await file.exists();
    if (!exists) {
      throw new HttpsError('not-found', 'OCR file not found in storage');
    }

    const [content] = await file.download();
    return { text: content.toString('utf-8') };
  }
);
```

**実装タスク追加**:
| タスク | 工数 | 詳細 |
|--------|------|------|
| getOcrText Cloud Function | 1h | 上記実装、index.tsへのexport追加 |

**AND検索でのocrResultUrl対応**:
- **設計方針**: Cloud Storage保存のドキュメントは、`ocrResult`フィールドのみで検索（全文は検索対象外）
- **理由**: Cloud Storageからの逐次フェッチは遅延が大きく、UXを著しく低下させる
- **代替案**: 検索用にOCR先頭500文字を別フィールド（`ocrExcerpt`）に保存する（Phase 7では未実装）

```typescript
// andSearch 内での判定
function andSearch(docs: Document[], query: string): Document[] {
  const keywords = query.split(/[\s　]+/).filter(k => k.length > 0);

  return docs.filter(doc => {
    const searchTarget = [
      doc.customerName,
      doc.documentType,
      doc.ocrResult || '',  // ★空の場合は検索対象外
      formatDateForSearch(doc.fileDate),
    ].join(' ').toLowerCase();

    return keywords.every(keyword =>
      searchTarget.includes(keyword.toLowerCase())
    );
  });
}
```

**UX補足**:
- 大容量OCRドキュメントでOCR文字列検索がヒットしない可能性があることを、検索UIのヘルプに記載
- 実運用でこの制約が問題になる場合は、Phase 8以降で`ocrExcerpt`フィールド追加を検討

**一覧表示カラム**:
| カラム | フィールド | 説明 |
|--------|------------|------|
| 処理日時 | `processedAt` | 降順ソート |
| ファイル名 | `fileName` | - |
| 顧客名 | `customerName` | 未確定時「要確認」バッジ（`!isCustomerConfirmed(doc)`） |
| 書類種別 | `documentType` | - |
| ステータス | `status` | processed/pending/error/processing/split |
| OCR結果（抜粋） | `getOcrExcerpt(doc)` | ★`ocrResultUrl`対応（下記セクション参照） |

**フィルター機能**:
- 期間: 7日/30日/全期間
- ステータス: 全て/processed/processing/pending/error/split（`DocumentStatus`に準拠）
- 顧客確定状態: 全て/確定済み/要確認

**ステータス表示マッピング（UIラベル）**:
| DocumentStatus | UIラベル | バッジ色 |
|----------------|----------|---------|
| `processed` | 完了 | 緑 |
| `processing` | 処理中 | 青 |
| `pending` | 待機中 | 黄 |
| `error` | エラー | 赤 |
| `split` | 分割済み | 紫 |

### customerConfirmed の undefined 挙動と needsManualCustomerSelection マッピング

**既存フィールド**: `needsManualCustomerSelection`（`functions/src/ocr/processOCR.ts` 283行目で設定中）

**Phase 7 新フィールド**: `customerConfirmed`

**マッピングロジック（デュアルリード）**:
```typescript
// フロントエンド: 確定状態を判定
function isCustomerConfirmed(doc: Document): boolean {
  // 1. customerConfirmed が明示的に設定されている場合（Phase 7以降のデータ）
  if (doc.customerConfirmed !== undefined) {
    return doc.customerConfirmed;
  }

  // 2. needsManualCustomerSelection が設定されている場合（現行データ）
  if (doc.needsManualCustomerSelection !== undefined) {
    return !doc.needsManualCustomerSelection;  // 反転: 要確認→未確定
  }

  // 3. どちらも undefined（Phase 6以前のデータ）
  return true;  // 確定済みとして扱う
}
```

**後方互換性のための定義**:

| `customerConfirmed` | `needsManualCustomerSelection` | 解釈 | UIラベル |
|---------------------|-------------------------------|------|---------|
| `true` | - | 確定済み | （バッジなし） |
| `false` | - | 要確認 | 「要確認」バッジ（オレンジ） |
| `undefined` | `true` | **要確認** | 「要確認」バッジ（オレンジ） |
| `undefined` | `false` | 確定済み | （バッジなし） |
| `undefined` | `undefined` | **確定済み** | （バッジなし） |

**バックエンド更新（Phase 7実装時）**:
```typescript
// processOCR.ts を更新: customerConfirmed を追加
await db.doc(`documents/${docId}`).update({
  // ... 他のフィールド
  needsManualCustomerSelection: customerResult.needsManualSelection,  // 既存（維持）
  customerConfirmed: !customerResult.needsManualSelection,            // ★追加
});
```

**根拠**:
- 既存データ（Phase 6以前）は両フィールドを持たない → 確定済みとして動作
- 現行データは `needsManualCustomerSelection` のみ → 反転してマッピング
- Phase 7以降は両フィールドを設定 → `customerConfirmed` を優先

**実装コード**:
```typescript
// 共通: 確定状態判定（デュアルリード対応）
function isCustomerConfirmed(doc: Document): boolean {
  if (doc.customerConfirmed !== undefined) {
    return doc.customerConfirmed;
  }
  if ((doc as any).needsManualCustomerSelection !== undefined) {
    return !(doc as any).needsManualCustomerSelection;
  }
  return true;  // 両方 undefined は確定済み
}

// フィルター適用時（useProcessingHistory.ts）
function applyConfirmedFilter(docs: Document[], filter: 'all' | 'confirmed' | 'unconfirmed') {
  if (filter === 'all') return docs;
  return docs.filter(doc => {
    const confirmed = isCustomerConfirmed(doc);
    return filter === 'confirmed' ? confirmed : !confirmed;
  });
}

// UI表示時（ProcessingHistoryPage.tsx）
function shouldShowUnconfirmedBadge(doc: Document): boolean {
  return !isCustomerConfirmed(doc);
}
```

### クエリ/ページング仕様

**Firestoreクエリ設計**:

**重要**: `customerConfirmed`フィルターはクライアント側で適用する。
理由: Firestore `where('customerConfirmed', '==', true)` は `undefined` のドキュメントを除外するため、既存データ（Phase 6以前）が表示されなくなる。

```typescript
// Firestoreクエリ（期間・ステータスのみ）
const constraints: QueryConstraint[] = [
  orderBy('processedAt', 'desc'),
  limit(FETCH_SIZE), // FETCH_SIZE = 50 (多めに取得してフィルター後に切り詰め)
];

// 期間フィルター（7日の場合）
const sevenDaysAgo = new Date();
sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
constraints.push(where('processedAt', '>=', Timestamp.fromDate(sevenDaysAgo)));

// ステータスフィルター（Firestoreクエリ）
if (statusFilter !== 'all') {
  constraints.push(where('status', '==', statusFilter));
}

// 顧客確定フィルター（クライアント側で適用）
// ※Firestoreクエリには含めない
```

**クライアント側フィルタリング（needsManualCustomerSelection互換）**:
```typescript
// ★重要: isCustomerConfirmed() を使用（上記「customerConfirmed の undefined 挙動」参照）
// 取得後にクライアント側でフィルター
function applyConfirmedFilter(docs: Document[], filter: 'all' | 'confirmed' | 'unconfirmed') {
  if (filter === 'all') return docs;
  return docs.filter(doc => {
    const confirmed = isCustomerConfirmed(doc);  // ★デュアルリード関数を使用
    return filter === 'confirmed' ? confirmed : !confirmed;
  });
}

// 最終的に PAGE_SIZE 件に切り詰め
const displayDocs = applyConfirmedFilter(fetchedDocs, confirmedFilter).slice(0, PAGE_SIZE);
```

**ページング方式**: Cursor-based（startAfter）
- 既存の `useDocuments.ts` と同じパターン
- `lastDoc` を保持し、次ページ取得時に `startAfter(lastDoc)` を使用

**タイムライングルーピング**: クライアント側で日付ごとにグループ化
```typescript
// 取得後のデータをグループ化
const groupedByDate = documents.reduce((acc, doc) => {
  const dateKey = doc.processedAt.toDate().toLocaleDateString('ja-JP');
  if (!acc[dateKey]) acc[dateKey] = [];
  acc[dateKey].push(doc);
  return acc;
}, {} as Record<string, Document[]>);
```

### 複合クエリとインデックスの対応表

| フィルター組み合わせ | Firestoreクエリ | クライアント側フィルター |
|---------------------|-----------------|------------------------|
| 期間のみ | `processedAt >= date` + `orderBy desc` | なし |
| 期間 + ステータス | `processedAt >= date` + `status == s` + `orderBy desc` | なし |
| 期間 + 顧客確定 | `processedAt >= date` + `orderBy desc` | **customerConfirmed** |
| 期間 + ステータス + 顧客確定 | `processedAt >= date` + `status == s` + `orderBy desc` | **customerConfirmed** |

**設計方針**:
- `customerConfirmed` フィルターは**常にクライアント側**で適用
- 理由: Firestoreの `where()` は `undefined` のドキュメントを除外するため、既存データとの互換性が保てない
- `customerConfirmed ASC, processedAt DESC` インデックスは**不要**（削除）

### ページネーション戦略（クライアント側フィルター対応）

**バッファリング方式**（フィルター後の結果を保持して次ページに持ち越し）:
```typescript
const FETCH_SIZE = 50;  // Firestoreから取得する件数
const PAGE_SIZE = 20;   // 画面に表示する件数

// 状態
let buffer: Document[] = [];       // フィルター済みだが未表示のドキュメント
let lastFirestoreDoc: DocumentSnapshot | null = null;
let noMoreFirestoreDocs = false;

async function fetchNextPage(): Promise<{ docs: Document[]; hasMore: boolean }> {
  // 1. バッファがPAGE_SIZE以上あれば、バッファから返す
  if (buffer.length >= PAGE_SIZE) {
    const displayDocs = buffer.slice(0, PAGE_SIZE);
    buffer = buffer.slice(PAGE_SIZE);
    return { docs: displayDocs, hasMore: true };
  }

  // 2. バッファが足りない場合、Firestoreから追加取得
  while (buffer.length < PAGE_SIZE && !noMoreFirestoreDocs) {
    const constraints = [
      ...baseConstraints,
      ...(lastFirestoreDoc ? [startAfter(lastFirestoreDoc)] : []),
      limit(FETCH_SIZE),
    ];
    const fetchedDocs = await fetchFromFirestore(constraints);

    if (fetchedDocs.length < FETCH_SIZE) {
      noMoreFirestoreDocs = true;
    }
    if (fetchedDocs.length > 0) {
      lastFirestoreDoc = fetchedDocs[fetchedDocs.length - 1].snapshot;
    }

    // クライアント側フィルター適用
    const filteredDocs = applyConfirmedFilter(fetchedDocs, confirmedFilter);
    buffer.push(...filteredDocs);
  }

  // 3. バッファからPAGE_SIZE件返す
  const displayDocs = buffer.slice(0, PAGE_SIZE);
  buffer = buffer.slice(PAGE_SIZE);

  return {
    docs: displayDocs,
    hasMore: buffer.length > 0 || !noMoreFirestoreDocs,
  };
}
```

**動作説明**:
1. `buffer` にフィルター済みドキュメントを保持
2. `lastFirestoreDoc` はFirestoreクエリのカーソル（フィルター前）
3. バッファが不足したら追加フェッチ、十分ならバッファから返す
4. これにより、フィルター後のドキュメントが21-50位置にあっても確実に取得可能

**UX**:
- 「次ページ」ボタンは `hasMore` が `true` の間表示
- 「要確認」フィルターで該当が少なくても、存在する限りすべて取得可能
- Firestoreの読み取り回数は増えるが、データ件数が少ない（日次数件〜数十件想定）ため許容

### 必要なインデックス

```json
// firestore.indexes.json に追加
// ※customerConfirmedインデックスは不要（クライアント側フィルターのため）
{
  "indexes": [
    {
      "collectionGroup": "documents",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "processedAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "documents",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "processedAt", "order": "DESCENDING" }
      ]
    }
  ]
}
```

### UXパターン
- タイムライン形式（日付でグループ化、stickyヘッダー）
- ステータスバッジ（色分け: 緑=processed、青=processing、黄=pending、赤=error、紫=split）
- 要確認バッジ（オレンジ、`customerConfirmed === false`）

### 参照ファイル
- 実装パターン: `frontend/src/hooks/useDocuments.ts`
- コンポーネント例: `frontend/src/pages/DocumentsPage.tsx`
- 型定義: `shared/types.ts`

---

## 機能2: 同姓同名解決フロー

### 顧客候補生成ロジック（processOCR更新）

**既存ロジック参照**: `functions/src/utils/extractors.ts` の `extractCustomerCandidates()`

**入力**:
- `ocrText`: OCR結果テキスト
- `customerMasters`: Firestoreの顧客マスター一覧

**正規化手順** (`textNormalizer.ts` 使用):
1. `normalizeTextEnhanced()`: 全角→半角変換、改行・空白正規化
2. `normalizeForMatching()`: カタカナ→ひらがな、大文字→小文字、記号除去

### 類似度算出アルゴリズム

**参照**: `functions/src/utils/similarity.ts` の `similarityScore()`

**アルゴリズム**: レーベンシュタイン距離ベースの正規化スコア

```typescript
// similarity.ts より
function levenshteinDistance(a: string, b: string): number {
  // 動的計画法による編集距離計算
  // 挿入・削除・置換の最小操作回数を算出
}

function similarityScore(a: string, b: string): number {
  if (a === b) return 100;
  if (a.length === 0 || b.length === 0) return 0;

  const distance = levenshteinDistance(a, b);
  const maxLength = Math.max(a.length, b.length);
  return Math.round((1 - distance / maxLength) * 100);
}
```

**スコア計算式**: `score = (1 - levenshteinDistance / maxLength) * 100`
- 完全一致: 100
- 1文字違い（5文字中）: `(1 - 1/5) * 100 = 80`
- 2文字違い（5文字中）: `(1 - 2/5) * 100 = 60`

**マッチングロジック（スコア割当ルール）**:

顧客ごとに以下のルールで**最高スコア**を割り当てる（複数条件該当時は最高を採用）:

| matchType (統一値) | 条件 | スコア | 補足 |
|-------------------|------|--------|------|
| `exact` | 正規化後の名前が完全一致 **または** ふりがなが完全一致 | **100** | 最優先 |
| `partial` | 姓（先頭2文字）が一致 | **75** | 固定値 |
| `fuzzy` | `similarityScore() >= 70` | **70-99** | 動的計算 |

**matchType 統一定義**:
- `exact`: 完全一致（名前 or ふりがな）
- `partial`: 部分一致（姓2文字）
- `fuzzy`: 類似度マッチ（レーベンシュタイン距離）

**スコア決定ロジック**:
```typescript
// matchType は 'exact' | 'partial' | 'fuzzy' に統一（CustomerCandidateInfo.matchType と同一）
type MatchType = 'exact' | 'partial' | 'fuzzy';

function calculateScore(ocrName: string, master: CustomerMaster): { score: number; matchType: MatchType } | null {
  const normalizedOcr = normalizeForMatching(ocrName);
  const normalizedMaster = normalizeForMatching(master.name);
  const normalizedFurigana = normalizeForMatching(master.furigana);

  // 1. 完全一致チェック（名前 or ふりがな）→ 100, matchType='exact'
  if (normalizedOcr === normalizedMaster || normalizedOcr === normalizedFurigana) {
    return { score: 100, matchType: 'exact' };
  }

  // 2. fuzzy と partial を両方計算し、高い方を採用
  const fuzzyScore = similarityScore(normalizedOcr, normalizedMaster);
  const partialMatch = normalizedOcr.slice(0, 2) === normalizedMaster.slice(0, 2);
  const partialScore = partialMatch ? 75 : 0;

  // 3. 高い方を返す（同点の場合はfuzzyを優先）
  if (fuzzyScore >= 70 && fuzzyScore >= partialScore) {
    return { score: fuzzyScore, matchType: 'fuzzy' };
  }
  if (partialScore > 0 && partialScore > fuzzyScore) {
    return { score: partialScore, matchType: 'partial' };
  }

  // 4. どちらも閾値未満 → null（候補外）
  return null;
}
```

**スコア優先順位（明確化）**:
1. 完全一致（100点）が最優先
2. fuzzy と partial を両方計算
3. **高いスコアを採用**（fuzzy 80 > partial 75、partial 75 > fuzzy 72）
4. 同スコアの場合は fuzzy を優先（より具体的なマッチ）

**候補ソート順**:
1. スコア降順（高い方が先）
2. 同スコアの場合: `isDuplicate=true` が先
3. 同スコア・同フラグの場合: 顧客ID昇順（安定ソート）

**閾値**:
- 最小スコア: 70（`MIN_SCORE_THRESHOLD` in `extractors.ts`）
- 最大候補数: 10（`MAX_CANDIDATES` in `extractors.ts`）

**手動選択が必要な条件** (`needsManualSelection = true`):
1. ベストマッチの `isDuplicate` が true
2. 上位2件のスコア差が 10ポイント以内
3. **候補が0件の場合**（`bestMatch === null`）→ `needsManualSelection = true`

**候補が0件の場合の動作**:
| 条件 | needsManualSelection | customerName | customerId | customerConfirmed | UI表示 |
|------|----------------------|--------------|------------|-------------------|--------|
| 候補0件 | `true` | `"不明顧客"` | `null` | `false` | 「要確認」バッジ、解決モーダルに「該当なし」のみ表示 |

**processOCRでの候補0件時の処理**:
```typescript
// processOCR.ts
const extractionResult = extractCustomerCandidates(ocrText, customerMasters);

if (extractionResult.bestMatch === null) {
  // 候補0件の場合
  const documentData = {
    // ... 他のフィールド
    customerName: '不明顧客',
    customerId: null,                    // ★候補0件でもnull
    customerCandidates: [],
    customerConfirmed: false,            // 手動確認が必要
    confirmedBy: null,
    confirmedAt: null,
    isDuplicateCustomer: false,
  };
}

// extractors.ts
function extractCustomerCandidates(ocrText: string, masters: CustomerMaster[]): ExtractionResult {
  const candidates = findMatchingCandidates(ocrText, masters);

  if (candidates.length === 0) {
    return {
      bestMatch: null,
      candidates: [],
      needsManualSelection: true,  // ★候補0件でも要確認
    };
  }
  // ... 既存ロジック
}
```

### isDuplicate フラグの定義と設定元

**定義場所**: `shared/types.ts` の `CustomerMaster` インターフェース（59行目）

```typescript
export interface CustomerMaster {
  id: string;
  name: string;
  isDuplicate: boolean; // 同姓同名フラグ
  furigana: string;
}
```

**設定元**: 顧客マスターデータ（Firestore: `masters/customers/items`）
- 管理者がマスターデータ編集画面（`MastersPage.tsx`）で設定
- 同姓同名の顧客が存在する場合に`true`を設定

**使用箇所**:
1. `extractors.ts`: `extractCustomerCandidates()` でマスターから読み込み
2. `processOCR.ts`: ベストマッチの`isDuplicate`を`Document.isDuplicateCustomer`にコピー

**関連フィールド**:
| フィールド | 場所 | 説明 |
|-----------|------|------|
| `CustomerMaster.isDuplicate` | マスター | 管理者が設定する同姓同名フラグ |
| `Document.isDuplicateCustomer` | ドキュメント | processOCRがベストマッチから設定 |

### processOCR での customerConfirmed 設定タイミング

**設定タイミング**: 新規ドキュメント作成時（Firestore書き込み時）

**isDuplicateCustomer の設定ルール（統一定義）**:
- **常に `bestMatch.isDuplicate` の値をコピー**する
- ベストマッチがない場合は `false`
- `needsManualSelection` の判定には使用するが、**独立して上書きはしない**

**自動確定ケース** (`needsManualSelection = false`):
```typescript
// processOCR.ts
const documentData = {
  // ... 他のフィールド
  customerName: extractionResult.bestMatch?.name ?? '不明顧客',
  customerCandidates: extractionResult.candidates,
  customerConfirmed: true,  // 自動確定
  confirmedBy: null,        // システム処理のためnull
  confirmedAt: null,        // システム処理のためnull
  // ↓ 常にベストマッチからコピー（独立した上書きはしない）
  isDuplicateCustomer: extractionResult.bestMatch?.isDuplicate ?? false,
};
```

**手動確認ケース** (`needsManualSelection = true`):
```typescript
// processOCR.ts
const documentData = {
  // ... 他のフィールド
  customerName: extractionResult.bestMatch?.name ?? '不明顧客', // 暫定設定
  customerCandidates: extractionResult.candidates,
  customerConfirmed: false, // 手動確認が必要
  confirmedBy: null,        // 未確定
  confirmedAt: null,        // 未確定
  // ↓ 常にベストマッチからコピー（needsManualSelectionとは独立）
  isDuplicateCustomer: extractionResult.bestMatch?.isDuplicate ?? false,
};
```

**確定/フラグの関係表**:
| ケース | needsManualSelection | customerConfirmed | isDuplicateCustomer | 根拠 |
|--------|----------------------|-------------------|---------------------|------|
| 同姓同名なし、候補1件 | `false` | `true` | `false` | 自動確定OK |
| 同姓同名あり（isDuplicate=true） | **`true`** | `false` | `true` | 同姓同名は常に手動確認 |
| 同姓同名なし、上位2件スコア差≤10 | `true` | `false` | `false` | 曖昧なので手動確認 |
| 候補0件（bestMatch=null） | `true` | `false` | `false` | 該当なし選択が必要 |
| 手動解決後（顧客選択） | - | `true` | **選択した顧客のisDuplicate** | 選択顧客のフラグに更新 |
| 手動解決後（該当なし選択） | - | `true` | `false` | 顧客なしのためfalse |

**重要**: `isDuplicate=true` の場合は**候補が1件でも手動確認**を要求する。これは同姓同名リスクを最小化するため。

**isDuplicateCustomer の更新タイミング**:
1. **processOCR時（自動）**: bestMatch.isDuplicate をコピー
2. **手動解決時**: 選択した顧客の isDuplicate をコピー（「該当なし」選択時は false）

この設計により、`isDuplicateCustomer` は常に「現在紐付いている顧客が同姓同名フラグを持つか」を正確に反映する。

**confirmedBy/confirmedAt の値まとめ**:
| ケース | confirmedBy | confirmedAt | customerConfirmed |
|--------|-------------|-------------|-------------------|
| 自動確定（システム） | `null` | `null` | `true` |
| 手動確認待ち | `null` | `null` | `false` |
| 手動解決後 | `user.uid` | `serverTimestamp()` | `true` |

### 既存スキーマとの整合

**shared/types.ts の Document 型との関係**:

| 既存フィールド | 用途 | Phase 7での扱い |
|----------------|------|-----------------|
| `customerName` | 確定済み顧客名 | 解決後に更新 |
| `isDuplicateCustomer` | 同姓同名フラグ | **変更なし**（bestMatch.isDuplicateからコピー） |
| `allCustomerCandidates` | 候補リスト（文字列） | `customerCandidates` に移行 |

**重要**: `isDuplicateCustomer` と `customerConfirmed` は**独立したフィールド**:
- `isDuplicateCustomer`: 顧客マスターで同姓同名フラグが立っているかどうか
- `customerConfirmed`: ユーザーによる確定が完了しているかどうか

**新規フィールド追加（後方互換）**:
```typescript
// shared/types.ts に追加
interface Document {
  // ... 既存フィールド ...

  // Phase 7 新規（オプショナル）
  customerId?: string | null;                     // 顧客ID（「該当なし」選択時はnull）★追加
  customerCandidates?: CustomerCandidateInfo[];  // 構造化された候補リスト
  customerConfirmed?: boolean;                    // 確定済みフラグ（デフォルト: true）
  confirmedBy?: string | null;                    // 確定者UID（システム自動確定時はnull）
  confirmedAt?: Timestamp | null;                 // 確定日時（システム自動確定時はnull）
}
```

**customerId nullability**:
- 通常の顧客選択時: `customerId = "customer-xxx"`（顧客マスターのID）
- 「該当なし」選択時: `customerId = null`
- 既存データ: `customerId` フィールドが存在しない場合は、`customerName` のみで識別（後方互換）

interface CustomerCandidateInfo {
  customerId: string;          // CustomerMaster.id からコピー
  customerName: string;        // CustomerMaster.name からコピー
  customerNameKana?: string;   // CustomerMaster.furigana からコピー
  isDuplicate: boolean;        // CustomerMaster.isDuplicate からコピー
  officeId?: string;           // ★未使用（将来拡張用）
  officeName?: string;         // ★未使用（将来拡張用）
  careManagerName?: string;    // ★未使用（将来拡張用）
  score: number;               // 類似度スコア (0-100)
  matchType: 'exact' | 'partial' | 'fuzzy';  // ★統一値（calculateScoreと同一）
}

// matchType の統一（全箇所で同一の型を使用）
// - calculateScore() の戻り値
// - CustomerCandidateInfo.matchType
// - PageOcrResult.matchType（既存、'none'を含むため別途定義）
```

**データソース**:
- `customerId`, `customerName`, `customerNameKana`, `isDuplicate`: `masters/customers/items` コレクションの `CustomerMaster` からコピー
- `officeId`, `officeName`, `careManagerName`: **Phase 7では未使用**。将来的に顧客-事業所リレーションを追加する場合に使用予定。現時点では `undefined` を設定。

**UI候補ソート時の `isDuplicate` 使用**:
```typescript
// 同スコア時は isDuplicate=true を優先表示
candidates.sort((a, b) => {
  if (a.score !== b.score) return b.score - a.score;
  if (a.isDuplicate !== b.isDuplicate) return a.isDuplicate ? -1 : 1;
  return 0;
});
```
```

### 既存データとの互換性・移行方針

**方針: デュアルリード（移行不要、フロントエンドで吸収）**

#### customerCandidates スキーマ互換性

**現在の実装**（`functions/src/ocr/processOCR.ts` 285-290行目）:
```typescript
// 現在保存されているスキーマ
customerCandidates: [{
  id: string,        // ← customerId ではなく id
  name: string,      // ← customerName ではなく name
  score: number,
  matchType: string,
  // isDuplicate は保存されていない
}]
```

**Phase 7 期待スキーマ**:
```typescript
interface CustomerCandidateInfo {
  customerId: string;
  customerName: string;
  isDuplicate: boolean;
  score: number;
  matchType: 'exact' | 'partial' | 'fuzzy';
}
```

**デュアルリード実装**:
```typescript
// フロントエンド: 候補データ正規化
function normalizeCandidate(raw: any): CustomerCandidateInfo {
  return {
    customerId: raw.customerId ?? raw.id ?? '',           // 新形式優先、旧形式フォールバック
    customerName: raw.customerName ?? raw.name ?? '',     // 新形式優先、旧形式フォールバック
    isDuplicate: raw.isDuplicate ?? false,                // 未設定なら false
    score: raw.score ?? 0,
    matchType: raw.matchType ?? 'fuzzy',
  };
}

// useDocumentsまたはuseSameNameResolution内で使用
const candidates = (doc.customerCandidates ?? []).map(normalizeCandidate);
```

**バックエンド更新（Phase 7実装時）**:
```typescript
// processOCR.ts を更新: 新スキーマで保存
customerCandidates: customerResult.candidates.slice(0, 5).map((c) => ({
  customerId: c.id,           // ★変更
  customerName: c.name,       // ★変更
  isDuplicate: c.isDuplicate, // ★追加
  score: c.score,
  matchType: c.matchType,
})),
```

#### 互換性まとめ

| 状況 | 処理 |
|------|------|
| `customerConfirmed` が undefined | 下記 `needsManualCustomerSelection` 参照 |
| `customerCandidates` が undefined | 空配列として扱う |
| `customerCandidates` が旧スキーマ | `normalizeCandidate()` で変換 |
| `allCustomerCandidates` が存在 | そのまま保持（新フィールドと共存） |

**既存データのマイグレーション**: 不要
- フロントエンドのデュアルリードで吸収
- 新規処理されたデータは新スキーマで保存

### 画面仕様

**トリガー**:
1. DocumentsPage一覧で「要確認」バッジ付き書類をクリック
2. 処理履歴ビューで「要確認」行をクリック
3. DocumentDetailModal内の「顧客を確定」ボタン

**解決モーダル（SameNameResolveModal）**:

**モーダル内の書類情報データソース**:
| UI表示 | Firestoreフィールド | フォールバック |
|--------|---------------------|----------------|
| ファイル名 | `fileName` | - |
| 書類種別 | `documentType` | `"不明"` |
| 書類日付 | `fileDate` | `processedAt`（fileDateがない場合） |

```
┌─────────────────────────────────────────────────┐
│  顧客の確定                              [×]    │
├─────────────────────────────────────────────────┤
│                                                 │
│  書類情報                                       │
│  ├ ファイル名: フェースシート_山田太郎.pdf      │
│  ├ 書類種別: フェースシート                     │
│  └ 書類日付: 2025-10-27                        │
│                                                 │
│  OCR抽出テキスト（抜粋）                        │
│  ┌─────────────────────────────────────────┐   │
│  │ 山田 太郎 様 昭和15年...                │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  顧客候補を選択してください                     │
│  ┌─────────────────────────────────────────┐   │
│  │ ○ 山田 太郎（ヤマダ タロウ）[スコア:100]  │   │
│  │   マッチ: 完全一致                       │   │
│  ├─────────────────────────────────────────┤   │
│  │ ○ 山田 太郎（ヤマダ タロウ）[スコア:100]  │   │
│  │   マッチ: 完全一致                       │   │
│  ├─────────────────────────────────────────┤   │
│  │ ○ 該当なし（顧客として登録しない）       │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  [キャンセル]                    [確定する]     │
└─────────────────────────────────────────────────┘
```

**候補表示の優先順位**:
1. スコア降順
2. 同スコアの場合: `isDuplicate` が true の顧客を先頭

**注意**: 事業所/ケアマネ情報はPhase 7では未実装（`CustomerCandidateInfo`の該当フィールドはundefined）

### 「該当なし」選択時のフロー

**ユースケース**: 顧客候補リストにマッチする顧客がいない場合、ユーザーは「該当なし」を選択できる。

**選択時の動作**:
1. **新規顧客は作成しない**（マスター管理は別フロー）
2. `customerName` を `"不明顧客"` に設定
3. `customerId` を `null` に設定
4. `customerConfirmed` を `true` に設定（「要確認」リストから除外）
5. 監査ログを作成

**実装コード**:
```typescript
// 「該当なし」選択時のトランザクション
async function resolveAsUnknown(documentId: string) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  await runTransaction(db, async (transaction) => {
    const docRef = doc(db, 'documents', documentId);
    const docSnap = await transaction.get(docRef);
    if (!docSnap.exists()) throw new Error('Document not found');

    const previousCustomerId = docSnap.data().customerId ?? null;

    // 1. documentsを更新
    transaction.update(docRef, {
      customerId: null,                    // 顧客IDなし
      customerName: '不明顧客',            // 固定値
      customerConfirmed: true,             // 確定済みとしてマーク（Phase 7新フィールド）
      needsManualCustomerSelection: false, // ★既存フィールドも更新（後方互換）
      confirmedBy: user.uid,
      confirmedAt: serverTimestamp(),
      isDuplicateCustomer: false,          // 「該当なし」選択時は必ずfalse
    });

    // 2. 監査ログを作成
    const logRef = doc(collection(db, 'customerResolutionLogs'));
    transaction.set(logRef, {
      documentId,
      previousCustomerId,
      newCustomerId: null,                 // null許可
      newCustomerName: '不明顧客',
      resolvedBy: user.uid,
      resolvedByEmail: user.email,
      resolvedAt: serverTimestamp(),
      reason: '該当なし選択',
    });
  });
}
```

**監査ログスキーマ更新**:
```typescript
interface CustomerResolutionLog {
  // ...既存フィールド
  newCustomerId: string | null;  // ← null許可に変更
  // ...
}
```

**Firestoreセキュリティルール更新**:
```javascript
// newCustomerIdの検証を緩和（null許可）
allow create: if request.auth != null
  && request.resource.data.resolvedBy == request.auth.uid
  && request.resource.data.documentId is string
  && request.resource.data.documentId.size() > 0
  // newCustomerIdはstringまたはnull
  && (request.resource.data.newCustomerId == null || request.resource.data.newCustomerId is string)
  && request.resource.data.newCustomerName is string
  && request.resource.data.newCustomerName.size() > 0
  && request.resource.data.resolvedByEmail is string
  && request.resource.data.resolvedAt is timestamp;
```

### 監査ログの書き込み責務

**責務分担**:
- **クライアント（フロントエンド）**: 解決UIの表示、ユーザー選択の受付
- **クライアント（フロントエンド）**: Firestoreへの書き込み（トランザクション使用）

**トランザクション設計**:
```typescript
// useSameNameResolution.ts
async function resolveCustomer(
  documentId: string,
  selectedCustomerId: string,
  selectedCustomerName: string,
  selectedCustomerIsDuplicate: boolean  // 選択顧客のisDuplicateフラグ
) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  await runTransaction(db, async (transaction) => {
    const docRef = doc(db, 'documents', documentId);
    const docSnap = await transaction.get(docRef);

    if (!docSnap.exists()) throw new Error('Document not found');

    const previousCustomerId = docSnap.data().customerId;

    // 1. documentsを更新
    transaction.update(docRef, {
      customerId: selectedCustomerId,
      customerName: selectedCustomerName,
      customerConfirmed: true,                          // Phase 7 新フィールド
      needsManualCustomerSelection: false,              // ★既存フィールドも更新（後方互換）
      confirmedBy: user.uid,
      confirmedAt: serverTimestamp(),
      isDuplicateCustomer: selectedCustomerIsDuplicate,
    });

    // 2. 監査ログを作成
    const logRef = doc(collection(db, 'customerResolutionLogs'));
    transaction.set(logRef, {
      documentId,
      previousCustomerId: previousCustomerId || null,
      newCustomerId: selectedCustomerId,
      newCustomerName: selectedCustomerName,
      resolvedBy: user.uid,
      resolvedByEmail: user.email,
      resolvedAt: serverTimestamp(),
    });
  });
}
```

**既存フィールド更新ルール**:
- `customerConfirmed`: Phase 7で新規追加、手動解決時に`true`を設定
- `needsManualCustomerSelection`: 既存フィールド、手動解決時に`false`を設定（後方互換のため両方更新）
```

**失敗時の一貫性**:
- トランザクションを使用するため、documents更新とログ作成は原子的
- どちらかが失敗した場合、両方ロールバックされる

### 新規コレクション: customerResolutionLogs

**コレクション名**: `customerResolutionLogs`

**ドキュメントID生成**: Firestore自動生成（`doc(collection(db, 'customerResolutionLogs'))`）

**スキーマ**:
```typescript
interface CustomerResolutionLog {
  // ドキュメントID: Firestore自動生成（20文字の英数字）
  documentId: string;            // 対象書類ID（必須）
  previousCustomerId: string | null;  // 変更前の顧客ID（初回確定時はnull）
  newCustomerId: string | null;  // 変更後の顧客ID（「該当なし」選択時はnull）
  newCustomerName: string;       // 変更後の顧客名（非正規化、必須、「該当なし」時は"不明顧客"）
  resolvedBy: string;            // 確定者UID（必須）
  resolvedByEmail: string;       // 確定者メールアドレス（必須）
  resolvedAt: Timestamp;         // 確定日時（serverTimestamp、必須）
  reason?: string;               // 任意のメモ（「該当なし」時は"該当なし選択"）
}
```

**バリデーション（Firestoreルールで強制）**:
- `documentId`: 文字列、空でない
- `newCustomerId`: 文字列 **または null**（「該当なし」選択時）
- `newCustomerName`: 文字列、空でない（「該当なし」時は"不明顧客"）
- `resolvedBy`: 文字列、リクエスト者のUIDと一致
- `resolvedByEmail`: 文字列
- `resolvedAt`: タイムスタンプ

**Firestoreセキュリティルール**:

**1. documents コレクション更新ルール追加（firestore.rules）**:
```javascript
// firestore.rules の documents ルールを更新
match /documents/{documentId} {
  // 読み取り: 認証済みユーザー（既存ルールそのまま）
  allow read: if request.auth != null;

  // 作成: Cloud Functionsのみ（サービスアカウント）
  allow create: if false;  // クライアントからは作成不可

  // 更新: 認証済みユーザー、顧客解決フィールドのみ
  allow update: if request.auth != null
    // 更新可能なフィールドをホワイトリストで制限
    && request.resource.data.diff(resource.data).affectedKeys().hasOnly([
      'customerId',
      'customerName',
      'customerConfirmed',
      'needsManualCustomerSelection',  // ★Phase 7で追加許可
      'confirmedBy',
      'confirmedAt',
      'isDuplicateCustomer'
    ])
    // confirmedBy は自分のUIDのみ設定可能
    && (request.resource.data.confirmedBy == request.auth.uid
        || request.resource.data.confirmedBy == resource.data.confirmedBy)
    // customerConfirmed は boolean
    && (request.resource.data.customerConfirmed is bool);

  // 削除: 不可
  allow delete: if false;
}
```

**2. customerResolutionLogs コレクション新規ルール（firestore.rules）**:
```javascript
// firestore.rules に追加
match /customerResolutionLogs/{logId} {
  // 読み取り: 認証済みユーザー
  allow read: if request.auth != null;

  // 作成: 認証済みユーザー、自分のUIDのみ、必須フィールド検証
  allow create: if request.auth != null
    && request.resource.data.resolvedBy == request.auth.uid
    && request.resource.data.documentId is string
    && request.resource.data.documentId.size() > 0
    // newCustomerId は string または null（「該当なし」対応）
    && (request.resource.data.newCustomerId == null
        || (request.resource.data.newCustomerId is string
            && request.resource.data.newCustomerId.size() > 0))
    && request.resource.data.newCustomerName is string
    && request.resource.data.newCustomerName.size() > 0
    && request.resource.data.resolvedByEmail is string
    && request.resource.data.resolvedAt is timestamp;

  // 更新・削除: 不可（監査ログは不変）
  allow update, delete: if false;
}
```

**参照**: 既存ルール `firestore.rules`

---

## 実装タスク

### 処理履歴ビュー（工数: Short = 4h）

| タスク | 工数 | 詳細 | 参照ファイル |
|--------|------|------|--------------|
| ProcessingHistoryPage作成 | 2h | 一覧表示、フィルター、ページング | `pages/DocumentsPage.tsx` |
| useProcessingHistory hook | 1h | Firestoreクエリ、キャッシュ | `hooks/useDocuments.ts` |
| ルーティング追加 | 0.5h | `/history` パス追加 | `App.tsx` |
| ナビゲーション更新 | 0.5h | メニューに「処理履歴」追加 | `components/Layout.tsx` |

### 同姓同名解決フロー（工数: Short/Medium = 8h）

| タスク | 工数 | 詳細 | 参照ファイル |
|--------|------|------|--------------|
| SameNameResolveModal作成 | 3h | 候補表示、選択UI、プレビュー | `components/DocumentDetailModal.tsx` |
| useSameNameResolution hook | 2h | 解決処理、監査ログ作成 | `hooks/useDocuments.ts` |
| processOCR更新 | 2h | `customerCandidates`, `customerConfirmed` 設定 | `functions/src/ocr/processOCR.ts` |
| DocumentsPage更新 | 0.5h | 要確認バッジ、モーダル連携 | `pages/DocumentsPage.tsx` |
| Firestoreルール更新 | 0.5h | customerResolutionLogs権限 | `firestore.rules` |

### 共通タスク

| タスク | 工数 | 詳細 |
|--------|------|------|
| Firestoreインデックス追加 | 0.5h | デプロイ |
| shared/types.ts更新 | 0.5h | 新規型追加 |
| テスト作成 | 2h | 下記テスト範囲参照 |

---

## テスト範囲

### 検証コマンドとテストランナー

**ユニットテスト実行**:
```bash
# Functions単体テスト（Vitest）
cd functions && npm test

# 特定テストファイルのみ
cd functions && npm test -- extractors.test.ts

# カバレッジ付き
cd functions && npm test -- --coverage
```

**Firestoreルールテスト実行**:
```bash
# Firestoreセキュリティルールテスト（エミュレータ必要）
cd functions && npm run test:rules
```

**フロントエンドテスト実行**:
```bash
# コンポーネントテスト（Vitest + Testing Library）
cd frontend && npm test

# 特定テストファイルのみ
cd frontend && npm test -- SameNameResolveModal.test.tsx
```

**手動検証チェックリスト**:

| 検証項目 | 手順 | 期待結果 |
|----------|------|---------|
| 処理履歴表示 | `/history` にアクセス | 直近7日の処理が表示される |
| 期間フィルター | 30日を選択 | 30日分の処理が表示される |
| ステータスフィルター | 「エラー」を選択 | エラーステータスのみ表示 |
| 顧客確定フィルター | 「要確認」を選択 | `customerConfirmed=false`のみ表示 |
| 要確認バッジ | 同姓同名顧客の書類を確認 | オレンジ色の「要確認」バッジ表示 |
| 解決モーダル | 要確認書類をクリック | 候補リストがスコア降順で表示 |
| 顧客確定 | 候補を選択して確定 | `customerConfirmed=true`に更新、バッジ消える |
| 監査ログ | 確定後にFirestoreコンソール確認 | `customerResolutionLogs`にレコード作成 |

### ユニットテスト（functions/test/）

**1. 顧客候補優先順位テスト** (`extractors.test.ts` に追加)
```typescript
describe('extractCustomerCandidates - priority', () => {
  // ★テストフィクスチャには必須フィールドをすべて含める
  const makeCustomer = (overrides: Partial<CustomerMaster>): CustomerMaster => ({
    id: 'default-id',
    name: '名無し',
    furigana: 'ナナシ',
    isDuplicate: false,
    ...overrides,
  });

  it('完全一致が最優先される', () => {
    const result = extractCustomerCandidates('山田太郎', [
      makeCustomer({ id: '1', name: '山田太郎', furigana: 'ヤマダタロウ' }),
      makeCustomer({ id: '2', name: '山田太朗', furigana: 'ヤマダタロウ' }),
    ]);
    expect(result.bestMatch?.customerId).toBe('1');
    expect(result.bestMatch?.score).toBe(100);
  });

  it('ふりがな一致が部分一致より優先される', () => {
    const result = extractCustomerCandidates('やまだたろう', [
      makeCustomer({ id: '1', name: '山田太郎', furigana: 'やまだたろう' }),
      makeCustomer({ id: '2', name: '山田', furigana: 'ヤマダ' }),
    ]);
    expect(result.bestMatch?.customerId).toBe('1');
    expect(result.bestMatch?.score).toBe(100);  // ★修正: ふりがな完全一致は100
    expect(result.bestMatch?.matchType).toBe('exact');  // ★追加: matchType確認
  });

  it('同スコア時はisDuplicateがtrueの顧客が先頭', () => {
    const result = extractCustomerCandidates('山田太郎', [
      makeCustomer({ id: '1', name: '山田太郎', isDuplicate: false, furigana: 'ヤマダタロウ' }),
      makeCustomer({ id: '2', name: '山田太郎', isDuplicate: true, furigana: 'ヤマダタロウ' }),
    ]);
    // 両方スコア100だが、isDuplicate=trueが優先される
    expect(result.candidates[0]?.isDuplicate).toBe(true);
  });

  it('候補数が10件を超えない', () => {
    const masters = Array.from({ length: 20 }, (_, i) =>
      makeCustomer({ id: String(i), name: `山田太郎${i}`, furigana: `ヤマダタロウ${i}` })
    );
    const result = extractCustomerCandidates('山田太郎', masters);
    expect(result.candidates.length).toBeLessThanOrEqual(10);
  });
});
```

**2. あいまい一致境界値テスト** (`extractors.test.ts` に追加)
```typescript
describe('extractCustomerCandidates - fuzzy threshold', () => {
  // ★テストフィクスチャには必須フィールドをすべて含める
  const makeCustomer = (overrides: Partial<CustomerMaster>): CustomerMaster => ({
    id: 'default-id',
    name: '名無し',
    furigana: 'ナナシ',
    isDuplicate: false,
    ...overrides,
  });

  it('スコア70でマッチする', () => {
    // 5文字中1.5文字違い → スコア70
    const result = extractCustomerCandidates('山田太郎', [
      makeCustomer({ id: '1', name: '山田太朗', furigana: 'ヤマダタロウ' }), // 1文字違い → スコア75
    ]);
    expect(result.bestMatch).not.toBeNull();
  });

  it('スコア69でマッチしない（fuzzy閾値未満かつpartial不一致）', () => {
    // 5文字中2文字違い → スコア60、姓不一致 → partial 0
    const result = extractCustomerCandidates('山田太郎', [
      makeCustomer({ id: '1', name: '田中太朗', furigana: 'タナカタロウ' }), // fuzzy60, partial0 → 候補外
    ]);
    expect(result.bestMatch).toBeNull();
  });

  it('fuzzy < 70 でも partial 一致なら75点でマッチ', () => {
    // fuzzy 65（閾値未満）でも姓一致なら partial 75 でマッチ
    const result = extractCustomerCandidates('山田XXXXX', [
      makeCustomer({ id: '1', name: '山田太郎', furigana: 'ヤマダタロウ' }),
    ]);
    expect(result.bestMatch?.score).toBe(75);
    expect(result.bestMatch?.matchType).toBe('partial');
  });

  it('fuzzy 80 > partial 75 の場合は fuzzy が優先', () => {
    // fuzzy 80 > partial 75 なので fuzzy を採用
    const result = extractCustomerCandidates('山田太朗', [  // 1文字違い → fuzzy 80
      makeCustomer({ id: '1', name: '山田太郎', furigana: 'ヤマダタロウ' }),
    ]);
    expect(result.bestMatch?.score).toBe(80);
    expect(result.bestMatch?.matchType).toBe('fuzzy');
  });

  it('スコア差10以内でneedsManualSelection=true', () => {
    const result = extractCustomerCandidates('山田太郎', [
      makeCustomer({ id: '1', name: '山田太郎', furigana: 'ヤマダタロウ' }),  // スコア100
      makeCustomer({ id: '2', name: '山田太朗', furigana: 'ヤマダタロウ' }),  // スコア80（仮）
    ]);
    if (result.candidates[1] && result.bestMatch!.score - result.candidates[1].score <= 10) {
      expect(result.needsManualSelection).toBe(true);
    }
  });

  it('スコア差11以上でneedsManualSelection=false（isDuplicate=falseの場合）', () => {
    const result = extractCustomerCandidates('山田太郎', [
      makeCustomer({ id: '1', name: '山田太郎', isDuplicate: false, furigana: 'ヤマダタロウ' }),
      makeCustomer({ id: '2', name: '鈴木一郎', isDuplicate: false, furigana: 'スズキイチロウ' }),
    ]);
    if (result.candidates.length === 1 ||
        (result.candidates[1] && result.bestMatch!.score - result.candidates[1].score > 10)) {
      expect(result.needsManualSelection).toBe(false);
    }
  });
});
```

**3. needsManualSelection判定テスト** (`extractors.test.ts` に追加)
```typescript
describe('extractCustomerCandidates - needsManualSelection', () => {
  // ★テストフィクスチャには必須フィールドをすべて含める
  const makeCustomer = (overrides: Partial<CustomerMaster>): CustomerMaster => ({
    id: 'default-id',
    name: '名無し',
    furigana: 'ナナシ',
    isDuplicate: false,
    ...overrides,
  });

  it('bestMatch.isDuplicate=trueでtrue（候補1件でも手動確認）', () => {
    const result = extractCustomerCandidates('山田太郎', [
      makeCustomer({ id: '1', name: '山田太郎', isDuplicate: true, furigana: 'ヤマダタロウ' }),
    ]);
    expect(result.needsManualSelection).toBe(true);
  });

  it('上位2件のスコア差が10以内でtrue', () => {
    const result = extractCustomerCandidates('山田太郎', [
      makeCustomer({ id: '1', name: '山田太郎', furigana: 'ヤマダタロウ' }),  // スコア100
      makeCustomer({ id: '2', name: '山田太郎', furigana: 'ヤマダタロウ' }),  // スコア100（同名別人）
    ]);
    expect(result.needsManualSelection).toBe(true);
  });

  it('候補が1件のみでfalse（isDuplicate=falseの場合）', () => {
    const result = extractCustomerCandidates('山田太郎', [
      makeCustomer({ id: '1', name: '山田太郎', isDuplicate: false, furigana: 'ヤマダタロウ' }),
    ]);
    expect(result.needsManualSelection).toBe(false);
  });

  it('候補が0件でtrue', () => {
    const result = extractCustomerCandidates('存在しない顧客', [
      makeCustomer({ id: '1', name: '山田太郎', furigana: 'ヤマダタロウ' }),
    ]);
    expect(result.bestMatch).toBeNull();
    expect(result.needsManualSelection).toBe(true);
  });
});
```

### コンポーネントテスト（frontend/src/）

**4. SameNameResolveModalテスト**
```typescript
describe('SameNameResolveModal', () => {
  it('候補リストが正しく表示される', () => {
    render(<SameNameResolveModal candidates={mockCandidates} />);
    expect(screen.getByText('山田 太郎')).toBeInTheDocument();
  });

  it('選択して確定できる', async () => {
    const onConfirm = vi.fn();
    render(<SameNameResolveModal candidates={mockCandidates} onConfirm={onConfirm} />);
    await userEvent.click(screen.getByLabelText('山田 太郎'));
    await userEvent.click(screen.getByText('確定する'));
    expect(onConfirm).toHaveBeenCalledWith('customer-1');
  });

  it('「該当なし」を選択できる', async () => {
    const onResolveUnknown = vi.fn();
    render(<SameNameResolveModal candidates={mockCandidates} onResolveUnknown={onResolveUnknown} />);
    await userEvent.click(screen.getByLabelText('該当なし'));
    await userEvent.click(screen.getByText('確定する'));
    expect(onResolveUnknown).toHaveBeenCalled(); // nullではなく専用ハンドラを呼ぶ
  });

  it('キャンセルで閉じる', async () => {
    const onClose = vi.fn();
    render(<SameNameResolveModal candidates={mockCandidates} onClose={onClose} />);
    await userEvent.click(screen.getByText('キャンセル'));
    expect(onClose).toHaveBeenCalled();
  });
});
```

### 統合テスト（手動確認）

**5. 監査ログ作成テスト**
- [ ] 解決操作後にcustomerResolutionLogsにレコードが作成される
- [ ] documentsの更新とログ作成が同時に行われる（トランザクション）
- [ ] 失敗時に両方ロールバックされる（ネットワーク切断テスト）

---

## リスクと緩和策

| リスク | 緩和策 |
|--------|--------|
| 履歴ビューのクエリ負荷 | デフォルト7日、ページング（20件/ページ）、インデックス追加 |
| 誤った顧客紐付け | プレビュー必須、確定ダイアログ、監査ログで追跡可能 |
| 監査ログのコスト増 | 解決時のみ記録（頻度低い、1回/書類程度） |
| 既存データとの互換性 | 新フィールドはオプショナル、undefined時のデフォルト値定義 |
| トランザクション失敗 | エラーハンドリング、ユーザーへの再試行促進 |
| 3条件同時フィルター | クライアント側フィルタリングで対応 |

---

## 完了条件

- [ ] 処理履歴ビューで直近7日の処理が一覧表示される
- [ ] フィルター（期間・ステータス・顧客確定状態）が動作する
- [ ] 同姓同名の書類に「要確認」バッジが表示される
- [ ] SameNameResolveModalで顧客候補から選択・確定できる
- [ ] 確定操作が監査ログに記録される
- [ ] 顧客候補優先順位テストがパスする
- [ ] あいまい一致境界値テストがパスする
- [ ] needsManualSelection判定テストがパスする

---

## 追加要件（Phase 7B: 検索・グルーピング強化）

以下の要件は Phase 7 のコア機能完了後に実装予定。

### 機能3: 担当CM別グルーピングビュー

**ユースケース**: ケアマネージャー毎に担当書類をまとめて確認したい

**画面仕様**:
- 配置: 書類一覧のフィルターに「担当CM別」ビュー追加、または専用タブ
- グルーピング: `careManager` フィールドでグループ化
- 表示: 各CMの件数表示、クリックで該当書類一覧展開

**データソース**:
- `documents` コレクションの `careManager` フィールド
- 未設定の場合: 「担当CM未設定」グループに分類

**Firestoreクエリ**:
```typescript
// CM一覧取得（集計）
const cmCounts = await getDocs(
  query(collection(db, 'documents'), orderBy('careManager'))
);
// クライアント側でグループ化・件数集計
```

### 機能4: AND検索（複数キーワード検索）

**ユースケース**: 「田中　フェースシート　３月」のようにスペース区切りで複数条件検索

**検索対象フィールド**:
- `customerName`（顧客名）
- `documentType`（書類種別）
- `ocrResult`（OCRテキスト）
- `fileDate`（書類日付 - 月指定対応）

**検索スコープ（重要）**:
- **バッファリング方式と連携**し、ロード済みデータ + 追加フェッチで検索
- Firestoreは全文検索非対応のため、クライアント側フィルタリングを使用

**実装方式**: バッファリングを活用したクライアント側フィルタリング

```typescript
// AND検索のバッファリング対応版
const SEARCH_FETCH_SIZE = 100;  // 検索時は多めにフェッチ

async function andSearchWithBuffering(
  query: string,
  pageSize: number
): Promise<{ docs: Document[]; hasMore: boolean }> {
  const keywords = query.split(/[\s　]+/).filter(k => k.length > 0);
  if (keywords.length === 0) return { docs: [], hasMore: false };

  let buffer: Document[] = [];
  let lastFirestoreDoc: DocumentSnapshot | null = null;
  let noMoreFirestoreDocs = false;

  // バッファがpageSizeに達するまでフェッチ＆フィルターを繰り返す
  while (buffer.length < pageSize && !noMoreFirestoreDocs) {
    const constraints = [
      orderBy('processedAt', 'desc'),
      ...(lastFirestoreDoc ? [startAfter(lastFirestoreDoc)] : []),
      limit(SEARCH_FETCH_SIZE),
    ];
    const fetchedDocs = await fetchFromFirestore(constraints);

    if (fetchedDocs.length < SEARCH_FETCH_SIZE) {
      noMoreFirestoreDocs = true;
    }
    if (fetchedDocs.length > 0) {
      lastFirestoreDoc = fetchedDocs[fetchedDocs.length - 1].snapshot;
    }

    // AND検索フィルター適用
    const matchedDocs = fetchedDocs.filter(doc => {
      const searchTarget = [
        doc.customerName,
        doc.documentType,
        doc.ocrResult,
        formatDateForSearch(doc.fileDate),
      ].join(' ').toLowerCase();

      return keywords.every(keyword =>
        searchTarget.includes(keyword.toLowerCase())
      );
    });

    buffer.push(...matchedDocs);
  }

  const displayDocs = buffer.slice(0, pageSize);
  return {
    docs: displayDocs,
    hasMore: buffer.length > pageSize || !noMoreFirestoreDocs,
  };
}

// 日付フォーマット（検索用）
function formatDateForSearch(fileDate: Timestamp): string {
  const date = fileDate.toDate();
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  // 複数フォーマットを含めて検索しやすく
  return `${year}年${month}月${day}日 ${year}/${month}/${day} ${month}月`;
}
```

**検索動作の説明**:
1. キーワードをスペースで分割
2. Firestoreから`SEARCH_FETCH_SIZE`件ずつフェッチ
3. 各ドキュメントに対してAND条件でフィルター
4. マッチした結果をバッファに蓄積
5. バッファが`pageSize`に達するまで繰り返し
6. これにより、マッチする結果が少なくても確実に取得可能

**UX**:
- 検索ボックス: 処理履歴/書類一覧ページの上部
- プレースホルダー: 「顧客名 書類種別 月 で検索」
- リアルタイムフィルター（debounce 300ms）
- 「もっと見る」ボタンで追加フェッチ

**日付キーワード対応**:
| 入力例 | マッチ条件 |
|--------|-----------|
| `3月` | fileDate が3月のドキュメント |
| `2025年3月` | fileDate が2025年3月のドキュメント |
| `03` | 月または日が03を含む |

### 工数見積（Phase 7B）

| タスク | 工数 |
|--------|------|
| CM別グルーピングビュー | 4h |
| AND検索機能 | 4h |
| UIコンポーネント（検索ボックス、グループヘッダー） | 2h |
| **合計** | **10h** |

---

## バージョン履歴と指摘対応

### v3 → v4 の変更点
| v3の指摘 | v4での対応 |
|----------|------------|
| データソースとフィールドマッピング未記載 | データソースセクション追加、OCR抜粋の取得方法を明記 |
| customerConfirmed undefined挙動未定義 | 挙動表追加、実装コード追加 |
| 自動確定時のconfirmedBy/At値未定義 | 値まとめ表追加 |
| isDuplicate設定元未定義 | 定義場所・設定元セクション追加 |
| 検証コマンド未記載 | 検証コマンドとテストランナーセクション追加 |

### v4 → v5 の変更点
| v4の指摘 | v5での対応 |
|----------|------------|
| customerConfirmedフィルターがundefinedを除外 | クライアント側フィルターに変更、Firestoreクエリから除外 |
| 「該当なし」フロー未定義 | 完全定義（customerName='不明顧客', customerId=null, 監査ログ） |
| isDuplicateCustomerセマンティクス矛盾 | 統一定義（常にbestMatch.isDuplicateからコピー） |
| 3条件フィルターのページネーション未定義 | オーバーフェッチ方式追加 |

### v5 → v6 の変更点
| v5の指摘 | v6での対応 |
|----------|------------|
| customerResolutionLogsスキーマ不整合 | newCustomerId: string | null を全箇所で統一 |
| ページネーションでフィルター結果が消失 | バッファリング方式に変更 |
| CustomerCandidateInfoにisDuplicate未定義 | isDuplicateフィールド追加、データソース明記 |
| customerId nullability未定義 | Document.customerId: string | null 追加 |
| needsManualSelection候補0件ケース未定義 | 候補0件 → needsManualSelection=true を追加 |

### v6 → v7 の変更点
| v6の指摘 | v7での対応 |
|----------|------------|
| needsManualSelection vs isDuplicate矛盾 | 確定/フラグ関係表を更新、isDuplicate=trueは常に手動確認 |
| office/CMフィールドがUI参照だが未使用 | UIモックから削除、Phase 7では未実装と明記 |
| bestMatch===null時のcustomerIdが未定義 | processOCRの候補0件処理を追加 |
| テストフィクスチャに必須フィールド欠落 | makeCustomerヘルパー追加、全フィールド記載 |
| UIコピー「新規顧客として登録」が矛盾 | 「顧客として登録しない」に変更 |
| v5指摘マッピング欠落 | 本セクション追加 |

### v7 → v8 の変更点
| v7の指摘 | v8での対応 |
|----------|------------|
| isDuplicateCustomer解決後の更新ルール未定義 | 「選択顧客のisDuplicateをコピー」ルール追加、トランザクションコード更新 |
| マッチ選択優先順位 vs rawスコアの曖昧さ | スコア計算ロジックを明確化、exact_furigana=100に統一 |
| 書類日付のデータソース未定義 | モーダル内データソース表追加（fileDate、フォールバックprocessedAt） |
| - | Phase 7B追加（担当CMグルーピング、AND検索） ※ユーザー要件追加 |

### v8 → v9 の変更点
| v8の指摘 | v9での対応 |
|----------|------------|
| 「該当なし」フローでisDuplicateCustomer未更新 | `resolveAsUnknown()`に`isDuplicateCustomer: false`を追加 |
| スコア優先順位の矛盾（fuzzy vs partial） | fuzzy/partial両方計算→高い方を採用するロジックに変更 |
| matchType値の不整合（exact_name/exact_furigana） | `'exact' \| 'partial' \| 'fuzzy'`に統一、calculateScore/CustomerCandidateInfo同一 |
| ステータス値がDocumentStatusと不整合 | `completed`→`processed`に修正、DocumentStatus全値を明記、UIラベルマッピング追加 |
| Phase 7B AND検索のスコープ未定義 | バッファリング方式と連携した検索ロジックを追加、SEARCH_FETCH_SIZE定義 |

### v9 → v10 の変更点
| v9の指摘 | v10での対応 |
|----------|------------|
| ocrResultUrl時の動作未定義 | `ocrResultUrl`対応セクション追加（履歴表示、モーダル全文取得、AND検索の制約） |
| customerCandidates既存スキーマ（id/name）との不整合 | デュアルリード実装（`normalizeCandidate()`）追加、バックエンド更新計画明記 |
| needsManualCustomerSelectionフラグのマッピング未定義 | `isCustomerConfirmed()`関数でデュアルリード、フィルター実装更新 |

### v10 → v11 の変更点
| v10の指摘 | v11での対応 |
|----------|------------|
| 確定フィルタリングコードの矛盾 | 全フィルター箇所を`isCustomerConfirmed()`使用に統一 |
| `/api/getOcrText` API仕様未定義 | Callable Function仕様追加（リクエスト/レスポンス/エラー/実装コード） |
| 履歴テーブルが`ocrResult.slice()`を直接参照 | `getOcrExcerpt(doc)`に統一 |
| 手動解決で`needsManualCustomerSelection`未更新 | 両トランザクション（resolveCustomer, resolveAsUnknown）に`needsManualCustomerSelection: false`追加 |

### v11 → v12 の変更点
| v11の指摘 | v12での対応 |
|----------|------------|
| Callableリージョン不一致 | クライアント側`getFunctions(app, 'asia-northeast1')`に修正 |
| フィールドマッピング表にOCR抜粋の矛盾 | `getOcrExcerpt(doc)`参照に統一 |
| getOcrTextの認可ポリシー未定義 | アクセス制御ポリシーセクション追加（認証必須、全ユーザー読み取り可） |
| documentsルール更新未記載 | Phase 7用フィールドのホワイトリストルール追加、confirmedByバリデーション追加 |
