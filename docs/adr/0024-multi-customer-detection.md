# ADR-0024: 複数人記載FAX検出機能(複数顧客FAX複製機能の縮退版)

## Status

Accepted (2026-08-30)。plan-crossreview（grip自白可視化 + codex 2パス独立診断）を経て設計確定、
decision-maker承認済み。PR-A実装完了。**Stage1〜2完了、kanameoneで複製機能を廃止済み**
（詳細は下記「ロールアウト実績」参照）。

## Context

kanameoneから仕様変更依頼が届いた。1つのFAXに複数名が記載されている場合、現状は複数顧客FAX複製機能
（`faxDuplication`、`functions/src/ocr/faxDuplication.ts`、2026-07-17導入）が検出人数分docを複製して
一覧に並べているが、複数の職員が同時に分割作業を行いファイルが重複する事故が起きた。先方は「分割業務の
専任担当者」を配置する体制に変えたため、この複製処理は不要になった。代わりに「複数人が記載されたファイル
だと一目で判別でき、まとめて抽出できる表示」が欲しい、というのが依頼内容。

複製機能はkanameone専用機能として実装されている一方、cocoroは2026-07-24前後にdecision-maker明示指示で
同機能を既に有効化済み（`docs/handoff/LATEST.md`）。「複製はkanameone専用でcocoroは無関係」という前提は
現状と一致しないため、本対応が明示的に操作するのはkanameoneの設定のみとし、cocoroの複製挙動には一切
触れない。

## Decision

### フラグを2つに分ける

既存`faxDuplication`は現状維持、新設`multiCustomerDetection`で検出バッジ表示を制御する。「複製を止める」
と「バッジを出す」は直交する関心なので分離した。決定打は**併走ステージ**が作れること — 複製ONのまま検出
だけONにして、「検出集合 == 複製発火集合」を本番データで実測してから複製を止められる。ロールバックも独立
する。既存フラグの意味を変える案（複製ロジックの転用）は、`set-feature-flag.js`の実行履歴・GHAの
choice文字列・テストの`flagDisabled` reason・GOAL.mdの運用記録がすべて「複製」の意味で固定されており、
意味を変えると過去のログが読めなくなるため却下した。

複製ロジックのコードは削除しない。ロールバック手段になり、ADR-0009「オプション機能は汎用的に設計する」
に沿って他テナント向け資産として残る。

### 検出基準は複製発火条件と厳密に同一

`matchType === 'exact' && !isDuplicate && !sameNameCollisionNames.has(name.trim())` をcustomerIdで
dedupして2件以上。候補フィルタ本体は`shared/multiCustomerDetection.ts`の
`selectDistinctExactCandidates()`へ切り出し、`functions/src/ocr/faxDuplication.ts`の
`planFaxDuplication()`はこの共有関数を内部で呼ぶ形にリファクタした（シグネチャ・reason enum・戻り値は
完全維持、`functions/test/faxDuplication.test.ts`は無改変で全パス）。両者のparityは
`functions/test/multiCustomerDetection.test.ts`が既存フィクスチャ全パターンで契約テストする。

`hasMultipleCandidates`（`extractors.ts`）はexact/fuzzyを区別せず数えるため流用しない。本文中にたまたま
別の人名が出ただけのファイルまで「複数人」と表示してしまうため。

### 新フィールドは既存doc へbackfillしない(FE側で導出する設計は今回スコープ外)

`multiCustomerDetected`(boolean)・`multiCustomerCount`(number)を`shared/types.ts`の`Document`に追加。
検出時true、非検出時も明示的にfalse（フィールド不在にしない）。フラグOFF時はキー自体を書き込まない
（false すら書かない）ため、無効テナント（cocoro/dev）の書込みペイロードは今日と完全に同一のまま。

既存doc（複製フラグ導入前の古いdoc含む）へのFE側導出フォールバック（`customerCandidates[]`から同じ述語
を再計算する案）は、plan-crossreview（codex指摘）でPR-Cとして構想したが、**初回リリースからは除外**した。
理由: FEは現在`settings/features`を一切読んでおらず、この導出ロジックをテナントフラグでゲートしない限り
`multiCustomerDetection`がOFFのテナント（cocoro等）にもバッジが表示されてしまうリスクがあるため。
Stage3（棚卸し実行）で対象件数を実測してから再導入を別途判断する。

## Consequences

