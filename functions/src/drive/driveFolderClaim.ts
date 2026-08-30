/**
 * Google Drive フォルダ claim プロトコル(Issue #871 恒久対策、ADR-0022 Decision 4 追記)
 *
 * `findOrCreateFolder.ts`のfind-or-createが「同名フォルダの作成事実」を原子的に
 * 記録するための状態機械。既存の`driveFolderLocks`コレクション(ドキュメントID生成
 * `buildFolderLockId()`)を拡張する形で実装し、新規コレクションは作らない。
 *
 * 背景(診断結果はIssue #871参照): Google Drive APIの`files.list`は`files.create`
 * 直後の検索で新規作成したファイルを返さないことがある(結果整合性の遅延)。
 * 旧`acquireFolderLock`/`releaseFolderLock`は「作成事実」を記録せず単なる排他制御
 * だったため、1件目の作成→ロック解放→数秒後に2件目が同じparent+nameを検索して
 * 0件(索引未反映)→ロックを自由に獲得→再検索も0件→再作成、という経路を防げなかった。
 * 本モジュールは「作成の予約(creating)→確定(resolved)」を単一ドキュメント・
 * 単一トランザクションで扱うことで、この経路を塞ぐ。
 *
 * 状態遷移: `(なし) → creating(beginCreation) → resolved(commitResolvedWithRetry)`。
 * 異常系は`invalidated`(従来の`files.list`探索へフォールバック許可)または
 * `divergent`(claimと実体が食い違っている、人手介入待ち。削除も再作成もしない)。
 *
 * 旧形式ドキュメント(`state`欠損、`{claimedAtMs, lockToken}`のみ)は`normalizeClaim()`で
 * `state:'creating', attempt:null`として解釈できるため、マイグレーション不要。
 * `childFolderResolver.ts`(PR-4で本プロトコルへ移行予定)が引き続きこの旧形式で
 * 読み書きする間も、`beginCreation()`のリース判定(`claimedAtMs`/`attempt.startedAtMs`)は
 * 両形式を区別なく扱えるため後方互換。
 *
 * 段階導入(shadowモード、`isDriveFolderClaimReadEnabled()`): claimの書き込みは常時
 * 行う(既存挙動への影響ゼロの純粋な追加)。claimを信用して`files.list`/`files.get`を
 * 短絡してよいかどうかだけをフラグで制御し、本番で3者(claim/files.get/files.list)の
 * 一致率を検証してから読み経路を有効化する(計画: `~/.claude/plans/moonlit-jumping-alpaca.md`)。
 */

import { drive_v3 } from 'googleapis';
import * as admin from 'firebase-admin';
import { randomUUID } from 'node:crypto';
import {
  SUPPORTS_ALL_DRIVES,
  DOCSPLIT_FOLDER_CLAIM_KEY,
  escapeQueryValue,
} from './driveApiConstants';

/** claimドキュメントの永続化先(トップレベルコレクション、Admin SDK専有)。 */
export const FOLDER_LOCKS_COLLECTION = 'driveFolderLocks';

/**
 * 'creating'状態のリースを保有中とみなす期間。PR-2(#872)で120秒→10分へ是正済み。
 * `driveExportScheduled.ts`の`DRIVE_EXPORT_STUCK_EXPORTING_THRESHOLD_MS`と同値。
 * リースは常にプロセス最大寿命(`timeoutSeconds:120`)より十分長くなければならない。
 */
export const FOLDER_LOCK_STALE_MS = 10 * 60 * 1000;

/** 作り立てのfolderIdに対しては`files.get`を呼ばない(自傷404の防止)。 */
export const CREATE_TRUST_MS = 60 * 1000;

/** この期間内はfiles.getのみで健全性を確認し、完全な`files.list`検索を省略する。 */
export const SOFT_TTL_MS = 5 * 60 * 1000;

/** 'creating'のリース失効後、attemptId検索で作成事実を回収するまでの猶予。 */
export const RECONCILE_GRACE_MS = 10 * 60 * 1000;

/**
 * claimドキュメントのネイティブTTL(Firestore `expireAt`)。日数。
 *
 * codex review P2指摘: `expireAt`フィールドへの書き込みだけではFirestoreは自動削除しない。
 * 環境ごとに`firestore.indexes.json`のインデックス変更と同様CI/CD対象外の手動手順として、
 * `driveFolderLocks`コレクションに対しTTLポリシーを別途プロビジョニングする必要がある
 * (例: `gcloud firestore fields ttls update expireAt --collection-group=driveFolderLocks
 * --enable-ttl --project=<project-id>`、またはFirebase/GCPコンソール)。未実施の環境では
 * `expireAt`は単なるデータであり、resolved/divergentのclaimは無期限に蓄積し続ける
 * (計画`~/.claude/plans/moonlit-jumping-alpaca.md`のロールアウトPhase 1でdev/cocoro/
 * kanameone各環境へのrules配備と併せて実施することになっている手順、PR-3のコード
 * デプロイだけでは完結しない)。
 */
