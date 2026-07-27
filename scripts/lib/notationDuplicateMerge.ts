/**
 * 表記ゆれ重複マスター統合(scripts/merge-notation-duplicate-masters.ts、2026-07-27)
 *
 * `check-customer-master-integrity.js`の[B]表記ゆれ重複候補(正規化後は一致するが生文字列は
 * 相違、姓名間スペースの有無等)は、明示的な`isDuplicate`フラグが立たない=同姓同名の別人
 * ではないという判断(decision-maker確認済み)のもと、1件のマスターへ統合する。この
 * 「isDuplicateフラグが立っていないこと」は自動統合の必須条件であり、いずれかのメンバーに
 * `isDuplicate:true`が立っているグループは`hasIsDuplicateFlag`により対象外にする
 * (code-review指摘対応、2026-07-27: 旧実装はこの条件をコメントにのみ記述し実装では
 * 一切チェックしていなかった)。
 *
 * `isDuplicate`フラグは自動統合を許可する側の唯一の安全網にはできない(`customerAmbiguityGate.ts`
 * が既に文書化している通り、force-addは衝突ペアの片側にしか付与せず、`updateCustomer`には
 * 重複チェックが一切ない)ため、furigana(読み仮名)が2件以上で食い違うグループも
 * `hasConflictingFurigana`により対象外にする(code-review 5巡目指摘対応、2026-07-27:
 * スペースの有無だけが異なる別人がフロントエンドの重複チェックを経由せず登録されうる
 * 経路が既存コードに存在するため、独立したシグナルで安全網を補強する)。
 *
 * 既存の「許容表記」機構(`CustomerMaster.aliases`、`functions/src/admin/masterOperations.ts`の
 * `addMasterAlias`と同型)を再利用し、敗者側の生名を勝者(canonical)のaliasesへ追加する。
 * 新規の仕組みは導入しない。
 */

import { normalizeText } from '../../functions/src/utils/similarity';
import { buildCareManagerUpdate } from '../../functions/src/triggers/syncCareManagerLogic';

// [B]検出の正規化は、既存のOCR名寄せロジック(functions/src/utils/similarity.ts)と
// 同一の`normalizeText()`を再利用する(code-review指摘対応、2026-07-27: 従来は
// scripts/check-customer-master-integrity.jsに続き3箇所目の独立コピーになっていた。
// 判定基準が乖離するリスクを避けるため、既存precedent(scripts/*.tsからfunctions/src/*
// への直接import、例: verify-candidate-extraction-document-level.ts)に倣いimportに統一)。

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

/**
 * グループ内のいずれかのメンバーに`isDuplicate:true`が立っているか判定する(code-review
 * 指摘対応、2026-07-27)。decision-maker指示の原文「同姓同名フラグが明示的になくて、
 * 漢字などスペース以外は完全一致なら、それは同姓同名差分ではないと判断」は、isDuplicate
 * フラグが明示的に立っている場合を自動統合の対象から除く前提条件を含んでいたが、旧実装は
 * `isDuplicate`フィールドを`CustomerRecord`へ読み込むだけで実際には一切参照していなかった。
 * `isDuplicate:true`は`MastersPage.tsx`の`handleForceAdd`(force-add UI)経由で人間が
 * 「衝突警告を確認したうえで別レコードとして意図的に追加した」ことを示す記録であり、
 * このフラグが立っているグループは自動統合せず`findExcludedNotationGroups`で手動確認へ回す。
 */
function hasIsDuplicateFlag(members: CustomerRecord[]): boolean {
  return members.some((m) => m.isDuplicate);
}

