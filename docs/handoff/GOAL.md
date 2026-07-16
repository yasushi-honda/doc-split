---
updated: 2026-07-16
---
<!-- session133: 新ミッション着手。前ミッション(kanameone担当CM別集計バグ修正+Issue #660過去ドリフト是正)はsession132で完全達成済み(全文はdocs/handoff/LATEST.md session132サマリ参照、git historyでも追跡可)。本ミッションは「複数顧客FAX複製機能」の設計相談から派生。相談の過程でIssue #664(session132では実害なしとして対応見送り判断済み)の優先度が再評価され、decision-maker判断により対応再開が決定された。 -->

## 現在のミッション

Issue #664「documents create/delete順序不同配信でphantom countが起きうる」を恒久的に修正する。集計トリガー(`onDocumentWrite`)の計算モデルを「event.before/afterの履歴差分適用」から「documentsのライブ状態への収束(materialized projection)」に置き換える。dev環境で実装・検証完了後、kanameone/cocoro本番へ展開する。

## 背景・why

- 発端は「複数顧客が写る1回の受信FAXを、検出した顧客の人数分だけ複製し、担当CMごとに後から選別してもらう」という現場提案(decision-maker経由)の設計相談。相談の中で、この運用が想定するdocument create/delete頻度の増加が、既存の未対応既知バグ(Issue #664)の発生条件(作成直後削除の配信順序不同)を「稀な理論値」から「日常的に踏みうる経路」に格上げすることが判明した
- Issue #664自体は複製機能の採否によらず独立して対応すべき既存バグであり、decision-maker判断により本ミッションとして先行対応することになった(複製機能自体の設計・実装は本ミッションのスコープ外)
- session132時点では「kanameone/cocoro本番で観測した実際のドリフトは全てIssue #660由来、Issue #664型の事例は0件」という実測を根拠に対応見送りと判断していたが、今回のスコープ拡大リスクを踏まえ再評価し、着手再開が決定された

### 設計検討の経緯(`/codex plan`セカンドオピニオン2往復、MCP版・threadId `019f67fa-3775-7e02-aee2-9d364abf2050`)

1. **1往復目**: Issue #664原文が想定していた「`documentAggregationStates/{docId}`にlatestEventTime/latestEventIdを持たせ、新しいstateがあれば古いイベントのdeltaをスキップする」という案をCodexへ検証依頼。以下2点が判明し、原案は不採用となった:
   - `event.time`はFirestore/Eventarcの配信順序比較キーとして安全に使えない(公式ドキュメントで裏付け: at-least-once配信・順序非保証。`Document.updateTime`は同一文書内で単調増加するがdeleteイベントには適用できない)
   - 「新しいstateがあれば古いイベントをスキップする」だけでは不正確。反例: グループAに別文書Yが1件存在する状態で、文書XのA→B属性変更イベントが文書X作成イベントより先に配信されると、単純スキップ方式は「作成イベントをスキップ」した上で「更新イベントのbefore=Aへの-1」を適用してしまい、Xとは無関係な文書Yの分まで誤って減算する
   - Codexの提案: 書込み側(`documents/{docId}`への全書込み経路)が、実際の書込みと同一トランザクションでrevision付きmutationレコードを生成する「outboxパターン」(`documentAggregationMutations`新設)
2. **全書込み経路の洗い出し(Exploreエージェント)**: outboxパターンを正しく実装するための前提として、`documents/{docId}`への書込み経路を全数調査した結果、**23箇所**判明(バックエンド10・フロントエンド5系統[Firestore Client SDK直接書込み、callable非経由]・スクリプト11本)。うち2箇所(`updateDocumentGroups.ts`自身のneedsKeyUpdate自己書込み、`searchIndexer.ts`という別トリガーの検索メタデータ自己書込み)は自己参照的に集計トリガーを再発火させる構造。outboxを正しく実装するには23箇所全てへの改修が必要となり、非現実的な規模と判断
3. **2往復目**: 「書込み側を一切変更せず、集計トリガー側だけで完結させる」代替案(ライブ再読込み+文書単位のcontribution状態)を提案しCodexへ再検証依頼。Codexは反例チェック・並行実行安全性を検証した上で、この代替案を**正しく、かつoutbox案より実装規模が大幅に小さい**と評価し、採用が確定した

## 採用設計

### 計算モデルの変更(意味論の変更、ADR-0021で明文化予定)

- **旧**: `event.data.before/after`という「このイベント固有の履歴差分」をdocumentGroupsに適用する(ADR-0020)
- **新**: `documentGroups`は「現在のdocumentsの状態」に収束すべき派生データと再定義し、各イベント処理は「前回このトリガーが適用した寄与(`documentAggregationStates/{docId}.contribution`) → 現在のdocumentsのライブ再読込みが示す寄与」の差分をトランザクション内で適用する

### なぜ安全か(Codex検証済み)

- 並行書込み: `documentAggregationStates/{docId}`もトランザクションの読み取りセットに含まれるため、競合時はFirestoreの標準的なトランザクション再試行機構(ADR-0020と同じ仕組み)でシリアライズされ、リトライ後は最新state+最新documentsに収束する
- ADR-0020の「トランザクション内でdocumentsを再読込みしない」制約は、旧モデル(このイベント固有の履歴差分を再現する必要がある)には必須だったが、新モデル(ライブ状態への収束が目的で、履歴差分の再現は目的としない)には適用されない
- docId再利用(delete後の同一ID再作成)も、ライブ再読込みにより追加対策なしで自然に安全(outbox+revision方式ではincarnationId等の追加設計が必要だった)
- 既存の`documentAggregationEvents`冪等台帳(ADR-0020)は、正しさの必須要件ではなくなるが、重複配信の早期skip最適化として維持する

### 追加で必要な修正(Codex指摘)

現行の`needsKeyUpdate`(`updateDocumentGroups.ts:91-96`)は、イベントの**古いafterData**を使ってトランザクション**外**で`documents/{docId}`へ事前updateしている。docId再利用後に古いイベントが遅延到着すると、新しい文書のキーを古いデータで上書きする恐れがあるため、ライブ再読込みデータ基準に直し、トランザクション内(write phase)に統合する。

## 完了の定義

- [x] AC1: 別文書Yがグループ内に存在する状態で、文書XのA→B更新イベントをX作成イベントより先に処理しても、Aのcountに影響なし・Bのみ+1になること → `updateDocumentGroupsIdempotencyIntegration.test.ts` AC1でPASS確認済み(Evaluatorによる独立実測でも再確認済み)
- [x] AC2: 作成直後削除でdelete配信が先着しcreateが後着しても、対象グループにphantom countが残らないこと → 同ファイルAC2でPASS確認済み(Issue #664の核心シナリオ)
- [x] AC3: 文書削除後の同一docId再利用で、古いイベントが遅延到着しても新しい内容のみ反映されること → 同ファイルAC3でPASS確認済み
- [x] AC4: 既存の冪等性AC(同一event.id重複配信・並行実行・部分失敗ロールバック、ADR-0020のAC1〜7相当)が新設計でも全てPASSすること → AC4-1〜4-6(異なるevent.id間の真の並行実行・キー正規化のみの組合せを追加検証)全てPASS
- [x] AC5: `needsKeyUpdate`がトランザクション内のライブデータ基準に統合され、トランザクション外の事前updateが存在しないこと → コードレビュー+AC5/AC5-2テストで確認済み
- [x] AC6: dev環境で移行(state seed + documentGroups再構築)後、恒等式検証(診断スクリプト相当)で差分0件であること → devリハーサルで確認済み(customer/office/documentType/careManager全一致、groupId単位・恒等式検証も一致)
- [x] AC7: kanameone/cocoro本番展開後、同様に差分0件であること → 両環境で診断スクリプト実行、customer/office/documentType/careManager全一致・groupId単位/恒等式検証も一致を確認済み。**エラー率同水準の確認も完了(2026-07-16)**: kanameoneのローカルgcloud認証(systemkaname@kanameone.com)が非対話的再認証要求でブロックされたため、既存デプロイSA経由でGHA(`run-ops-script.yml` `check-function-error-logs`スクリプト新設、PR化予定)から確認。結果: 両環境とも`onDocumentWrite`(Issue #664修正対象関数)は過去7日間エラー0件。kanameoneの`ondocumentwritesearchindex`(検索インデックス用の別トリガー)に201件のエラーがあったが、全て「Memory limit of 512 MiB exceeded」のOOMで、タイムスタンプは07-10/07-12(今回デプロイ2026-07-16T05:38 UTCより前)の既存事象。`scripts/monitoring-templates/alert-searchindex-oom.yaml`という既存アラートテンプレートで既に監視対象化されている既知の別問題であり、Issue #664修正とは無関係。cocoroの他関数エラー(各2件)は全てデプロイ完了時刻に集中した「Invalid request, unable to process」というCORSプリフライトの正常応答で無害と確認済み
- 不変条件: 「複数顧客FAX複製機能」自体の設計・実装は本ミッションのスコープに含めない(decision-maker確定、2026-07-16)。Issue #664の過去ドリフト是正(本番で既に発生している可能性のあるphantom countの補正)も本ミッションのスコープ外(新規発生の防止のみが目的。既存tooling`rebuildSingleGroupAggregation()`による個別補正は必要になった時点で別途対応)

## 進行中のtasks

- [x] A. `buildContribution(liveDocData)`新設 — `groupAggregation.ts`。既存の`generateGroupKeys()`/`resolveGroupKeyAndDisplay()`/`status==='split'`除外ロジックを流用し、最大4件のgroup所属配列を返す
- [x] B. `diffContribution(previous, target)`新設 — `groupAggregation.ts`。group単位でdelta統合(-1/0/+1)。同一グループが両方に存在し表示名も同一なら何も返さない(真のno-opでFirestore書込みを避ける)
- [x] C. `documentAggregationStates`読み書きヘルパー — `groupAggregation.ts`(`aggregationStateRef`/`readAggregationStateContribution`/`buildAggregationStateEntry`)
- [x] D. `processDocumentAggregationEvent()`刷新 — `updateDocumentGroups.ts`。event.before/after依存を廃止しライブ再読込み+state diffに統合、needsKeyUpdateをtx内のライブデータ基準へ統合。`DocumentAggregationEventInput`からbeforeData/afterDataを削除
- [x] E. `applyAggregationDeltas()`の重複group ref対応確認 — diffContributionはgroupId単位でdedup済みの配列を返すため追加修正不要と確認(tsc型チェックPASSで検証)
- [x] F. 単体テスト(buildContribution/diffContribution) — `groupAggregation.test.ts`に34件追加、全PASS(反例ケース含む)
- [x] G. integration test拡張 — `updateDocumentGroupsIdempotencyIntegration.test.ts`を新インターフェースに合わせ全面書き換え。AC1(反例ケース)/AC2(Issue #664核心シナリオ)/AC3(docId再利用)/AC4-1〜4(既存冪等性ACの回帰確認)/AC5・AC5-2(needsKeyUpdateのライブ化)の9件全PASS。実装当初のテストfixture不備(大文字careManagerKeyがnormalizeGroupKeyで小文字化される不整合、およびAC4-4のstate非存在誤assertion)を実行結果から検出・修正済み
- [x] H. `documentAggregationStates`のFirestore rules(deny-all)+テスト — `firestore.rules`/`firestore.rules.test.ts`、3件追加、全PASS
- [x] I. migrationスクリプト — `scripts/migrate-document-groups.js --seed-aggregation-states`追加(既存`--backfill-cm-unassigned`と同じメンテナンスゲート制御)。GHA `run-ops-script.yml`に選択肢登録済み。エミュレータ上でdry-run→実行→検証のリハーサル実施、CM未設定フォールバック・split除外・ゲート再開全て確認済み
- [x] J. ADR-0021作成 — `docs/adr/0021-live-read-aggregation-model.md`。Codexの「documentGroupsも同一スナップショットで再構築すべき」という提案には、直前ミッションでの個別再構築方針(全体再構築のリスク回避)を踏襲する形で意図的に逸脱した旨を明記
- [x] K. devリハーサル — dev環境(doc-split-dev)で完了。
  - デプロイ: `./scripts/deploy-to-project.sh dev --full`でFunctions(onDocumentWrite含む)+Firestore rules+Hosting成功
  - **手順ミス(要記録)**: ADR-0021移行手順は「新トリガーコード配備の**前**にseedする」ことが必須だが、今回はデプロイ→seedの順で実行してしまった(逆順)。Cloud Functionsログで該当ウィンドウ(デプロイ完了〜seed完了、約12分間)の`onDocumentWrite`実行を確認した結果、書き込みイベントは0件で実害なしと確認。**L(本番展開)では絶対に正しい順序(seed→デプロイ)を守ること**
  - `--seed-aggregation-states`実行(GHA、`fix/issue-664-live-read-aggregation`ブランチ経由): スキャン161件/state作成161件、エラーなし
  - `diagnose-caremanager-group-gap.js`実行 → office/documentType/careManagerで既存ドリフト検出(customer=161✅ 一致、他3種は不一致)。**このドリフトは今回の変更とは無関係**(`--seed-aggregation-states`はdocumentGroupsを一切変更しないため)。dev環境が過去の複数セッションのテスト用データ(`--seed-doc-*`等)を蓄積した結果の既存ドリフムと判断
  - GOAL.md AC6の「documentGroups再構築」を実施: `--rebuild-groups`(個別グループ再構築、対象5件: office_ひまわり訪問介護ステーション/documentType_ケアプラン/careManager_佐々木恵子/office_あおぞらデイサービスセンター/documentType_サービス提供票)をdry-run→実行、5/5成功
  - 再度`diagnose-caremanager-group-gap.js`実行 → customer/office/documentType/careManager全てdynamic=161/実測=161で一致✅、groupId単位の個別比較も全一致、恒等式検証も一致✅。**AC6達成**
- [x] L. kanameone/cocoro本番展開 — decision-maker承認後、Kの教訓(seed→デプロイの正しい順序)を厳守して実施。両環境で完了。
  - **kanameone**: `--seed-aggregation-states`(9693件、dry-run→実行、エラーなし)→ Functions/rules/hostingデプロイ(`switch-client.sh kanameone`+`deploy-to-project.sh kanameone --full`)→ 診断スクリプトでcustomer/office/documentType/careManager全て9693件で一致✅、groupId単位・恒等式検証も一致✅(session132のドリフト是正が維持されており新規ドリフトなし)
  - **cocoro**: `--seed-aggregation-states`(1090件、dry-run→実行、エラーなし。実行時に1件新規Gmail取込文書(pending、contribution空)が増えていたが、空contributionのためstate作成対象外=想定通りの無害な挙動)→ Functions/rulesデプロイ(`firebase deploy --only functions -P cocoro` / `firebase deploy --only firestore:rules,firestore:indexes,storage -P cocoro`、editorアカウントのため`deploy-to-project.sh`を使わず手動手順)→ 診断スクリプトで1091件全て一致✅、groupId単位・恒等式検証も一致✅
  - 後片付け: Firebase CLIアカウント/gcloud構成をdev用に復帰済み

- [x] K-pre. `/code-review high`(8 finder agents)+Evaluator分離プロトコル実施、指摘への対応完了:
  - CONFIRMED①(migrate-document-groups.jsのゲート制御3重複) — `withMaintenanceGate()`ヘルパーに統合、エミュレータリハーサルで再検証済み
  - CONFIRMED②(`groupAggregationRebuildContractIntegration.test.ts`が本番未使用の`getAffectedGroups()`を検証しておりbuildContribution/diffContributionモデルの正しさを一切カバーしていなかった) — `processDocumentAggregationEvent()`本体を直接呼ぶ形に書き換え、母集団件数のnon-trivialアサーションを追加。エミュレータで2件PASS確認
  - CONFIRMED③(CLAUDE.md「Partial Updateテストに更新対象外フィールド不変を含める」ルール未遵守) — AC5/AC5-2に不変フィールドのassertion追加
  - CONFIRMED④(migration順序が実行時に強制されない) — ADR-0021の移行手順セクション(72行目)に既に明記済みのため、ADR-0019と同種の許容済み運用リスクとして現状維持
  - Evaluator指摘MEDIUM(異なるevent.id間の真の並行実行がuntested、ADR-0021の中核安全性claim) — AC4-5追加。調査の結果、ローカルFirestoreエミュレータは「未存在ドキュメントへの`transaction.set()`」が絡む競合を確実には検知しないという既知の制約([firebase-tools#8120](https://github.com/firebase/firebase-tools/issues/8120))を実機で確認。本番はAdmin SDKデフォルトの悲観的ロックのためこの制約は適用されないが、emulatorでend-to-end検証できるのは「既存state/groupへの変更」の競合のみと判明。この経路(AC4-5)は3秒超のリトライ発生を伴い確実にPASS(3連続実行で決定的)。詳細はADR-0021残存リスクに追記
  - Evaluator指摘LOW(keyUpdateのみ・集計変化なしの組み合わせがuntested) — AC4-6追加、PASS確認
  - PLAUSIBLE指摘4件(trigger-storm読み取り増幅・seed scriptのorderBy省略[既存パターン踏襲]・diffContribution重複エントリ防御・generateGroupKeys冗長呼び出し) — severity低のため今回は現状維持(次にこのコードパスを触る際に再検討)
  - 全品質ゲート再検証: `npm run lint`(0 errors)/`npm run build`(成功)/`npm run test`(1800 passing)/`npm run test:rules`(83 passing)/`npm run test:integration`(124 passing、既存122件+AC4-5/AC4-6の2件、回帰なし)

## ✅ ミッション完了(2026-07-16)

A〜L・AC1〜AC7全て完了。Issue #664「documents create/delete順序不同配信でphantom countが起きうる」問題は、dev/kanameone/cocoro全環境で恒久的に修正された(ADR-0021)。

**PRマージ済み**: PR #669(`fix/issue-664-live-read-aggregation` → `main`)。`/codex review-diff`によるセカンドオピニオン3ラウンド(P1×3・P2×2・P3×1、いずれも修正済み)を経てdecision-maker明示承認のうえ squash merge、feature branch削除済み。local mainもfast-forward済み(`f9f8869`)。

**次セッションへの申し送り**:
- AC7の「エラー率同水準」の明示的ログ比較は、kanameone gcloud認証の再認証要求により未実施。次回のcatchup等でCloud Functionsのエラー率(kanameone/cocoro双方)を目視確認することを推奨
- K実施時の手順ミス(devでデプロイ→seedの順序を誤った、実害なしと確認済み)を教訓として記録済み。L実施時は正しい順序(seed→デプロイ)を徹底し、問題なく完了した