export const CLAIM_TTL_DAYS = 180;

/** 404が何回連続したらclaimを`invalidated`にしてよいか。 */
export const MISS_THRESHOLD = 3;

/** 404累積の判定に必要な経過時間(この間隔を跨がない限りinvalidateしない)。 */
export const MISS_WINDOW_MS = 10 * 60 * 1000;

export type ClaimState = 'creating' | 'resolved' | 'invalidated' | 'divergent';

export interface FolderClaimAttempt {
  attemptId: string;
  startedAtMs: number;
  runId: string | null;
}

export interface FolderClaimDoc {
  state: ClaimState;
  lockToken?: string;
  claimedAtMs?: number;
  folderId?: string;
  attempt: FolderClaimAttempt | null;
  resolvedAtMs?: number;
  verifiedAtMs?: number;
  lastFullScanAtMs?: number;
  missCount?: number;
  firstMissAtMs?: number;
  missRunIds?: string[];
  parentId: string;
  name: string;
}

export type ResolvedFolderClaim = FolderClaimDoc & { state: 'resolved'; folderId: string };

/**
 * 2件以上見つかった場合にthrow(`findOrCreateFolder.ts`と共有)。
 * `reconcileAttempt()`のattemptIdタグ検索でも同じ意味(claimが指すはずの作成が
 * 2件のフォルダとして観測された=矛盾)で使う。
 */
export class AmbiguousFolderError extends Error {
  constructor(name: string, parentId: string, count: number) {
    super(
      `フォルダ名が重複しているため解決できません(${count}件): "${name}"（親フォルダ: ${parentId}）`
    );
    this.name = 'AmbiguousFolderError';
  }
}

/**
 * 同一parent+nameのフォルダ作成/解決が別の実行で進行中の場合にthrow。
 * `driveExportStatus:'error'`へ遷移させ、次回スイープで自動リトライされる。
 */
export class FolderCreationInProgressError extends Error {
  constructor(name: string, parentId: string) {
    super(
      `フォルダ作成が別の処理で進行中のため待機します: "${name}"（親フォルダ: ${parentId}）`
    );
    this.name = 'FolderCreationInProgressError';
  }
}

/**
 * `files.get`が404を返したが、まだclaimを無効化するに至っていない(疑いであり証明ではない)。
 * transient扱い: 呼び出し元は`error`ステータスへ遷移し、次回スイープで自然にリトライされる。
 */
export class FolderVerificationPendingError extends Error {
  constructor(name: string, parentId: string) {
    super(
      `既存フォルダの健全性確認が保留中です(404を検知しましたが確定していません): "${name}"（親フォルダ: ${parentId}）`
    );
    this.name = 'FolderVerificationPendingError';
  }
}

/** `files.get`が403(権限不足)を返した。フォルダ自体は存在するとみなしclaimは無変更。 */
export class DrivePermissionError extends Error {
  constructor(name: string, parentId: string, folderId: string) {
    super(
      `Drive APIへのアクセス権限が不足しています(フォルダは存在するとみなします): "${name}"（親フォルダ: ${parentId}、folderId: ${folderId}）`
    );
    this.name = 'DrivePermissionError';
  }
}

/**
 * claimが指すfolderIdと実体(`files.get`のparents、または完全再検索の結果)が食い違う。
 * 人手介入待ち。削除も再作成も行わない。
 */
export class DivergentFolderClaimError extends Error {
  constructor(name: string, parentId: string, claimedFolderId?: string, observedFolderId?: string) {
    const detail =
      observedFolderId !== undefined
        ? `claim側: ${claimedFolderId ?? '(不明)'} / 実体側: ${observedFolderId}`
        : `claimedFolderId: ${claimedFolderId ?? '(不明)'}`;
    super(
      `フォルダの記録(claim)と実体が食い違っています(人手確認が必要): "${name}"（親フォルダ: ${parentId}、${detail}）`
    );
    this.name = 'DivergentFolderClaimError';
  }
}

/** `commitResolvedWithRetry`がリトライ後も失敗した。呼び出し元は`error`ステータスへ遷移させる。 */
export class FolderClaimCommitError extends Error {
  readonly folderId: string;
  constructor(name: string, parentId: string, folderId: string, cause: unknown) {
    super(
      `claimの確定書込みに失敗しました(リトライ後も失敗): "${name}"（親フォルダ: ${parentId}、folderId: ${folderId}）: ${
        cause instanceof Error ? cause.message : String(cause)
      }`
    );
    this.name = 'FolderClaimCommitError';
    this.folderId = folderId;
  }
}

