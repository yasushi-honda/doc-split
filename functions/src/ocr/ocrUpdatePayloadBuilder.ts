/**
 * OCR抽出結果からFirestoreドキュメント更新payloadを組み立てる純粋関数。(Issue #526 D1)
 *
 * processDocument()の後段処理（抽出結果の集約→Firestore update payload生成）を
 * Firestore/Storage/VertexAIの副作用から切り離すことで、直接ユニットテスト可能にする。
 * splitDocumentBuilder.ts と同じ規約: serverTimestamp()/delete() 等のFieldValueは
 * 自前で呼び出さない。ただし `extractedAt` は呼出元が生成したFieldValueをそのまま
 * 受け取り `ocrExtraction` に一体化して返す(後述のレビュー教訓)。
 *
 * `summary` フィールドは意図的に含まない: summaryWritePayloadContract.test.ts が、要約の
 * discriminated union 変換呼出と `summaryTruncated`/`summaryOriginalLength` の
 * FieldValue.delete() が同一update()ブロック内で隣接することを契約テストしており、
 * 呼出元(ocrProcessor.ts)のupdate()呼出に直接書く必要があるため。
 * `status`/`updatedAt` も意図的に含まない: これらは抽出結果ではなくライフサイクル管理
 * フィールドであり、呼出元がupdate()呼出の中で直接書き込む。
 *
 * `extractedAt` を呼出元でのspread後override(オブジェクトキーの「後勝ち」)に頼らず
 * この関数の入力として受け取っているのは、キー順序に安全性が依存する設計を避け、
 * 将来の並び替えで `extractedAt` が静かに失われるリスクを構造的に排除するため。
 *
 * Issue #526 D2: この戻り値は呼出元でconfirmedFieldMerge.tsのconfirmed保護マージを
 * 経てから書き込まれる(customerConfirmed等がtrueのフィールドはこの関数の提案値ではなく
 * 既存ドキュメントの確定値が優先される)。
 *
 * ADR-0018 Phase E (Issue #547): `ocrResult`/`pageResults` は本体update payloadに
 * 含まない(型レベルで本体への値書込みを不可能にする)。detail/mainへの書込みは
 * 呼出元(ocrProcessor.ts)がローカル変数 savedOcrResult/pageResults を直接使う。
 */

import type {
  DocumentExtractionResult,
  CustomerExtractionResult,
  OfficeExtractionResultWithCandidates,
  DateExtractionResult,
  ArbitrationProvenance,
  MatchType,
} from '../utils/extractors';

/**
 * arbitrate*() が返す結果は基底の *ExtractionResult に `provenance` を追加した
 * Arbitrated*ExtractionResult 型だが、本モジュールは基底型のみを要求してきた
 * (provenanceは構造的に無視されていた)。Pass2昇格の可観測化(PR2)のため、
 * provenanceを任意プロパティとして受け取れるよう型を拡張する。
 * オプショナルにしているのは、arbitrationを経ていない呼び出し元(既存テスト等)との
 * 後方互換性を保つため。
 */
type WithOptionalProvenance<T> = T & { provenance?: ArbitrationProvenance };

export interface OcrUpdatePayloadInputs {
  documentTypeResult: WithOptionalProvenance<DocumentExtractionResult>;
  customerResult: WithOptionalProvenance<CustomerExtractionResult>;
  officeResult: WithOptionalProvenance<OfficeExtractionResultWithCandidates>;
  dateResult: WithOptionalProvenance<DateExtractionResult>;
  ocrResultUrl: string | null;
  totalPages: number;
  suggestedNewOffice: string | null;
  /** ocrExtraction.version に書き込むモデルID (呼出元のGEMINI_CONFIG.modelId) */
  modelId: string;
  /** ocrExtraction.extractedAt にそのまま書き込む値 (呼出元のFieldValue.serverTimestamp()) */
  extractedAt: FirebaseFirestore.FieldValue;
}

export interface OcrExtractionMeta {
  version: string;
  extractedAt: FirebaseFirestore.FieldValue;
  customer: {
    suggestedValue: string;
    suggestedId: string | null;
    confidence: number;
    matchType: MatchType;
  };
  office: {
    suggestedValue: string;
    suggestedId: string | null;
    confidence: number;
    matchType: MatchType;
  };
  documentType: {
    suggestedValue: string;
    suggestedId: string | null;
    confidence: number;
    matchType: MatchType;
  };
}

