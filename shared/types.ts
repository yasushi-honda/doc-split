/**
 * DocSplit 共通型定義
 * Firestoreスキーマに基づく型定義
 */

import { Timestamp } from 'firebase/firestore';

// ============================================
// ドキュメント（書類管理）
// ============================================

export type DocumentStatus = 'pending' | 'processing' | 'processed' | 'error' | 'split';

/** ドキュメントのソースタイプ */
export type SourceType = 'gmail' | 'upload';

/**
 * Summary フィールド (Issue #215)
 *
 * discriminated union で「truncated=true ⟹ originalLength 必須」を型レベル保証。
 * illegal state (truncated=true だが originalLength 欠落) を代入不可能にする。
 *
 * - 判別タグ: `truncated: boolean` (TypeScript の narrowing で分岐判定)
 * - truncated=false: `{ text, truncated }` のみ (originalLength は型に存在しない)
 * - truncated=true: `{ text, truncated, originalLength }` (originalLength 必須)
 *
 * 旧フラット形式 (summary/summaryTruncated/summaryOriginalLength) の既存 Firestore ドキュメントは
 * FE firestoreToDocument 側で後方互換読込 (フラット→ネスト変換) する。書込は常に本型。
 */
export type SummaryField =
  | { text: string; truncated: false }
  | { text: string; truncated: true; originalLength: number };

export interface Document {
  id: string;
  processedAt: Timestamp;
  fileId: string;
  fileName: string;
  displayFileName?: string;
  mimeType: string;
  ocrResult: string;
  ocrResultUrl?: string; // 長い場合はCloud Storage参照
  summary?: SummaryField; // AI生成の要約 (Issue #209/#215)
  documentType: string;
  customerName: string;
  officeName: string;
  fileUrl: string;
  fileDate: Timestamp;
  isDuplicateCustomer: boolean;
  allCustomerCandidates?: string;
  totalPages: number;
  targetPageNumber: number;
  status: DocumentStatus;
  sourceType?: SourceType;
  messageId?: string;            // Gmail messageId（重複チェック用）
  careManager?: string;
  category?: string;

  // ページ単位OCR結果（PDF分割用）
  pageResults?: PageOcrResult[];
  splitSuggestions?: SplitSuggestion[];
  pageRotations?: PageRotation[];

  // 分割元ドキュメントへの参照（分割で生成された場合）
  parentDocumentId?: string;
  splitFromPages?: { start: number; end: number };
  // 分割元としてのフラグ・分割先ドキュメントID
  isSplitSource?: boolean;
  splitInto?: string[];

  /**
   * 分割 PDF の identity / provenance fields (ADR-0016 / Issue #445)
   *
   * 移行期間中は optional。lifecycle:
   * - PR-D1 (本 PR): 型定義のみ、書込なし
   * - PR-D2: 新規分割 PDF (splitPdf 改修後) で必須書込 (10 fields 全て)
   * - PR-D3: rotatePdfPages 改修後の rotation 結果で derived 4 fields のみ更新 (source 5 + createdAt は base から完全保持、ADR-0016 MUST 3 / AC14)
   * - PR-D4: 既存 docs への best-effort backfill (親 PDF 現存 + sha256 計算可能ケースのみ)
   * - PR-D5: optional → required 格上げを評価
   *
   * 詳細は docs/adr/0016-document-identity-and-provenance.md 参照
   */
  provenance?: DocumentProvenance;

  /**
   * legacy backfill metadata (ADR-0016 MUST 6 / Issue #445 PR-D4)
   *
   * 意味論:
   * - field absent = PR-D2/D3 で生成された verified provenance (split 完了時刻の正当 bytes 証拠)
   * - field exists = PR-D4 backfill で書込まれた legacy doc (split 時点正当ではない)
   *
   * Consumer は provenance 単独で "verified split-time origin" と判定してはならない (ADR MUST 6 Consumer contract)。
   * rotate gate は backfilled doc を confidence === 'derived-bytes-verified' のみ許可 (ADR MUST 3 拡張)。
   *
   * **判定方法 (Codex 4th review Low 1 反映)**: TypeScript 上の型表面は `undefined` を absence として扱う
   * (`strictNullChecks` 下で `null` 不可)。一方 Firestore 経由で読み込んだ document に `provenanceBackfill: null`
   * が混入する可能性がある (古い書込経路 / 手動修復等)。Consumer は `provenanceBackfill === undefined`
   * ではなく **field 存在チェック** (`'provenanceBackfill' in doc` または等価) または `!= null` (loose) で判定し、
   * truthiness check (`if (provenanceBackfill)`) は **使わない** (空オブジェクト判定の事故を防ぐ)。
   */
  provenanceBackfill?: ProvenanceBackfillMetadata;