/**
 * `verifyFolderClaim`がuntrash(Drive側の書込み)自体には成功したが、直後のFirestore記録
 * (`recordVerification`)に失敗した場合に投げる(codex review P2指摘対応、2巡目)。
 * `findOrCreateFolder.ts`はこの型を無視して既存の一般的なエラー処理に任せてよいが、
 * `childFolderResolver.ts`はrollback manifest(restoredFolderIds)追跡のため
 * `folderId`を取り出して使う。
 */
export class FolderClaimRestoreCommitError extends Error {
  readonly folderId: string;
  readonly cause: unknown;
  constructor(name: string, parentId: string, folderId: string, cause: unknown) {
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    super(
      `フォルダの復元(untrash)自体は成功しましたがclaim記録に失敗しました: "${name}"（親フォルダ: ${parentId}、folderId: ${folderId}）: ${causeMessage}`
    );
    this.name = 'FolderClaimRestoreCommitError';
    this.folderId = folderId;
    this.cause = cause;
  }
}

export type DriveApiErrorKind =
  | 'notFound'
  | 'unauthenticated'
  | 'permissionDenied'
  | 'rateLimited'
  | 'transient'
  | 'unknown';

/**
 * Drive APIが投げたエラーをfail-closedの原則で分類する(§3)。
 * `exportDocument.ts`の`isDriveFileNotFoundError()`と同じ規約(`err.status`/`err.code`/
 * `err.response.status`)を踏襲し、この判定ロジックを両モジュールで共有できるようにする。
 */
export function classifyDriveApiError(error: unknown): DriveApiErrorKind {
  const err = error as {
    code?: number | string;
    status?: number;
    response?: { status?: number };
    errors?: Array<{ reason?: string }>;
  };
  const status =
    typeof err?.status === 'number'
      ? err.status
      : typeof err?.code === 'number'
        ? err.code
        : err?.response?.status;

  if (status === 404) return 'notFound';
  if (status === 401) return 'unauthenticated';
  if (status === 403) {
    const reason = err?.errors?.[0]?.reason;
    if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') {
      return 'rateLimited';
    }
    return 'permissionDenied';
  }
  if (status === 429) return 'rateLimited';
  if (typeof status === 'number' && status >= 500) return 'transient';
  // ネットワーク層エラー等、statusを持たないものは一時的とみなす(fail-closed、claim無変更で再throw)
  if (status === undefined) return 'transient';
  return 'unknown';
}

function claimRef(
  firestore: admin.firestore.Firestore,
  parentId: string,
  name: string
): admin.firestore.DocumentReference {
  return firestore.collection(FOLDER_LOCKS_COLLECTION).doc(buildFolderLockId(parentId, name));
}

/** Firestoreドキュメント名の制約(スラッシュ不可等)を避けるためbase64urlでエンコード。 */
export function buildFolderLockId(parentId: string, name: string): string {
  return Buffer.from(`${parentId}/${name}`).toString('base64url');
}

function ttlTimestamp(): admin.firestore.Timestamp {
  return admin.firestore.Timestamp.fromMillis(Date.now() + CLAIM_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/** 旧形式(`state`欠損)のドキュメントを`state:'creating', attempt:null`として解釈する。 */
function normalizeClaim(
  data: admin.firestore.DocumentData,
  parentId: string,
  name: string
): FolderClaimDoc {
  if (data.state === undefined) {
    return {
      state: 'creating',
      lockToken: data.lockToken as string | undefined,
      claimedAtMs: data.claimedAtMs as number | undefined,
      attempt: null,
      parentId,
      name,
    };
  }
  return data as FolderClaimDoc;
}

/** undefinedのキーを除去する(admin SDKは`ignoreUndefinedProperties`未設定のため素通しできない)。 */
function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const result = {} as T;
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}

async function withBackoffRetry<T>(
  fn: () => Promise<T>,
  attempts: number,
  baseDelayMs: number
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** i));
      }
    }
  }
  throw lastError;
}

/**
 * claimを読み取る(旧形式も正規化して返す)。ドキュメントが存在しなければnull。
 */
export async function readClaim(
  firestore: admin.firestore.Firestore,
  parentId: string,
  name: string
): Promise<FolderClaimDoc | null> {
  const snap = await claimRef(firestore, parentId, name).get();
  if (!snap.exists) return null;
  return normalizeClaim(snap.data()!, parentId, name);
}

