/**
 * 表記ゆれ重複マスター統合(scripts/merge-notation-duplicate-masters.ts、2026-07-27)
 *
 * `check-customer-master-integrity.js`の[B]表記ゆれ重複候補(正規化後は一致するが生文字列は
 * 相違、姓名間スペースの有無等)は、明示的な`isDuplicate`フラグが立たない=同姓同名の別人
 * ではないという判断(decision-maker確認済み)のもと、1件のマスターへ統合する。
 *
 * 既存の「許容表記」機構(`CustomerMaster.aliases`、`functions/src/admin/masterOperations.ts`の
 * `addMasterAlias`と同型)を再利用し、敗者側の生名を勝者(canonical)のaliasesへ追加する。
 * 新規の仕組みは導入しない。
 */

/** [B]検出に使うのと同一の正規化(`functions/src/utils/similarity.ts`の`normalizeText()`と同一)。 */
function normalizeName(text: string): string {
  return text
    .replace(/[\s　]+/g, '')
    .replace(/[・．.]/g, '')
    .toLowerCase();
}

export interface CustomerRecord {
  id: string;
  name: string;
  furigana: string;
  careManagerName: string;
  notes: string;
  aliases: string[];
  isDuplicate: boolean;
}

export interface NotationDuplicateGroup {
  members: CustomerRecord[];
}

/**
 * グループ内に生名(name)が完全一致するメンバーが2件以上含まれるか判定する。
 * 完全一致するメンバーは[A](真の同姓同名候補、別人の可能性)であり、本モジュールの
 * 統合対象外。正規化後は同一グループに入りうる(例:「田中太郎」×2 + 「田中 太郎」)ため、
 * グループ単位でこのチェックを行い、該当グループ全体を安全側で対象外にする
 * (evaluator指摘・2026-07-27: distinctNames.size>1だけでは、完全一致のサブグループが
 * 紛れ込んだ場合に真の別人まで誤って統合してしまう致命的な穴があった)。
 */
function hasExactMatchSubset(members: CustomerRecord[]): boolean {
  const nameCounts = new Map<string, number>();
  for (const m of members) {
    nameCounts.set(m.name, (nameCounts.get(m.name) ?? 0) + 1);
  }
  return [...nameCounts.values()].some((count) => count > 1);
}

function groupByNormalizedName(customers: CustomerRecord[]): NotationDuplicateGroup[] {
  const byNormalized = new Map<string, CustomerRecord[]>();
  for (const c of customers) {
    const key = normalizeName(c.name);
    if (!key) continue;
    const group = byNormalized.get(key) ?? [];
    group.push(c);
    byNormalized.set(key, group);
  }

  const groups: NotationDuplicateGroup[] = [];
  for (const members of byNormalized.values()) {
    const distinctNames = new Set(members.map((m) => m.name));
    if (members.length > 1 && distinctNames.size > 1) {
      groups.push({ members });
    }
  }
  return groups;
}

/**
 * 正規化後は一致するが生文字列が異なるグループを検出する。
 * 完全一致([A]、真の同姓同名候補)のみのグループは対象外(呼出元が別途扱う)。
 * グループ内に完全一致のサブグループが紛れ込んでいる場合も、安全側でグループ全体を
 * 対象外にする(`findExcludedNotationGroups`で個別に検出・手動確認へ回す)。
 */
export function groupNotationDuplicates(customers: CustomerRecord[]): NotationDuplicateGroup[] {
  return groupByNormalizedName(customers).filter((g) => !hasExactMatchSubset(g.members));
}

/**
 * `groupNotationDuplicates`が完全一致サブグループの混在を理由に除外したグループを返す。
 * 自動統合はできないが、手動確認の対象として可視化するために使う
 * (呼出元のオーケストレーションスクリプトがコンソール出力・件数集計に使用)。
 */
export function findExcludedNotationGroups(customers: CustomerRecord[]): NotationDuplicateGroup[] {
  return groupByNormalizedName(customers).filter((g) => hasExactMatchSubset(g.members));
}

export interface CanonicalChoice {
  canonical: CustomerRecord;
  losers: CustomerRecord[];
}

/**
 * グループ内から正式表記(canonical)を1件選ぶ。
 * ポリシー(decision-maker確認済み、2026-07-27): 紐づく書類数が多い方を優先し、
 * 書類の付け替え件数を最小化する。書類数が同数の場合はスペースを含む表記を優先する
 * (3件以上のグループでスペースを含む表記が複数ある場合は、さらにid昇順でタイブレークする。
 * evaluator指摘で「必ず一方に決まる」という旧コメントの不正確さを訂正、2026-07-27)。
 */
export function pickCanonical(
  group: NotationDuplicateGroup,
  documentCounts: Map<string, number>
): CanonicalChoice {
  const hasSpace = (name: string) => /[\s　]/.test(name);

  const sorted = [...group.members].sort((a, b) => {
    const countDiff = (documentCounts.get(b.id) ?? 0) - (documentCounts.get(a.id) ?? 0);
    if (countDiff !== 0) return countDiff;
    const spaceDiff = Number(hasSpace(b.name)) - Number(hasSpace(a.name));
    if (spaceDiff !== 0) return spaceDiff;
    return a.id.localeCompare(b.id);
  });

  const [canonical, ...losers] = sorted;
  return { canonical, losers };
}

export interface MergedMasterUpdate {
  aliasesToAdd: string[];
  furigana?: string;
  careManagerName?: string;
  notes?: string;
}

/**
 * canonicalマスターへ適用する更新内容を構築する(純粋関数、Firestoreアクセスなし)。
 * 呼出元は`aliasesToAdd`を`FieldValue.arrayUnion(...aliasesToAdd)`で書き込む想定
 * (`functions/src/admin/masterOperations.ts`の`addMasterAlias`と同一パターン)。
 */
export function buildMergedMasterUpdate(choice: CanonicalChoice): MergedMasterUpdate {
  const existingAliases = new Set(choice.canonical.aliases);
  const aliasesToAdd = choice.losers
    .map((l) => l.name)
    .filter((name) => name !== choice.canonical.name && !existingAliases.has(name));

  const update: MergedMasterUpdate = { aliasesToAdd };

  if (!choice.canonical.furigana) {
    const furiganaFromLoser = choice.losers.find((l) => l.furigana)?.furigana;
    if (furiganaFromLoser) update.furigana = furiganaFromLoser;
  }

  if (!choice.canonical.careManagerName) {
    const careManagerFromLoser = choice.losers.find((l) => l.careManagerName)?.careManagerName;
    if (careManagerFromLoser) update.careManagerName = careManagerFromLoser;
  }

  // notes(区別用補足情報、shared/types.ts CustomerMaster)は敗者マスター削除で消失しうるため、
  // furigana/careManagerNameと同じ欠損時補完ポリシーの対象に含める(evaluator指摘、2026-07-27)。
  if (!choice.canonical.notes) {
    const notesFromLoser = choice.losers.find((l) => l.notes)?.notes;
    if (notesFromLoser) update.notes = notesFromLoser;
  }

  return update;
}

/**
 * 敗者マスターに紐づいていたdocumentへ適用するPartial Update payload。
 * customerId/customerNameの2キーのみ(CLAUDE.md MUST: 更新対象外フィールド不変)。
 */
export function buildDocumentRepointPayload(canonical: CustomerRecord): {
  customerId: string;
  customerName: string;
} {
  return { customerId: canonical.id, customerName: canonical.name };
}
