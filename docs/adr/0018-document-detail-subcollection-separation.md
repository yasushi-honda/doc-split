# ADR-0018: Document 重フィールドのサブコレクション分離 (Firestore Egress 削減)

## Status

Proposed (2026-07-06、Codex 6 ラウンドレビュー反映済み、再レビュー待ち)

- Proposed: 2026-07-06 (Phase A、本ADR + `DocumentDetail`型定義)
- Amended: 2026-07-06 (Codex 1st review, `codex review --base main -c model_reasoning_effort=xhigh`、P1×3 + P2×2 反映)
  - P1: `deleteDocument.ts`が親のみ削除しサブコレクションが孤児化する問題 → 削除フロー改修 + ルールに親存在チェック追加
  - P1: Phase Dの読者列挙漏れ(`detectSplitPoints`/`splitPdf`のpageResults読込/`ocrProcessor`のpageResultsReuse読込/`useProcessingHistory`の`getOcrExcerpt`)を追加
  - P1: `set(merge:true)`によるレース対策が、実際にはFirestoreルールの create/update 判定(存在しないdocへの書込は常にcreate評価)と矛盾し機能しない → phase順序保証(Phase C完了後にPhase D-FE書込を投入)に置き換え
  - P2: `ProcessingHistoryPage`の`getOcrExcerpt()`がPhase E後に空文字列化する問題を追記
  - P2: `DocumentDetail.pageResults`の型を実際の永続化shape(`PersistedPageOcrResult`)に修正(旧`PageOcrResult`はIssue #278で意図的に分離されたstructurally incompatibleな別shape)
- Amended: 2026-07-06 (Codex 2nd review, 同コマンド、P1×1 + P2×3 反映)
  - P1: reprocess-clearを`detail/main`→本体の2回の独立updateで設計していたため片方失敗時にOCRデータ消失+再処理未キューイングの可視データ損失リスクがあった → `writeBatch()`による単一commit化に修正
  - P2: `DocumentDetail.ocrResult`を`string`必須から`ocrResult?: string`(optional)に修正(reprocess直後〜OCR完了までフィールド不在の状態が起こるため)
  - P2: `useProcessingHistory`の`getOcrExcerpt()`を`detail/main`個別取得に置き換える案は、最大200件一括取得時にN+1的な重い転送を招きegress削減の趣旨に反すると指摘 → 本体に軽量`ocrExcerpt`フィールドを新設する方式に変更
  - P2: `seed-dev-data.ts`のdual-write化をPhase F(cleanup)からPhase Bへ前倒し(Phase C以降のdevシードで`detail/main`欠落によりdevリハーサル自体が失敗するため)
- Amended: 2026-07-06 (Codex 3rd review, 同コマンド、P1×3 + P2×1 反映)
  - P1: 新設`ocrExcerpt`フィールドが既存`documents/{docId}`ルールの`affectedKeys().hasOnly([...])`許可リストに未追加のままだと、Phase B以降の全FE再処理リクエストが`permission-denied`で失敗する問題を追記
  - P1: `getReprocessClearFields()`の実際の呼出元が3箇所(`useReprocessDocument()`/`useErrors.ts`/`DocumentsPage.tsx`)に分散しており、関数レベルの記述だけでは1箇所でも`writeBatch()`化を取りこぼすと`detail/main.pageResults`が残存し`pageResultsReuse`が誤って再利用可能と判定する問題を明記、3箇所を明示列挙
  - P1: `deleteDocument.ts`の削除同期を「サブコレクション削除→親削除」の順序ベース逐次実行として記述していたが、これはreprocess-clearで既に修正した部分失敗と同型のバグ(2回目の削除失敗で親docが生き残る)であることが判明 → `db.batch()`による単一commit化に修正
  - P2: Phase Cのbackfillスコープに`detail/main`作成だけでなく`ocrExcerpt`の算出・書込を追加(Phase Bのみだと未reprocessの既存docで`ocrExcerpt`が永久に空欄になるため)
- Amended: 2026-07-06 (Codex 4th review, 同コマンド、P1×2 + P2×2 反映)
  - P1: `scripts/seed-e2e-data.js`等、`documents/{id}`を直接作成する箇所が個別列挙では収束しないと判明 → 網羅的監査をPhase B Acceptance Criteriaとして追加(プロセス化)
  - P1: `DocumentsPage.tsx`の一括再処理(`handleBulkReprocess`)がchunking無しの単一`writeBatch()`で、1doc2write化により500件上限の閾値が250件に半減する問題を追記 → 250件チャンク分割+複数commit化に修正
  - P2: `cleanup-duplicates.js`等の運用スクリプトが`deleteDocument.ts`を経由せず直接親docを削除しており`detail/main`が孤児化する問題も同様に網羅的監査プロセスへ統合
  - P2: Storage offload済み(`ocrResultUrl`セット)docの`ocrExcerpt`が空になり既存のplaceholder表示(「OCR結果はCloud Storageに保存されています」)が失われる回帰を修正、`getOcrExcerpt()`の出し分けロジックは維持したまま参照先のみ変更する設計に訂正
- Amended: 2026-07-06 (Codex 5th review, 同コマンド、P1×0 + P2×4 反映。P1が初めて0件 = 収束傾向)
  - P2: 新規doc作成時の`ocrResult`初期化を`detail/main`への「付け替え」と誤記していた箇所を、dual-write原則通り「親にも維持したまま追加」に訂正(未移行の既存読者が`undefined.toLowerCase()`でクラッシュする回帰を防止)
  - P2: **一覧検索機能(`fetchDocuments()`の`searchText`フィルタ)が`doc.ocrResult`を直接参照しておりPhase E後にクラッシュすると判明**。Phase Dで`ocrResult`条件を検索対象から除外(fileName/customerName/documentTypeのみに縮小)。OCR全文検索機能自体の要否はdecision-maker確認事項として明示(本ADRのスコープ外の別プロジェクト)
  - P2: `getOcrText`/`regenerateSummary`が親+`detail/main`を独立した2回の`.get()`で読む設計だと、dual-write中の書込タイミングによって不整合な組合せを読む可能性 → `db.runTransaction`内の`Promise.all`で単一スナップショットとして読むよう修正
  - P2: `PersistedPageOcrResult`型が実データの一部バリエーション(分割子の`originalPageNumber`、Issue #205以前のレコードの`truncated`欠落)を捕捉しきれない既知の限界を明記(既存データのschema drift、本ADRのスコープでは是正しない)
- Amended: 2026-07-06 (Codex 6th review, 同コマンド、P1×1 反映)
  - P1: Phase B〜C期間中(FE reprocess-clearがまだ旧経路=親のみクリアの間)に再処理を開始→失敗したdocは、`detail/main`が再処理前の古いOCR内容のまま残存するため、「`detail/main`存在確認のみ」のPhase C完了判定だと見逃す。`status:'pending'`のdocを検証対象から除外し、Phase D-FE投入時点で`pending`件数ゼロを別途確認する要件を追加
- **Phase B完了: 2026-07-07 (5PR構成、PR #569/#571/#573/#574/#575)**。PR1(ルール改修+既存バグ修正)/PR2(Functions dual-write改修)/PR3(削除同期改修)/PR4a(FE writeBatch化、detail/main書込はPhase D以降のPR4bへ分離)/PR5(seed-dev-data.ts dual-write化)を全実装、各PR`/code-review high`+Codexセカンドオピニオン実施。Issue #547はPhase B完遂によりclose。Phase C(backfill)以降は別途decision-maker起点指示+`/impl-plan`で着手
- **Phase C完了: 2026-07-09**。backfill全3環境完遂(cocoro 1,039件・kanameone 9,341件、verify PASS)
- **Phase D完了: 2026-07-09**。dual-read cutover(FE/Functions/scripts全読者切替)を両本番(cocoro/kanameone)へ展開完遂
- Amended: 2026-07-10 (Phase E impl-plan起票時、Codexセカンドオピニオン2周、`mcp__codex__codex` MCP版・effort high、session111)
  - **P1 (Critical、設計ギャップ)**: 当初のPhase E計画は「本体からocrResult/pageResultsを削除するだけ」だったが、`ocrProcessor.ts`等の書込み箇所(表#1,2,4,7,8,11)がPhase B以降も本体への値書込み(dual-write)を継続する設計のままだったため、削除完了後も新規処理・再処理のたびに本体へ値が復活し、「Phase E完了=egress実削減発生」という前提が成立しないことが判明(`functions/src/ocr/ocrProcessor.ts:391-410`の`merged`オブジェクトが本体`tx.update()`にocrResult/pageResultsを含めていた実装をコードで実証確認)。→ **Phase Eのスコープを「dual-write停止(PR-E1) + 削除実行(PR-E2)」の2段構成に拡張**し、以下「移行フェーズ」表のPhase E行を改訂。dual-write停止対象は表#1,2,4,7,8,11のうち`getReprocessClearFields()`(表#7)の`deleteField()`によるクリアを除く「値のset/update」のみ(次項参照)
  - **P1**: `getReprocessClearFields()`(`frontend/src/hooks/useDocuments.ts`)の親`deleteField()`は、dual-write(値の書込み)ではなく「Phase E完了前に`resolveDetailFields()`が親へフォールバックして古いOCRを読むのを防ぐ安全策」であり、PR-E1のdual-write停止対象から除外する(誤って対象に含めると、再処理中にdetail/mainだけクリアされ親の古い値が残存し、フォールバックで古いOCRが表示される回帰を招く)
  - **P1**: `pdfOperations.ts`の`splitPdf`は`item.payload`という単一オブジェクトを親`batch.set()`とdetail`batch.set()`の両方のソースとして共有しているため、単純にpayloadからキーを削るとdetail書込みも失敗する。→ 親用に`ocrResult`/`pageResults`を除いた`parentPayload`のコピーを作る設計に変更(`delete parentPayload.ocrResult`等)
  - **P1**: PR-E1後は「親にocrResult/pageResultsが存在しない」のが正常状態になるため、削除スクリプトの対象判定にPhase C backfillと同じ「親↔detail hash一致」判定をそのまま使うと、PR-E1後に新規作成された正常docを不一致(mismatch)誤判定する。→ 削除スクリプトは「delete/already-deleted/skip-mismatch/skip-detail-missing/skip-in-pipeline」の5分類判定(`scripts/lib/deleteLegacyOcrFieldsHelpers.ts`の`decideDeletionAction`)を新設
  - **P1**: 削除スクリプトの誤実行防止として、PR-E1が対象環境に完全デプロイ済みであることを機械的に確認するmigration marker機構(`_migrations/adr0018PhaseEPreflight`、`--mark-preflight`で運用者が明示的に記録)を追加。`--execute`/`--rollback`はこのマーカーがない環境では即abort
  - **P1**: rollback(`--rollback --run-id <runId>`)は削除実行と同一Firestore transactionで記録するmanifest(`_migrations/adr0018PhaseEDeletionRun_{runId}/deletedDocs/{docId}`、削除フィールド一覧+削除時刻のみ)を用い、detail/mainの**現在値**で親を復元する限定的な復旧手段とする。GCSは使わない(削除する値そのものを複製する必要がなく、detail/mainが値の実体を保持し続けるため。GCS書込み成功/Firestore commit失敗のような原子性の懸念を構造的に排除)。PR-E1により新規処理は親へ書込まないため、rollback後も親の値は将来の再処理で更新されない制約がある旨を明記
  - **P2**: `documentGroups`集計トリガー(`updateDocumentGroups.ts`)は集計対象キー(customerKey等)が不変でも無条件で下流のgroup transactionを発生させる設計だったため、Phase Eの全件削除でトリガーストームが増幅する懸念があった。→ `groupAggregation.ts`に集計対象フィールド完全不変時の早期returnガード(`isAggregationUnchanged()`)を追加し、レート制御と合わせた二重の負荷対策とした
  - **P2**: FE既知リスク2件を修正: `PdfSplitModal`がdetail取得のloading/error状態を無視して操作可能だった点(`detailLoading`/`detailError` propを追加しボタンをdisable化) / `useDocumentDetail`のisError/errorがUIに表示されず「OCR結果なし」と区別不能だった点(`DocumentDetailModal`にエラー表示を追加)

## Context

### 発端 (Issue #547, P1)

kanameone の 2026年6月請求で、「App Engine」表示のカテゴリ ¥5,452 の実体が全額 Cloud Firestore であり、うち **¥4,645 が egress**(SKU: `Cloud Firestore Internet Data Transfer Out from Tokyo to APAC`)と判明した。これは利用者がブラウザで一覧を開くたびに、`ocrResult`(OCR全文)・`pageResults[].text`(ページ別全文)を含む**ドキュメント全体**が配信されているためである。Firestore Client SDK にはフィールド選択(projection)機能がなく、ドキュメント単位でしか取得できないという構造的制約に起因する。

### 事前計測 (PR #555, kanameone環境, n=300, read-only)

| 項目 | 値 |
|------|-----|
| ドキュメント平均サイズ(JSON.stringify近似) | 19,831B(中央値10,434B) |
| 重フィールド9種合計 | 平均17,455B(**全体の88.0%**) |
| ocrResult | 平均6,881B(34.7%)、300/300件に存在 |
| pageResults | 平均9,199B(**46.4%**)、300/300件に存在 |
| customerCandidates / officeCandidates / ocrExtraction / extractionScores / extractionDetails | 合計 平均1,375B(6.9%) |
| splitSuggestions / splitSegments | このサンプルでは0/300件(分割候補docが含まれなかった) |

詳細: [Issue #547 コメント](https://github.com/yasushi-honda/doc-split/issues/547#issuecomment-4887902729)

### スコープの絞り込み経緯

初期案は Issue 本文が例示する9フィールド全部(ocrResult / pageResults / customerCandidates / officeCandidates / ocrExtraction / extractionScores / extractionDetails / splitSuggestions / splitSegments)をサブコレクションへ移動する設計だった。この案について独立レビュー(Fable5モデルによるセカンドオピニオン、担当AIの設計プロセスを見せずに批判的評価を依頼)を実施し、以下の事実誤認が発覚、検証の上で修正した:

1. `frontend/src/components/ExtractionInfoPopover.tsx`(45-68行目)が `extractionScores` / `extractionDetails` / `ocrExtraction` / `customerCandidates` / `officeCandidates` を使用しており、`DocumentDetailModal.tsx` から3箇所(customer/office/documentType)呼び出されている(grep実行で確認)。「詳細モーダルでは不使用」という当初の調査結果は誤りだった。
2. `officeCandidates` は `DocumentsPage.tsx` だけでなく `CustomerSubGroup.tsx`(106-107行目)/ `GroupDocumentList.tsx`(67-68行目)の**計3箇所**で「事業所要確認」バッジ判定に使用されている(grep実行で確認)。
3. Functions側の `getOcrText.ts`(45行目)/ `regenerateSummary.ts`(59,63,77行目)が親docの `ocrResult` を直接読んでおり、FE改修だけでは Phase D(dual-read cutover)が不十分になる。

実測値から ocrResult+pageResults の2フィールドのみで**重フィールド合計の92.1%(全体サイズの81.1%)** を占める。9フィールド全部を移行した場合の削減率(88.0%)との差は egress 換算で **月額 約¥321** のみ(¥4,645×(0.880-0.811)≈¥321)。この差額のために4箇所のFEコンポーネント改修(ExtractionInfoPopover + 3バッジ箇所)と新規派生フィールド(`officeCandidatesCount`等)の永続管理コスト(#178教訓: reprocessリセット漏れ・rules whitelist追加・backfill整合検証が恒久的に必要になる)を負うのは費用対効果が悪いと判断し、**スコープを ocrResult + pageResults の2フィールドに限定**する。

## Decision

### スキーマ

- 新設: `documents/{docId}/detail/main`(固定ドキュメントID `main`、1親1detail)
  - `ocrResult: string`
  - `pageResults?: PersistedPageOcrResult[]`(**Codex P2反映**: 旧`PageOcrResult`は検出メタ合成後のpost-processed shapeで実際の永続化shapeと不一致。`shared/types.ts`に新設した`PersistedPageOcrResult`型を使う)
- 本体 `documents/{docId}` からは Phase E 完了時点で `ocrResult` / `pageResults` を削除。他7フィールド(customerCandidates / officeCandidates / ocrExtraction / extractionScores / extractionDetails / splitSuggestions / splitSegments)は本体に残置、変更なし
- `shared/types.ts` に `DocumentDetail` interface を追加(本PRで追加。`Document` 型の `ocrResult` / `pageResults` は後続 Phase まで維持し、Phase D で `@deprecated` コメントを付与予定)

### 書込・読込箇所の改修(12箇所、Phase B以降で対応)

| # | ファイル | 現状 | 改修内容 |
|---|---------|------|---------|
| 1 | `functions/src/ocr/ocrProcessor.ts`(`db.runTransaction`) | 7/9フィールドを他メタと同一tx.update。**読込側**: `pageResultsReuse`判定(:117)が`docData.pageResults`を直接参照 | tx内で本体update(`ocrExcerpt`算出値を含む、#9参照) + `detail/main` set を同一transactionに含める(MUST: 原子性)。Phase D: `pageResultsReuse`の読込元を`detail/main`に切替 |
| 2 | `functions/src/pdf/pdfOperations.ts` `splitPdf` | 子docへ5/9フィールドをbatch.setでコピー。**読込側**: 親の`docData.pageResults`(:524,590)を読んで子用に整形 | 子ごとに本体batch.set + `detail/main` batch.set を同一batch.commit()に含める(MUST: 原子性)。Phase D: 親`pageResults`読込元を`detail/main`に切替 |
| 3 | `functions/src/pdf/pdfOperations.ts` `detectSplitPoints` | splitSuggestions/splitSegmentsの書込先は**変更なし**(本移行のスコープ外フィールド)。**読込側**: `docData.pageResults`(:99)を直接参照 | 書込ロジック変更なし。Phase D: `pageResults`読込元を`detail/main`に切替(切替なしだとPhase E後、分割候補検出が常に0件になる — Codex P1指摘) |
| 4 | `functions/src/gmail/checkGmailAttachments.ts` / `functions/src/upload/uploadPdf.ts` / `scripts/import-historical-gmail.js` | 新規doc作成時に`ocrResult`を空文字初期化(3箇所) | **`detail/main`にも同時初期化(付け替えではなく追加、Codex 5th review P2反映)**: Phase B〜Dの間、`fetchDocuments()`の`searchText`フィルタ(`doc.ocrResult.toLowerCase()`、#12参照)等、未移行の既存読者は親の`ocrResult`が`string`(空文字含む)であることを前提にしている。親の初期化を`detail/main`側だけに付け替える(cutover)と、Phase D完了前の`pending`状態docで親`ocrResult`が`undefined`になり、これら未移行読者がクラッシュする。dual-write原則(#547 ADR全体で一貫: 読者を切り替えるまで旧フィールドは書き続ける)を本箇所にも適用し、親には従来通り`ocrResult: ''`を書きつつ`detail/main`にも同じ値を書く |
| 5 | `functions/src/ocr/getOcrText.ts` | `data.ocrResult`を親docから直接読込 | `detail/main`ドキュメント読込に変更(`ocrResultUrl`オフロード判定ロジックは維持)。**親+`detail/main`を`db.runTransaction`内の`Promise.all([tx.get(docRef), tx.get(detailRef)])`で同一スナップショットとして読む(Codex 5th review P2反映)**: 独立した2回の`.get()`だと、その間にdual-write中の別処理がcommitした場合、「新しい親(ocrResultUrlセット済み)」+「古いdetail(ocrResult空)」のような不整合な組合せを読んでしまい、本来取得できるはずのOCRテキストが空文字で返る可能性がある |
| 6 | `functions/src/ocr/regenerateSummary.ts` | 同上 | 同上(#5と同じtransactional paired-read) |
| 7 | `getReprocessClearFields()`(`frontend/src/hooks/useDocuments.ts`)の**呼出元3箇所**: ①`useReprocessDocument()`(同ファイル:342-345、単発`updateDoc()`) ②`frontend/src/hooks/useErrors.ts`(:238、単発`updateDoc()`) ③`frontend/src/pages/DocumentsPage.tsx`(`handleBulkReprocess`:475-497、一括選択、既に`writeBatch()`使用・**現状chunking無し**) | `ocrResult`/`pageResults`を親docから`deleteField()`(1回のupdateで他メタと同時) | 削除先を`detail/main`に変更(`ocrExcerpt`(#9参照)も同一updateで`deleteField()`対象に追加)。**3箇所全てで`writeBatch()`により本体update + `detail/main` update を単一commitにまとめる**(Codex 2nd/3rd review P1反映: ①②は現在単発`updateDoc()`のためbatch化が必須、③は既存batchに`detail/main`分のbatch.updateを追加するだけでよい。1箇所でも取りこぼすと、そのパスで再処理した分割子ドキュメントが`detail/main.pageResults`を消し忘れたまま`pageResultsReuse`に到達し、古いOCRが「再利用可能」と誤判定されOCRスキップ+古い抽出結果の温存という品質破壊が起きる)。**③は選択件数のchunking必須(Codex 4th review P1反映)**: 現状`selectedIds`の件数上限が無く(無限スクロール後の全選択で500件超も理論上可能)、1docあたり1writeの現行実装でも500件超で暗黙の上限に達しうる既存の潜在リスクだが、本移行で1docあたり2write(本体+detail/main)になることで**閾値が250件に半減**し顕在化しやすくなる。`selectedIds`を250件ずつのチャンクに分割し、チャンクごとに`writeBatch()`を生成して逐次`commit()`する実装に変更する |
| 8 | `functions/src/documents/deleteDocument.ts`(:172、`docRef.delete()`) | 親docのみ削除。サブコレクションは削除されず残存する(Firestoreの既定挙動) | `db.batch()`で`docRef.collection('detail').doc('main')`のdeleteと`docRef`のdeleteを**単一commitにまとめる**(Codex 1st review P1: 削除同期の必要性を指摘 → Codex 3rd review P1: 当初案の「サブコレクション削除→親削除」という順序ベースの逐次実行では、2回目の削除が失敗した場合に親docが生き残ったままdetail/mainだけ消えるという別の部分失敗が起きうると指摘、batch化に修正) |
| 9 | `frontend/src/hooks/useProcessingHistory.ts` `getOcrExcerpt()` / `frontend/src/pages/ProcessingHistoryPage.tsx`(:277) | `doc.ocrResult`を親docスナップショットから直接読込。`ocrResultUrl`がset済み(Storage offload済み、#547事前計測でkanameone実データの1%)の場合は「（OCR結果はCloud Storageに保存されています）」というplaceholder文言を表示 | 本体に軽量な`ocrExcerpt?: string`(先頭200字程度、上限付き)を新設し、`ocrProcessor.ts`のメインtransaction内で算出・書込(Phase B)。**Storage offload済みdoc(`ocrResultUrl`セット時)は`ocrExcerpt`を空にせず、既存のplaceholder文言をそのまま`ocrExcerpt`に格納する**(Codex 4th review P2反映: 当初案は`getOcrExcerpt()`を`doc.ocrExcerpt`読込のみに置換する設計だったため、offload済みdocの`ocrExcerpt`がbackfill/Phase B双方で空文字になり、既存のplaceholder表示が失われる回帰があった。`getOcrExcerpt()`自体は「`ocrResultUrl`有無を見て出し分ける」ロジックを保持したまま、参照先を`doc.ocrResult`→`doc.ocrExcerpt`に変えるだけにする)。**Phase Cのbackfillは`detail/main`作成に加えて既存docの`ocrExcerpt`も同時算出・書込む**(Codex 3rd review P2反映: Phase Bのみだと新規/再処理docにしか`ocrExcerpt`が付かず、backfill対象の既存docがPhase D以降ずっと空欄表示になるため、backfill時に親の既存`ocrResult`/`ocrResultUrl`(dual-write期間中は本体にまだ存在)から算出して書く)。理由: `useProcessingHistory`は最大200件を一括取得するため、`detail/main`個別取得だと1リクエストあたり最大200回のdocument取得+完全なocrResult/pageResults転送が発生し、egress削減の趣旨に反する(Codex 2nd review P2指摘)。**この方式の最終確定はPhase Dの`/impl-plan`で行う**(既存機能の廃止/UX変更という代替案も比較対象に含める) |
| 10 | `scripts/reprocess-master-matching.js` | `doc.ocrResult`/`doc.pageResults`を親docから直接読込(マスターデータ再突合スクリプト) | Phase D: `detail/main`読込に変更 |
| 11 | `scripts/seed-dev-data.ts`(:318,413) | dev fixture生成時に`ocrResult`を親docへ直接書込 | **Phase B**でdual-write改修(Phase Fへの先送り不可 — Codex 2nd review P2指摘: Phase C backfill後にこのスクリプトでシードすると`detail/main`が生成されず、Phase D以降の読者が空を受け取りdevリハーサル自体が失敗する) |
| 12 | `frontend/src/hooks/useDocuments.ts` `fetchDocuments()`(:437-448、`DocumentFilters.searchText`) | クライアントサイドで`doc.fileName`/`doc.customerName`/`doc.documentType`/`doc.ocrResult`に対し`.toLowerCase().includes()`する全文検索フィルタ。一覧クエリで取得済みのdocに対する後処理のため、**今まさに一覧表示がocrResultを含む全フィールドを転送している実態そのもの**(egress問題の実例) | **Phase EでOCR全文検索は継続不可能**(親から`ocrResult`が消えるため`doc.ocrResult`は`undefined`になり`.toLowerCase()`が例外を投げる、Codex 5th review P2指摘)。Phase Dで`searchText`フィルタから`doc.ocrResult`条件を除外し、fileName/customerName/documentTypeのみの検索に縮小する(クラッシュ防止の必須対応)。**OCR全文検索という機能自体の廃止は本ADRの決定事項ではなく、decision-makerへの確認事項**として明示する — 必要であれば別途Algolia/Typesense等の専用検索基盤 or `detail/main`を対象にしたCloud Function callable検索の新規設計が必要(egress削減の趣旨とは独立した別プロジェクト規模の投資になるため、本ADRのスコープ外) |

### 全doc作成・削除経路の網羅的監査(MUST、Phase B/実装着手前)

Codex reviewを4ラウンド重ねる中で、`documents/{id}`を直接作成・削除する箇所が都度新たに見つかった(`scripts/seed-e2e-data.js`、`scripts/cleanup-duplicates.js`、`scripts/cleanup-ambiguous-collision-docs.ts`等、上記11箇所の書込・読込表に含まれない)。この種のスクリプトは`run-ops-script.yml`経由で随時追加されており、ADR本文に個別列挙する形では収束しない(見つけた分だけ追記しても次のスクリプトが追加されれば陳腐化する)。そのため、個別列挙ではなく**プロセスとして以下をPhase B実装のAcceptance Criteriaに組み込む**:

1. **作成箇所の監査**: `rg "collection\('documents'\)\.doc\(|db\.doc\(\`documents/|\.collection\('documents'\)" functions/src scripts frontend/src` 等で `documents/{id}` に対する `set()` / `transaction.set()` / `batch.set()` を行う箇所を全て洗い出し、各箇所について「`detail/main`を同一transaction/batchで作成するよう改修する」か「dev/test専用で本番影響なしと確認しスコープ外と明記する」のいずれかを判定してチェックリスト化する
2. **削除箇所の監査**: 同様に `documents/{id}` に対する `.delete()` を行う箇所(Cloud Functions・opsスクリプト双方)を全て洗い出し、`detail/main`の削除同期(`db.batch()`によるdoc#8と同様の原子的削除)を追加するか、スコープ外と明記するかを判定する
3. 上記1・2の監査結果はPhase Bの`/impl-plan`に添付し、**未判定の箇所を残したままPhase C(backfill)・Phase E(destructive削除)へ進まない**

### Firestoreルール

`documents/{docId}/detail/{detailId}` を新設(Phase A完了・Codexレビュー通過後、別PRで追加):

```
match /documents/{docId}/detail/{detailId} {
  // Codex P1反映: 親doc削除後もサブコレクションが孤児として残存するケースへの
  // defense-in-depth。deleteDocument.ts改修(書込箇所#8)を主対策とし、本条件は
  // 将来の別削除経路(手動コンソール操作等)が同期を忘れた場合の保険。
  allow read: if isWhitelisted()
    && exists(/databases/$(database)/documents/documents/$(docId));
  allow create: if false; // Functions専用 (admin SDK経由はルール適用外)
  allow update: if isWhitelisted()
    && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['ocrResult', 'pageResults']);
  allow delete: if isAdmin();
}
```

親 `documents/{docId}` のルールが持つ `isWhitelisted()` / `isAdmin()` ヘルパーをそのまま再利用する。`splitSuggestions` / `splitSegments` 相当のFunctions専用フィールドはこのサブコレクションに存在しないため、update許可リストは2フィールドのみで完結する。

**既存の `documents/{docId}` ルール改修も必須(Codex 3rd review P1反映)**: 新設フィールド`ocrExcerpt`(#9参照)はFEのreprocess-clearが`deleteField()`で親docから削除する対象になる。現行の`documents/{docId}`ルールの`allow update`は`affectedKeys().hasOnly([...])`で許可フィールドをホワイトリスト化しており(`firestore.rules:58-610`相当)、このリストに`ocrExcerpt`を追加しないと、Phase B以降ocrExcerptが書き込まれたdocに対するFEの再処理リクエストが丸ごと`permission-denied`で失敗する。Phase B実装時に「再処理用フィールド」セクションへ`ocrExcerpt`を追加すること。

**`allow create: if false` と FE書込の整合性(Codex P1反映)**: Firestoreセキュリティルールは、書込対象パスに既存ドキュメントが無い場合、クライアントが`set()`/`update()`いずれのAPIを使っても**`create`ルールで評価する**(`resource.data == null`が判定基準であり、クライアント側APIの選択とは無関係)。そのため「`update()`だと`NOT_FOUND`で失敗するので`set(merge:true)`を使う」という対策はここでは機能しない — `detail/main`が存在しない状態でのFE書込は`allow create: if false`によりいずれの方法でも`permission-denied`で拒否される。正しい対策は「原子性要件」節を参照。

### 原子性要件 (MUST)

- `ocrProcessor.ts` のメイン書込み、`splitPdf` の子ドキュメント作成は、本体 + `detail/main` を**同一transaction/batchで書込む**。2回の独立書込は禁止(整合性ウィンドウが生じるため)。
- `splitPdf` の子ドキュメント数上限: 現在499(`N+1≤500`、`pdfOperations.ts:337-344`)。分離後は子ごとに本体set + `detail/main` set の2書込になるため **`N≤249`に変更**(`2N+1≤500`)。実装前にPhase C監査工程で既存`splitInto`配列の実際の最大長を確認し、249で十分か検証する(不足する場合はチャンク分割コミット + コミットマーカー方式を別途検討)。
- `getReprocessClearFields()`(FE直接書込)は現状、親doc単一の1回のupdateで複数フィールドを原子的に消している。本移行で`detail/main`が追加されると、これを2回の独立したupdateに分けて実行した場合、**片方成功・片方失敗の部分書込**が起こり得る(Codex 2nd review P1指摘: `detail/main`クリア成功後に親update失敗 → OCRデータが消えたまま再処理がキューイングされない可視データ損失)。対策:
  1. **原子性**: `writeBatch(db)`で本体docのupdate(`status: 'pending'`等)と`detail/main`のupdate(`ocrResult`/`pageResults`のdeleteField)を**単一commitにまとめる**。2回の独立した`updateDoc()`呼出は禁止。
  2. **存在保証**: `detail/main`はFunctions専用(`allow create: if false`)であり、FEは`update()`のみ可能(既存doc必須)。この前提を成立させるため、**FE書込(Phase Dのreprocess-clear改修)はPhase C(backfill)が全docに対して完了・検証済みであることを確認してからデプロイする**(Phase B以降のdual-writeで新規/再処理docは`detail/main`が必ず作成されるため、Phase Cの全件backfill完了時点で「`detail/main`が存在しないdocはゼロ」が保証される)。この順序保証により、FEの`update()`は常に成功する。
  3. **`DocumentDetail.ocrResult`の型**: batch実行後、OCR再処理が完了するまでの間`detail/main`は`ocrResult`フィールドが存在しない状態になる。`shared/types.ts`の`DocumentDetail.ocrResult`は`string`必須ではなく`ocrResult?: string`(optional)とする(Codex 2nd review P2反映)。

### 移行フェーズ (ADR-0016 PR-D1〜D5パターンを踏襲)

| Phase | 内容 | destructive | Codexレビュー |
|-------|------|:---:|:---:|
| **A(本PR)** | 本ADR + `DocumentDetail`/`PersistedPageOcrResult`型定義。書込ロジック変更なし | No | **本PRがゲート対象** |
| **B ✅完了(2026-07-07)** | dual-write + delete同期。上記表#1〜4,8,11の書込/削除改修(`deleteDocument.ts`の`detail/main`削除同期、`seed-dev-data.ts`のdual-write化を含む — Codex 2nd review P2反映: Phase Fへの先送りだとPhase C以降のdevシードが`detail/main`欠落を起こしdevリハーサル自体が失敗する)。`ocrExcerpt`軽量フィールドも本Phaseで導入。本体フィールドは後方互換のため当面維持。**FE reprocess-clear(#7)の`detail/main`書込パスはこのPhaseだけでは投入しない**(Phase C完了確認後、PR4bとして別途実装) | No(追加書込+削除同期のみ) | 実施済み(PR #569/#571/#573/#574/#575、各`/code-review high`+Codex) |
| **C ✅完了(2026-07-09)** | backfill。既存全docに`detail/main`を作成 **+ `ocrExcerpt`を親の既存`ocrResult`から算出して同時書込**(Codex 3rd review P2反映: Phase Bのみだと未reprocessの既存docは`ocrExcerpt`が永久に空欄になるため)。ADR-0016 PR-D4型の4-phase構造(Phase A=監査+分類read-only → Phase B=書込前revalidation → Phase C=原子的backfill → Phase D=検証)。監査時に splitInto 実測上限も確認。**完了検証は「全doc`detail/main`存在確認」だけでは不十分(Codex 6th review P1反映)**: Phase B〜C期間中、FE reprocess-clearはまだ旧経路(親のみクリア、#7参照)のままのため、ユーザーが再処理を開始した後OCR完了前に失敗した場合、親は`status:'pending'`+クリア済みだが`detail/main`は**再処理開始前の古いOCR内容のまま残存**する。この状態のdocは「`detail/main`が存在する」という理由だけでbackfill完了/Phase D投入可としてはならない — **`status: 'pending'`のdocは検証対象から除外**し、Phase D-FE(#7の`writeBatch()`化)投入時点で`status:'pending'`のdocがゼロであることを別途確認する(通常のOCRパイプラインで自然に解消されるまで待つ、または該当docの`detail/main`を明示的にクリアしてから投入する) | Yes(既存docへの新規書込) | impl-plan + 実装後 |
| **D ✅完了(2026-07-09実装+展開)** | dual-read cutover。読者を`detail/main`に切替: FE(`DocumentDetailModal`/`PdfSplitModal`/`firestoreToDocument()`)+ Functions(`getOcrText`/`regenerateSummary`/`detectSplitPoints`/`splitPdf`の親pageResults読込/`ocrProcessor`の`pageResultsReuse`読込)+ scripts(`reprocess-master-matching.js`)。`useProcessingHistory.getOcrExcerpt()`は`detail/main`ではなく本体の`ocrExcerpt`フィールドを読むよう変更(#9、Phase Bで書込導入済み)。**Phase C完了確認後にFE reprocess-clear(#7)を`writeBatch()`でデプロイ**。一覧クエリは`ocrResult`/`pageResults`を一切参照しない状態にする。**実装: PR-D1(#598 FE reprocess-clear)/PR-D2(#599 Functions 4読者)/PR-D3(#601 FE 4読者+ui-verified)/PR-D4(#602 scripts 2本+AC9読者ゼロ契約テスト)全マージ済み。cocoro/kanameoneへの展開完了(2026-07-09 session110): dev E2E確認PASS→両環境ともHosting(D1+D3)先行→`backfill-detail-subcollection --verify`でstale=0/in-pipeline=0確認→Functions(D2)デプロイ、全関数成功。scripts(D4)は別途デプロイ不要(GitHub Actions実行時に都度main最新コードを使用)。副産物: kanameone向けにFirebase CLIブラウザ認証不要のGitHub Actions workflow(`deploy-hosting.yml`)を新設** | No | 実装後review(実施済み、PR-D1〜D4各`/code-review`+Codex) |
| **E ✅本番実行完遂(2026-07-10、session113。cocoro+kanameone両環境で`--execute`実行済み、egress削減発生中)** | **2026-07-10 Amended反映: dual-write停止をPhase Eへ前倒し統合、PR-E1/PR-E2の2段構成に変更**(当初計画は削除のみだったが、削除完了後も新規処理・再処理のたびに本体へ値が復活し「Phase E完了=egress実削減発生」の前提が崩れることをCodexセカンドオピニオンで検出)。**PR-E1**: 表#1,2,4,7,8,11の書込み箇所から本体への値set/update書込みを除去(`getReprocessClearFields()`の`deleteField()`は安全策として維持、対象外)。`ocrProcessor.ts`/`pdfOperations.ts`(splitPdfのparentPayload/detailPayload分離)/`checkGmailAttachments.ts`/`uploadPdf.ts`/`import-historical-gmail.js`/`seed-dev-data.ts`改修 + 書込み側契約テスト新設。**PR-E2**: migration marker機構(`_migrations/adr0018PhaseEPreflight`、PR-E1デプロイ未確認環境での誤実行を防止) + `documentGroups`トリガーへのdiff最適化(`isAggregationUnchanged()`、集計キー不変時は下流write 0) + 削除スクリプト(`scripts/delete-legacy-ocr-fields.ts`、状態別5分類ロジック`decideDeletionAction`、削除直前canonicalHash同一tx内再検証、Firestoreのみのmanifest記録) + `--rollback`(manifest限定復元、将来write不可逆) + FE契約テスト新設(`detailReaderCutoverContract.test.ts`) + FE既知リスク2件修正(`PdfSplitModal`のdetailLoading/detailErrorゲート、`DocumentDetailModal`のisError表示)。**egressの実削減効果はPR-E2の`--execute`実行で初めて発生**(Firestoreはprojection非対応のため、フィールドを実際に本体から消さない限り一覧クエリの転送量は変わらない)。トリガーストーム対策: documentGroups diff最適化 + レート制御(`runWithRateControl`、Phase C同様CONCURRENCY=4/150ms間隔)の二重対策。**本番実行(session113)**: cocoro(1,055件)・kanameone(9,513件)両環境ともmark-preflight→dry-run→canary10件→中間verify(想定内FAIL)→全量execute→最終verify(PASS)を番号単位認可で実施、エラー・異常skip 0件、detail/main不在0件(データ破壊なし)。egressの請求額への反映は翌月確認待ち | **Yes(destructive、番号認可+dry-run+devリハーサル必須。実装はimpl-plan承認済み。本番`--execute`実行も完了、各ステップ番号単位認可取得済み)** | impl-plan(session111、Codex 2周) + 実装後review + devリハーサル + 本番実行(session113、両環境verify PASS) |
| **F** | cleanup。PR-E1で置き換わらなかった残存の暫定コード除去、`DocumentDetail`型の`@deprecated`整理、テストファイルの最終整理確認(dual-write停止自体はPhase Eへ前倒し済みのため、Phase Fのスコープは縮小) | No | 実装後review |

各Phaseは別途 `/impl-plan` + Codexセカンドオピニオン経由で詳細計画化する。本ADRは**設計方針合意のみ**であり、Phase B以降の実装着手は別Task/別PR/別承認。

## Consequences

### Pros

- 一覧表示のegress削減(¥4,645/月 → 推定¥878/月程度、Phase E完了時点)
- `ExtractionInfoPopover` / 3箇所のバッジロジック / 派生フィールド管理を一切変更不要 — 変更範囲が9フィールド全移行案より大幅に縮小
- 既存の`ocrResultUrl`(Storage offload機構、`OCR_RESULT_MAX_LENGTH=100000`超過時)との責務分離が明確なまま維持される

### Cons

- ocrResult+pageResults限定のため、削減効果は9フィールド全移行(残差¥557/月)より**月¥321程度劣る**。将来的にPhase F後の実測でさらなる削減が必要と判明した場合、残り7フィールドの移行を別Issueとして再検討する余地を残す
- `splitPdf`の子ドキュメント数上限が半減(499→249)
- Phase Eの本体フィールド削除は全件のドキュメント書込トリガー(documentGroups集計/search_index)を誘発し、一時的なFunctions invocation急増を招く(Phase E実行前に既存トリガーのdiff検知ロジックを確認する必要あり)

## Alternatives Considered

### A案: 9フィールド全部をサブコレクションへ移行(初期案、不採用)

- 追加で月¥321程度の削減効果があるが、`ExtractionInfoPopover`改修 + 3箇所のバッジロジック改修 + `officeCandidatesCount`等の新規派生フィールドの永続管理(#178教訓の対象増、reprocessリセット漏れ・rules whitelist追加・backfill整合検証が恒久的に必要)が必要
- ❌ **不採用**: 費用対効果が悪い。Phase F後の実測でegress削減が不十分と判明した場合、別Issueとして再評価する

### B案: 既存の`ocrResultUrl`(Storage offload)機構を`pageResults`にも拡張

- `ocrResult`は既に`OCR_RESULT_MAX_LENGTH=100000`字超過時にCloud Storageへ自動オフロードされる仕組みが存在する(`saveOcrResult()`)。これを`pageResults`にも適用し、Firestoreサブコレクションを新設しない案
- ❌ **不採用**: Cloud Storageはフィールド単位のセキュリティルールベースアクセス制御ができず(署名付きURLまたはIAM管理が別途必要)、Firestoreルールで完結する既存の権限モデル(`isWhitelisted()`)と一貫しない。また`pageResults`は構造化データ(ページ別配列)であり、単一テキストファイルへのシリアライズは`PdfSplitModal`での部分アクセスや将来的なページ単位フィールド追加の柔軟性を制限する

### C案: サブコレクションを用途別に分割(pageResults用/ocrResult用など)

- ❌ **不採用**: 現状も`ocrResult`と`pageResults`は常にセットで読み書きされており(`ocrProcessor.ts`の単一transaction、`splitPdf`の単一batch)、分割の実利がない。1ドキュメントへの統合の方がシンプルで書込コード・rulesともに単純化される

## References

- **Issue #547**: https://github.com/yasushi-honda/doc-split/issues/547
- **PR #555**(事前計測スクリプト追加、実測データの出典): https://github.com/yasushi-honda/doc-split/pull/555
- **ADR-0016**(段階移行パターン=PR-D1〜D5構造の前例): `docs/adr/0016-document-identity-and-provenance.md`
- **memory: feedback_destructive_migration_codex_review.md**(destructive migrationのimpl-planはCodexセカンドオピニオン必須)
- **memory: feedback_second_opinion_not_final_conclusion.md**(セカンドオピニオンは参考情報として扱い、指摘は検証の上で採否判断する)
- **既存実装**: `functions/src/ocr/ocrProcessor.ts:288-376`(ocrResultUrlオフロード判定+メインtransaction) / `functions/src/pdf/pdfOperations.ts:337-344,713-727`(splitPdf batch上限+原子性) / `frontend/src/hooks/useDocuments.ts:254-320`(`getReprocessClearFields()`) / `functions/src/documents/deleteDocument.ts:172`(親doc削除)
- **Codex CLI 1st review**(2026-07-06、`codex review --base main --strict-config -c model_reasoning_effort=xhigh`、session `019f34a5-7de2-7941-a09f-39c52e3cf652`): P1×3 + P2×2、本ADR改訂で全件反映済み
- **Codex CLI 2nd review**(2026-07-06、同コマンド、改訂後diffに対する再レビュー): P1×1 + P2×3、本ADR改訂で全件反映済み
- **Codex CLI 3rd review**(2026-07-06、同コマンド、改訂後diffに対する再レビュー): P1×3 + P2×1、本ADR改訂で全件反映済み
- **Codex CLI 4th review**(2026-07-06、同コマンド、改訂後diffに対する再レビュー): P1×2 + P2×2、本ADR改訂で全件反映済み
- **Codex CLI 5th review**(2026-07-06、同コマンド、改訂後diffに対する再レビュー): P1×0 + P2×4、本ADR改訂で全件反映済み(P1が初めて0件)
- **Codex CLI 6th review**(2026-07-06、同コマンド、改訂後diffに対する再レビュー): P1×1、本ADR改訂で反映済み
- **Codex MCP 7th review**(2026-07-10、`mcp__codex__codex`、session111 Phase E impl-plan起票時、1周目): dual-write停止未考慮の設計ギャップを含むP1×5 + P2×4を検出、本ADR改訂で全件反映済み
- **Codex MCP 8th review**(2026-07-10、`mcp__codex__codex-reply`、同session、統合計画の2周目レビュー): P1×7、本ADR改訂・実装で全件反映済み(deleteFieldの誤除外防止/splitPdf payload分離/削除スクリプト状態別分類/migration marker/manifest原子性/rollback限界明記/documentGroups AC是正)
- **Amended: 2026-07-10 (session112)**: PR-E1/PR-E2実装(session111)に対し `/code-review high`(8 finder + 20件1-vote検証)を実施、続けてCodex MCP second opinion(effort high)でマージ前修正の要否をバランス判定。マージ前修正必須6件(`runRollback`のsilent no-op/`deleteOneDoc`のswitch文型安全性ギャップ/`canonicalHash`重複実装/`DeletionCounters`のPartial Updateテスト欠如/`Document.ocrResult`型とPhase E後の実態の不一致/`parseArgs`の`--marked-by`引数swallowバグ)を実装、follow-up 8件はPRコメントに記録(新規Issue化基準未達)。ローカルFirebase Emulators + Playwright MCPで`DocumentDetailModal`/`PdfSplitModal`の正常系UI確認、`ui-verified`ラベル付与。**PR #611マージ完了(squash、コミット`b1e8297`)**。本番(cocoro/kanameone)への`--execute`実行はまだ行われていない(GitHub Actions実行履歴で確認済み、dev環境のみで実行)
- **Amended: 2026-07-10 (session113)**: #547 Phase E本番実行完遂。cocoro(1,055件)・kanameone(9,513件)両環境で`--mark-preflight`→`--dry-run`→`--execute --limit 10`(canary)→`--verify`(中間、想定内FAIL)→`--execute`全件→`--verify`(最終、PASS)をGitHub Actions `run-ops-script.yml`経由・各ステップ番号単位認可で実施。エラー・異常skip(親↔detail不一致/detail不在)は全ステップ通じて0件、detail/mainサブコレクションは両環境とも無傷。egressの実削減効果は本番`documents/{docId}`から`ocrResult`/`pageResults`が実際に削除されたことで発生開始、請求額への反映は翌月確認待ち。**#547のFirestore egress削減トラックはこれで完了、GOAL.md記載のコスト圧縮ミッションの技術的完了条件を充足**(ただしコスト最適化=黒字化は別途保留カード「OCR出力エンティティリスト化」のdecision-maker判断待ち、GOAL.md「重要な注記」参照)
- **是正: 2026-07-12 (session117)**: 上記session113の「完遂」記述は不正確だったと判明。`--mark-preflight`ゲート(「PR-E1が対象環境に完全デプロイ済みであることを運用者が確認した上で実行するゲート」)は人間の申告記録に過ぎず、実際のCloud Functionsデプロイ状態を機械的に検証するものではなかった。session113時点で、PR #611(`b1e8297`、dual-write停止コード)はmainにマージ済みだったが、kanameone/cocoro双方の本番Cloud Functionsには**一度もデプロイされていなかった**(`gcloud functions list`実測+`docs/handoff/LATEST.md`session114記録で独立に裏付け: 両環境とも2026-07-09以降`deploy-functions.yml`未実行)。運用者(前セッションの本AIエージェント)が「PRのmainマージ」を「本番デプロイ済み」と誤認してpreflightを承認した可能性が高い。結果、削除実行(session113)後も旧デプロイのコードが新規/再処理ドキュメントの本体へ`ocrResult`/`pageResults`を書き戻し続けており、read-only `--verify`再実行でkanameone17件・cocoro5件の再発生を実測確認(いずれもdetail/main不在は0件、データ損失なし)。Codexセカンドオピニオン(`/codex plan`、MCP effort high)で是正計画を検証の上、cocoro→kanameoneの順で`deploy-functions.yml`により`b1e8297`+#539(`054cf7a`)+#540(`4a4b740`)+#625(`8b6ddcd`)の4コミットを反映(旧リビジョンdrain待機・デプロイ後verify比較・dry-run・番号単位認可を経てexecute)、両環境とも最終`--verify` PASS(残存0件)を確認して是正完了。**再発防止の課題**: `--mark-preflight`のような「デプロイ前提のdestructive migration」ゲートは、人間の申告のみに依存せず、デプロイ済みsource SHA等を機械的に検証する仕組みへの改善が望ましい(Codex指摘、本ADRのスコープ外のため別途検討)