/**
 * 'creating'状態のclaimを原子的に確保する。既存claimが有効なリース中(state='creating'かつ
 * リース内)の場合はblocked。divergentは'divergent'を、resolvedは'resolved'をそのまま
 * 返す(いずれも上書きしない。codex review指摘対応、4巡目: shadow/read経路のロールアウト
 * 段階に関わらず常にresolvedを保護する。呼び出し元がclaimを事前に読んでからこの関数を
 * 呼ぶまでの間隙で別の呼び出し元がresolvedへ確定させるTOCTOUを、この関数自身の
 * トランザクション内で検知することでのみ完全に塞げるため)。リース失効/未知形式のみ
 * 上書きしてよい。
 */
export async function beginCreation(
  firestore: admin.firestore.Firestore,
  parentId: string,
  name: string,
  runId: string
): Promise<
  | { status: 'begun'; attemptId: string }
  | { status: 'blocked' }
  | { status: 'divergent'; claim: FolderClaimDoc }
  | { status: 'resolved'; claim: ResolvedFolderClaim }
> {
  const ref = claimRef(firestore, parentId, name);
  const attemptId = randomUUID();
  const startedAtMs = Date.now();

  const result = await firestore.runTransaction(async (
    tx
  ): Promise<
    | { kind: 'blocked' }
    | { kind: 'divergent'; claim: FolderClaimDoc }
    | { kind: 'resolved'; claim: ResolvedFolderClaim }
    | { kind: 'begun' }
  > => {
    const snap = await tx.get(ref);
    const existing = snap.exists ? normalizeClaim(snap.data()!, parentId, name) : null;

    // second-opinionレビュー指摘(Important)対応: divergent(人手介入待ち)は
    // shadowモード(呼び出し元がclaimを事前読取しない経路)や、read有効化後に
    // shadowへ戻された場合(フラグの一時ロールバック等)でも、無条件に上書きして
    // 新規作成attemptへ進んではならない。plan §4の「削除も再作成もしない」を
    // このtx自体でも自己防衛する。
    if (existing?.state === 'divergent') {
      return { kind: 'divergent', claim: existing };
    }

    // codex review指摘対応(4巡目、P1): 従来はresolved claimをshadow/未読取経路で
    // 無条件に上書きしていた(claim導入前の重複作成リスクを変えないための意図的設計
    // だったが、findOrCreateFolder.tsとchildFolderResolver.tsが同じparent+nameを
    // 取り合うケースでは、呼び出し元が事前にclaimを読んでからこの関数を呼ぶまでの
    // 間隙で別解決者がresolvedへ確定させるTOCTOUを塞げなかった)。予約の可否判定と
    // 「既にresolved済みか」の確認を同一トランザクション内でatomicに行い、resolved
    // ならそれを採用させる(呼び出し元は`verifyFolderClaim`等で健全性確認してから
    // 使う)よう、常にresolvedを保護する形に統一する。
    if (existing?.state === 'resolved' && typeof existing.folderId === 'string') {
      return { kind: 'resolved', claim: existing as ResolvedFolderClaim };
    }

    if (existing) {
      const leaseAnchorMs = existing.attempt?.startedAtMs ?? existing.claimedAtMs ?? 0;
      const leaseValid = Date.now() - leaseAnchorMs < FOLDER_LOCK_STALE_MS;
      if (existing.state === 'creating' && leaseValid) {
        return { kind: 'blocked' };
      }
    }

    const attempt: FolderClaimAttempt = { attemptId, startedAtMs, runId };
    const doc = stripUndefined({
      state: 'creating' as const,
      attempt,
      parentId,
      name,
      lockToken: attemptId,
      claimedAtMs: startedAtMs,
      expireAt: ttlTimestamp(),
    });
    tx.set(ref, doc);
    return { kind: 'begun' };
  });

  if (result.kind === 'blocked') {
    return { status: 'blocked' };
  }
  if (result.kind === 'divergent') {
    return { status: 'divergent', claim: result.claim };
  }
  if (result.kind === 'resolved') {
    return { status: 'resolved', claim: result.claim };
  }
  return { status: 'begun', attemptId };
}

/**
 * 予約したattemptを確定させ、状態を'resolved'にする。書込み失敗はリトライ(3回・指数
 * バックオフ)後も失敗したら`FolderClaimCommitError`をthrowする(握り潰さない)。
 * 既に別のattemptがこのclaimを確定/上書き済みの場合は何もしない(fencing、正常系)。
 */
