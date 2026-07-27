#!/usr/bin/env ts-node
/**
 * 表記ゆれ重複マスター統合スクリプト(2026-07-27)
 *
 * `check-customer-master-integrity.js`の[B]表記ゆれ重複候補(正規化後は一致するが生文字列は
 * 相違、姓名間スペースの有無等)を、1件のマスターへ統合する。明示的な`isDuplicate`フラグが
 * 立たない=同姓同名の別人ではないという判断(decision-maker確認済み、2026-07-27)による。
 *
 * ポリシー: 紐づく書類数が多い方を正式表記(canonical)として残し、書類の付け替え件数を
 * 最小化する。敗者側の生名は、既存の「許容表記」機構(`CustomerMaster.aliases`)へ追加する
 * (新規の仕組みは導入しない)。furigana/careManagerName/notesはcanonical側が欠損している
 * 場合のみ敗者から補完する(上書きしない)。
 *
 * 安全対策(evaluatorレビュー指摘対応、2026-07-27):
 * - 完全一致([A]、真の同姓同名候補)がグループ内に紛れ込んでいる場合は
 *   `groupNotationDuplicates`が丸ごと対象外にする。除外グループは`findExcludedNotationGroups`
 *   で可視化し、コンソールへ警告出力する(自動統合はせず手動確認へ回す)。
 * - `--execute`前に、`cleanup-ambiguous-collision-docs.ts`と同型の`--backup-out`で
 *   敗者マスターの全フィールド+付け替え対象書類IDをJSONへ書き出す(dry-runでも出力、
 *   レビュー材料兼復旧材料)。
 * - 敗者マスター削除の直前(書類付け替え・canonicalマスター更新の直後)に、そのcustomerId
 *   を参照するdocumentが新たに増えていないか再検証する(本番kanameoneはGmail取込が継続
 *   稼働中のため、書類再取得と削除の間に新規docがloserのcustomerIdへ割り当てられる
 *   レースを完全には排除できない)。検出した場合はその敗者の削除・マージのみスキップし、
 *   書類の付け替え自体は既に完了済みのため実害は限定的。再検証は必ず書類付け替えの
 *   「後」に行うこと(2026-07-27実装時に自己検出: 付け替えより前に行うと、まだ
 *   付け替えていない敗者自身の既知の書類を「新規レース」と誤検知してしまう)。
 * - 書類付け替え時のcareManager/careManagerKeyは、canonical自身の値があればそれを、
 *   なければPhase1時点(全敗者、confirmedLosers確定前)の補完値を使う(code-review指摘
 *   対応、2026-07-27: `functions/src/triggers/syncCareManager.ts`はcanonical自身の
 *   careManagerNameが変化した時のみ発火するトリガーのため、旧実装はcustomerId/
 *   customerNameのみ更新し敗者側の古い担当ケアマネの値が書類に残り続けていた)。
 * - 計画(Phase1)→バックアップ書出し(Phase2)→実行(Phase3)の3段階構成(evaluator再指摘
 *   対応、2026-07-27: 旧実装はグループ単位のexecute直後にバックアップを書き出しており、
 *   途中のグループで例外が発生すると復旧材料が一切残らなかった)。この分離により、複数
 *   グループ実行時は「書類の読み取り」から「実際の付け替え書込み」までの間隔が旧実装より
 *   広がる(全グループのPhase1完了+バックアップ書出しを待つため)。ここでも上記の削除直前
 *   再検証が安全網として働くため、レースが起きても実害はマスター削除スキップ止まりで、
 *   データ消失やbroken referenceには至らない(evaluator確認済み)。
 *
 * 判定ロジックは`scripts/lib/notationDuplicateMerge.ts`の純粋関数を使用。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=docsplit-kanameone npx ts-node scripts/merge-notation-duplicate-masters.ts               # dry-run(既定)
 *   FIREBASE_PROJECT_ID=docsplit-kanameone npx ts-node scripts/merge-notation-duplicate-masters.ts --execute      # 実行
 *   FIREBASE_PROJECT_ID=docsplit-kanameone npx ts-node scripts/merge-notation-duplicate-masters.ts --backup-out <path>  # バックアップ出力先を明示指定
 */

