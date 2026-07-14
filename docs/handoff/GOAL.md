---
updated: 2026-07-14
---
<!-- session129: 新ミッション着手。前ミッション(OCR突合精度向上)はsession125クローズ済みのためLATEST.md/archive/2026-07-history.mdへ全文アーカイブ済み(git historyでも追跡可)。本ミッションはkanameoneからの「顧客別とCM別で利用者件数に差異がある」報告から着手。原因調査・Codexセカンドオピニオン(plan mode)を経て確定した実装計画。 -->

## 現在のミッション
kanameone本番で「担当CM(ケアマネジャー)別」の書類集計が「顧客別」集計より大幅に少なく表示されるバグを修正する。`careManager`未設定の書類を「CM未設定」グループとして可視化(除外ではなく計上)し、顧客別/CM別の合計件数を一致させる。

## 背景・why
- kanameoneから「顧客別と担当CM別で利用者件数に差異がある（CM別だと明らかに数字が小さい）」という報告があり調査した
- 根本原因: `Document`型の`customerName`/`officeName`/`documentType`は必須フィールド(マッチ失敗時は`不明顧客`/`未判定`にフォールバック)だが、`careManager`は任意フィールドでフォールバックなし。集計ロジック`functions/src/utils/groupAggregation.ts`は正規化キーが空の場合そのgroupTypeの集計から丸ごと除外するため、careManager別集計だけが顧客別集計より大幅に少なくなる非対称性がある
- kanameone実データ実測(2026-07-14): customer合計9,620件 vs careManager合計6,283件(差34.7%)。うち「不明顧客」グループが3,280件(34.1%)、実在顧客だがCM欠落が91件(customerIdなし62/マスターCM未設定22/**同期漏れ疑い7件**)
- バグの発生源3箇所: `functions/src/ocr/ocrUpdatePayloadBuilder.ts`(OCR自動取込)・`functions/src/pdf/splitDocumentBuilder.ts`(手動分割)・`scripts/migrate-document-groups.js`(groupAggregation.tsのロジックを独立に再実装したコピー、本体だけ直すと手動再構築時にバグが再発する)
- `/codex plan`セカンドオピニオン(MCP、effort=high)で以下の指摘を受け計画に反映済み:
  1. 集計専用の予約keyを使うべき（`未設定`という表示名をそのままkeyにすると実在CM名との衝突リスクがある）
  2. グループ生成だけでなく、グループをクリックして書類一覧を展開する経路（クエリロジック）にも同じ意味付けを持たせる必要がある
  3. `getAffectedGroups`・全件再集計・移行スクリプト(`migrate-document-groups.js`)で同一のkey導出関数を使うべき（最低でも契約テストで出力一致を保証）
  4. 本番バックフィルは同時更新競合対策・ロールバック手順（事前スナップショット、旧ロジックでの再構築手順）が必要
  5. AC「既存17グループのcount不変」は同期漏れ7件を将来補正すると成立しなくなるため「今回の集計修正単独では不変」に限定する
- GitHub Actions経由の新規診断スクリプト(`scripts/diagnose-caremanager-group-gap.js`, PR #654)で、Codex指摘の数値矛盾(9,620-3,371=6,249≠6,283)を実データ再検証。原因は前回集計スクリプトの母集団定義ミス(`status='split'`除外漏れ)と判明し、正しい母集団(`status !== 'split'`)では恒等式`customerKey非空 = careManagerKey非空 + careManagerKey欠損`が誤差0で一致することを実証した
- 副次発見(未解明・スコープ外): `documentGroups`実測値と動的再計算の間にcustomer-1件/careManager-25件の微小なズレ(over-count疑い)。バックフィル設計（既存documentGroupsをクリアしてから再構築）で自然に解消される見込み

## 完了の定義
- dev環境でcareManagerが空文字/undefined/nullいずれのdocumentも、同一の予約key(例: `__UNASSIGNED_CARE_MANAGER__`)+表示名「CM未設定」で`documentGroups`に集計される（証明: 単体テストで境界値3パターンPASS）
- 差分集計(`getAffectedGroups`)と全件再集計(`rebuildAllGroupAggregations`)が同一fixtureに対して完全一致する（証明: 契約テストPASS）
- `scripts/migrate-document-groups.js`が独立コピーを持たず、`groupAggregation.ts`と同一のkey導出ロジックを使う（証明: `diagnose-caremanager-group-gap.js`で採用した`functions/lib/`経由requireパターンで統一、または契約テストでの出力一致確認）
- フロントエンド「担当CM別」タブに「CM未設定」グループが表示され、クリックで該当書類一覧が正しく展開される（証明: Playwright実機確認、CLAUDE.md「UIコンポーネント変更時の確認」ルール準拠）
- kanameone本番バックフィル実行前に、対象件数・予定グループ内訳をドライランで出力し、実行後に同レポートと比較して差分が説明可能である（証明: バックフィルスクリプトのdry-run/execute出力ログ）
- kanameone本番バックフィル後、customer合計とcareManager合計(CM未設定含む)が誤差0件で一致する（証明: `diagnose-caremanager-group-gap.js`相当の再検証実行結果）
- 今回の集計修正単独では、既存の実在CM名17グループのcountがバックフィル前後で変化しない（証明: バックフィル前後の診断スクリプト比較。同期漏れ7件を別途補正する場合はこの限りではない）
- 本番展開後、kanameone/cocoro双方でエラー率が展開前と同水準（証明: `fix-stuck-documents --include-errors --dry-run`でエラー0件）
- 不変条件: 同期漏れ7件の原因究明・documentType「未判定」過集中問題・careManagerの検索インデックス欠落は本ミッションのスコープに含めない（decision-maker確定、2026-07-14）

## 進行中のtasks
- [ ] A. `functions/src/utils/groupAggregation.ts`の集計ロジック修正 — `getAffectedGroups()`/`rebuildAllGroupAggregations()`で、careManagerKeyが空の場合も予約key(`__UNASSIGNED_CARE_MANAGER__`等)+表示名「CM未設定」で集計対象に含める。予約keyは実在CM名の正規化結果と衝突しないことを保証する設計にする（Codex指摘反映）
- [ ] B. グループ展開経路の確認・対応 — フロントエンドで「CM未設定」グループをクリックした際に該当書類一覧を取得するクエリロジック(`CustomerSubGroup.tsx`等)が、予約keyと書類側の実際のcareManagerKey(空文字のまま)の対応関係を正しく扱えるか確認し、必要なら修正（Codex指摘反映、Aに依存）
- [ ] C. 単体テスト追加 — careManagerKeyが空文字/undefined/null/空白文字("　"等)いずれのケースも同一の「CM未設定」グループに集約されることを検証。あわせてCM変更/クリア/削除/復元/customer変更等、全更新経路でincrement/decrementの対称性を確認するテストを追加（Codex指摘反映、Aに依存）
- [ ] D. `scripts/migrate-document-groups.js`の同期修正 — `groupAggregation.ts`の独立コピーを解消。`diagnose-caremanager-group-gap.js`(PR #654)で採用した`functions/lib/functions/src/utils/groupAggregation.js`をrequireするパターンで統一する（Aに依存、並列可）
- [ ] E. 差分集計 vs 全件再集計の一致性契約テスト — 同一fixtureに対して`getAffectedGroups`の差分適用結果と`rebuildAllGroupAggregations`の全件再構築結果が完全一致することを保証するテストを追加（Codex指摘反映、A,Dに依存）
- [ ] F. dev環境リハーサル — careManager未設定のdocumentを意図的に作成し、documentGroupsへの反映・フロントエンド表示・クリック展開をPlaywright実機確認する（A,B,C完了後）
- [ ] G. 本番バックフィル設計 — 同時更新競合対策(バックフィル中のOCR処理・手動分割等との競合をウォーターマーク方式等で回避)、ロールバック手順(事前スナップショット取得、旧ロジックでの再構築手順)、ドライラン/完了判定機構(対象件数・グループ内訳の事前出力と実行後比較)を設計・実装する（Codex指摘反映、A,D,E完了後）
- [ ] H. kanameone本番バックフィル実行 — GitHub Actions経由、decision-maker承認後に実行。実行後`diagnose-caremanager-group-gap.js`で数値整合性を再検証する（F,G完了後）
- [ ] I. cocoro本番バックフィル実行 — Hの効果確認後に同様の手順で展開する（H完了後）

## 🔄 中断点（in-flight）
なし

## 監視・確認事項（トリガー待ち、前ミッション#547/#548から継続、新ミッションでも引き続き有効）
- egress実削減効果の翌月請求での実測確認（未実施。8月上旬の7月分請求書で確認）
- #548試算（全対策後¥23,000/月）の実額最終確認（実額は7月分請求書確定後）
- 【重要な発見、2026-07-14 session126】kanameone 7月請求のFirestore egress急増(+797%)の原因を特定・記録: 7/9のPhase C本番backfill(`backfill-detail-subcollection --execute`)によるトリガーストームと判明。対策(`isAggregationUnchanged`)は既に本番投入済みで再発は見込み低い。最終確認は7月分確定請求を待つ（詳細: docs/handoff/archive/2026-07-history.md session126）
- 【追加検証、2026-07-14 session127】Firestoreサイズ再計測+Gemini21日分実測: Phase E効果を直接証明、コスト圧縮確度を60-75%→80%程度に上方修正（詳細: 同archive session127）
- 【追加検証②、2026-07-14 session128】Cloud Monitoring read_count実測+cocoro反映状況確認: トリガーストーム説をさらに裏付け、cocoro側も反映確認済み（詳細: 同archive session128）
- dev環境のテストデータ`phase-e-devcheck-001`/`phase-e-devcheck-002`の後片付け（任意）
- 前ミッション（#547/#548運用コスト圧縮2トラック）は2026-07-10技術完了・2026-07-12是正確認済み。詳細はgit history（`git log -p docs/handoff/GOAL.md`）およびdocs/handoff/archive参照
- （任意・着手指示なき限り不要）OCR突合精度向上ミッション（旧ミッション、session125で撤退）で未解明のまま残った「kanameone confirmed-replayでbaseline自体の一致率が33.3%/41.7%と低い」原因。将来的に興味を持った場合の起点はdocs/handoff/archive/2026-07-history.md（旧ミッションタスクH/Iの記録）、および`scripts/compare-ocr-arbitration-logic-confirmed.ts`
- （任意・着手指示なき限り不要）本ミッションで発見された副次課題3件は別タスクとして扱う: ①同期漏れ7件(`syncCareManager.ts`のonCustomerMasterWriteトリガー反映漏れ、原因未解明) ②documentTypeの「未判定」が2,465件(25.6%)でcount降順ソートのタブ先頭を占有している疑い(実機未確認、過去Issue #501と同型の「単一グループへの過集中」リスク) ③careManagerがトークン検索インデックス対象外で検索窓から検索できない機能欠落
