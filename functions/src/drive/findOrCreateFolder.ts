/**
 * Google Drive フォルダの find-or-create(ADR-0022 Decision 4)
 *
 * 親フォルダ直下を子フォルダ名で検索し、0件なら作成・1件なら再利用(trashedなら
 * 復元してから再利用)・2件以上なら `AmbiguousFolderError` をthrowして停止する。
 * 曖昧な状態での自動選択は誤配置リスクがあるため、常に停止を優先する。
 *
 * Issue #811根本原因の修正(2026-08-27、Phase B Part B): 従来は`trashed=false`
 * 固定検索だったため、手動でゴミ箱に入れたフォルダを次回エクスポート時に
 * 「存在しない」と誤判定し新規作成し続け、物理フォルダ重複を生んでいた
 * (kanameone「森奈穂美」フォルダで6重複・241件のdocumentが影響を受けた実害を
 * Phase B Part Aで移行済み)。
 *
 * 検索は2段階で行う(2026-08-27、初版の単純なtrashed込み検索をkanameone本番の
 * 実運用で検出した回帰を受けて訂正): まずactiveのみで検索し、1件ならそれを
 * 即座に返す(過去に整理された無関係なtrashedの同名フォルダが他に残っていても
 * 一切考慮しない)。active 0件の場合のみtrashed込みで再検索し、1件なら
 * `files.update({trashed:false})`で復元してから返す。各段階で2件以上見つかった
 * 場合は`AmbiguousFolderError`で停止する。
 *
 * Issue #871恒久対策(2026-08-30、claimプロトコル): `files.list`の結果整合性遅延
 * (`files.create`直後の検索で新規作成分が返らないことがある)により、逐次実行でも
 * 「1件目が作成→ロック解放→2件目が同じparent+nameを検索して0件(索引未反映)→
 * 再作成」という経路で物理フォルダ重複が発生していた(診断結果はIssue #871参照)。
 * 「作成の予約(creating)→確定(resolved)」を`driveFolderClaim.ts`の単一ドキュメント・
 * 単一トランザクションで扱うことで、この経路を塞ぐ。
 *
 * 段階導入(shadowモード): `settings/features`の`driveFolderClaimRead`フラグが
 * 有効になるまでは、claimの書き込みのみ行い(既存挙動への影響ゼロ)、`files.list`/
 * `files.get`をclaimで短絡することはない。フラグ有効化後は下記3段ラダーで
 * Drive API呼び出しを短絡する:
 *
 * | resolvedAtMs/verifiedAtMsからの経過 | Drive API呼び出し |
 * |---|---|
 * | < CREATE_TRUST_MS(60秒)            | なし(claimのfolderIdを即返す) |
 * | CREATE_TRUST_MS〜SOFT_TTL_MS(5分)  | files.getのみ(健全性確認) |
 * | > SOFT_TTL_MS                       | files.list完全検索(現行と同等の重複検知力) |
 *
 * 完全再検索が0件の場合はclaimを信用する(§4の要): resolved claimが存在するのに
 * `files.list`が0件を返す状態こそが本バグの症状そのものであり、これを「フォルダが
 * 消えた」と解釈して再作成に倒すと5分の壁を越えただけでバグが再現する。claimを
 * 無効化できる唯一の経路は`files.get`の404累積判定(`driveFolderClaim.ts`の
 * `recordMiss`)だけである。
 *
 * Issue #880恒久対策(2026-09-17): claimプロトコル状態機械の呼び出しシーケンスは
 * `childFolderResolver.ts`とほぼ同一だったため重複しており、実際に2度(コミット
 * 8a89badd・PR #928)片側だけ修正して対称性が崩れる実害を起こしていた。
 * `folderResolutionCore.ts`へ状態機械本体を集約し、本ファイルは薄いラッパーになった。
 */

import * as admin from 'firebase-admin';
import { drive_v3 } from 'googleapis';
import {
  AmbiguousFolderError,
  FolderCreationInProgressError,
  DivergentFolderClaimError,
  FOLDER_LOCKS_COLLECTION,
  FOLDER_LOCK_STALE_MS,
  buildFolderLockId,
} from './driveFolderClaim';
import { resolveFolderWithClaim, FolderResolutionPolicy } from './folderResolutionCore';

// 呼び出し元(exportDocument.ts等)・テストからの既存importを壊さないための再export。
export {
  AmbiguousFolderError,
  FolderCreationInProgressError,
  DivergentFolderClaimError,
  FOLDER_LOCKS_COLLECTION,
  FOLDER_LOCK_STALE_MS,
  buildFolderLockId,
};

const findOrCreateFolderPolicy: FolderResolutionPolicy = {
  logPrefix: '[findOrCreateFolder]',
  makeAmbiguousError: (name, parentId, count) => new AmbiguousFolderError(name, parentId, count),
  makeMissingIdError: (name, context) =>
    new Error(
      context === 'created'
        ? `フォルダの作成に失敗しました(idが返却されませんでした): "${name}"`
        : `既存フォルダのidが取得できません: "${name}"`
    ),
  // wrapCommitFailure は指定しない: commit失敗時は素のerrorをそのままthrowする
  // (現行実装の非対称性、Issue #880 characterization test で挙動を固定済み)。
};

export async function findOrCreateFolder(
  drive: drive_v3.Drive,
  firestore: admin.firestore.Firestore,
  parentId: string,
  name: string
): Promise<string> {
  const outcome = await resolveFolderWithClaim(drive, firestore, parentId, name, findOrCreateFolderPolicy);
  return outcome.id;
}
