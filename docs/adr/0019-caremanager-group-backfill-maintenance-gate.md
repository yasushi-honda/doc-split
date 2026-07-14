# ADR-0019: 担当CM別集計バックフィルの並行更新対策(メンテナンスゲート方式)

## Status

Accepted (2026-07-15, session131)。`/impl-plan`フルモード + `/codex plan`セカンドオピニオン3往復を経て設計確定、decision-maker承認済み。実装完了(GOAL.md タスクG サブタスクA〜G)。

## Context

### 背景

kanameone本番で「担当CM(ケアマネジャー)別」の書類集計が「顧客別」集計より大幅に少なく表示される非対称性バグがあった(customer合計9,620件 vs careManager合計6,283件、差34.7%、2026-07-14時点)。原因は`Document`型の`careManager`が任意フィールドでフォールバックがなく、集計ロジック(`functions/src/utils/groupAggregation.ts`)が正規化キー空文字のgroupTypeを丸ごと除外していたこと。

PR #656(GOAL.md タスクA)でこの本体ロジックを修正済み: `resolveGroupKeyAndDisplay()`を新設し、careManagerKeyが空でもcustomerKeyが非空なら予約key(`__UNASSIGNED_CARE_MANAGER__`)+表示名「CM未設定」で集計対象に含めるようにした。この修正は本番の`onDocumentWrite`トリガー(`updateDocumentGroups.ts`)には既に反映されており、**新規の書込みは全て正しく集計される**。残る課題は、修正前の旧ロジックで既に構築された本番`documentGroups`コレクションの**既存データ**をどう安全に是正するかである。

### スコープの再評価(セカンドオピニオンで判明)

当初はGOAL.mdに「`documentGroups`全体の再構築(同時更新競合対策・ロールバック手順込み)」という広いスコープで記載されていたが、`/codex plan`との対話の中で以下が判明した:

- `resolveGroupKeyAndDisplay()`の`UNASSIGNED_FALLBACK`は`careManager`にのみ定義されている。したがって本バグの影響を受けるのは**新設の「CM未設定」グループ1件のみ**であり、既存の顧客別/事業所別/書類種別/実在CM別グループは数学的に無影響である。
- この事実により、バックフィルは「`documentGroups`全体の調停」ではなく「単一グループの安全な初期作成」に縮小できる。

### 検討した候補案とCodexによる却下理由

`/codex plan`セカンドオピニオン(3往復)で以下の候補案がいずれも並行更新レースを防げないと判明した:

1. **差分ベースのdelta合成**(バックフィルのスキャン結果と、既存の`updateGroupAggregation()`をそのまま流用したライブトリガーの更新を単純に加算する): `updateGroupAggregation()`は新規グループ作成時にdelta値を無視し常に`count:1`固定で作成する実装(現状の唯一の呼び出し元=ライブトリガーはdelta常に1のため無害だが汎用差分適用には使えない、実コードで確認)。また、バックフィルがdocument Xを「CM未設定」と読んだ直後にライブトリガーがXを実CMへ更新すると、二重の巻き戻し(CM未設定を再び+1、実CM側を-1)が発生し、ライブ更新を打ち消してしまう。
2. **`processedAt`等の時刻cutoff境界による区切り**: ページング全件スキャン自体が一貫スナップショットでないため、各文書が更新前・更新後のどちらで読まれたか混在する。cutoff以前に作成された文書がスキャン〜書込みの間に実CMへ変わっても、まだ存在しないグループへの`-1`はスキップされるため、古いスキャン結果のまま過大計上として残る。
3. **`syncCareManager.ts`(顧客マスター同期バッチ)のみを一時停止**: 500件一括更新によるホットドキュメント競合は大きく減らせるが、OCR完了確定処理・splitにも同種の競合があり、正確性の保証にはならない。
4. **集計副作用のみをoutbox化**(documents本体への書込みは止めない): outboxが「集計更新を後送り」にするだけで「documentsの一貫したスナップショット」を作らないため、スキャンが更新前後どちらを読んだか不明なままoutboxイベントを一律replayすると二重計上または欠落が生じる。

## Decision

### 採用方式: 集計所属変更ゲート(短時間の書込み経路ゲート)

`documents`本体の全書込みを止めるのではなく、**集計所属を変えうる「確定」書込みのみ**を短時間ゲートし、静止状態でCM未設定グループを安全に初期作成する。

#### ゲート対象(短時間停止)

| 経路 | ファイル | 挿入位置 | 理由 |
|------|---------|---------|------|
| OCR完了確定・rescue | `functions/src/ocr/processOCR.ts` (`processOCR` onSchedule) | スケジュール実行ハンドラの先頭(rescue処理より前) | `customerName`/`careManager`/`status`を確定させる唯一の書込み経路。ゲート中は当該サイクルを丸ごとスキップし、pending文書はそのまま残る(次回1分間隔実行でキャッチアップ) |
| split | `functions/src/pdf/pdfOperations.ts` (`splitPdf` onCall) | 認証・バリデーション後、PDF読込等の重い処理の前 | 親`status:'split'`化+子文書の`careManager`初期値決定を行う |
| 顧客マスター同期 | `functions/src/triggers/syncCareManager.ts` (`onCustomerMasterWrite`) | ハンドラ先頭、`documents`一括update前 | 最大500件バッチ更新によるCM未設定グループへのトランザクション集中の主因(Codexが最も強く懸念した経路) |
| FE直接編集 | `frontend/src/hooks/useDocumentEdit.ts`(書類詳細画面の手動メタデータ編集)等、クライアントSDKから`documents`を直接書き換える経路全般 | `firestore.rules`の`documents/{docId}` update ルール | Cloud Functions(Admin SDK)はFirestore Rulesの適用対象外のため、上記3経路のコードレベルゲートでは制御できない。Evaluatorレビューで指摘(session131) — 当初のADR案では`appendReprocessClearToBatch`(再処理ボタン)のみを残存リスクとして許容していたが、日常的に使われる手動編集機能`useDocumentEdit.ts`が見落とされていたため、Firestore Rules側で`customerName`/`officeName`/`documentType`/`careManager`を変更する更新をゲート閉中は一律拒否する対策に変更した(`groupAggregationGateOpen()`/`affectsGroupAggregationFields()`関数を追加) |