export async function commitResolvedWithRetry(
  firestore: admin.firestore.Firestore,
  parentId: string,
  name: string,
  attemptId: string,
  folderId: string
): Promise<void> {
  const ref = claimRef(firestore, parentId, name);
  try {
    await withBackoffRetry(
      async () => {
        await firestore.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          const existing = snap.exists ? normalizeClaim(snap.data()!, parentId, name) : null;
          if (existing?.state === 'creating' && existing.attempt?.attemptId !== attemptId) {
            return; // 既に別のattemptに引き継がれている(fencing) → 何もしない
          }
          if (existing?.state === 'resolved' && existing.attempt?.attemptId !== attemptId) {
            return; // 既に他のattemptがresolved確定済み → 上書きしない
          }
          const nowMs = Date.now();
          const doc = stripUndefined({
            state: 'resolved' as const,
            folderId,
            attempt: { attemptId, startedAtMs: existing?.attempt?.startedAtMs ?? nowMs, runId: existing?.attempt?.runId ?? null },
            resolvedAtMs: nowMs,
            verifiedAtMs: nowMs,
            lastFullScanAtMs: nowMs,
            missCount: 0,
            missRunIds: [] as string[],
            parentId,
            name,
            expireAt: ttlTimestamp(),
          });
          tx.set(ref, doc);
        });
      },
      3,
      300
    );
  } catch (error) {
    throw new FolderClaimCommitError(name, parentId, folderId, error);
  }
}

/**
 * 完全再検索(`files.list`)でresolved確定した場合に、claimの`lastFullScanAtMs`/
 * `verifiedAtMs`を更新する(§4「完全再検索の結果とclaimの突合」正常系)。
 */
export async function recordFullScanResolution(
  firestore: admin.firestore.Firestore,
  parentId: string,
  name: string,
  folderId: string,
  runId: string
): Promise<void> {
  const ref = claimRef(firestore, parentId, name);
  await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const existing = snap.exists ? normalizeClaim(snap.data()!, parentId, name) : null;

    // second-opinionレビュー指摘(Important)対応: beginCreationと同様、shadowモードや
    // read無効化直後の経路では呼び出し元がclaimを事前確認していないため、divergent
    // (人手介入待ち)をこの完全再検索の記録で無条件に'resolved'へ上書きしてはならない。
    if (existing?.state === 'divergent') {
      console.warn(
        `[driveFolderClaim] divergent状態のclaimを完全再検索の結果で上書きしません(人手介入待ち): "${name}"（親フォルダ: ${parentId}）`
      );
      return;
    }

    const nowMs = Date.now();
    const doc = stripUndefined({
      state: 'resolved' as const,
      folderId,
      attempt: existing?.attempt ?? { attemptId: randomUUID(), startedAtMs: nowMs, runId },
      resolvedAtMs: existing?.resolvedAtMs ?? nowMs,
      verifiedAtMs: nowMs,
      lastFullScanAtMs: nowMs,
      missCount: 0,
      missRunIds: [] as string[],
      parentId,
      name,
      expireAt: ttlTimestamp(),
    });
    tx.set(ref, doc);
  });
}

/**
 * 'creating'のリースが失効している(=プロセスが強制終了された可能性がある)claimを、
 * `files.create`時に刻んだappProperties冪等キー(attemptId)で検索し回収する。
 * 1件ヒット→前任者のcreateは成功していた(採用)。2件以上→AmbiguousFolderError。
 * 0件かつ猶予(`RECONCILE_GRACE_MS`)未満→fail-closedで待機。0件かつ猶予超過→
 * このattemptを`invalidated`にし、呼び出し元に従来経路(完全再検索→新規create)を促す。
 */
export async function reconcileAttempt(
  drive: drive_v3.Drive,
  firestore: admin.firestore.Firestore,
  parentId: string,
  name: string,
  claim: FolderClaimDoc & { attempt: FolderClaimAttempt },
  runId: string
): Promise<
  | { status: 'adopt'; folderId: string; restored: boolean }
  | { status: 'wait' }
  | { status: 'clear' }