  // Phase 7: 顧客確定機能
  //
  // customerConfirmed/officeConfirmed/documentTypeConfirmed 共通の注意点（2026-07-04訂正）:
  // 「デフォルト: true」という値は書込元によって成立しない。通常OCR取り込み(ocrProcessor.ts)は
  // 抽出確信度に応じてtrue/falseを書き分け、手動分割(splitDocumentBuilder.ts)はユーザーが
  // 実際に選択したフィールドのみtrue・未送信時はfalseにフォールバックする。一方で一覧・詳細画面の
  // 一部UIはundefinedを「対応不要」扱いし`=== false`のみで再確認バナーを出す（本フィールド自体は
  // undefinedを確定済み相当として黙って許容する設計、この非対称性は既知のものとして扱うこと）。
  customerId?: string | null;                    // 顧客ID（「該当なし」選択時はnull）
  customerCandidates?: CustomerCandidateInfo[];  // 構造化された候補リスト
  customerConfirmed?: boolean;                   // 確定済みフラグ（上記注意点を参照）
  confirmedBy?: string | null;                   // 確定者UID（システム自動確定時・未確定時はnull）
  confirmedAt?: Timestamp | null;                // 確定日時（システム自動確定時・未確定時はnull）
  needsManualCustomerSelection?: boolean;        // 後方互換用（Phase 6以前）

  // 事業所確定機能
  officeId?: string | null;                      // 事業所ID（「該当なし」選択時はnull）
  officeCandidates?: OfficeCandidateInfo[];      // 構造化された候補リスト
  officeConfirmed?: boolean;                     // 確定済みフラグ（上記注意点を参照）
  officeConfirmedBy?: string | null;             // 確定者UID（システム自動確定時・未確定時はnull）
  officeConfirmedAt?: Timestamp | null;          // 確定日時（システム自動確定時・未確定時はnull）
  suggestedNewOffice?: string | null;            // ファイル名から抽出された事業所名（登録提案用）

  // 書類種別確定機能 (Issue #526: 手動分割時の確定入力をOCR再解析から保護するため)
  documentTypeConfirmed?: boolean;               // 確定済みフラグ（上記注意点を参照。By/Atは持たない）

  // Phase 8: グループ化用正規化キー（Cloud Functionsで自動設定）
  customerKey?: string;       // customerName正規化版
  officeKey?: string;         // officeName正規化版
  documentTypeKey?: string;   // documentType正規化版
  careManagerKey?: string;    // careManager正規化版

  // Phase 9: OCR抽出スナップショット（正解フィードバック用）
  ocrExtraction?: OcrExtraction;

  // 抽出スコア（各フィールドの信頼度）
  extractionScores?: ExtractionScores;
  // 抽出詳細（マッチ方法・キーワード等）
  extractionDetails?: ExtractionDetails;

  // OCR結果確認ステータス（人によるチェック状態）
  verified?: boolean;           // 確認済みフラグ（デフォルト: false）
  verifiedBy?: string | null;   // 確認者UID
  verifiedAt?: Timestamp | null; // 確認日時
}

// ============================================
// ADR-0018: Firestore egress削減のためのサブコレクション分離 (Issue #547)
// ============================================

/**
 * pageResults として実際に永続化される shape。
 *
 * `functions/src/ocr/buildPageResult.ts` の `RawPageOcrResult` と同一だが、
 * shared/types.ts は functions/ 配下の型を import できない（shared/ の独立性）ため
 * ここに複製定義する。shared/types.ts の `PageOcrResult`(`PageOcrMeta & SummaryField`、
 * detectedDocumentType 等の検出メタ合成後の post-processed shape) とは
 * **structurally incompatible**(Issue #278 で意図的に分離された別 shape)。
 * `Document.pageResults` フィールドの型宣言(`PageOcrResult[]`)はこの不一致を
 * 引き継いだ既存の型不正確さであり、新設する `DocumentDetail` では実際に
 * 書き込まれる shape に合わせて正しく型付けする(Codex review #556 P2 反映)。
 */
