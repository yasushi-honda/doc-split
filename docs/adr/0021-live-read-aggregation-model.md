# ADR-0021: 集計トリガーの計算モデルを「イベント履歴差分」から「ライブ状態への収束」へ変更

## Status

Accepted (2026-07-16)。`/codex plan`セカンドオピニオン2往復(初期案の却下・代替案の採用)を経て設計確定。実装完了。

## Context

### 背景・発見の経緯

ADR-0020(集計トリガーのイベント冪等台帳)は「同一event.idの重複配信」への対応を完了させたが、Issue #664として「異なるevent.id間の配信順序不同」による既知の限界が残っていた:

1. キーなしdocumentのcreateイベント(C)発生、直後にdeleteイベント(D)発生
2. CloudEventsは配信順序を保証しないため、Dが先に配信されうる
3. D処理時点ではまだ対応する`documentGroups`グループが存在しないため、`-1`は実質no-op
4. その後Cが処理される。documentは既にFirestoreから削除済みだが、Cの`event.data.after`は生成時点の凍結スナップショットを保持しているため、`+1`が適用されてしまう
5. C・D両方のevent.idが冪等台帳に記録されるため、再試行による是正手段がなく、該当グループのcountが永久に`+1`多いまま残留する(phantom count)

本Issueは、複数顧客が写る1回の受信FAXを検出顧客の人数分だけ複製し担当CMごとに選別してもらう、という別件の設計相談から派生した。この複製運用はdocument create/delete頻度を増やすため、Issue #664の発生条件(作成直後削除の配信順序不同)を「稀な理論値」から「日常的に踏みうる経路」に格上げする懸念があり、decision-maker判断により複製機能に先立って本Issueへの対応が決定された。

### 却下した初期修正案

Issue #664起票時点の想定案は、`documentAggregationStates/{docId}`に`latestEventTime`/`latestEventId`を持たせ、「今回のイベントより新しいstateが既に記録されていれば、このイベントのdeltaを適用しない」という順序制御だった。`/codex plan`セカンドオピニオンで以下2点の欠陥を指摘され、この案は不採用となった:

1. **`event.time`は配信順序の比較キーとして安全に使えない**: Firebase公式ドキュメント([Firestore events](https://firebase.google.com/docs/functions/firestore-events))はイベントがat-least-once配信であり順序を保証しないと明記している。CloudEvents仕様の`time`属性も発生時刻を表すのみで、因果順序を表す単調な連番ではない。Firestoreの`Document.updateTime`は同一文書内で単調増加するが、deleteイベントには適用できない(削除後は文書自体が存在せず、比較対象のupdateTimeを持たない)。
2. **「新しいstateがあれば古いイベントをスキップする」だけでは不正確**: 反例がある。グループAに別文書Yが1件存在する状態で、文書XのA→B属性変更イベントが文書X作成イベントより先に配信されると、単純スキップ方式は「作成イベントをスキップ」した上で「更新イベントのbefore=Aへの`-1`」を適用してしまい、Xとは無関係な文書Yの分まで誤って減算する。これは「順序を検知してスキップする」だけでは直らず、ADR-0020の計算モデル自体(before/afterの履歴差分をそのまま適用する)を変える必要があることを示している。

Codexは代替として、書込み側(`documents/{docId}`への全書込み経路)が実際の書込みと同一トランザクションでrevision付きmutationレコードを生成する「outboxパターン」(`documentAggregationMutations`新設)を提案した。しかし、`documents/{docId}`への書込み経路を全数調査した結果、**23箇所**(バックエンド10・フロントエンド5系統[Firestore Client SDK直接書込み、callable非経由]・スクリプト11本)判明し、うち2箇所(`updateDocumentGroups.ts`自身のキー正規化自己書込み、`search/searchIndexer.ts`の検索メタデータ自己書込み)は自己参照的に集計トリガーを再発火させる構造だった。outboxパターンを正しく実装するには23箇所全てへの改修が必要となり、非現実的な規模と判断した。

## Decision

### 採用design: ライブ再読込み + 文書単位のcontribution状態

書込み側を一切変更せず、集計トリガー側だけで計算モデルを変更する。

**計算モデルの変更**:
- **旧(ADR-0020)**: `event.data.before/after`という「このイベント固有の履歴差分」をdocumentGroupsに適用する
- **新**: `documentGroups`は「現在のdocumentsの状態に収束すべき派生データ(materialized projection)」と再定義し、各イベント処理は「前回このトリガーが適用した寄与(`documentAggregationStates/{docId}.contribution`) → 現在のdocumentsのライブ再読込みが示す寄与」の差分をトランザクション内で適用する

```
documentAggregationStates/{docId}
  contribution: Array<{ groupType, groupKey, displayName }>  // 前回適用した寄与(最大4件)
  updatedAt: Timestamp
```

`documentAggregationEvents`(ADR-0020の冪等台帳)は既存データ形式のまま維持し、同一event.idの重複配信に対する早期skip最適化として引き続き使う。正しさの必須要件ではなくなったが、コスト削減のため残す。

### なぜ安全か(`/codex plan`セカンドオピニオンで反例チェック・並行実行安全性を検証済み)

- **反例ケースへの対応**: 「前回のcontribution → 現在のライブ状態」の差分を取るため、他文書の寄与を誤って参照することがない。前述の反例(グループAに文書Yが1件、文書XのA→B更新がcreateより先着)でも、Xの処理は常にXのstate(前回はまだ空)を基準にするため、Aへ触れずBのみ+1になる
- **並行書込みとの整合性**: `documentAggregationStates/{docId}`もトランザクションの読み取りセットに含まれるため、同一docIdへの並行イベント処理はFirestoreの標準的なトランザクション競合検知・自動リトライ機構(ADR-0020と同じ仕組み)でシリアライズされ、リトライ後は最新state+最新documentsに収束する
- **ADR-0020の「トランザクション内でdocumentsを再読込みしない」制約は本設計には適用されない**: 旧モデルは「このイベント固有の履歴差分を再現する」ことが目的だったため、別イベントの現在状態を誤って基準にしないことが必須だった。新モデルは履歴差分の再現を目的とせず「現在のライブ状態への収束」が目的のため、ライブ再読込みそのものが正しい設計になる
- **docId再利用(delete後に同一IDで別内容の文書が作られるケース)も、追加対策なしで自然に安全**: ライブ再読込みは常に「今」の状態を見るため、旧incarnation時代の遅延イベントが新incarnationのcontributionを破壊しない

### 追加で必要になった修正: needsKeyUpdateのライブデータ基準化

現行の`needsKeyUpdate`(customerKey等のキャッシュフィールド正規化)は、イベントの**古いafterData**を使ってトランザクション**外**で事前updateしていた。docId再利用後に古いイベントが遅延到着すると、新しい文書のキーを古いデータで上書きしてしまう恐れがあったため(Codex指摘)、ライブ再読込みしたデータを基準にし、トランザクションのwrite phaseに統合した。

### 実装

`functions/src/utils/groupAggregation.ts`:
- `buildContribution(liveDocData)`: ライブなdocumentデータから最大4件のgroup所属を算出する。既存の`generateGroupKeys()`/`resolveGroupKeyAndDisplay()`/`status==='split'`除外ロジックを流用するが、**保存済みのcustomerKey等ではなく生フィールドから毎回キーを再導出する**(`rebuildAllGroupAggregations()`等と同じ「生データから再導出」パターンへの統一)
- `diffContribution(previous, target)`: 2つのcontributionをgroupId単位で比較し、追加/削除/表示名変更のみ`AggregationDelta`として返す。両方に同一キー・同一表示名で存在する場合は何も返さない(真のno-opではFirestore書込みを発生させない)
- `aggregationStateRef`/`readAggregationStateContribution`/`buildAggregationStateEntry`: `documentAggregationStates`の読み書きヘルパー

`functions/src/triggers/updateDocumentGroups.ts`:
- `processDocumentAggregationEvent()`を刷新。単一トランザクション内で「台帳確認 → documentsライブ再読込み → state読込み → contribution算出・diff → (必要なら)affected groups読込み → 全書込み(キー正規化・group delta適用・state更新・台帳作成)」を実行する
- `DocumentAggregationEventInput`から`beforeData`/`afterData`を削除(もはや使わない)。`onDocumentWrite`本体(`onDocumentWritten`ラッパー)も`event.data`を参照しなくなり、大幅に簡素化された

### 移行手順(本番展開時に必須)

新トリガーコードを配備する**前**に、既存の全document(`buildContribution()`のstatus==='split'判定に母集団定義を委ねる無条件フルスキャン)に対して`documentAggregationStates`をseedする必要がある。配備後に実行すると、配備直後〜seed完了までの間に発生したイベントがstate不在(`previousContribution=[]`)として扱われ、既に`documentGroups`へ計上済みの寄与を二重加算してしまう。

`scripts/migrate-document-groups.js --seed-aggregation-states`(既存の`--backfill-cm-unassigned`/`--rebuild-groups`と同じメンテナンスゲート制御: クローズ→10分ドレイン待機→全document scan・seed)を追加した。推奨シーケンス(dev/kanameone/cocoro全環境で実施・検証済み。ただし後述の`--keep-gate-closed`/`--reopen-gate`はCodex review後の追加改善で、初回のdev/kanameone/cocoro実施時点では未実装だった):

1. `--seed-aggregation-states --keep-gate-closed`を実行(ゲートクローズ→ドレイン→seed→**ゲートは閉じたまま維持**)
2. 新トリガーコードをデプロイ(`gh workflow run "Deploy Cloud Functions"`)し、成功を確認
3. `--reopen-gate`でメンテナンスゲートを明示的に再開
4. `scripts/diagnose-caremanager-group-gap.js`で恒等式検証
5. 差分があれば既存の`rebuildSingleGroupAggregation()`(個別groupId再構築)で補正

**なぜ`--keep-gate-closed`が必要か(`/codex review`P1指摘、本番実施後に追加修正)**: 当初実装ではseed完了と同時にゲートが自動再開されていた。新トリガーコードのデプロイはこのスクリプトの責務外(運用者が別途実行する)であり、seed完了〜デプロイ完了の間隙でゲートが開いていると、集計所属変更(OCR確定/split/CM同期)を旧トリガーが処理して`documentGroups`を正しく更新するが`documentAggregationStates`には反映されない。デプロイ後にその文書が再び触られると、新トリガーが古いstateとの差分を「新規変化」と誤認し二重適用する。dev/kanameone/cocoroへの初回展開時点ではこの改善前のバージョンを使用したため理論上のリスク窓が存在したが、展開後に`diagnose-caremanager-group-gap.js`で恒等式検証を実施し差分0件を確認済み(=このリスクは顕在化していない)。将来の再実行(新規クライアント展開等)では`--keep-gate-closed`/`--reopen-gate`を使用すること。

**seedスクリプトの母集団クエリ修正(`/codex review`P1指摘、本番実施後に追加修正)**: 当初実装は`rebuildAllGroupAggregations()`と同じ`where('status','!=','split').orderBy('status').orderBy('processedAt','desc')`クエリを使用していたが、Firestoreの`!=`/`orderBy`クエリは対象フィールドを持たない文書を暗黙に除外する。`buildContribution()`はstatus未設定文書を「split以外」として包含するため、この非対称性により`status`/`processedAt`が未設定のレガシー文書がseed対象から漏れうる。`scripts/diagnose-caremanager-group-gap.js`と同じ`FieldPath.documentId()`順の無条件フルスキャン+`buildContribution()`自身のstatus判定に統一した。dev/kanameone/cocoroの実際のデータには該当する文書が存在しなかった(診断スクリプトの恒等式検証で差分0件確認済み)ため実害はなかったが、将来の再実行時の潜在リスクを排除する。

**Codexの提案(「documentGroupsも同一スナップショット基準で再構築する」)からの意図的な逸脱**: Codexは移行時にstate seedと同時に`documentGroups`全体も再構築することを推奨したが、本プロジェクトでは直前のミッション(Issue #660是正、GOAL.md タスクJ4)で`documentGroups`の恒等式一致を検証済みであり、`rebuildAllGroupAggregations()`(全削除+再構築)は影響範囲が過大なため本番で意図的に避けてきた経緯がある(Issue #660是正でも個別groupId再構築方式を採用)。本ADRでも同じ判断を踏襲し、`documentGroups`の全体再構築は行わず、state seedのみを事前に行い、事後検証で差分が見つかった場合にのみ個別補正する方針とした。

### 残存リスク

- **フロントエンドの直接書込み(5系統)は`functions/src/utils/maintenanceGate.ts`のゲートを参照しない**(バックエンド書込み経路のみゲート対応済み)。移行のドレイン待機中に偶発的なフロントエンド編集が発生した場合、その1文書についてstate seedのタイミングとの間に僅かなズレが生じうるが、次回イベントで自己収束するため実害は小さいと判断した。ADR-0019の既知残存リスクと同種
- **`documentAggregationStates`にTTLを設定しない**(`documentAggregationEvents`と異なり、対象docIdが存在する限り永続的に必要な状態のため)。docId再利用を考慮すると無期限保持が安全側であり、コスト影響は1文書あたり小さな1レコードのみのため許容する
- **「あるgroupへの生まれて初めての貢献」が複数文書から真に並行発生するケースは、ローカルFirestoreエミュレータ上では確実に検証できない**(Evaluator指摘を受けたintegration test追加時に実機検証で判明)。`documentAggregationStates`/`documentGroups`いずれも未存在ドキュメントへの`transaction.set()`が絡む競合は、ローカルエミュレータの楽観的並行性制御が確実には検知しないことを確認した([firebase-tools#8120](https://github.com/firebase/firebase-tools/issues/8120)で公式に認知されている既知の制約)。本番の標準EditionFirestore/Admin SDKはデフォルトで悲観的ロックを使用するため([公式ドキュメント](https://firebase.google.com/docs/firestore/transaction-data-contention))この制約自体は本番には適用されないが、この経路は本番Firestoreの並行性保証に依拠しており、emulator上でのend-to-end実証はできていない。既存ドキュメントへの`update()`/`delete()`が絡む競合(=一度でも集計済みのdocIdに対する競合)は、エミュレータ上でも確実にシリアライズされることを実機で確認済み(`AC4-5`)。なお本項目はADR-0021で新規に導入したリスクではなく、`applyAggregationDeltas()`の新規グループ作成ロジック自体はADR-0020から変更していないため、Issue #660修正時点から存在する特性である

## Consequences

### 得られたもの

- Issue #664の核心シナリオ(作成直後削除の配信順序不同によるphantom count)が、integration testで再現・修正確認済み(`functions/test/updateDocumentGroupsIdempotencyIntegration.test.ts`)
- Codexが指摘した反例ケース(無関係な他文書の寄与を誤って減算する)、docId再利用、既存のADR-0020冪等性AC(同一event.id重複配信・並行実行・アトミック性)全て回帰確認済み
- `documents/{docId}`への書込み経路(23箇所)を一切変更する必要がなかった。outboxパターン(Codex当初案)と比較して実装規模が大幅に縮小した
- `onDocumentWrite`本体が`event.data.before/after`を扱わなくなり、CloudEventのプラミングが簡素化された

### トレードオフ

- **履歴の厳密な再生はできない**: 「このイベントが何を表していたか」という監査証跡は失われる(新モデルは「現在の状態」のみを保持する)。集計の正しさ(count projection)には影響しないが、将来イベント単位の監査が必要になった場合は別途設計が必要
- **新規ドキュメント作成時、`documentAggregationStates`への1回の追加書込みが発生する**(既存の`documentAggregationEvents`台帳書込みに加えて)。コスト影響は文書1件あたり小さなドキュメント1件のみ

## 関連

- [ADR-0020: 集計トリガー(onDocumentWrite)のイベント冪等台帳による非冪等性修正](0020-aggregation-event-idempotency-ledger.md) — 同一event.id内の重複排除(documentAggregationEvents)は本ADRでも維持。本ADRは「異なるevent.id間の配信順序」への対応を追加する
- [ADR-0019: 担当CM別集計バックフィルの並行更新対策(メンテナンスゲート方式)](0019-caremanager-group-backfill-maintenance-gate.md) — `--seed-aggregation-states`の移行手順で同じメンテナンスゲート機構を再利用
- Issue #664: documents create/delete順序不同配信によるphantom count(本ADRで解消)
- `functions/src/utils/groupAggregation.ts` (`buildContribution`/`diffContribution`/`aggregationStateRef`)
- `functions/src/triggers/updateDocumentGroups.ts` (`processDocumentAggregationEvent`)
- `functions/test/updateDocumentGroupsIdempotencyIntegration.test.ts`
- `scripts/migrate-document-groups.js --seed-aggregation-states`