import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';
import {
  CustomerRecord,
  partitionNotationGroups,
  pickCanonical,
  buildMergedMasterUpdate,
  buildDocumentRepointPayload,
  resolveConfirmedLosers,
} from './lib/notationDuplicateMerge';

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID を設定してください');
  process.exit(1);
}

const execute = process.argv.includes('--execute');

function getOpt(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}
const backupOut =
  getOpt('--backup-out') || path.join(process.cwd(), `merge-notation-duplicate-masters-backup-${projectId}.json`);

admin.initializeApp({ projectId });
const db = admin.firestore();

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

async function fetchAllCustomers(): Promise<CustomerRecord[]> {
  const snap = await db.collection('masters/customers/items').get();
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      name: asString(data.name).trim(),
      furigana: asString(data.furigana).trim(),
      careManagerName: asString(data.careManagerName).trim(),
      notes: asString(data.notes).trim(),
      aliases: Array.isArray(data.aliases) ? data.aliases.filter((a: unknown) => typeof a === 'string') : [],
      isDuplicate: data.isDuplicate === true,
    };
  });
}

async function countDocumentsByCustomerId(customerId: string): Promise<number> {
  const snap = await db.collection('documents').where('customerId', '==', customerId).count().get();
  return snap.data().count;
}

interface BackupGroupEntry {
  canonical: CustomerRecord;
  losers: Array<{ master: CustomerRecord; affectedDocumentIds: string[] }>;
  update: ReturnType<typeof buildMergedMasterUpdate>;
}