export type PersistedPageOcrResult = SummaryField & {
  pageNumber: number;
  inputTokens: number;
  outputTokens: number;
};

/**
 * `documents/{docId}/detail/main` サブコレクションドキュメントの型。
 *
 * Issue #547 (Firestore egress削減) の対応として、`Document` 本体から
 * `ocrResult` / `pageResults` の2フィールドのみを分離する（Phase E完了後、
 * 本体からは削除される）。他の重フィールド（customerCandidates等）は
 * FE複数箇所（ExtractionInfoPopover / 一覧バッジ判定）が依存するため
 * 本体に残置する（ADR-0018 Alternatives Considered A案 参照）。
 *
 * 移行フェーズ（ADR-0016 PR-D1〜D5パターン踏襲）:
 * - Phase A (本型定義): 書込ロジック変更なし
 * - Phase B (dual-write): 本体 + 本サブコレクションへ同一transaction/batchで同時書込
 * - Phase C (backfill): 既存docへの一括作成
 * - Phase D (dual-read cutover): FE/Functions双方の読込先切替
 * - Phase E (destructive): 本体からocrResult/pageResultsを削除（egress削減の本丸）
 *
 * 詳細: docs/adr/0018-document-detail-subcollection-separation.md
 */
export interface DocumentDetail {
  ocrResult: string;
  pageResults?: PersistedPageOcrResult[];
}

// ============================================
// ADR-0016: 分割 PDF Identity / Provenance (Issue #445)
// ============================================

/**
 * 分割 PDF の provenance fields (ADR-0016 / Issue #445)
 *
 * 親 PDF identity (source*) + 子 object identity (derived*) + audit (createdAt) の 10 fields。
 *
 * 書込タイミング:
 * - PR-D2 (splitPdf 改修後): 新規分割 PDF で 10 fields 全て必須書込
 * - PR-D3 (rotatePdfPages 改修後): rotation 結果で derived 4 fields のみ更新 (source 5 + createdAt は base から完全保持、AC14 / ADR-0016 MUST 3)
 * - PR-D4 (backfill): 既存 docs に対し best-effort で書込 (親 PDF 現存 + sha256 計算可能ケースのみ)
 *
 * MUST 5 (ADR-0016): sourceSha256 / sourceGeneration / sourceMetageneration は
 * 「実際に split に使用した parent PDF bytes」と同一 read snapshot で取得・整合検証する。
 *
 * 注意: createdAt は audit / トレース用途のみで、bytes identity 照合対象ではない。
 * PR-C3c (PR #452) の自動復旧 gate (6-field provenance) と混同しない。
 *
 * 詳細: docs/adr/0016-document-identity-and-provenance.md
 */
export interface DocumentProvenance {
  /** 親 Storage object generation (split 時点の同一 read snapshot で取得) */
  sourceGeneration: string;
  /** 親 Storage object metageneration */
  sourceMetageneration: string;
  /** 親 PDF bytes の sha256 (hex)、実際に split に使用した buffer から計算 (MUST 5) */
  sourceSha256: string;
  /** 親 Storage bucket 内 object name (split 時点、`gs://` prefix は含まない) */
  sourcePath: string;
  /** 親 Storage bucket 名 */
  sourceBucket: string;
  /** 子 (本 doc) の canonical Storage path (`processed/{docId}/{fileName}`) */
  derivedObjectPath: string;
  /** 子 Storage object 書込後の generation */
  derivedGeneration: string;
  /** 子 Storage object 書込後の metageneration */
  derivedMetageneration: string;
  /** 子 PDF bytes の sha256 (hex)、子 object 書込後に compute / metadata 取得 */
  derivedSha256: string;
  /** provenance 書込時刻 (= split 完了時刻)。audit field、bytes identity 照合対象ではない */
  createdAt: Timestamp;
}

/**
 * Backfill confidence 階層 (ADR-0016 MUST 6)
 *
 * 高 → 低:
 * - `derived-bytes-verified`: parent + child 現存、再 split で sha256 一致 (Issue #432 silent corruption 被害なし)
 * - `child-snapshot-only`: 現 child sha256/generation 実計算記録のみ、parent 不在 or 再 split 不一致
 *   (壊れた legacy bytes の可能性あり、dev/test fixture のみで作成、本番 Phase C では原則記録しない)
 * - `metadata-only`: child GCS metadata のみで sha256 実計算スキップ (PR-D4 では原則禁止、明示 approval 必要)
 *
 * rotate gate 動作 (ADR MUST 3 拡張):
 * - `derived-bytes-verified`: allow
 * - `child-snapshot-only` / `metadata-only`: failed-precondition reject
 */