> {
  const attemptId = claim.attempt.attemptId;
  const q =
    `'${parentId}' in parents and appProperties has ` +
    `{ key='${DOCSPLIT_FOLDER_CLAIM_KEY}' and value='${escapeQueryValue(attemptId)}' }`;
  const files: drive_v3.Schema$File[] = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q,
      fields: 'nextPageToken, files(id, name, trashed)',
      includeItemsFromAllDrives: true,
      pageSize: 100,
      pageToken,
      ...SUPPORTS_ALL_DRIVES,
    });
    files.push(...(res.data.files ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  if (files.length > 1) {
    throw new AmbiguousFolderError(name, parentId, files.length);
  }
  if (files.length === 1) {
    const id = files[0].id;
    if (!id) {
      throw new Error(`reconcile対象フォルダのidが取得できません: attemptId=${attemptId}`);
    }
    // codex review P2指摘対応: files.create()後・commit前に(人力操作等で)ゴミ箱へ
    // 移動されていた場合、通常の名前解決経路(resolveExistingFolder)は必ずuntrashして
    // から返すのに対し、reconcile経由だけがtrashed状態のまま採用してしまう非対称を
    // 解消する。復元に失敗した場合はfail-closedで再throwする(既存のtrashed復元と同じ方針)。
    const restored = !!files[0].trashed;
    if (restored) {
      await drive.files.update({
        fileId: id,
        requestBody: { trashed: false },
        fields: 'id',
        ...SUPPORTS_ALL_DRIVES,
      });
    }
    return { status: 'adopt', folderId: id, restored };
  }

  const elapsedMs = Date.now() - claim.attempt.startedAtMs;
  if (elapsedMs < RECONCILE_GRACE_MS) {
    return { status: 'wait' };
  }

  await invalidateAttempt(firestore, parentId, name, attemptId);
  void runId;
  return { status: 'clear' };
}

/**
 * `folderId`が指す'resolved'状態のclaimを'invalidated'にする(fencing: folderId一致のみ)。
 * `rollback-drive-folder-merge.ts`が、ロールバックで再trashed化したtarget folderの
 * claim記録を明示的に無効化するために使う(PR-4)。manifestはparentId/nameを持たず
 * folderIdのみ記録しているため、`parentId`/`name`をキーにする`invalidateAttempt`とは
 * 別にfolderIdでの問い合わせを提供する(単純な等価フィルタ2つのみのクエリのため、
 * Firestoreの自動単一フィールド索引で完結し追加のcomposite index設定は不要)。
 * 残置しても次回exportの`files.get`404累積判定(最大10分)で自然に解消されるため、
 * この呼び出し自体の失敗はbest-effortとして扱ってよい(呼び出し元の判断)。
 * マッチした件数を返す(0件はclaim未生成またはTTL消滅済みで正常)。
 */
export async function invalidateResolvedClaimByFolderId(
  firestore: admin.firestore.Firestore,
  folderId: string
): Promise<number> {
  const snap = await firestore
    .collection(FOLDER_LOCKS_COLLECTION)
    .where('folderId', '==', folderId)
    .where('state', '==', 'resolved')
    .get();

  let invalidatedCount = 0;
  for (const doc of snap.docs) {
    await firestore.runTransaction(async (tx) => {
      const fresh = await tx.get(doc.ref);
      const data = fresh.data();
      if (!fresh.exists || data?.state !== 'resolved' || data?.folderId !== folderId) {
        return; // fencing: 別処理が既に状態を変えている
      }
      const doc2 = stripUndefined({
        state: 'invalidated' as const,
        attempt: null,
        parentId: data.parentId as string,
        name: data.name as string,
        expireAt: ttlTimestamp(),
      });
      tx.set(fresh.ref, doc2);
    });
    invalidatedCount++;
  }
  return invalidatedCount;
}

/**
 * `attemptId`(`files.create`時に刻んだappProperties冪等キー)が指す'creating'状態の
 * claimを'invalidated'にする(fencing: attemptId一致のみ、codex review P2指摘対応、5巡目)。
 * `rollback-drive-folder-merge.ts`が、`ChildFolderCreatedButUncommittedError`/
 * `ChildFolderRestoredButUncommittedError`経由でmanifestに記録された(=claim確定書込みが
 * 失敗し'creating'のままfolderIdフィールドを持たない)フォルダを再trashed化する際に使う。
 * `invalidateResolvedClaimByFolderId`はfolderIdフィールドで問い合わせるため、'creating'の
 * ままfolderIdを持たないこのケースを検知できない——放置すると、rollback後に別解決者の
 * `reconcileAttempt`がタグ検索でこのtrashed済みフォルダを見つけてuntrashし、rollbackが
 * 実質的に取り消されてしまう。`attempt.attemptId`はネストフィールドの単純等価クエリの
 * ため、こちらも追加のcomposite index設定は不要。
 */
export async function invalidateCreatingClaimByAttemptId(
  firestore: admin.firestore.Firestore,
  attemptId: string
): Promise<number> {
  const snap = await firestore
    .collection(FOLDER_LOCKS_COLLECTION)
    .where('attempt.attemptId', '==', attemptId)
    .where('state', '==', 'creating')
    .get();

  let invalidatedCount = 0;
  for (const doc of snap.docs) {
    await firestore.runTransaction(async (tx) => {
      const fresh = await tx.get(doc.ref);
      const data = fresh.data();
      if (!fresh.exists || data?.state !== 'creating' || data?.attempt?.attemptId !== attemptId) {
        return; // fencing: 別処理が既に状態を変えている
      }
      const doc2 = stripUndefined({
        state: 'invalidated' as const,
        attempt: null,
        parentId: data.parentId as string,
        name: data.name as string,
        expireAt: ttlTimestamp(),
      });
      tx.set(fresh.ref, doc2);
    });
    invalidatedCount++;
  }
  return invalidatedCount;
}

/** 'creating'状態のclaimを'invalidated'にする(fencing: attemptIdが一致する場合のみ)。 */
export async function invalidateAttempt(
  firestore: admin.firestore.Firestore,
  parentId: string,
  name: string,
  attemptId: string
): Promise<void> {
  const ref = claimRef(firestore, parentId, name);
  await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const existing = normalizeClaim(snap.data()!, parentId, name);
    if (existing.state !== 'creating' || existing.attempt?.attemptId !== attemptId) {
      return; // 既に別状態に遷移済み(fencing)
    }
    const doc = stripUndefined({
      state: 'invalidated' as const,
      attempt: null,
      parentId,
      name,
      expireAt: ttlTimestamp(),
    });
    tx.set(ref, doc);
  });
}

