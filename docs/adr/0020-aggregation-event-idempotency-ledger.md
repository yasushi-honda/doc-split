# ADR-0020: 集計トリガー(onDocumentWrite)のイベント冪等台帳による非冪等性修正

## Status

Accepted (2026-07-15, session131)。`/impl-plan`フルモード+`/codex plan`セカンドオピニオン(初期案の却下・訂正1往復)を経て設計確定。実装完了。

## Context

### 背景・発見の経緯

GOAL.md タスクG(ADR-0019、担当CM別集計「CM未設定」グループのバックフィル)のkanameone本番実行(2026-07-15)後、Runbook Step 4の検証(`diagnose-caremanager-group-gap.js`)で、既存の実在CMグループ8件において`documentGroups`の実測countとdocuments生データから再計算した期待値の間に持続的な(約14.5分後の再検証でも1件も変化しない)不一致を発見した。特に`careManager_奥村敬子`は期待40件に対し実測80件と、正確に2倍という強い二重計上のシグネチャを示した。

当初「`onDocumentWrite`の自己書込み(`needsKeyUpdate`時の正規化キー更新)による自己再帰トリガーが二重計上を引き起こしている」という仮説を立てたが、`/codex plan`セカンドオピニオン(threadId `019f6334-58c2-7f11-9950-51182f124745`)でコードを行単位で追跡した結果、この仮説は棄却された。自己書込みによる再発火(呼出しB)は、`beforeData`/`afterData`両方を`generateGroupKeys()`で生フィールドから再正規化するため差分が実質ゼロになり、`getAffectedGroups()`の早期return(`isAggregationUnchanged()`)で`Updated 0 groups`となる。kanameoneのCloud Loggingで観測したログ順序もこの動作と完全に一致しており、自己再帰トリガー自体は無害と判明した。

真の原因は、`functions/src/triggers/updateDocumentGroups.ts`の`onDocumentWrite`ハンドラ全体が**イベント単位で冪等でない**ことにある:
- Firestore/EventarcはCloudEventをat-least-once配信するため、同一イベントが複数回配信されうる
- `updateGroupAggregation()`をaffected group(最大4件)ごとに独立した`Promise.all()`+個別トランザクションで呼んでいたため、一部のグループ更新が成功した後に別のグループ更新が失敗して関数全体がエラーになりCloud Functionsにリトライされると、既に成功していたグループにもdeltaが再適用される

### 却下した初期修正案

`documents/{docId}`に`lastAggregationEventId`フィールドを1件だけ持たせ、直近処理済みのevent.idと比較する案を最初に設計したが、`/codex plan`セカンドオピニオンで以下の欠陥を指摘され却下した:

1. **順序不同の再配信を防げない**（本ADRの核心的な却下理由）: イベントA処理後にイベントBを処理し(`last=B`)、その後Aが遅れて再配信されると`last=B≠A`となり、誤ってAを再適用してしまう。単一の「直近1件」を覚える方式は、配信順序が保証されない環境では原理的に不十分
2. deleteイベントでは`documents/{docId}`が存在せず、マーカーを書く場所がない
3. `lastAggregationEventId`自体をdocumentsに書き込むため、必ず新たな`onDocumentWritten`イベントを誘発する。当初「単一トランザクションに統合すれば自己再帰が消える」と考えたが、これは誤りだった。Firestoreトリガーはトランザクション経由の書込みかどうかを問わず、コミットで発火するため、自己再帰を「排除」することは原理的にできない（既存の`isAggregationUnchanged()`早期returnによる「安全な有限no-op」設計を維持し続けるのが正しい扱いであり、変更不要と判断した）

## Decision

### 採用design: 独立コレクションによるイベント冪等台帳

`documentAggregationEvents/{event.id}`を新設し、event.idごとに独立したドキュメントとして処理済みマーカーを記録する。これにより配信順序に依存せず、各イベントを厳密に一度だけ処理できる。

```
documentAggregationEvents/{eventId}
  source: string       // CloudEvent.source
  subject?: string     // CloudEvent.subject
  eventTime: string    // CloudEvent.time
  processedAt: Timestamp (serverTimestamp)
  expireAt: Timestamp  // TTL、処理時刻+30日
```

### メカニズム

`onDocumentWrite`ハンドラの集計反映部分を単一の`db.runTransaction()`に統合する(`functions/src/triggers/updateDocumentGroups.ts`の`processDocumentAggregationEvent()`):

1. **read phase**: `transaction.getAll(ledgerRef, ...groupRefs)`(公式API。複数の独立した`transaction.get()`呼出しの代わりに使用、affected groupは所属変更時に旧+新で最大8件)で、イベント台帳+全affected groupを一括読み取り
2. 台帳が既に存在すれば集計を再適用せず即return(重複配信・リトライを無視)
3. **write phase**: 全グループ更新(`applyAggregationDeltas()`) + 台帳`transaction.create()`を同一トランザクションでatomicに実行