export type BackfillConfidence =
  | 'derived-bytes-verified'
  | 'child-snapshot-only'
  | 'metadata-only';

/**
 * Backfill 時に記録する 5 分類カテゴリ (ADR-0016 MUST 6 evidence.classifierCategory、Codex 2nd review I7 反映)。
 *
 * 内訳:
 * - PR-C3c classifier 4 メンバー (`scripts/lib/collisionClassifier.ts` の `Classification`):
 *   `MatchedByHash | RepairableMissingFile | Ambiguous | LostOrUnrecoverable`
 * - PR-D4 で追加した classifier 通過不能ケースのフォールバック: `NeedsManualReview`
 *   (splitFromPages 不在 / dual parent 等で classifier に渡せない doc を記録するための値、
 *   impl-plan §8 fixture 拡張表参照)
 *
 * `Classification` を直接 import せず別定義する理由: `shared/` は `scripts/` に依存できない
 * (frontend bundle 経路 + layer 規約)。drift 防止は doc-audit と PR review でカバーする。
 */
export type BackfillClassifierCategory =
  | 'MatchedByHash'
  | 'RepairableMissingFile'
  | 'Ambiguous'
  | 'LostOrUnrecoverable'
  | 'NeedsManualReview';

/**
 * 既存 docs への legacy backfill metadata (ADR-0016 MUST 6 / PR-D4)
 *
 * 必須記録項目:
 * - `method`: enum で将来別 method を追加する余地を残す
 * - `confidence`: 階層化された信頼度 (rotate gate 動作と連動)
 * - `backfilledAt`: backfill 実行時刻 (≠ provenance.createdAt = split 完了時刻、Codex 1st Critical 2 反映)
 * - `evidence`: 再現性 / 監査用の現物計算情報
 *
 * MUST 7 (ADR-0016): provenance exists + provenanceBackfill absent な doc は immutable skip。
 * 既存 verified provenance を低信頼度 backfill で破壊する経路を構造的に閉鎖する。
 */
export interface ProvenanceBackfillMetadata {
  /** backfill 方法 (enum、将来拡張余地) */
  method: 'legacy-observed';
  /** rotate gate 動作と連動する confidence 階層 */
  confidence: BackfillConfidence;
  /** backfill 実行時刻 (≠ provenance.createdAt) */
  backfilledAt: Timestamp;
  /** 再現性 / 監査用の現物計算情報 */
  evidence: {
    /** 親 Storage object が backfill 時点で存在したか */
    parentExists: boolean;
    /** 再 split で sha256 一致を検証した場合 true、未検証 null */
    parentSha256MatchedAtBackfill: boolean | null;
    /** child object から sha256 を実計算したか */
    childSha256ComputedAtBackfill: boolean;
    /** 例: 'pr-d4-v1.0' (script 改修で再 backfill 区別) */
    backfillScriptVersion: string;
    /** PR-C3c classifier 出力 (Codex 2nd review I7 反映) */
    classifierCategory: BackfillClassifierCategory;
  };
}

// ============================================
// Phase 9: OCR抽出スナップショット
// ============================================

/** OCRフィールド単位の抽出情報 */
export interface OcrFieldExtraction {
  suggestedValue: string;      // OCRが提案した値
  suggestedId?: string | null; // マッチしたマスターID（あれば）
  confidence: number;          // 信頼度スコア (0-100)
  matchType: string;           // マッチタイプ (exact/partial/fuzzy/none)
}

/** OCR抽出スナップショット（正解フィードバック用） */
export interface OcrExtraction {
  version: string;             // OCRモデルバージョン (例: "gemini-2.5-flash")
  extractedAt: Timestamp;      // 抽出日時
  customer?: OcrFieldExtraction;
  office?: OcrFieldExtraction;
  documentType?: OcrFieldExtraction;
}

// ============================================
// 抽出スコア・詳細情報
// ============================================

/** 各フィールドの抽出信頼度スコア */
export interface ExtractionScores {
  documentType: number;   // 書類種別スコア (0-100)
  customerName: number;   // 顧客名スコア (0-100)
  officeName: number;     // 事業所名スコア (0-100)
  date: number;           // 日付スコア (0-100)
}