/**
 * summary/summaryTruncated/summaryOriginalLength/status/updatedAt は含まない (呼出元が追加する)。
 * displayFileNameも含まない: Issue #526 D2でconfirmed保護マージ後の最終メタから生成する
 * 順序に変更されたため、この関数の戻り値(マージ前のOCR提案値)からは生成できない。
 * 呼出元(ocrProcessor.ts)がconfirmed保護マージ後にgenerateDisplayFileName()を呼び出す。
 */
export interface OcrExtractionUpdateFields {
  ocrResultUrl: string | null;
  documentType: string;
  customerName: string;
  customerId: string | null;
  careManager: string | null;
  officeName: string;
  officeId: string | null;
  fileDate: Date | null;
  fileDateFormatted: string | null;
  isDuplicateCustomer: boolean;
  needsManualCustomerSelection: boolean;
  customerConfirmed: boolean;
  confirmedBy: null;
  confirmedAt: null;
  allCustomerCandidates: string;
  customerCandidates: Array<{
    customerId: string | null;
    customerName: string;
    isDuplicate: boolean;
    score: number;
    matchType: MatchType;
    careManagerName: string | null;
  }>;
  officeConfirmed: boolean;
  officeConfirmedBy: null;
  officeConfirmedAt: null;
  officeCandidates: Array<{
    officeId: string | null;
    officeName: string;
    shortName: string | null;
    isDuplicate: boolean;
    score: number;
    matchType: MatchType;
  }>;
  suggestedNewOffice: string | null;
  totalPages: number;
  /**
   * Issue #526 D2: documentTypeにはcustomerConfirmed/officeConfirmedのような
   * 確信度ベースの自己判定シグナル(needsManualSelection相当)が存在しないため、
   * OCR自身は常にfalseを書く(documentTypeConfirmedは分割画面でのユーザー選択でのみtrueになる)。
   */
  documentTypeConfirmed: boolean;
  category: string | null;
  extractionScores: {
    documentType: number;
    customerName: number;
    officeName: number;
    date: number;
  };
  extractionDetails: {
    documentMatchType: MatchType;
    documentKeywords: string[];
    customerMatchType: MatchType;
    officeMatchType: MatchType;
    datePattern: string | null;
    dateSource: string | null;
  };
  ocrExtraction: OcrExtractionMeta;
  /**
   * ADR-0025 PR2: Pass2(LLM候補抽出)の候補がarbitrationで昇格したか(=全文ベース抽出を
   * 上書きしたか)をフィールドごとに記録する。個人情報を一切含まないブール値のみ
   * (氏名・事業所名等の実値はここに書かない)。Pass2廃止の可否判断に必要な実データ
   * (昇格率)を実運用ログから計測するための可観測化であり、この値自体は仲裁結果に
   * 一切影響しない(read-only な記録用フィールド)。
   *
   * 【集計時の注意(codex review指摘)】複数顧客FAX複製機能(faxDuplication、ADR-0024)
   * 有効時は、1回のOCR/Pass2実行の結果がdistributionIdを共有する複数documentsエントリ
   * (元doc+顧客ごとの複製)に同一値でコピーされる(applyOcrCompletionTransaction()が
   * mergedを全複製メンバーへspreadするため)。これは他の抽出結果フィールド(totalPages等)
   * と同じ仕様であり意図的(各複製は同じOCR実行結果を正しく反映している)。ただし
   * collection全体で昇格率を集計する際は、distributionId(無ければdoc.id)でグルーピング
   * してから計算しないと、複数顧客宛のFAXの実行結果が複製メンバー数だけ多重計上され、
   * Pass2廃止の可否判断を誤らせる(`scripts/inspect-ocr-volume-stats.js`のtotalPages集計と
   * 同じdedup処理が必要)。
   */
  pass2Promotion: {
    documentType: boolean;
    customerName: boolean;
    officeName: boolean;
    date: boolean;
  };
}

/** 顧客/事業所候補は表示・課金コスト抑制のため先頭5件のみ保持する (#178 既存挙動) */
const MAX_CANDIDATES = 5;