- kanameoneでは複製が止まり、一覧で「複数名の可能性 (N名)」が判別・抽出できる。cocoroを含む他テナントは
  今回の操作を一切受けず今日と同じ挙動のまま
- 複製フラグ導入(2026-07-17)より前に蓄積された既存docにはバッジが表示されない制約が残る（PR-C見送りの
  トレードオフ）
- Stage2（kanameoneの複製OFF切替）は、ADR-0019のメンテナンスゲート機構
  （`system/maintenanceFlags.groupAggregationGateOpen`）を流用して`processOCR`を一時停止し、切替の瞬間に
  複製が1件も発生しないことを保証する。当初「Gmail取込トリガーを一時停止する」案を検討したが、
  `checkGmailAttachments`を止めても既にpending状態のdocは`processOCR`でOCR処理が継続され複製ロジックが
  発火するため的外れと判明し、この既存ゲートへの流用に訂正した

## ロールアウト実績（2026-08-30）

**Stage 1（kanameone併走、8/29〜8/30）**: `multiCustomerDetection`フラグをON（`faxDuplication`はtrueのまま併走）にしてから約1.5日で検出サンプル91件（document単位）/20件（グループ単位）に到達し、AC-9の最低条件（5件以上）を満たした。Cloud Loggingで`faxDuplicationPlan`ログの`reason: exactCandidatesDistributed`件数（フラグON後）を実測したところ20件で、棚卸しスクリプトの「検出も伴う複製グループ数」（20件）と完全一致。「検出のみで複製されなかった」doc数も0件だった。両方向で不一致ゼロを確認し、「検出集合 == 複製発火集合」を本番データで実測できた。

**Stage 2（kanameone複製OFF切替、8/30 12:55〜13:20 UTC）**: 上記Decision節記載の手順通り実施。①`system/maintenanceFlags.groupAggregationGateOpen`を`false`に設定 ②20分ドレイン待機（ADR-0019のバリア方式を踏襲）③`documents`の`status:processing`件数が0件であることを確認 ④`set-feature-flag --flag faxDuplication --value false`をdry-run確認後に本実行 ⑤ゲートを`true`に戻す。ゲート閉鎖時間は合計約25分。切替後、`settings/features.faxDuplication: false`を実測確認済み。

**Stage 3（棚卸し結果、`audit-fax-duplication-inventory`、kanameone、8/30時点）**:

| 指標 | 値 |
|---|---|
| スキャン対象doc数 | 3,203件 |
| 複製グループ数（`distributionId`を持つ） | 1,016グループ |
| グループサイズ分布 | 1名:46 / 2名:566 / 3名:154 / 4名:71 / 5名:46 / 6名:33 / 7名:31 / 8名:23 / 9名:10 / 10名:36 |
| 元doc欠落グループ | 23件 |
| Drive出力済みメンバーを含むグループ数 | 747グループ（totalDriveExportedMemberCount: 1,566件） |
| 検出（`multiCustomerDetected:true`）doc数 | 91件 |

「Drive出力済みメンバーを含むグループ数」（747グループ）は、PR-C（既存doc向けFE導出フォールバック）の再導入要否を判断する際の入力として記録する。複製フラグ導入（2026-07-17）より前に蓄積された既存docのうち、既にDrive出力済みのものが大部分を占める場合、バッジ表示の恩恵を受けられない既存docの規模がそれだけ大きいことを意味する。

**未検証項目**: Stage2切替後、実際に新しい複数人記載FAXが到着した際の最終挙動確認（複製されず検出バッジのみになること、Cloud Loggingで`reason: flagDisabled`になること）は、8/30時点でまだ到着実績がなく未実施。次回到着時に確認する。

## 関連

- [ADR-0009: Feature Flags Per Client](./0009-feature-flags-per-client.md)
- [ADR-0019: 担当CM別集計バックフィルの並行更新対策(メンテナンスゲート方式)](./0019-caremanager-group-backfill-maintenance-gate.md) — Stage2で流用するゲート機構
- [ADR-0022: Google Drive Export](./0022-google-drive-export.md) — feature flag + allowlist設計の先例
- `shared/multiCustomerDetection.ts` / `functions/src/ocr/faxDuplication.ts` / `functions/test/multiCustomerDetection.test.ts`
- 承認済みプラン: `~/.claude/plans/merry-drifting-seal.md`