/** 抽出方法の詳細情報 */
export interface ExtractionDetails {
  documentMatchType: string;     // 書類種別のマッチタイプ
  documentKeywords?: string[];   // マッチしたキーワード
  customerMatchType: string;     // 顧客名のマッチタイプ
  officeMatchType: string;       // 事業所名のマッチタイプ
  datePattern?: string | null;   // 日付の抽出パターン
  dateSource?: string | null;    // 日付の抽出元
}

// ============================================
// Phase 8: グループ化ビュー
// ============================================

/** グループ化タイプ */
export type GroupType = 'customer' | 'office' | 'documentType' | 'careManager';

/** グループ内のプレビュードキュメント */
export interface GroupPreviewDoc {
  id: string;
  fileName: string;
  documentType: string;
  processedAt: Timestamp;
}

/** ドキュメントグループ（サマリー情報） */
export interface DocumentGroup {
  id: string;                   // グループID: {groupType}_{groupKey}
  groupType: GroupType;         // グループ化タイプ
  groupKey: string;             // グループキー（正規化された値）
  displayName: string;          // 表示名（元の値）
  count: number;                // グループ内ドキュメント数
  latestAt: Timestamp;          // 最新処理日時
  latestDocs: GroupPreviewDoc[]; // プレビュー用（最新3件）
  updatedAt: Timestamp;         // 集計更新日時
}

// ============================================
// マスターデータ
// ============================================

/**
 * マスターデータ共通型 (#338 統合)
 *
 * Firestore 実態に合わせて optionality を統一。書き込み時に欠落するケース (CSV import 前の
 * partial / 旧スキーマ移行中) や sanitize*Masters (functions/src/utils/sanitizeMasterData.ts)
 * で undefined 正規化されるケースがあるため、reader 側は optional 前提でアクセスする。
 *
 * 履歴: #337 で BE/FE で optionality 乖離 (BE extractors.ts は既に optional) が判明、#338 で shared 側を
 * optional に寄せて一本化。FE で required 前提アクセスがあった箇所は `?? fallback` で防御 (MastersPage.tsx)。
 */
export interface DocumentMaster {
  id?: string;        // FirestoreドキュメントID（フロントエンド取得時に設定）
  name: string;
  dateMarker?: string; // 日付抽出の目印（例: "発行日"）。Firestore 実態で欠損するケースあり (#338)
  category?: string;   // 分類（例: "医療"）。Firestore 実態で欠損するケースあり (#338)
  keywords?: string[]; // 照合用キーワード（例: ["被保険者証", "介護保険"]）
  aliases?: string[];  // 許容される別表記（例: ["介護保険被保険者証", "被保険者証明書"]）
}

export interface CustomerMaster {
  id: string;
  name: string;
  isDuplicate?: boolean; // 同姓同名フラグ。sanitize で欠損ケースあり (#338)
  furigana?: string;     // Firestore 実態で欠損ケースあり、sanitize で undefined 正規化 (#338)
  careManagerName?: string; // 担当ケアマネジャー名
  aliases?: string[];  // 許容される別表記（例: ["田中　太郎", "たなか太郎"]）
  notes?: string;      // 区別用補足情報（例: "北名古屋在住"）
}

export interface OfficeMaster {
  id: string;              // ドキュメントID
  name: string;
  nameKey?: string;        // 正規化キー（検索用）
  shortName?: string;
  isDuplicate?: boolean;   // 同名フラグ。sanitize で欠損ケースあり (#338)
  aliases?: string[];      // 許容される別表記（例: ["北名古屋市東部地域包括支援センター"]）
  notes?: string;          // 区別用補足情報（例: "東部"）
}

export interface CareManagerMaster {
  id?: string;           // ドキュメントID
  name: string;          // 氏名
  email?: string;        // メールアドレス（Google Workspace）
  aliases?: string[];    // 別表記（例: ["田中 太郎", "たなか太郎"]）
}

// ============================================
// Phase 7: 顧客候補情報
// ============================================

/** 顧客候補のマッチタイプ */
export type CustomerMatchType = 'exact' | 'partial' | 'fuzzy';

/** 顧客候補情報（processOCRで生成、同姓同名解決モーダルで表示） */
export interface CustomerCandidateInfo {
  customerId: string;          // CustomerMaster.id からコピー
  customerName: string;        // CustomerMaster.name からコピー
  customerNameKana?: string;   // CustomerMaster.furigana からコピー
  isDuplicate: boolean;        // CustomerMaster.isDuplicate からコピー
  officeId?: string;           // 将来拡張用
  officeName?: string;         // 将来拡張用
  careManagerName?: string;    // 将来拡張用
  notes?: string;              // 区別用補足情報
  score: number;               // 類似度スコア (0-100)
  matchType: CustomerMatchType;
}