/** resolved claimの健全性確認(files.get)成功時に`verifiedAtMs`を更新し、missCountをリセットする。 */
async function recordVerification(
  firestore: admin.firestore.Firestore,
  parentId: string,
  name: string,
  folderId: string
): Promise<void> {
  const ref = claimRef(firestore, parentId, name);
  await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const existing = snap.exists ? normalizeClaim(snap.data()!, parentId, name) : null;
    const nowMs = Date.now();
    const doc = stripUndefined({
      state: 'resolved' as const,
      folderId,
      attempt: existing?.attempt ?? null,
      resolvedAtMs: existing?.resolvedAtMs ?? nowMs,
      verifiedAtMs: nowMs,
      lastFullScanAtMs: existing?.lastFullScanAtMs,
      missCount: 0,
      missRunIds: [] as string[],
      parentId,
      name,
      expireAt: ttlTimestamp(),
    });
    tx.set(ref, doc);
  });
}

/** claimを'divergent'にする(claimと実体の食い違いを検知した場合)。人手介入待ち。 */
export async function markDivergent(
  firestore: admin.firestore.Firestore,
  parentId: string,
  name: string,
  reason: string
): Promise<void> {
  const ref = claimRef(firestore, parentId, name);
  await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const existing = snap.exists ? normalizeClaim(snap.data()!, parentId, name) : null;
    const doc = stripUndefined({
      state: 'divergent' as const,
      folderId: existing?.folderId,
      attempt: null,
      divergentReason: reason,
      parentId,
      name,
      expireAt: ttlTimestamp(),
    });
    tx.set(ref, doc);
  });
}

/**
 * `files.get`の404を記録する。missCount≥`MISS_THRESHOLD`かつ経過≥`MISS_WINDOW_MS`かつ
 * 異なる実行(runId)が2件以上、を全て満たして初めて'invalidated'へ遷移する(§3)。
 */
async function recordMiss(
  firestore: admin.firestore.Firestore,
  parentId: string,
  name: string,
  runId: string
): Promise<{ invalidated: boolean }> {
  const ref = claimRef(firestore, parentId, name);
  return firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const existing = snap.exists ? normalizeClaim(snap.data()!, parentId, name) : null;
    const nowMs = Date.now();
    const missCount = (existing?.missCount ?? 0) + 1;
    const firstMissAtMs = existing?.missCount ? (existing.firstMissAtMs ?? nowMs) : nowMs;
    const missRunIds = Array.from(new Set([...(existing?.missRunIds ?? []), runId]));

    const shouldInvalidate =
      missCount >= MISS_THRESHOLD &&
      nowMs - firstMissAtMs >= MISS_WINDOW_MS &&
      missRunIds.length >= 2;

    if (shouldInvalidate) {
      const doc = stripUndefined({
        state: 'invalidated' as const,
        attempt: null,
        parentId,
        name,
        expireAt: ttlTimestamp(),
      });
      tx.set(ref, doc);
      return { invalidated: true };
    }

    const doc = stripUndefined({
      state: 'resolved' as const,
      folderId: existing?.folderId,
      attempt: existing?.attempt ?? null,
      resolvedAtMs: existing?.resolvedAtMs,
      verifiedAtMs: existing?.verifiedAtMs,
      lastFullScanAtMs: existing?.lastFullScanAtMs,
      missCount,
      firstMissAtMs,
      missRunIds,
      parentId,
      name,
      expireAt: ttlTimestamp(),
    });
    tx.set(ref, doc);
    return { invalidated: false };
  });
}

/** `verifyFolderClaim`の返り値。`restored`は呼び出し元(rollback manifest記録用)が
 * この呼び出し自体でuntrashを行ったかどうかを示す。 */
