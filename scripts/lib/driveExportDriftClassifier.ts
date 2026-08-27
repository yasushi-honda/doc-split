/**
 * `scripts/classify-drive-export-drift.ts` の純粋ロジック部(I/O非依存、unit test対象)。
 * Issue #811/#823 remediation(kanameone: exported documentのdriveFileIdが実際には
 * Drive上で404/trashed/誤配置になっている問題)の検出ロジック。
 *
 * `scripts/lib/driveExportBackfillHelpers.ts`と同じ分離パターン(Firestore/Drive I/Oに
 * 依存しない判定・集計だけをここに置く)。
 */

export type DriftCategory = 'healthy' | 'missing-404' | 'trashed' | 'misplaced';

// セカンドオピニオンI9指摘: 'storage-object-missing'は元々`classifyDriftEvidence`内で
// 返す想定だったが、codex review P1指摘対応でStorage確認を分類確定"後"の付随情報
// (`storageObjectExists`フィールド)に変更したため、この関数からは二度と返らないdead
// reasonになっていた。codex review(12回目)指摘対応で'multi-parent'も同様に
// (parents件数に関わらずhealthy/misplaced比較に統合したため)dead reasonになった。
// 両方とも型から削除する(将来「本当に必要になったら復活させる」判断をしやすくするため、
// 削除であってrenameはしない)。
export type BlockedReason =
  | 'no-drive-file-id'
  | 'api-error'
  | 'segment-unresolvable'
  | 'ambiguous-path'
  | 'customer-unconfirmed'
  | 'target-path-not-created';

export const ALL_BLOCKED_REASONS: readonly BlockedReason[] = [
  'no-drive-file-id',
  'api-error',
  'segment-unresolvable',
  'ambiguous-path',
  'customer-unconfirmed',
  'target-path-not-created',
];

/**
 * `drive.files.get({fileId, fields:'parents,trashed'})`の結果を、呼び出し元
 * (`functions/src/drive/exportDocument.ts`の`isDriveFileNotFoundError()`と同じ判定)で
 * 3種に正規化したもの。404以外の例外(403/5xx等)は`api-error`として`not-found`と
 * 区別する(#823調査で判明した「元の調査スクリプトは全例外を404扱いしていた」誤りの是正)。
 */
export type DriveFileGetResult =
  | { kind: 'ok'; trashed: boolean; parents: string[] | undefined }
  | { kind: 'not-found' }
  | { kind: 'api-error'; errorMessage: string };

export interface DriftEvidence {
  driveFileId: string | null | undefined;
  /** driveFileIdが存在する場合のみ非null(欠損時はfileGet自体を呼ばないためnull)。 */
  fileGet: DriveFileGetResult | null;
  /** `childFolderResolver.ts`の`resolveChildFolderPathReadOnly()`等で解決済みの、
   *  現在の設定・ロジックで解決されるべき"正しい"親フォルダID。呼び出し元が
   *  segment解決失敗(`segment-unresolvable`/`ambiguous-path`)を別途blockedとして
   *  扱ってから本関数を呼ぶ契約とする。空文字列は「対象フォルダがDrive上にまだ
   *  一度も作成されたことがない(=このdocumentが正しく配置されている可能性はゼロ)」
   *  ことを表すsentinel値として扱い、`target-path-not-created`でblockedにする
   *  (codex review P2指摘対応: 空文字列をparents[0]と単純比較すると誤ってmisplaced
   *  判定になってしまうため)。 */
  expectedLeafFolderId: string;
}

export type DriftClassification =
  | { kind: 'classified'; category: DriftCategory }
  | { kind: 'blocked'; reason: BlockedReason; detail?: string };

/**
 * 1件のdocumentの物理状態を分類する。判定順序は`exportDocument.ts`の
 * `resolveDriveFile()`が実際に辿る分岐(driveFileId欠損→404→trashed→parents比較)と
 * 意図的に一致させている(#823調査「classifyは本番と同一の判定ロジックを使う」方針)。
 */