// ============================================
// 事業所候補情報
// ============================================

/** 事業所候補のマッチタイプ */
export type OfficeMatchType = 'exact' | 'partial' | 'fuzzy';

/** 事業所候補情報（processOCRで生成、同名解決モーダルで表示） */
export interface OfficeCandidateInfo {
  officeId: string;            // OfficeMaster.id からコピー
  officeName: string;          // OfficeMaster.name からコピー
  shortName?: string;          // OfficeMaster.shortName からコピー
  isDuplicate: boolean;        // OfficeMaster.isDuplicate からコピー
  notes?: string;              // 区別用補足情報
  score: number;               // 類似度スコア (0-100)
  matchType: OfficeMatchType;
}

// ============================================
// Phase 7: 顧客解決監査ログ
// ============================================

/** 顧客解決監査ログ */
export interface CustomerResolutionLog {
  documentId: string;               // 対象書類ID
  previousCustomerId: string | null; // 変更前の顧客ID（初回確定時はnull）
  newCustomerId: string | null;     // 変更後の顧客ID（「該当なし」選択時はnull）
  newCustomerName: string;          // 変更後の顧客名（「該当なし」時は"不明顧客"）
  resolvedBy: string;               // 確定者UID
  resolvedByEmail: string;          // 確定者メールアドレス
  resolvedAt: Timestamp;            // 確定日時
  reason?: string;                  // 任意のメモ（「該当なし」時は"該当なし選択"）
}

/** 事業所解決監査ログ */
export interface OfficeResolutionLog {
  documentId: string;               // 対象書類ID
  previousOfficeId: string | null;  // 変更前の事業所ID（初回確定時はnull）
  newOfficeId: string | null;       // 変更後の事業所ID（「該当なし」選択時はnull）
  newOfficeName: string;            // 変更後の事業所名（「該当なし」時は"不明事業所"）
  resolvedBy: string;               // 確定者UID
  resolvedByEmail: string;          // 確定者メールアドレス
  resolvedAt: Timestamp;            // 確定日時
  reason?: string;                  // 任意のメモ（「該当なし」時は"該当なし選択"）
}

// ============================================
// エイリアス学習履歴
// ============================================

export type AliasLearningMasterType = 'office' | 'customer' | 'document';

export interface AliasLearningLog {
  id: string;
  masterType: AliasLearningMasterType;
  masterId: string;
  masterName: string;
  alias: string;
  learnedBy: string;
  learnedByEmail: string;
  learnedAt: Timestamp;
}

// ============================================
// エラー履歴
// ============================================

export type ErrorType =
  | 'OCR完全失敗'
  | 'OCR部分失敗'
  | '情報抽出エラー'
  | 'ファイル処理エラー'
  | 'システムエラー';

export type ErrorStatus = '未対応' | '対応中' | '完了';

export interface ErrorRecord {
  errorId: string;
  errorDate: Timestamp;
  errorType: ErrorType;
  fileName: string;
  fileId: string;
  totalPages: number;
  successPages: number;
  failedPages: number;
  failedPageNumbers: string[];
  errorDetails: string;
  fileUrl: string;
  status: ErrorStatus;
}

// ============================================
// Gmail受信ログ
// ============================================

export interface GmailLog {
  fileName: string;
  hash: string; // MD5ハッシュ（重複検知用）
  fileSizeKB: number;
  emailSubject: string;
  processedAt: Timestamp;
  fileUrl: string;
  emailBody: string;
}

// ============================================
// アップロードログ
// ============================================

export interface UploadLog {
  fileName: string;
  hash: string; // MD5ハッシュ（重複検知用）
  fileSizeKB: number;
  uploadedAt: Timestamp;
  uploadedBy: string; // UID
  uploadedByEmail: string;
  fileUrl: string;
}

// ============================================
// アプリ設定
// ============================================

export type LabelSearchOperator = 'AND' | 'OR';

export interface AppSettings {
  targetLabels: string[]; // 監視対象Gmailラベル
  targetSenders: string[]; // 監視対象送信元メールアドレス
  labelSearchOperator: LabelSearchOperator;
  errorNotificationEmails: string[];
  gmailAccount?: string; // 監視対象Gmailアカウント
}