async function main(): Promise<void> {
  console.log(`プロジェクト: ${projectId}`);
  console.log(`モード: ${execute ? '実行(書込みあり)' : 'dry-run(書込みゼロ)'}`);
  console.log('---\n');

  const customers = await fetchAllCustomers();
  // partitionNotationGroups()は1回のグルーピングでincluded/excludedを同時に返す
  // (code-review指摘対応、2026-07-27: groupNotationDuplicates/findExcludedNotationGroupsを
  // 続けて呼ぶと同じグルーピング処理が2回走っていた)。
  const { included: groups, excluded: excludedGroups } = partitionNotationGroups(customers);

  if (excludedGroups.length > 0) {
    console.log(
      `⚠️ ${excludedGroups.length}組は完全一致サブグループ(真の同姓同名候補)を含むため自動統合の対象外です。手動確認してください:`
    );
    for (const g of excludedGroups) {
      console.log(`  ${g.members.map((m) => `「${m.name}」(id=${m.id.slice(0, 12)}…)`).join(' / ')}`);
    }
    console.log('');
  }

  console.log(`[B] 表記ゆれ重複候補: ${groups.length}組\n`);

  if (groups.length === 0) {
    console.log('対象なし。終了します。');
    process.exit(0);
  }

  // Phase 1: 計画フェーズ。全グループの統合計画(canonical/losers/付け替え対象書類ID)を
  // 読み取り専用で確定させる。書込みは一切行わない。
  let totalDocsRepointed = 0;
  const plannedGroups: Array<{ choice: ReturnType<typeof pickCanonical>; entry: BackupGroupEntry }> = [];

  for (const group of groups) {
    // 全メンバーの書類一覧を`.get()`で1回だけ取得し、件数(canonical選定用)と
    // 実際のdocument ID一覧(敗者の付け替え用)の両方をここから導出する
    // (code-review指摘対応、2026-07-27: 旧実装は全メンバーにcount()を実行した後、
    // 敗者についてのみ同一条件で改めて`.get()`しており、敗者分は毎回二重クエリだった)。
    const counts = new Map<string, number>();
    const docsByMemberId = new Map<string, string[]>();
    for (const member of group.members) {
      const docsSnap = await db.collection('documents').where('customerId', '==', member.id).get();
      const docIds = docsSnap.docs.map((d) => d.id);
      counts.set(member.id, docIds.length);
      docsByMemberId.set(member.id, docIds);
    }

    const choice = pickCanonical(group, counts);
    const update = buildMergedMasterUpdate(choice);

    console.log(`グループ: ${group.members.map((m) => `「${m.name}」(${counts.get(m.id)}件)`).join(' / ')}`);
    console.log(`  → canonical: 「${choice.canonical.name}」(id=${choice.canonical.id.slice(0, 12)}…)`);

    const loserEntries: BackupGroupEntry['losers'] = [];
    for (const loser of choice.losers) {
      const affectedDocumentIds = docsByMemberId.get(loser.id) ?? [];
      loserEntries.push({ master: loser, affectedDocumentIds });
      console.log(
        `  → 敗者: 「${loser.name}」(id=${loser.id.slice(0, 12)}…, 書類${affectedDocumentIds.length}件を付け替え)`
      );
      totalDocsRepointed += affectedDocumentIds.length;
    }
    if (update.aliasesToAdd.length > 0) {
      console.log(`  → aliases追加: ${update.aliasesToAdd.map((a) => `「${a}」`).join(', ')}`);
    }
    if (update.furigana) console.log(`  → furigana補完: 「${update.furigana}」`);
    if (update.careManagerName) console.log(`  → careManagerName補完: 「${update.careManagerName}」`);
    if (update.notes) console.log(`  → notes補完: 「${update.notes}」`);
    console.log('');

    plannedGroups.push({ choice, entry: { canonical: choice.canonical, losers: loserEntries, update } });
  }

  // Phase 2: バックアップ書き出し。破壊的な書込み(Phase 3)より必ず前に行う
  // (evaluator指摘対応、2026-07-27: 従来はグループ単位のexecute直後に書き出しており、
  // 途中のグループで例外が発生すると復旧材料が一切残らなかった)。dry-runでも出力され
  // レビュー材料として使える。
  const backupPayload = {
    exportedAt: new Date().toISOString(),
    projectId,
    mode: execute ? 'execute' : 'dry-run',
    excludedGroups: excludedGroups.map((g) => ({ members: g.members })),
    groups: plannedGroups.map((p) => p.entry),
  };
  fs.writeFileSync(backupOut, JSON.stringify(backupPayload, null, 2));
  console.log(`バックアップ/レビュー用JSONを保存しました: ${backupOut}\n`);

  // Phase 3: 実行フェーズ(--executeのみ)。Phase 1で確定済みの計画に基づき書込みを行う。
  // グループ単位でtry/catchし、1グループの失敗が残り全グループを無音で巻き込まないように
  // する(code-review指摘対応、2026-07-27: 旧実装は例外がmain().catch()まで伝播し
  // process.exit(1)するのみで、途中グループの成功/失敗が要約されなかった)。
  let succeededGroupCount = 0;
  const failedGroups: string[] = [];

  if (execute) {
    for (const { choice, entry } of plannedGroups) {
      try {
        // 書類付け替え。canonical自身のcareManagerNameが既に設定されていればそれを、
        // 未設定ならPhase1で全敗者(entry.update、confirmedLosers確定前)から計算した
        // 補完値を使う(code-review指摘対応、2026-07-27: 旧実装はcustomerId/customerName
        // のみ更新しcareManager/careManagerKeyへ触れず、敗者側の古い担当ケアマネの値が
        // 付け替え後も残ってしまっていた。functions/src/triggers/syncCareManager.tsは
        // canonical自身のcareManagerName値が変化した時のみ発火するため、既に値が設定済み
        // のcanonicalへ統合する場合はトリガーが発火せず書類側が永久に古いままになりえた)。
        // ここでconfirmedLosers確定前のPhase1計算値を使うのは、削除直前の再検証(後述)を
        // 書類付け替えの「後」・削除の直前という一等最小の間隔に保つため(1回目の
        // 再検証を書類付け替えより先に行うと、まだ付け替えていない敗者自身の既知の書類を
        // 「新規レース」と誤検知してしまう設計上の罠があった、2026-07-27実装時に自己検出)。
        const payload = buildDocumentRepointPayload({
          ...choice.canonical,
          careManagerName: choice.canonical.careManagerName || entry.update.careManagerName || '',
        });
        for (const loserEntry of entry.losers) {
          for (const docId of loserEntry.affectedDocumentIds) {
            await db.doc(`documents/${docId}`).update(payload);
          }
          console.log(`  ✔ 「${loserEntry.master.name}」の書類${loserEntry.affectedDocumentIds.length}件を付け替え済み`);
        }

        // 削除直前の再検証: 書類再取得〜削除の間に新規docがこのcustomerIdへ割り当て
        // られていないか確認する。書類付け替えの直後・削除の直前に行うことで、
        // 「まだ付け替えていない自分自身の既知の書類」を誤って検知しない
        // (evaluator指摘対応、2026-07-27)。確定した敗者(confirmedLosers)のみをマージ・
        // 削除対象にする(code-review指摘対応、2026-07-27: 旧実装はPhase1時点の全敗者
        // からマージ内容を計算して無条件でcanonicalへ反映した後に削除可否を個別判定して
        // いたため、削除がスキップされた敗者の生名/furigana等がcanonicalへ既に取り込まれ、
        // 削除されず生き残った敗者マスターとcanonicalの両方が同一人物のデータを保持する
        // 不整合が生じえた)。
        const recheckCounts = new Map<string, number>();
        for (const loser of choice.losers) {
          recheckCounts.set(loser.id, await countDocumentsByCustomerId(loser.id));
        }
        const { confirmedLosers, skippedLosers } = resolveConfirmedLosers(choice, recheckCounts);
        for (const loser of skippedLosers) {
          console.log(
            `  ⚠️ 敗者マスター(${loser.id.slice(0, 12)}…)は削除直前の再検証で${recheckCounts.get(loser.id)}件の書類が新たに検出されたため、削除・マージ双方をスキップしました(手動確認要)`
          );
        }

        if (confirmedLosers.length > 0) {
          const confirmedUpdate = buildMergedMasterUpdate({ canonical: choice.canonical, losers: confirmedLosers });
          const masterUpdate: Record<string, unknown> = {};
          if (confirmedUpdate.aliasesToAdd.length > 0) {
            masterUpdate.aliases = admin.firestore.FieldValue.arrayUnion(...confirmedUpdate.aliasesToAdd);
          }
          if (confirmedUpdate.furigana) masterUpdate.furigana = confirmedUpdate.furigana;
          if (confirmedUpdate.careManagerName) masterUpdate.careManagerName = confirmedUpdate.careManagerName;
          if (confirmedUpdate.notes) masterUpdate.notes = confirmedUpdate.notes;
          if (Object.keys(masterUpdate).length > 0) {
            await db.doc(`masters/customers/items/${choice.canonical.id}`).update(masterUpdate);
            console.log(`  ✔ 「${choice.canonical.name}」のcanonicalマスターを更新済み`);
          }

          for (const loser of confirmedLosers) {
            await db.doc(`masters/customers/items/${loser.id}`).delete();
            console.log(`  ✔ 敗者マスター(${loser.id.slice(0, 12)}…)を削除済み`);
          }
        }
        succeededGroupCount++;
      } catch (err) {
        failedGroups.push(choice.canonical.name);
        console.error(`  ❌ 「${choice.canonical.name}」グループの処理中にエラーが発生しました:`, err);
      }
      console.log('');
    }
  }

  console.log(`合計: ${groups.length}組、書類${totalDocsRepointed}件${execute ? 'を付け替え' : 'が付け替え対象'}`);
  if (execute) {
    console.log(`実行結果: 成功${succeededGroupCount}組 / 失敗${failedGroups.length}組`);
    if (failedGroups.length > 0) {
      console.log(`失敗したグループ: ${failedGroups.map((n) => `「${n}」`).join(', ')}(バックアップJSONから復旧・再実行してください)`);
    }
  }
  console.log(`\n=== ${projectId} ${execute ? '実行完了' : 'dry-run完了(書き込みゼロ)'} ===`);
  process.exit(execute && failedGroups.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('エラー:', err);
  process.exit(1);
});
