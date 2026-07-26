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
  aliases: string[];
  isDuplicate: boolean;
}

export interface NotationDuplicateGroup {
  members: CustomerRecord[];
}

/**
 * 正規化後は一致するが生文字列が異なるグループを検出する。
 * 完全一致([A]、真の同姓同名候補)は対象外(呼出元が別途扱う)。
 */
export function groupNotationDuplicates(customers: CustomerRecord[]): NotationDuplicateGroup[] {
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

export interface CanonicalChoice {
  canonical: CustomerRecord;
  losers: CustomerRecord[];
}

/**
 * グループ内から正式表記(canonical)を1件選ぶ。
 * ポリシー(decision-maker確認済み、2026-07-27): 紐づく書類数が多い方を優先し、
 * 書類の付け替え件数を最小化する。同数の場合はスペースを含む表記を優先する
 * (このグループの構造上、必ずスペース有/無の一方に決まる)。
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