/**
 * グループ内の2件以上が、furigana(読み仮名)を共に保持しているにも関わらず異なる値を
 * 持つか判定する(code-review 5巡目指摘対応、2026-07-27)。
 *
 * `isDuplicate`フラグを自動統合の唯一の安全網にできない理由: `functions/src/drive/
 * customerAmbiguityGate.ts`が既に文書化している通り、(1)`MastersPage.tsx`の
 * `handleForceAdd`は衝突ペアの新規追加側にのみ`isDuplicate:true`を付与し既存側は
 * 更新しない、(2)`useMasters.ts`の`updateCustomer`(改名含む)には重複チェックが
 * 一切ない、(3)`checkCustomerDuplicate`が使う`normalizeName`(`frontend/src/lib/
 * textNormalizer.ts`)はスペースを圧縮するのみで内部の単一スペースは除去しないため
 * (本モジュールが使う`normalizeText`は全スペースを除去する非対称性がある)、スペースの
 * 有無だけが異なる別人がフロントエンドの重複チェックを一度も経由せず登録されうる。
 * furiganaは同一人物であれば通常一致するはずの独立フィールドであり、`isDuplicate`に
 * 依存しない「別人の疑い」シグナルとして使う。careManagerName(担当ケアマネ異動により
 * 正当に変わりうる)は対象に含めない。
 */
function hasConflictingFurigana(members: CustomerRecord[]): boolean {
  const furiganaValues = members.map((m) => m.furigana).filter((f) => f !== '');
  return new Set(furiganaValues).size > 1;
}

