# 監視基盤セットアップ運用手順

Issue #220 + ADR-0015 Follow-up で構築した log-based metric + Cloud Monitoring alert policy の運用手順。

## 構成概要

- **11 種メトリクス** (log-based) を各環境で作成 (うち`processocr_error`・`search_index_write_degraded`は`lifecycle: temporary`、review_by到達後に削除/恒久化を再判断)
- **11 種アラートポリシー** (Cloud Monitoring) をメトリクスと対になる形で作成
- **通知チャネル** 1 つ (email、環境ごと) を作成し全ポリシーで共有

関連コード:
- `scripts/setup-log-based-metrics.sh`: 作成 (冪等: 既存の metric / alert policy は既定で変更しない、`--dry-run` 対応)
- `scripts/teardown-log-based-metrics.sh`: 削除 (policies → metrics → channel の順)
- `scripts/monitoring-templates/`: alert policy YAML テンプレート
- `.github/workflows/setup-monitoring.yml`: workflow_dispatch 実行基盤

## メトリクス仕様

| メトリクス | ログフィルタ | 閾値 | 閾値根拠 |
|---|---|---|---|
| `searchindex_oom` | `ondocumentwritesearchindex` の "Memory limit exceeded" | 1h 以内に 1 件以上 | PR #218 で 0 件維持、再発即異常 |
| `ocr_page_truncated` | `[OCR] ... text truncated` (WARN) | 24h 以内に 3 件以上 | 過去30日実績 0.067件/日の約45倍 |
| `ocr_aggregate_truncated` | `[OCR] Aggregate pageResults truncated` (WARN) | 24h 以内に 1 件以上 | per-page 二段目発動は異常 |
| `summary_truncated` | `[Summary] truncated` (WARN) | 24h 以内に 1 件以上 | Issue #209 再発指標 |
| `search_index_silent_failure` | `Failed to remove tokens` (`console.error`出力、severity条件なし: Cloud LoggingでDEFAULT severityのため、Issue #981) | 24 時間窓で 1 件以上 (incident は 7 日間可視化) | ADR-0015 再評価トリガー条件1 (`#220 metric で severity=ERROR ログが 7日間に 1件以上発生`) を反映。GCP API 制約 (alignmentPeriod 最大 25h) のため厳密な 7 日 rolling ではなく、`autoClose: 7d` で incident 可視性を 7 日担保 |
| `drive_folder_divergent` | `[driveFolderClaim] claim divergent detected` | 24 時間窓で 1 件以上 (incident は 7 日間可視化) | Issue #871 恒久対応。claim と Drive 実体の食い違い(新規発生)を検知。実績: 約2.5週間で2件、発生自体が異常 |
| `drive_folder_divergent_record_failed` | `divergent記録に失敗しました` | 24 時間窓で 1 件以上 (incident は 7 日間可視化) | Issue #871 恒久対応。`markDivergent()`自体のFirestore書込み失敗は claim にもメトリクスにも残らない経路があるため高優先度 |
| `claim_divergent_backlog_stale` | `[driveFolderClaim] divergent backlog stale` (`console.warn`出力、severity条件なし: Cloud LoggingでDEFAULT severityのため、Issue #981。`driveFolderClaimDivergentSweep`日次関数が出力) | 24 時間窓で 1 件以上 (incident は 7 日間可視化) | Issue #871 恒久対応。「新規発生」検知だけでは既存の未解決分の**放置**を検知できないギャップを埋める。3日以上未解決の divergent が残っている場合のみ日次で1回発火 |
| `processocr_completed` | `OCR processing (polling) completed`(`processOCR`、正常終了時に必ず出力) | **absence**条件: 20分間ログが出現しない | ADR-0025 PR6。`processOCR`に`concurrency:1`を導入(tick重複防止)したことに伴い、原因を問わずOCR処理パイプライン全体が停止している状態を検知する健全性監視。他メトリクスと異なり閾値超過ではなく**ログの欠落**を検知する点に注意(`conditionAbsent`、`conditionThreshold`ではない)。閾値20分(1200s)は「1サイクル最大900秒(`PROCESS_OCR_TIMEOUT_SECONDS`) + 次tickまでの待ち最大60秒」=最大960秒という**正当な**間隔に対して十分なマージンを取った値(Issue #966 H1、当初600sは900秒タイムアウトと矛盾し誤発火しうると判明したため修正) |
| `search_index_write_degraded` | `[searchIndexer] token skipped: document size limit` または `[searchIndexer] index write failed`(`ondocumentwritesearchindex`、いずれも引数1個の単一文字列の `console.error`。severity 条件なし) | 24 時間窓で 1 件以上 (incident は 7 日間可視化) | Issue #984。高頻度トークン(`"2026"` 等)の `search_index` 文書が 1MiB 上限に達したスキップ、および判定関数が外れた場合の未分類の書込み失敗を検知。**kanameone では段階2まで常時 open が正常**(SOP は下記「Issue #984」節)。`lifecycle: temporary`、`review_by: 2026-10-31` |
| `processocr_error` | `Error processing document`(`processOCR`のみ、`ocrProcessor.ts` `handleProcessingError`が無条件出力) | 1h 以内に 1 件以上 | ADR-0025 PaddleOCR Pass1全面切替(2026-09-19)後の一時的事後監視(`lifecycle: temporary`、`review_by: 2026-10-03`)。severity条件は付けない(`console.error()`はfirebase-functions/logger未使用のためCloud Loggingで自動的にERROR severityへ昇格されずDEFAULTのまま記録される実測を確認済み。当初`severity="ERROR"`を含めていたが構造的に一致しない欠陥がありPR #980で修正)。`Error processing document`はtransientエラー(自動リトライで最終的に成功する一時失敗)でも無条件出力されるため「status:error確定」そのものではない点に留意。有効化前の実データ確認(直近30日)は3環境とも該当ログ0件で陽性検証材料なし |

### アラートポリシー共通パラメータ

- `duration`: 0s (閾値超過で即発火)。例外: `processocr_completed`はabsence条件のため`duration: 1200s`(上表参照)
- `autoClose`:
  - 標準 (`searchindex_oom` / `ocr_*_truncated` / `summary_truncated` / `processocr_completed` / `processocr_error`): 86400s (24h 無発火で自動クローズ)
  - `search_index_silent_failure` / `search_index_write_degraded` / `drive_folder_divergent` / `drive_folder_divergent_record_failed` / `claim_divergent_backlog_stale`: 604800s (7 日間) — 放置検知のため長めに取る
- `notificationRateLimit`: **未設定**。Cloud Monitoring API の仕様により metric-based alert policy では指定不可（log-based policy 限定）。metric alert は incident オープン時 1 通のみ送信、`autoClose` まで再通知されないため通知暴走リスクは元々低い
- **検出遅延**:
  - `searchindex_oom` (alignment 1h): 約 3-5 分
  - `ocr_*_truncated` / `summary_truncated` (alignment 24h): 数分〜最大数時間 (Cloud Monitoring の rolling 評価依存)
  - `search_index_silent_failure` (alignment 24h): 同上、即時検知には向かない
  - `processocr_completed` (**absence条件**、他9種と異なり閾値超過ではなくログの欠落を検知。`alignmentPeriod:60s`・`duration:1200s`): 約20-21分。「1サイクル最大900秒+次tickまでの待ち最大60秒」という正当な最大間隔(960秒)に対して十分なマージンを取った設計
  - `processocr_error` (alignment 1h): 約3-5分

ADR-0015 要件「5 分以内」は `searchindex_oom` のみ厳密に満たす。他は「日次で必ず検出」を目標とする。
ADR-0015 要件「7 日間に 1 件以上」は metric alignment では厳密には表現できないため、`autoClose: 7d` による incident 継続可視化で実運用上の監査表現を代替する。より厳密な weekly 集計が必要な場合は scheduled query / health-report 等で別途担保する。

## 運用手順

### 初回セットアップ

**GitHub Actions 経由 (推奨)**:
1. Actions → "Setup Monitoring (log-based metrics + alerts)"
2. `environment`: 対象環境を選択
3. `action`: `setup`
4. `notification_email`: 通知先アドレス (HEALTH_REPORT_TO と同一推奨)
5. Run workflow

**ローカル実行 (トラブルシューティング時)**:
```bash
./scripts/setup-log-based-metrics.sh <project-id> <notification-email>
# 例: ./scripts/setup-log-based-metrics.sh docsplit-kanameone alerts@example.com
```

### Dry-run (構文検証)

本番前の動作確認。**リソース作成はスキップするが、既存確認の `gcloud describe/list` 呼び出しは実行する** (権限エラー時は dry-run でも失敗する)。
```bash
./scripts/setup-log-based-metrics.sh <project-id> <notification-email> --dry-run
```

未知の引数 (例: `--dryrun`, `-n`, `--DRY-RUN`) は reject される (typo による silent 作成防止)。

### 冪等性

スクリプトは既存リソースがあれば既定では変更せず skip する。再実行しても副作用なし。

- **alert policy**: 更新は自動では行われない。変更する場合は先に teardown が必要。
- **log-based metric**: 既存 metric の filter が定義と食い違う場合は警告を出して skip する(#981)。反映するには `UPDATE_EXISTING_METRICS=1` を付けて再実行する(差分のある metric のみ `gcloud logging metrics update` で更新。`--dry-run` で事前確認できる)。alert policy は `metric.type` を参照するため、metric の filter 更新だけなら policy の変更は不要。
- 上記の `UPDATE_EXISTING_METRICS=1` は**ローカル実行のみ**対応。GitHub Actions (`setup-monitoring.yml`) にはこの環境変数を渡す入力がない。特定 metric だけを更新する場合は `gcloud logging metrics update <name> --log-filter=...` を直接使ってもよい。

### ロールバック / 削除

**GitHub Actions**:
- `action`: `teardown` を選択して実行

**ローカル**:
```bash
./scripts/teardown-log-based-metrics.sh <project-id> [--yes]
```

削除順序: **policies → metrics → channel** (依存関係の逆順)。

### 確認コマンド

```bash
# メトリクス一覧
gcloud logging metrics list --project=<project-id> \
  --filter='name=(searchindex_oom OR ocr_page_truncated OR ocr_aggregate_truncated OR summary_truncated OR search_index_silent_failure OR drive_folder_divergent OR drive_folder_divergent_record_failed OR claim_divergent_backlog_stale OR processocr_completed OR processocr_error)'

# アラートポリシー一覧 (user_labels で本 script が作成したもののみ識別)
gcloud alpha monitoring policies list --project=<project-id> \
  --filter='userLabels.source="docsplit-monitoring-setup"'

# 通知チャネル
gcloud alpha monitoring channels list --project=<project-id> \
  --filter='displayName:"DocSplit Monitoring Alerts"'
```

## 必要な権限

**初回セットアップを実行する SA または ユーザーアカウント**:
- `roles/logging.configWriter` (log-based metric 作成)
- `roles/monitoring.alertPolicyEditor` (alert policy 作成)
- `roles/monitoring.notificationChannelEditor` (notification channel 作成)
- `roles/serviceusage.serviceUsageConsumer` (API 利用)

**既存の `docsplit-cloud-build@<project>.iam.gserviceaccount.com` の権限**:
```
roles/logging.logWriter
```
→ **configWriter を含まないため、本セットアップは実行不可**。

### 権限不足の解消手順

**オプション 1: 既存 SA に 3 roles 追加** (最小変更、ただし deploy SA が監視変更権限を持つ副作用):
```bash
PROJECT_ID=docsplit-kanameone
SA="docsplit-cloud-build@${PROJECT_ID}.iam.gserviceaccount.com"

for role in \
  roles/logging.configWriter \
  roles/monitoring.alertPolicyEditor \
  roles/monitoring.notificationChannelEditor; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$SA" --role="$role"
done
```

**オプション 2: 専用 SA 新規作成** (最小権限原則、採用方針):
- SA 名: `docsplit-monitoring-admin@<project>.iam.gserviceaccount.com`
- 上記 3 roles のみ付与 (`roles/logging.configWriter`, `roles/monitoring.alertPolicyEditor`, `roles/monitoring.notificationChannelEditor`)
- キー発行 → GitHub Secrets に登録
- `setup-monitoring.yml` の `credentials_json` は以下の Secret を参照する:
  - `MONITORING_SA_KEY_DEV` (dev)
  - `MONITORING_SA_KEY_KANAMEONE` (kanameone)
  - `MONITORING_SA_KEY_COCORO` (cocoro)

### セットアップ手順 (環境ごとに 1 回)

```bash
# 1. SA 作成
gcloud iam service-accounts create docsplit-monitoring-admin \
  --display-name="DocSplit Monitoring Admin (log-based metrics + alerts)" \
  --project=<project-id>

# 2. 3 roles 付与
SA="docsplit-monitoring-admin@<project-id>.iam.gserviceaccount.com"
for role in \
  roles/logging.configWriter \
  roles/monitoring.alertPolicyEditor \
  roles/monitoring.notificationChannelEditor; do
  gcloud projects add-iam-policy-binding <project-id> \
    --member="serviceAccount:$SA" --role="$role" --condition=None --quiet
done

# 3. キー発行 → Secret 登録 → 鍵ファイル削除
gcloud iam service-accounts keys create /tmp/monitoring-sa.json \
  --iam-account=$SA --project=<project-id>
gh secret set MONITORING_SA_KEY_<ENV> --repo yasushi-honda/doc-split \
  < /tmp/monitoring-sa.json
rm /tmp/monitoring-sa.json
```

### 展開状況

- ✅ dev: SA + Secret + setup 完了 (2026-04-17 session6, 5 metrics + 5 alert policies + 1 channel 稼働中)
- ✅ kanameone: SA + Secret + setup 完了 (2026-04-17 session7, Run ID `24547741800`, 5 metrics + 5 alert policies + 1 channel 稼働中、通知先 `hy.unimail.11@gmail.com`)
- ✅ cocoro: SA + Secret + setup 完了 (2026-04-17 session7, Run ID `24548562806`, 5 metrics + 5 alert policies + 1 channel 稼働中、通知先 `hy.unimail.11@gmail.com`)
- ✅ 2026-09-20 (Issue #981 / PR #985): dev / cocoro / kanameone の `search_index_silent_failure` と `claim_divergent_backlog_stale` の filter から severity 条件を除去(`gcloud logging metrics update` で in-place 反映、alert policy は無変更)。`console.error` / `console.warn` は gen2 の Cloud Logging で DEFAULT severity のため、旧 filter は一致しなかった
- ⏳ Issue #871 恒久対応で追加した3種（`drive_folder_divergent`/`drive_folder_divergent_record_failed`/`claim_divergent_backlog_stale`）は**PR時点では未適用**。スクリプトは冪等なので、各環境で `setup-log-based-metrics.sh` を再実行すれば既存5種はskipされ新規3種のみ追加される（ロールアウト §1 参照）

## 通知先の調整

Cloud Monitoring の notification channel の email アドレスを変更する場合:
1. 対象 channel の ID を特定 (上記確認コマンド)
2. `gcloud alpha monitoring channels update <CHANNEL_ID> --update-channel-labels=email_address=<new-email> --project=<project>`

または teardown → setup で再作成。

## gcloud alpha 依存について

本 script は `gcloud alpha monitoring` (channels/policies) を使用している。2026-04-16 時点の `gcloud` CLI では Cloud Monitoring の `channels` / `policies` サブコマンドは GA 化されておらず alpha track のみ利用可。alpha は予告なく変更される可能性があるため:

- 定期的に `gcloud beta monitoring` または `gcloud monitoring` の利用可能性を確認する
- 破壊的変更があった場合は本 script を更新する
- 代替手段として Google Cloud Monitoring API (REST / gRPC) 直接呼び出しも検討可能

## Issue #871: Drive フォルダ乖離(divergent)の検知〜解決 運用 SOP

`driveFolderLocks` の claim と Drive 実体が食い違う `divergent` 状態は、人手介入なしでは絶対に解消されない(TTL 対象外、§出典: ADR-0022 決定4追記)。以下の手順を形骸化させないため、承認経路・棚卸し・昇格基準を明文化する。

### 検知〜解決フロー

1. **新規発生の検知**: `drive_folder_divergent` アラート発火(24h窓・1件以上)。または `claim_divergent_backlog_stale` アラート(3日以上未解決の滞留)で既存分の放置に気づく
2. **一覧化(read-only)**: GitHub Actions "Run Operations Script" → `classify-drive-claim-divergence` を実行し、Plan(推奨 resolution・プリフライト結果込み)を artifact として取得
3. **承認**: Plan の内容(推奨 mode・claim グラフ衝突・stranded 件数)を人間が確認し、`exec_args_json` に `{planRunId, approvedOperations: {opId: {mode, acknowledgedStrandedFiles?}}}` を明示指定する
4. **実行**: `execute-drive-claim-resync` を `--execute --requeue` 付きで実行(dry-run 先行を推奨)。Drive 先→Firestore 後の順で書き込み、rollback manifest が artifact として残る
5. **確認**: 対象 document の `driveExportStatus` が `exported` に遷移したことを確認する

### 形骸化防止条項(MUST)

- **承認は必ず `classify-drive-claim-divergence` が発行した `planRunId` 経由のみ**で行う。`folderId` を直接指定する自由入力の実行経路は作らない(誤操作・スコープ外操作の防止)
- 承認は必ず GitHub Actions 経由で行う。**Firestore コンソールでの直接編集はコードでは防止できない**ため、`driveFolderLocks` への書込み権限を持つアカウントを定期棚卸しし最小化する。緊急時にやむを得ず直接操作した場合は、事後に `resyncHistory[]` 相当の記録を手動で追記し、次回棚卸しで必ず申告する
- 人手棚卸し時は claim ドキュメントの `resyncHistory[]`(直近20件)を確認し、**同一顧客/ケアマネで繰り返し divergent が発生していないか**を確認する。繰り返し発生は個別 resync だけでは対処しきれない業務フロー側の問題を示唆する
- **月間発生件数が閾値(目安: 3件)を超えたら、個別 resync ではなく根本原因レビュー**(なぜ手動操作が発生しているか、業務フロー側の見直し)を起動する。`divergentReason` 別の発生件数を計測し、閾値超過の判断材料とする(「未判定フォルダの export ゲート未実装」が直接原因と断定できる根拠は現時点でないため、原因を決め打ちしない)
- `driveFolderLocks` への書込みは `functions/src/drive/driveFolderClaim.ts` モジュール内の関数経由に限定する規約とし、新規の書込み経路を追加する PR レビュー時は `grep -rn "collection('driveFolderLocks')\|FOLDER_LOCKS_COLLECTION" functions/src` で同ファイル以外からの直接アクセスがないことを確認する

### UI 化への昇格基準

現状はアプリ内 UI を作らず ops-script + GitHub Actions での承認に留める。以下のいずれかを満たした場合、アプリ内 UI 化を別途計画する:

- divergent の発生率が**月数件以上**で恒常化した場合
- 承認担当者がエンジニア以外(現場担当者等)に拡大する必要が生じた場合

### 既知の未実装事項

- Firestore Audit Log(`protoPayload.serviceName="firestore.googleapis.com"`)による `driveFolderLocks` への直接書込み検知は、詳細な log filter 設計を含めて未実装。GHA 経由以外からの書込みを継続的に自動検知する仕組みは今後の課題とし、当面は上記「承認は必ず GitHub Actions 経由」の運用ルール(権限棚卸し + 緊急時の事後申告)で代替する

## Issue #984: 検索インデックスの高頻度トークン飽和(`search_index_write_degraded`)運用 SOP

`search_index/{tokenId}` は1トークン=1ドキュメントに全書類の postings を詰める設計のため、高頻度トークンが
Firestore の 1MiB 上限に達する。`ondocumentwritesearchindex` は、サイズ超過のトークンだけをスキップして
他のトークンを登録する(それ以前は書類の全トークンが未登録になっていた)。

- **`token skipped: document size limit` のログ**: `docId=` `skipped=` `tokenIds=` を含む1書類1行。`tokenIds=` が飽和したトークンの ID。
- **kanameone の既知の飽和トークン**: `00177502`(`"2026"`)。段階2(postings のシャーディング等)が済むまで、2026 年の新規書類のたびにスキップが出て、アラートは**常時 open が正常**。
- **新規飽和の読み方**: アラートの有無ではなく、ログの `tokenIds=` に**これまで出ていなかった tokenId** が現れたかを見る。
  ```bash
  gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="ondocumentwritesearchindex" AND textPayload:"[searchIndexer] token skipped"' \
    --project=<env-project-id> --freshness=1d --limit=200 --format='value(textPayload)' | grep -o 'tokenIds=[^ ]*' | sort | uniq -c | sort -rn
  ```
- **`index write failed` が出た場合**: サイズ超過と判定できなかった失敗。`code=` `message=` を確認し、サイズ超過の判定関数(`functions/src/utils/firestoreErrors.ts` の `isFirestoreDocumentSizeExceededError`)の文言が SDK/バックエンドの変更で外れていないかを疑う。
- **スキップされた書類**: そのトークンでは検索にヒットしない(他のトークンでは検索可能)。`documents.search.skippedTokens` にスキップしたトークン文字列が保存される。
- **`search.tokenHash` の読み方が変わる**: `tokenHash` 保存済み = 全トークン登録済み、ではない。`force-reindex --all-drift` の `drift: 0` と、`scripts/backfill-detail-subcollection.ts --audit` の `tokenHash` 欠落数は「ハッシュ保存済みか」を示すのであり、スキップの有無は `search.skippedTokens` で確認する。

## 関連ドキュメント

- [ADR-0015](../adr/0015-search-index-silent-failure-policy.md): silent failure 対処方針
- [ADR-0022](../adr/0022-google-drive-export.md) 決定4: Drive フォルダ乖離(divergent)の恒久出口・承認付き再同期ワークフロー(Issue #871)
- Issue #220: log-based metric + alert (本タスクの起票元)
- Issue #229: 復旧 SOP + force reindex (ADR-0015 Follow-up)
- Issue #217 / PR #218: OOM 応急対処 (searchindex_oom の対象)
- Issue #205 / PR #208: OCR 切り詰め防御 (ocr_*_truncated の対象)
- Issue #209 / PR #212: summary 切り詰め防御 (summary_truncated の対象)
- Issue #219 / PR #222: silent failure 監視可能化 (search_index_silent_failure の対象)
- Issue #871: Drive フォルダ乖離(divergent)の恒久対応(承認付き再同期ワークフロー)