export function classifyDriftEvidence(evidence: DriftEvidence): DriftClassification {
  if (!evidence.driveFileId) {
    return { kind: 'blocked', reason: 'no-drive-file-id' };
  }

  const fileGet = evidence.fileGet;
  if (!fileGet) {
    throw new Error(
      'classifyDriftEvidence: driveFileIdが設定されているのにfileGetがnullです(呼び出し契約違反: driveFileIdがある場合は必ずfiles.getの結果を渡すこと)'
    );
  }

  if (fileGet.kind === 'api-error') {
    return { kind: 'blocked', reason: 'api-error', detail: fileGet.errorMessage };
  }

  if (fileGet.kind === 'not-found') {
    return { kind: 'classified', category: 'missing-404' };
  }

  // fileGet.kind === 'ok'
  if (fileGet.trashed) {
    return { kind: 'classified', category: 'trashed' };
  }

  // codex review(12回目)指摘: `resolveDriveFile()`(exportDocument.ts)の実際の修復ロジックは
  // parentsが何件であっても(0件/1件不一致/2件以上いずれも)無条件で
  // `addParents: parentId` + `removeParents: <parentId以外の全件>` により単一parentへ
  // 正規化する。multi-parentを個別にblockedとして除外するのは本番の修復可能性と乖離し、
  // 実際には修復可能なdriftを過小報告することになる(#823の内訳確定という本ツールの目的に
  // 直接影響する)。よってparents件数に関わらずhealthy/misplacedの比較に統合する。

  // codex review P2指摘: 期待leafフォルダがまだ作成されていない場合(呼び出し元が空文字を
  // 渡す契約、`resolveExpectedLeaf()`参照)、現在のparentsとは絶対に一致し得ないため
  // 無条件でmisplaced判定になってしまう。しかしこれは「誤配置」ではなく「正しい配置先が
  // まだ存在せず判定不能」という別の状態のため、blockedとして区別する。
  if (!evidence.expectedLeafFolderId) {
    return { kind: 'blocked', reason: 'target-path-not-created' };
  }

  const parents = fileGet.parents ?? [];
  if (parents.length === 1 && parents[0] === evidence.expectedLeafFolderId) {
    return { kind: 'classified', category: 'healthy' };
  }
  return { kind: 'classified', category: 'misplaced' };
}

export interface ClassificationCounts {
  scanned: number;
  healthy: number;
  missing404: number;
  trashed: number;
  misplaced: number;
  blocked: Record<BlockedReason, number>;
}

function emptyBlockedCounts(): Record<BlockedReason, number> {
  const counts = {} as Record<BlockedReason, number>;
  for (const reason of ALL_BLOCKED_REASONS) {
    counts[reason] = 0;
  }
  return counts;
}

/** `classifyDriftEvidence()`の結果集合を集計する。scanned = 全カテゴリ+blocked合計。 */
export function summarizeClassifications(classifications: readonly DriftClassification[]): ClassificationCounts {
  const counts: ClassificationCounts = {
    scanned: 0,
    healthy: 0,
    missing404: 0,
    trashed: 0,
    misplaced: 0,
    blocked: emptyBlockedCounts(),
  };

  for (const c of classifications) {
    counts.scanned += 1;
    if (c.kind === 'blocked') {
      counts.blocked[c.reason] += 1;
      continue;
    }
    switch (c.category) {
      case 'healthy':
        counts.healthy += 1;
        break;
      case 'missing-404':
        counts.missing404 += 1;
        break;
      case 'trashed':
        counts.trashed += 1;
        break;
      case 'misplaced':
        counts.misplaced += 1;
        break;
    }
  }

  return counts;
}

export interface CareManagerSummary extends ClassificationCounts {
  careManager: string;
}

/** ケアマネ名ごとにグルーピングして集計する(Issue #823「他ケアマネへの横展開規模」の答え)。 */
export function summarizeByCareManager(
  rows: readonly { careManager: string; classification: DriftClassification }[]
): CareManagerSummary[] {
  const grouped = new Map<string, DriftClassification[]>();
  for (const row of rows) {
    const list = grouped.get(row.careManager) ?? [];
    list.push(row.classification);
    grouped.set(row.careManager, list);
  }

  return [...grouped.entries()].map(([careManager, classifications]) => ({
    careManager,
    ...summarizeClassifications(classifications),
  }));
}