#### ゲート対象外(継続)

- Gmail取込・アップロードによる`pending`文書作成(`customerKey`がまだ空の段階)。`resolveGroupKeyAndDisplay()`の`canFallbackToUnassigned`条件(`customerKey`非空が前提)により、この段階の書込みは元々`documentGroups`への副作用を持たないため止める必要がない。

#### メカニズム

1. `system/maintenanceFlags`ドキュメントの`groupAggregationGateOpen`フィールド(`functions/src/utils/maintenanceGate.ts`)で開閉を制御。フラグ未設定時は「開いている(true)」を安全側デフォルトとする。
2. ゲートを閉じてから、**Cloud Functions最大実行時間(`processOCR`: 540秒)を上回る待機(デフォルト10分、`scripts/migrate-document-groups.js --drain-wait-ms`で調整可)** をドレイン確認バリアとする。これにより、ゲートクローズ前に開始していた実行を含め、集計所属変更を伴う書込みが全て完了/タイムアウト済みであることを技術的根拠を持って保証する(単なる時間待ちではなく、Cloud Functionsの実行時間上限という具体的な制約に基づく)。
3. 静止状態で`documents`を`where('status','!=','split').orderBy('status').orderBy('processedAt','desc')`(既存の複合indexを再利用、新規index不要)で全件スキャンし、`careManagerKey==''`かつ`customerKey!==''`の書類を対象にCM未設定グループの`count`/`latestDocs`/`latestAt`を計算する。
4. **事前チェック+単一トランザクション内での再チェック**の二段構えで、既にグループが存在する場合(想定外の並行作成、または誤った再実行)は上書きせず異常終了する(`functions/src/utils/groupAggregation.ts` `backfillUnassignedCareManagerGroup()`)。
5. バックフィル成功・失敗にかかわらず`finally`でゲートを必ず再開する(閉じたまま放置しない)。

### ロールバックの再定義

GOAL.md原文の「ロールバック手順(事前スナップショット取得、旧ロジックでの再構築手順)」は、タスクD(`scripts/migrate-document-groups.js`の独立コピー撤廃)の設計と本質的に矛盾する — 旧ロジックは意図的に削除済みであり、復元は不可能かつ不要である。

`documentGroups`は完全に`documents`の生フィールド(`customerName`/`officeName`/`documentType`/`careManager`)から導出可能な**派生データ**であり、本バックフィルはこれらの生フィールドを一切変更しない(CM未設定グループという集計結果ドキュメントを新規作成するのみ)。したがって、万一バックフィルの計算結果に誤りが判明した場合のリカバリは「旧ロジックへの回帰」ではなく、**「バグを修正した上で`backfillUnassignedCareManagerGroup()`を再実行する自己収束」**である:

- グループが未作成のまま失敗(トランザクション未到達): 単純に再実行すれば事前チェックから再開できる(冪等)。
- グループ作成後に誤りが判明: `documentGroups/careManager___UNASSIGNED_CARE_MANAGER__`を削除してから再実行する。

## Consequences

### 得られたもの

- Gmail取込(kanameoneの中核業務)を停止せずにバックフィルを実行できる。
- バックフィル対象が1グループのみに縮小されたことで、`rebuildAllGroupAggregations()`(全削除+全再構築)よりもFirestore書込み量・障害時の影響範囲が大幅に小さい。
- ゲート・ドレイン待機・単一グループ作成のいずれも既存の複合indexで動作し、新規index作成(ビルド待ち時間)が不要。

### 残存リスク(意図的な許容)

- **`scripts/`配下の運用スクリプト**(`fix-stuck-documents.js`等、status:'pending'化を伴うもの)はAdmin SDK経由でFirestore Rulesの適用対象外のためゲート対象外。いずれも`workflow_dispatch`の手動トリガーであり、バックフィル実行者が事前に把握・調整可能。

**FE経由の手動「再処理」トリガー**(`frontend/src/hooks/useDocuments.ts`の`appendReprocessClearToBatch`)・**書類詳細画面の手動メタデータ編集**(`useDocumentEdit.ts`)は、`customerName`/`officeName`/`documentType`/`careManager`いずれかの変更(削除含む)を伴うため、上記のFirestore Rules対策により**ゲート閉中は技術的にブロックされる**(意図しない残存リスクではなく、Rules側の対策で解消済み)。

これらの残存リスクは、バックフィル実行前後で`scripts/diagnose-caremanager-group-gap.js`(groupId単位の個別比較に強化済み)を実行し、差分が説明可能であることを確認することで検知する。

## 関連

- [運用Runbook](../context/caremanager-group-backfill-runbook.md)
- GOAL.md タスクA(PR #656)・D(PR #658)・G(本ADR)
- `functions/src/utils/maintenanceGate.ts` / `functions/src/utils/groupAggregation.ts` (`backfillUnassignedCareManagerGroup`)
- `functions/test/maintenanceGateWiringContract.test.ts` / `maintenanceGateIntegration.test.ts` / `backfillUnassignedCareManagerGroupIntegration.test.ts`