export function buildOcrExtractionUpdatePayload(
  inputs: OcrUpdatePayloadInputs
): OcrExtractionUpdateFields {
  const {
    documentTypeResult,
    customerResult,
    officeResult,
    dateResult,
    ocrResultUrl,
    totalPages,
    suggestedNewOffice,
    modelId,
    extractedAt,
  } = inputs;

  const customerCandidateNames = customerResult.candidates
    .slice(0, MAX_CANDIDATES)
    .map((c) => c.name);

  return {
    ocrResultUrl: ocrResultUrl ?? null,
    documentType: documentTypeResult.documentType || '未判定',
    customerName: customerResult.bestMatch?.name || '不明顧客',
    customerId: customerResult.bestMatch?.id ?? null,
    careManager: customerResult.bestMatch?.careManagerName ?? null,
    officeName: officeResult.bestMatch?.name || '未判定',
    officeId: officeResult.bestMatch?.id ?? null,
    fileDate: dateResult.date ?? null,
    fileDateFormatted: dateResult.formattedDate ?? null,
    isDuplicateCustomer: customerResult.bestMatch?.isDuplicate || false,
    needsManualCustomerSelection: customerResult.needsManualSelection ?? false,
    // Issue #895修正: bestMatch===null(候補ゼロ)の場合、needsManualSelectionは
    // false(仲裁ロジック上「手動選択が必要な複数候補」の状態ではないため)のままだが、
    // これは「確定してよい」ことを意味しない。bestMatch !== nullを明示条件に追加し、
    // 候補ゼロ時に誤ってcustomerConfirmed:trueになる空確定を防ぐ(ADR-0025 PR2)。
    customerConfirmed: !customerResult.needsManualSelection && customerResult.bestMatch !== null,
    confirmedBy: null,
    confirmedAt: null,
    allCustomerCandidates: customerCandidateNames.join(','),
    customerCandidates: customerResult.candidates.slice(0, MAX_CANDIDATES).map((c) => ({
      customerId: c.id ?? null,
      customerName: c.name ?? '',
      isDuplicate: c.isDuplicate || false,
      score: c.score ?? 0,
      matchType: c.matchType ?? 'none',
      careManagerName: c.careManagerName ?? null,
    })),
    // Issue #895修正: customerConfirmedと同じ理由でbestMatch !== nullを明示条件に追加(ADR-0025 PR2)。
    officeConfirmed: !officeResult.needsManualSelection && officeResult.bestMatch !== null,
    officeConfirmedBy: null,
    officeConfirmedAt: null,
    officeCandidates: officeResult.candidates.slice(0, MAX_CANDIDATES).map((o) => ({
      officeId: o.id ?? null,
      officeName: o.name ?? '',
      shortName: o.shortName ?? null,
      isDuplicate: o.isDuplicate || false,
      score: o.score ?? 0,
      matchType: o.matchType ?? 'none',
    })),
    suggestedNewOffice: suggestedNewOffice ?? null,
    totalPages,
    documentTypeConfirmed: false,
    category: documentTypeResult.category ?? null,
    extractionScores: {
      documentType: documentTypeResult.score ?? 0,
      customerName: customerResult.bestMatch?.score ?? 0,
      officeName: officeResult.bestMatch?.score ?? 0,
      date: dateResult.confidence ?? 0,
    },
    extractionDetails: {
      documentMatchType: documentTypeResult.matchType ?? 'none',
      documentKeywords: documentTypeResult.keywords ?? [],
      customerMatchType: customerResult.bestMatch?.matchType ?? 'none',
      officeMatchType: officeResult.bestMatch?.matchType ?? 'none',
      datePattern: dateResult.pattern ?? null,
      dateSource: dateResult.source ?? null,
    },
    ocrExtraction: {
      version: modelId,
      extractedAt,
      customer: {
        suggestedValue: customerResult.bestMatch?.name || '不明顧客',
        suggestedId: customerResult.bestMatch?.id ?? null,
        confidence: customerResult.bestMatch?.score ?? 0,
        matchType: customerResult.bestMatch?.matchType ?? 'none',
      },
      office: {
        suggestedValue: officeResult.bestMatch?.name || '未判定',
        suggestedId: officeResult.bestMatch?.id ?? null,
        confidence: officeResult.bestMatch?.score ?? 0,
        matchType: officeResult.bestMatch?.matchType ?? 'none',
      },
      documentType: {
        suggestedValue: documentTypeResult.documentType || '未判定',
        suggestedId: null,
        confidence: documentTypeResult.score ?? 0,
        matchType: documentTypeResult.matchType ?? 'none',
      },
    },
    pass2Promotion: {
      documentType: documentTypeResult.provenance?.source === 'candidate',
      customerName: customerResult.provenance?.source === 'candidate',
      officeName: officeResult.provenance?.source === 'candidate',
      date: dateResult.provenance?.source === 'candidate',
    },
  };
}