export interface VerifiedFolderClaim {
  folderId: string;
  restored: boolean;
}

/**
 * resolved claimの健全性を`files.get`で確認する(§3の分類表に従いfail-closedで処理する)。
 * 200・name不一致(codex review指摘対応: Drive UI上でのリネームを検知しないと、要求された
 *   名前とは異なるフォルダへ際限なくエクスポートし続けてしまう)、または(trashed状態に
 *   かかわらず)parents不一致(codex review指摘対応: 別の親へ移動後にゴミ箱へ入れられた
 *   フォルダをtrashed判定より先に検知しないと、untrashして誤った場所を採用してしまう)
 *   → 'divergent'にして`DivergentFolderClaimError`をthrow。
 * 200・trashed=false・parents一致 → 健全、folderIdを返す(restored: false)。
 * 200・trashed=true・parents一致 → untrashして返す(restored: true。untrash失敗は再throw)。
 * 404 → missCountを記録し、常に`FolderVerificationPendingError`をthrow(invalidate
 *       するかどうかに関わらず、当該呼び出しはtransientとして扱う。invalidateされて
 *       いれば次回呼び出しで従来経路に自然にフォールバックする)。
 * 403(権限不足) → `DrivePermissionError`をthrow、claim無変更。
 * それ以外(401/429/5xx/network/unknown) → fail-closedでclaim無変更のまま再throw。
 */
export async function verifyFolderClaim(
  drive: drive_v3.Drive,
  firestore: admin.firestore.Firestore,
  parentId: string,
  name: string,
  claim: ResolvedFolderClaim,
  runId: string
): Promise<VerifiedFolderClaim> {
  let getResult;
  try {
    getResult = await withBackoffRetry(
      () =>
        drive.files.get({
          fileId: claim.folderId,
          fields: 'id, name, trashed, parents',
          ...SUPPORTS_ALL_DRIVES,
        }),
      3,
      500
    );
  } catch (error) {
    const kind = classifyDriveApiError(error);
    if (kind === 'notFound') {
      await recordMiss(firestore, parentId, name, runId);
      throw new FolderVerificationPendingError(name, parentId);
    }
    if (kind === 'permissionDenied') {
      throw new DrivePermissionError(name, parentId, claim.folderId);
    }
    // unauthenticated / rateLimited(リトライ枯渇) / transient(リトライ枯渇) / unknown
    // → fail-closed、claim無変更のまま再throw
    throw error;
  }

  const data = getResult.data;

  // codex review指摘対応: フォルダ名が変更されている(親は同じまま)場合を検知する。
  // parentsのみ確認していると、リネームされた同一IDのフォルダをそのまま信用してしまい、
  // 要求された名前とは異なるフォルダへエクスポートし続けてしまう。
  if (data.name !== undefined && data.name !== name) {
    await markDivergent(firestore, parentId, name, 'name-mismatch');
    throw new DivergentFolderClaimError(name, parentId, claim.folderId);
  }

  // codex review指摘対応: parents確認をtrashed分岐より先に行う。誤った順序だと、
  // 手動で別の親フォルダへ移動されてからゴミ箱に入れられたフォルダを、parents不一致に
  // 気付かないままuntrashして採用してしまい(移動先の誤配置を検知できない)、移行処理が
  // 誤った場所にドキュメントを配置しうる。
  const parents = data.parents ?? [];
  if (!parents.includes(parentId)) {
    await markDivergent(firestore, parentId, name, 'parents-mismatch');
    throw new DivergentFolderClaimError(name, parentId, claim.folderId);
  }

  if (data.trashed) {
    await drive.files.update({
      fileId: claim.folderId,
      requestBody: { trashed: false },
      fields: 'id',
      ...SUPPORTS_ALL_DRIVES,
    });
    // codex review指摘対応(2巡目、P2): untrash(Drive側の書込み)自体は成功したのに、
    // 直後のrecordVerification(Firestore書込み)が失敗すると、この関数を呼んだ
    // `childFolderResolver.ts`は「実はDrive側で復元が起きた」事実を知る手段を失い、
    // rollback manifest(restoredFolderIds)からこの復元事実が漏れる。folderIdを運べる
    // 専用errorで包み、呼び出し元が判断できるようにする。
    try {
      await recordVerification(firestore, parentId, name, claim.folderId);
    } catch (recordError) {
      throw new FolderClaimRestoreCommitError(name, parentId, claim.folderId, recordError);
    }
    return { folderId: claim.folderId, restored: true };
  }

  await recordVerification(firestore, parentId, name, claim.folderId);
  return { folderId: claim.folderId, restored: false };
}