function groupByNormalizedName(customers: CustomerRecord[]): NotationDuplicateGroup[] {
  const byNormalized = new Map<string, CustomerRecord[]>();
  for (const c of customers) {
    const key = normalizeText(c.name);
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
 * 正規化後は一致するグループを、統合可能([B]、表記ゆれのみ)と統合不可
 * (完全一致サブグループを含む、[A]相当の真の同姓同名候補が混在)に一括で振り分ける。
 * `groupByNormalizedName`を1回だけ実行する(code-review指摘対応、2026-07-27:
 * `groupNotationDuplicates`/`findExcludedNotationGroups`を続けて呼ぶと同じグルーピング
 * 処理が2回走っていた)。
 */
export function partitionNotationGroups(customers: CustomerRecord[]): {
  included: NotationDuplicateGroup[];
  excluded: NotationDuplicateGroup[];
} {
  const all = groupByNormalizedName(customers);
  const isExcluded = (members: CustomerRecord[]) =>
    hasExactMatchSubset(members) || hasIsDuplicateFlag(members) || hasConflictingFurigana(members);
  return {
    included: all.filter((g) => !isExcluded(g.members)),
    excluded: all.filter((g) => isExcluded(g.members)),
  };
}

/**
 * 正規化後は一致するが生文字列が異なるグループを検出する。
 * 完全一致([A]、真の同姓同名候補)のみのグループは対象外(呼出元が別途扱う)。
 * グループ内に完全一致のサブグループが紛れ込んでいる場合も、安全側でグループ全体を
 * 対象外にする(`findExcludedNotationGroups`で個別に検出・手動確認へ回す)。
 */
export function groupNotationDuplicates(customers: CustomerRecord[]): NotationDuplicateGroup[] {
  return partitionNotationGroups(customers).included;
}

/**
 * `groupNotationDuplicates`が完全一致サブグループの混在を理由に除外したグループを返す。
 * 自動統合はできないが、手動確認の対象として可視化するために使う
 * (呼出元のオーケストレーションスクリプトがコンソール出力・件数集計に使用)。
 */
export function findExcludedNotationGroups(customers: CustomerRecord[]): NotationDuplicateGroup[] {
  return partitionNotationGroups(customers).excluded;
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
 * customerId/customerName/careManager/careManagerKeyの4キーのみ
 * (CLAUDE.md MUST: 更新対象外フィールド不変)。
 *
 * careManager/careManagerKeyの必要性(code-review指摘対応、2026-07-27):
 * `functions/src/triggers/syncCareManager.ts`はcustomer masterの`careManagerName`が
 * 変更された時のみ、その顧客に紐づくdocumentの`careManager`/`careManagerKey`を一括更新する
 * トリガーである。本スクリプトが敗者の書類をcanonicalへ付け替える際、canonicalの
 * `careManagerName`自体が変化しなければ(既に値が設定されているケース)このトリガーは
 * 発火しないため、付け替えられた書類は敗者側の古い担当ケアマネのままになりうる。
 * `buildCareManagerUpdate`(syncCareManagerLogic.tsのSSoT)を直接使い、書類の付け替えと
 * 同時にcanonical側の正しい担当ケアマネへ揃える。
 *
 * 呼出元は`canonical`のcareManagerNameに、補完済みの値(`resolveInitialCareManagerName`/
 * `resolveFinalCareManagerName`の戻り値)を渡すこと(canonical自身が欠損しており敗者からの
 * 補完で初めて設定されるケースを正しく反映するため)。書類付け替え(Phase3、confirmedLosers
 * 確定前)には`resolveInitialCareManagerName`を、削除直前の再検証後にconfirmedLosersベースの
 * 値へ補正する場合は`resolveFinalCareManagerName`を使う(両者は一致しないことがあるため、
 * 呼出元は差分を検知して既に付け替え済みの書類を再補正すること、code-review 4巡目指摘対応、
 * 2026-07-27)。
 */
export function buildDocumentRepointPayload(canonical: CustomerRecord): {
  customerId: string;
  customerName: string;
  careManager: string | null;
  careManagerKey: string;
} {
  return {
    customerId: canonical.id,
    customerName: canonical.name,
    ...buildCareManagerUpdate(canonical.careManagerName),
  };
}

/**
 * 書類付け替え時(Phase3、confirmedLosers確定前)に使うcareManagerNameを算出する(純粋関数)。
 * canonical自身の値があればそれを優先し、なければPhase1時点(全敗者ベース)の
 * `buildMergedMasterUpdate`補完値を使う。
 */
export function resolveInitialCareManagerName(canonical: CustomerRecord, phase1Update: MergedMasterUpdate): string {
  return canonical.careManagerName || phase1Update.careManagerName || '';
}

/**
 * 削除直前の再検証で確定したconfirmedLosersベースの`confirmedUpdate`(全敗者が
 * skipされconfirmedLosersが空の場合はnull)から、canonicalマスター自身に反映される
 * 最終的なcareManagerNameを算出する(純粋関数)。
 *
 * `resolveInitialCareManagerName`が返す値(書類付け替え時に使用済み)と異なりうる
 * (careManagerName補完元の敗者が再検証でskipされた場合)。呼出元はその差分を検知して
 * 既に付け替え済みの書類を再補正すること(code-review 4巡目指摘対応、2026-07-27:
 * 未修正だと書類側のcareManagerとcanonicalマスター自身のcareManagerNameが異なる値の
 * まま残ってしまっていた)。
 */
export function resolveFinalCareManagerName(
  canonical: CustomerRecord,
  confirmedUpdate: MergedMasterUpdate | null
): string {
  return canonical.careManagerName || confirmedUpdate?.careManagerName || '';
}

export interface ConfirmedLosersResult {
  confirmedLosers: CustomerRecord[];
  skippedLosers: CustomerRecord[];
}

/**
 * 敗者マスター削除直前の再検証結果(`recheckCounts`: 敗者id→その時点で参照している
 * document数)から、実際に削除・マージしてよい敗者(confirmedLosers)と、レース発生の
 * 疑いがあるため削除・マージを見送る敗者(skippedLosers)を振り分ける(純粋関数)。
 *
 * (code-review指摘対応、2026-07-27): 旧実装はPhase1時点の全敗者から`buildMergedMasterUpdate`
 * で更新内容を計算し無条件でcanonicalへ反映した「後」に、敗者ごとの削除可否を個別判定
 * していた。そのため再検証で削除がスキップされた敗者の生名/furigana等が、削除されず
 * 生き残った敗者マスターとcanonicalの双方に同時に存在する不整合状態になりえた。
 * 呼出元は本関数の`confirmedLosers`のみを`buildMergedMasterUpdate`へ渡すことで、
 * 実際に削除される敗者のデータのみがcanonicalへ反映されるようにする。
 */
export function resolveConfirmedLosers(
  choice: CanonicalChoice,
  recheckCounts: Map<string, number>
): ConfirmedLosersResult {
  const confirmedLosers: CustomerRecord[] = [];
  const skippedLosers: CustomerRecord[] = [];
  for (const loser of choice.losers) {
    const remaining = recheckCounts.get(loser.id) ?? 0;
    if (remaining > 0) {
      skippedLosers.push(loser);
    } else {
      confirmedLosers.push(loser);
    }
  }
  return { confirmedLosers, skippedLosers };
}
