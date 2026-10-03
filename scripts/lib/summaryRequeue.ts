/**
 * 要約だけを`pending`へ戻す再投入(canary用)の純粋ロジック (通常経路のGemini停止計画 PR-D)
 *
 * `reset-document-to-pending.js`(OCRごとやり直す)と違い、要約キュー用フィールドだけを触る。
 * OCR結果・確定項目・既存の要約本文(`summary`)は更新しない。Sarashinaが成功した時だけ
 * `commitSummaryResult`が要約を上書きし、失敗時は元の要約が残る。
 *
 * Firestoreへ依存しない関数だけを置く(Admin SDKのFieldValueへの変換は実行スクリプト側)。
 */

export const MAX_REQUEUE_IDS = 10;

const DOC_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/** カンマ区切りのdoc_idを検証して返す。1〜10件、重複・不正文字・空要素は例外。 */
export function parseRequeueDocIds(csv: string | undefined): string[] {
  if (!csv || csv.trim() === '') {
    throw new Error('doc_idが空です(1〜10件のカンマ区切りで指定してください)');
  }
  const ids = csv.split(',').map((s) => s.trim());
  if (ids.length > MAX_REQUEUE_IDS) {
    throw new Error(`doc_idは最大${MAX_REQUEUE_IDS}件です(指定: ${ids.length}件)`);
  }
  for (const id of ids) {
    if (!DOC_ID_PATTERN.test(id)) {
      throw new Error('doc_idは英数字・アンダースコア・ハイフンのみ、空要素は不可です');
    }
  }
  if (new Set(ids).size !== ids.length) {
    throw new Error('doc_idに重複があります');
  }
  return ids;
}

export type RequeueEligibility =
  | { eligible: true; fromState: string | null }
  | { eligible: false; reason: 'not-found' | 'not-processed' | 'summary-in-flight' };

/**
 * 再投入できる文書か判定する。OCR完了(status=processed)が前提(`claimSummaryRun`が
 * processedでない文書をskippedへ倒すため)。要約が処理中の文書は実行中のclaimを壊すので拒否する。
 * `summaryState`未設定の旧形式文書は対象(fromState=null)。
 */
export function evaluateRequeueEligibility(data: Record<string, unknown> | undefined): RequeueEligibility {
  if (!data) return { eligible: false, reason: 'not-found' };
  if (data.status !== 'processed') return { eligible: false, reason: 'not-processed' };
  const state = data.summaryState;
  if (state === 'processing') return { eligible: false, reason: 'summary-in-flight' };
  return { eligible: true, fromState: typeof state === 'string' ? state : null };
}

export interface RequeuePlan {
  /** そのまま書き込む値 */
  set: { summaryState: 'pending'; summaryAttemptCount: 0 };
  /** serverTimestampを書き込むフィールド(`updatedAt`は`generateSummaryBatch`のorderBy対象) */
  serverTimestamps: readonly string[];
  /** deleteFieldで消すフィールド(前回の失敗・claimの残骸) */
  deleteFields: readonly string[];
}

/** 更新対象を宣言する。ここに無いフィールドは一切変更しない(テストで固定)。 */
export function buildRequeuePlan(): RequeuePlan {
  return {
    set: { summaryState: 'pending', summaryAttemptCount: 0 },
    serverTimestamps: ['summaryStateUpdatedAt', 'updatedAt'],
    deleteFields: ['summaryError', 'summaryErrorKind', 'summaryRunId'],
  };
}

const BACKUP_FIELDS = [
  'summaryState',
  'summaryAttemptCount',
  'summaryProvider',
  'summaryError',
  'summaryErrorKind',
  'summaryRunId',
] as const;

export interface StateBackup {
  docId: string;
  state: Record<(typeof BACKUP_FIELDS)[number], unknown>;
}

/**
 * 再投入前の状態フィールドだけを控える。要約本文・OCR本文は実PIIを含みうるため含めない
 * (ローカルディスクに実PIIを置かない運用)。
 */
export function buildStateBackup(docId: string, data: Record<string, unknown>): StateBackup {
  const state = {} as StateBackup['state'];
  for (const field of BACKUP_FIELDS) {
    state[field] = data[field] ?? null;
  }
  return { docId, state };
}

export interface RequeueGateInput {
  /** デプロイ済み`generateSummaryBatch`の環境変数SUMMARY_PROVIDER(実機値) */
  l1Provider: string | undefined;
  /** settings/features.sarashinaSummary */
  flag: unknown;
  /** settings/features.sarashinaSummaryAllowlist(未設定=null=全許可、[]=全拒否) */
  allowlist: string[] | null;
}

export type RequeueGateResult = { ok: true } | { ok: false; reason: string };

/**
 * 再投入しても実際にSarashinaで処理されるかをfail-closedで確認する。
 * L1/L2が揃っていない状態で`pending`へ戻すと、文書が`skipped`へ倒れる/処理されない。
 */
export function evaluateRequeueGate(input: RequeueGateInput, docIds: readonly string[]): RequeueGateResult {
  if (input.l1Provider !== 'sarashina') {
    return { ok: false, reason: `SUMMARY_PROVIDERが'sarashina'ではありません(実値: ${input.l1Provider ?? '未設定'})` };
  }
  if (input.flag !== true) {
    return { ok: false, reason: 'settings/features.sarashinaSummaryが明示的にtrueではありません' };
  }
  if (input.allowlist !== null) {
    const outside = docIds.filter((id) => !input.allowlist!.includes(id));
    if (outside.length > 0) {
      return { ok: false, reason: `許可リスト外のdoc_idがあります: ${outside.join(',')}` };
    }
  }
  return { ok: true };
}

/**
 * settings/featuresからallowlistを解釈する。本番の`getSarashinaSummaryGate()`と同じ規則にする:
 * フィールド不在=null(未設定=全許可)、存在するが配列でない/非文字列要素を含む=[](全拒否)。
 * 不正値を「未設定」と読むと、再投入した文書をバッチが`skipped`へ倒してしまう。
 */
export function resolveAllowlist(settings: Record<string, unknown> | undefined): string[] | null {
  if (!settings || !('sarashinaSummaryAllowlist' in settings)) return null;
  const raw = settings.sarashinaSummaryAllowlist;
  if (!Array.isArray(raw) || raw.some((v) => typeof v !== 'string')) return [];
  return raw as string[];
}

/**
 * 再投入前の状態を1行のkey=value(値はURIエンコード)で表す。GitHub Actionsのログは波括弧を
 * マスキングで潰すため、JSONではロールバック記録として使えない。未設定(null)は空値で出す。
 */
export function formatStateBackupLine(backup: StateBackup): string {
  const cell = (v: unknown): string => (v === null || v === undefined ? '' : encodeURIComponent(String(v)));
  return [`docId=${cell(backup.docId)}`, ...BACKUP_FIELDS.map((f) => `${f}=${cell(backup.state[f])}`)].join(' ');
}
