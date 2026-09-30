# Driveフォルダ再帰統合 runbook(同名の兄弟フォルダ2つ)

`scripts/plan-drive-folder-tree-merge.ts` / `scripts/execute-drive-folder-tree-merge.ts`(ADR-0028 Decision 2の例外)の運用手順。
対象: `settings/drive.rootFolderId`直下の同名フォルダ2つ(統合元S・統合先D)。ルートclaimが
`divergent` / `ambiguous-full-scan` / folderId=D の状態のもの。

## 前提(すべて満たさないとplan/executeが拒否する)
- `settings/drive.grantedScopes`にフルスコープ`drive`(再連携済み)
- `settings/features.driveFolderClaimRead`=true
- S・Dとも有効なフォルダ・親はrootFolderIdのみ・同名・S≠D・Dがルートclaimのfolder
- 統合元ツリーを参照するclaimが0件(`parentId`・`folderId`とも)

## 手順(GitHub Actions: Run Operations Script)
1. **運用フリーズの承認**: 実行前後は、対象フォルダを人がDrive上で操作しない・並走する運用スクリプトを流さない旨をdecision-makerが承認する(ルートclaimがdivergentの間、通常exportはDriveに触れる前に停止するが、人の操作と運用スクリプトは止められない)
2. `plan-drive-folder-tree-merge`(exec_args_json: `{"sourceFolderId":"…","targetFolderId":"…"}`)→ artifact `plan-output.json`(件数とIDのみ。フォルダ名・ファイル名は含まない)
3. planの件数(ファイル移動/フォルダ再親付け/trash・同名ファイル併存数・阻害要因)を確認。**阻害要因が1件でもあれば中止**(解消して再plan)
4. `execute-drive-folder-tree-merge --dry-run`(exec_args_json: `{"planRunId":"<2のrun id>","expectedFileMoves":N,"expectedFolderMoves":N,"expectedFolderTrashes":N}`。件数はplanと一致必須)で書込み0件のドリフト検知
5. `execute-drive-folder-tree-merge --execute`(同じexec_args_json)
6. 完了確認: `status=completed`・`finalize=resolved`・`audit-drive-sibling-duplicates`で対象の行が消える・ルートclaimがresolved(D)

## 残余リスク(設計上の限界)
- 空確認からtrashまでは原子的でない。直前に人が統合元へファイルを置くと、フォルダごとtrashされうる(trash後の再列挙では、trash済みフォルダの子が見えず検知できない)。運用フリーズ(手順1)で緩和し、事後は30日以内にゴミ箱から復元できる
- 統合先の同名子フォルダ・docSplitDocId重複はplan時のみ確認する。planは実行の直前(24時間以内、超過すると書込みを伴う実行は拒否)に取り直す

- 同一planのexecuteを同時に2本走らせない(排他機構は無い。GHAのRun Operations Scriptは1本ずつ、完了を確認してから次を起動する)

- ショートカット: 参照先を変えずに通常のファイルと同様に移動する。ただし「空にしてtrashされる統合元フォルダ」を指すもの(統合後にリンク切れになる)と、参照先が取得できないものは阻害要因。統合対象の**外**にあるショートカットが統合元フォルダを指している場合は検知できず、統合後にリンク切れになりうる。阻害要因の実体は`inspect-drive-items`(read-only、IDのみ出力)で確認できる

## 中断・失敗時
- 部分統合の間はルートclaimがdivergentのままで、対象ツリーのDrive保存(通常export)は止まり続ける。長期間放置せず、原因を除いて早めに再実行する
- 途中失敗(`aborted-op-failure`等): ルートclaimはdivergentのまま(通常exportの停止を維持)。原因を除いて**同一planで再実行**すれば、適用済みopをスキップして続きから完走する(ドリフト時は書込み前に停止するので再planする)
- `aborted-root-claim-changed`: plan後にルートclaimが変化した。再planする
- `finalize-failed`: Drive側の統合は完了しているがclaimが未確定。ルートclaimの状態を確認して再実行
- 時間が経つとplanのfence(claimのupdateTime)や対象の状態が変わるため、planは実行の直前に取り直す

## 手動復旧(専用ロールバックツールは作らない)
manifest(artifact `execute-drive-folder-tree-merge-manifest-…`、90日保持)に全opのID・種別・結果が残る。
- ファイル/フォルダの移動: manifest・plan(`ops[]`の`fromParentId`/`toParentId`)を元に`files.update`(addParents/removeParents)で戻す
- 統合元フォルダ: 名前が`…【統合済み_YYYY-MM-DD】`に改名されtrash済み。Driveのゴミ箱から30日以内に復元し、接尾辞を外す
- ルートclaim: finalize後に戻す場合は`releaseDivergentClaim`等の既存の承認付き再同期手順を使う(自己判断で`driveFolderLocks`を直接編集しない)
- 復旧手順はdevで演習してから本番に使う

## devリハーサル
`setup-drive-folder-fixture --dev --tree-merge-scenario`でS・D・ルートclaimを投入 → 上記手順を2周(2周目は`--cleanup`後に再投入、または同一planの再実行で冪等性を確認)。