**同時実行時の実際の保護機構**: 競合防止は`create()`のALREADY_EXISTS自体ではなく、read phaseで`ledgerRef`を`transaction.getAll()`の読み取りセットに含めている点に由来する。同一event.idの並行トランザクションが競合すると、Firestoreは一方を`ABORTED`として検出しSDKが自動リトライする(`@google-cloud/firestore`の`isRetryableTransactionError()`が`ABORTED`/`CANCELLED`/`UNKNOWN`/`DEADLINE_EXCEEDED`等をリトライ対象とする一方、`ALREADY_EXISTS`はリトライ対象に含まれない)。再読取り時には先勝ちしたトランザクションの台帳が既に存在するため、後発は`ledgerSnap.exists`でskipに回る(AC4で並行実行を実測済み)。`create()`(`set()`ではなく)の採用は、万一この楽観的並行制御をすり抜けるロジックバグがあった場合に`ALREADY_EXISTS`で明示的に失敗させる防御的アサーションであり、競合防止そのものの主機構ではない。

**集計差分は必ず`event.data.before`/`event.data.after`の凍結スナップショット(の正規化コピー)から計算する**。トランザクション内で「現在の」`documents`を再読込みして差分計算すると、配信順序が入れ替わった別イベントの状態を誤って基準にしてしまうため、この設計は必須（`/codex plan`指摘）。

既存のキー正規化自己書込み(`needsKeyUpdate`時の`documents/{docId}`への部分update)はそのまま維持し、変更しない。

### CloudEvent.idの安定性(設計の前提)

`event.id`が再配信間で同一に保たれることを前提にしている。この前提は以下で裏付けられる:
- `node_modules/firebase-functions/lib/v2/core.d.ts`の`CloudEvent<T>.id: string`(「A globally unique ID for this event」)
- Firebase公式ドキュメント「[Retry event-driven functions](https://firebase.google.com/docs/functions/retries)」: イベントIDはイベント固有であり、同一イベントの再試行では同一IDを用いて重複処理を防げる旨が明記されている

### `transaction.getAll()`の採用理由

`Promise.all(refs.map(r => transaction.get(r)))`でも動作する可能性は高いが、Node Admin SDK専用の`transaction.getAll(...refs)`API(`@google-cloud/firestore/build/src/transaction.js`)を採用した。read phaseを一回の明示的操作にでき、読み取り順序制約が明確になる。

## Consequences

### 得られたもの

- 同一event.idの二重(逐次/並行)配信、順序不同の再配信、delete再配信のいずれに対しても、集計が正しく1回分のみ反映されることをintegration testでlock-in(`functions/test/updateDocumentGroupsIdempotencyIntegration.test.ts`、AC1〜AC5)
- 一部グループの更新が失敗した場合、トランザクション全体がロールバックされ台帳も記録されないため、「部分成功状態」が残らない(Firestoreトランザクションのatomic性による)

### 残存リスク・今後の対応

- **過去に蓄積したドリフトの是正は本ADRのスコープ外**(GOAL.md タスクJ4)。`rebuildAllGroupAggregations()`による全件再構築は、本冪等性修正を全環境(dev/kanameone/cocoro)へ配備しドレインした後に実施すべきであり、配備前の実行は安全でない(全件再構築中もライブトリガーが動作していると、削除・ライブdelta・最終setが競合するため)
- トランザクション競合(同じcareManager等のホットグループを複数イベントが更新する場合、単一トランザクションへの統合により競合・リトライが増える可能性)は、正しさのために必要なトレードオフだが、本番デプロイ後にレイテンシ・abort率をログで監視することが望ましい
- TTL(30日)はFirestore/Eventarcの最大再試行期間を十分に上回る期間として設定した。コスト削減目的であり、短くしすぎて冪等性の保証を失わないこと

## 関連

- [ADR-0019: 担当CM別集計バックフィルの並行更新対策(メンテナンスゲート方式)](0019-caremanager-group-backfill-maintenance-gate.md) — 本ADRとは別レイヤーの対策(ADR-0019は「書込み元の一時停止」、本ADRは「トリガー適用の冪等性」)であり、両立する
- GOAL.md 派生ミッション(Issue #660) タスクJ1〜J4
- `functions/src/triggers/updateDocumentGroups.ts` (`processDocumentAggregationEvent`)
- `functions/src/utils/groupAggregation.ts` (`applyAggregationDeltas`/`buildGroupRefs`/`aggregationEventLedgerRef`/`buildAggregationEventLedgerEntry`)
- `functions/test/updateDocumentGroupsIdempotencyIntegration.test.ts`