// ============================================
// ユーザー管理
// ============================================

export type UserRole = 'admin' | 'user';

export interface User {
  uid: string;
  email: string;
  displayName?: string;
  role: UserRole;
  createdAt: Timestamp;
  lastLoginAt: Timestamp;
}

// ============================================
// 定数（ビジネスロジック設定値）
// ============================================

export const CONSTANTS = {
  /** 顧客名・事業所名の類似度閾値（0-100） */
  CUSTOMER_SIMILARITY_THRESHOLD: 70,

  /** 書類名検索時のOCRテキスト先頭文字数 */
  DOCUMENT_NAME_SEARCH_RANGE_CHARS: 200,

  /** 日付マーカー後の検索文字数 */
  DATE_MARKER_SEARCH_RANGE_CHARS: 50,

  /** 未識別情報の代替文字列 */
  STATUS_UNDETERMINED: '未判定',

  /** 不明書類の代替文字列 */
  FILE_NAME_UNKNOWN_DOCUMENT: '不明文書',

  /** 不明顧客の代替文字列 */
  FILE_NAME_UNKNOWN_CUSTOMER: '不明顧客',
} as const;

// ============================================
// ページ単位OCR結果（PDF分割用）
// ============================================

/**
 * ページ単位OCR結果のメタ情報（分割判定用）。
 * #258: SummaryField (text/truncated/originalLength) を合成して discriminated union 化することで、
 * truncated=true ⟹ originalLength 必須を型レベル保証。
 * meta 部のみを参照したい caller (split 判定など) のために export。
 */
export type PageOcrMeta = {
  pageNumber: number;
  detectedDocumentType: string | null;
  detectedCustomerName: string | null;
  detectedOfficeName: string | null;
  detectedDate: Date | null;
  matchScore: number; // マッチ精度スコア（0-100）
  matchType: 'exact' | 'partial' | 'none';
};

export type PageOcrResult = PageOcrMeta & SummaryField;

export interface SplitSuggestion {
  afterPageNumber: number; // このページの後で分割
  reason: SplitReason;
  confidence: number; // 確信度（0-100）
  newDocumentType: string | null;
  newCustomerName: string | null;
}

export type SplitReason =
  | 'new_customer' // 新しい顧客が検出された
  | 'new_document_type' // 新しい書類種別が検出された
  | 'content_break' // 内容の明確な区切り
  | 'manual'; // ユーザーが手動で追加

export interface SplitPreview {
  segments: SplitSegment[];
}

export interface SplitSegment {
  startPage: number;
  endPage: number;
  suggestedFileName: string;
  documentType: string;
  customerName: string;
  customerId?: string | null;
  officeName: string;
  officeId?: string | null;
  fileDate: Date | null;
  /** 顧客候補リスト */
  customerCandidates?: Array<{
    id: string;
    name: string;
    score: number;
    isDuplicate: boolean;
    careManagerName?: string;
  }>;
  /** 事業所候補リスト */
  officeCandidates?: Array<{
    id: string;
    name: string;
    score: number;
    isDuplicate: boolean;
  }>;
  /** 手動選択が必要か（顧客） */
  needsManualCustomerSelection?: boolean;
  /** 手動選択が必要か（事業所） */
  needsManualOfficeSelection?: boolean;
  /** 同姓同名の顧客か */
  isDuplicateCustomer?: boolean;
  /** 担当ケアマネ名 */
  careManagerName?: string | null;
  /**
   * 確定フラグ（Issue #526）: 分割画面でユーザーが実際に選択した値かどうか。
   * サーバー側ではID有無から推測しない（自動検出候補にもIDが付くため誤判定しうる）。
   * フロントエンドが `isValidCustomerSelection` 等の判定結果をそのまま送信する。
   */
  customerConfirmed?: boolean;
  officeConfirmed?: boolean;
  documentTypeConfirmed?: boolean;
}

// ============================================
// PDF編集操作
// ============================================

export interface PageRotation {
  pageNumber: number;
  rotation: 0 | 90 | 180 | 270;
}

export interface PdfEditRequest {
  documentId: string;
  operations: PdfOperation[];
}

export type PdfOperation =
  | { type: 'rotate'; pageNumber: number; degrees: 90 | 180 | 270 }
  | { type: 'split'; afterPageNumber: number }
  | { type: 'delete'; pageNumber: number };

