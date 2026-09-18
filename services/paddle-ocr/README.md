# PaddleOCR Cloud Runサービス

ADR-0025(PaddleOCR移行)のPR4: 自前ホスティングPaddleOCR(PP-OCRv6 medium)をCloud Run上でHTTPサービスとして提供する。詳細な意思決定の経緯は[`docs/adr/0025-paddleocr-migration.md`](../../docs/adr/0025-paddleocr-migration.md)を参照。

## 本サービスが証明すること/しないこと

- **証明すること**: 固定済みPaddleOCRモデル(重みSHA-256で同一性を担保)を使い、本番と同一の入力形式(PDF/JPEG/PNG/TIFF/GIF)・ページ分割経路でOCRを実行できること。
- **証明しないこと**: Cloud Run実機でのコスト・精度・レイテンシの定量評価。これはPR4c(`scripts/paddle-ocr-verify.ts`)の実測結果、およびPR6着手可否のゲート判定をもって成立する。実測値は本ファイル末尾に追記する。

## エンドポイント契約

### `GET /health`

> **命名の経緯(PR4b実機検証)**: 当初`/healthz`だったが、devのCloud Run実機で外部リクエストのみGoogle Frontend側の404で弾かれ続ける現象を確認した(内部のstartup/liveness probeからの疎通・末尾スラッシュ付き`/healthz/`は外部からも正常、新規revision作成でも再現、公式ドキュメントは外部到達可能と明記)。原因は特定できていない(未文書化のGoogle側インフラ挙動の可能性)が、回避策として`/health`に変更した。詳細は下記「Cloud Run liveness probeによるインスタンス強制入れ替え」節。

```json
{
  "status": "ok",
  "engine": "paddleocr",
  "modelVersion": "PP-OCRv6_medium/det:<hash12>/rec:<hash12>",
  "renderDpi": 200,
  "imageDigest": "<deploy時に--set-env-varsで注入>",
  "modelLoaded": true
}
```

### `POST /ocr`

生バイナリbody。`Content-Type`は`application/pdf`/`image/jpeg`/`image/png`/`image/tiff`/`image/gif`の5種類のみ受理する(本番`functions/src/upload/uploadPdf.ts`の受理MIMEタイプと同期)。

```json
{
  "text": "1ページ目\n\n2ページ目",
  "pages": ["1ページ目", "2ページ目"],
  "pageCount": 2,
  "engine": "paddleocr",
  "modelVersion": "PP-OCRv6_medium/det:<hash12>/rec:<hash12>",
  "lang": "japan",
  "renderDpi": 200,
  "processingMs": 1234
}
```

**契約上の重要な決定**: `text`は常に`pages.join("\n\n")`(ページヘッダなし)。本番の`ocrProcessor.ts:356-359`がFunctions側で`--- Page N ---`ヘッダを付けるため、サービス側で付けると二重になる。本番は常に1ページずつ送るため、実運用では`text === pages[0]`になる。

エラー時は`{"error": {"code": "...", "message": "...", "limit": <任意>, "actual": <任意>}}`。

| HTTPステータス | code | 意味 |
|---|---|---|
| 400 | `EMPTY_BODY` | リクエストbodyが空 |
| 413 | `PAYLOAD_TOO_LARGE` | `MAX_UPLOAD_BYTES`超過 |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | 未対応のContent-Type |
| 422 | `PAGE_LIMIT_EXCEEDED` / `PIXEL_LIMIT_EXCEEDED` / `INVALID_PDF` / `INVALID_IMAGE` | 入力データ自体の問題 |
| 500 | `OCR_ENGINE_ERROR` | エンジン異常 |
| 504 | `PROCESSING_TIMEOUT` | 処理時間超過(入力由来ではないため、422ではなく504としリトライ対象にする) |

## モデル同一性担保

`expected-model-hashes.json`にHugging Faceリポジトリのimmutable revisionと重み本体3ファイル(`inference.json`/`inference.pdiparams`/`inference.yml`)のSHA-256を固定している。値は[`scripts/fixtures/paddle-ocr-golden/manifest.json`](../../scripts/fixtures/paddle-ocr-golden/manifest.json)の実測値(24文書PoCで94/96正解を出した重みそのもの)と同一。`download_models.py`がビルド時にこのrevisionから取得・検証し、`ocr_engine.py`が起動時に再検証する(fail-loud)。

値を変更する場合は`scripts/generate-paddle-ocr-golden-text.py`をローカル再実行して精度を再検証し、`manifest.json`と`expected-model-hashes.json`を同時更新すること(無検証での更新は禁止)。

## PR4a実装時の実機検証で判明した事項

- **linux/amd64でのmkldnn実行パスの不具合**: デフォルト設定(`enable_mkldnn`未指定)でamd64コンテナ上で推論を実行すると`(Unimplemented) ConvertPirAttribute2RuntimeAttribute not support [...]`(`onednn_instruction.cc`)で例外終了することを確認した(QEMUエミュレーション環境での検証、実Cloud Run実機での再現有無はPR4bで要確認)。`enable_mkldnn=False`で回避し、`ocr_engine.py`・`scripts/generate-paddle-ocr-golden-text.py`の両方に反映済み。mkldnnはCPU推論の高速化オプションであり正解性には影響しない。
- **arm64/amd64のOCR結果一致(重要なリスク解消)**: ADR-0025 PR4計画のv2で「未検証のリスク」として明記していた「arm64(Mac)生成のgolden textとamd64(Cloud Run想定)推論結果が完全一致するか」について、ローカルDocker(linux/amd64、QEMUエミュレーション)上で5 fixture全て(6ページ)を検証し、**文字単位で完全一致**することを確認した。ただし実Cloud Run実機(エミュレーションではない実x86_64ハードウェア)での再確認はPR4bで実施する。
- **イメージサイズ**: 725MB(単一ステージ、python:3.12-slimベース)。ADR-0025 PR4計画v1が見積もっていた「3〜4GB級」は過大な推測だったことが確定した。

## 既知の限界: PROCESSING_TIMEOUTはネイティブ推論のハングを止められない

`MAX_PROCESSING_SECONDS`(既定240秒)超過時に504を返す仕組み(`app.py`の`ocr()`)は、`ENGINE.page_text()`を`loop.run_in_executor()`で別スレッドに逃がし、`asyncio.wait(timeout=...)`で残り予算を待つ設計になっている。これは**GILが断続的に解放される通常の遅延**(CPU競合等)には正しく機能する(実測で確認済み)。

しかし、実機プローブで**PaddleOCRのCPU推論(det→rec)は推論全体を通じてGILをほぼ連続的に保持する**ことを確認した(1回の推論(約81秒)のうち約76秒間、メインスレッドが完全に停止しGILを取得できなかった)。この状態では、推論が真にハングした場合:

- タイムアウト判定コールバック自体がスケジュールされず、504はハング中の推論が(もし)完了するまで返らない
- `ocr_engine.py`の`PaddleOcrEngine`が`predict()`呼び出し全体を`threading.Lock()`で保持するため、同一インスタンスへの後続リクエストもロック待ちで完全に足止めされる
- Cloud Runの既定CPU割り当て(request-based billing)ではレスポンス返却後にCPUがスロットリングされるため、バックグラウンドの推論はほぼ凍結し、次のリクエストが来てCPUが再割り当てされるまで進まない

**Pythonのシグナル・`Future.cancel()`・`asyncio.wait_for()`のいずれでも、C/C++内で実行中のネイティブ推論を安全に停止する方法はない**(GILを共有する同一プロセス内のスレッドである限り不可避な制約)。真に強制力のあるデッドラインが必要なら、別プロセス(GILを共有しない)へ推論を切り出しSIGKILLで終了する設計が必要になるが、本番トラフィックは常に1ページ/リクエストでFunctions側に既存のリトライ機構があるため、そこまでの複雑度は現時点では見送った。

**実質的な防波堤**: 呼び出し元(Functions)から見た応答は、アプリの504が返らない場合でもCloud Run自体のリクエスト`--timeout`(計画値300秒)で最終的に打ち切られる。凍結したインスタンス自体の入れ替えは、PR4bで導入したCloud Run liveness probeが担う(下記節参照)。アプリ層でLock取得に短いタイムアウトを設けて503を返す代替案も検討したが、GIL連続保持時にはその待機自体も機能せず、中途半端に導入すると「幽霊推論が終わるまで503を連発する劣化インスタンス」を作るだけで根本解決にならないため見送った(codex/Fable 5.1双方のセカンドオピニオンで一致した結論)。

## Cloud Run liveness probeによるインスタンス強制入れ替え(PR4b)

上記の通りアプリ層では真のハングを止められないため、Cloud Runの**liveness probe**(`GET /health`、既定`periodSeconds=30,timeoutSeconds=5,failureThreshold=10`=検知窓300秒)を導入し、`/health`自体が応答不能になった凍結インスタンスをプラットフォーム側からSIGKILL+強制置換する設計にした。probe失敗時の挙動(Cloud Run公式ドキュメントで確認済み): コンテナはSIGKILLで停止、処理中のリクエストはHTTP 503で終了、オートスケーリングが同一リビジョン内で新インスタンスを起動する(新リビジョン不要)。

**エンドポイント名を`/healthz`から`/health`へ変更した経緯(PR4b実機デプロイ時)**: devへの`first_deploy=true`実デプロイで、Cloud Run内部のprobeトラフィック(`169.254.169.126`)からの`/healthz`疎通は200 OKで安定していたが、外部(curl・GitHub Actionsワークフロー)からの`/healthz`(完全一致パス)へのリクエストのみがGoogle Frontend側で404となりアプリに到達しない現象を確認した。`/healthz/`(末尾スラッシュ)や`/`・`/docs`等の他パスは外部からも正常にCloud Run/アプリ層まで到達しており、20分の待機・2回の新規revision作成でも再現し続けたため、伝播遅延やrevision固有のキャッシュではないと判断した。Cloud Run公式ドキュメントは「health checkエンドポイントは他の外部公開エンドポイントと同様に外部到達可能」と明記しており、この挙動の根本原因はGCP側の未文書化のインフラ挙動である可能性が高いが特定できていない。実務上の回避策としてエンドポイント名を`/health`に変更した。

**この仕組みの限界(重要)**: liveness probeは「凍結した単一インスタンスを隔離する」防波堤であり、「リトライすれば必ず成功する」ことを保証する仕組みではない。同一の入力(特定の破損パターンを持つ画像など)が毎回ネイティブ推論をハングさせ、呼び出し元が同じ入力を再送し続ける場合、「503→リトライ→新インスタンスも同じ入力で再びハング」という置換ループが理論上起こりうる。この無限ループを防ぐ最終防波堤は、Functions側の既存リトライ上限(`maxRetries`到達で`status: error`に確定させる設計)である(PR5/PR6でPaddleOCRクライアントがこの既存基盤を使う前提、契約テストで担保すべき)。

`startup probe`(既定`periodSeconds=5,timeoutSeconds=3,failureThreshold=24`=起動猶予120秒)は、モデルロード完了を待つための設定であり、cold start全体(コンテナpull含む)のレイテンシ計測とは別物である。cold latencyの実測はPR4cで別途行う。

liveness窓(300秒)はPR4b時点では暫定値であり、Cloud Run実機での単一ページ処理時間の実測(p95/最大値)を確認したうえで、PR4c完了後に最終値を確定する。**2026-09-18時点**: Stage3負荷試験ハーネス(`--mode=load`)は実装完了したが、実測値の取得(Phase B、`intensity=full`)はマージ後の別タスクのため、この窓の最終値確定はPhase B完了後まで持ち越す。

### D-1実効性検証結果(2026-09-13、dev実機)

`app.py`にテスト専用の`FORCE_HEALTH_FAIL_AFTER_SECONDS`環境変数ゲート(本番未設定=無効、起動から指定秒数経過後の`/health`を決定論的に503にする)を追加し、隔離revision(`--tag`、トラフィック0%)に短縮したprobe設定(`periodSeconds=5,timeoutSeconds=3,failureThreshold=3`=15秒窓)+`FORCE_HEALTH_FAIL_AFTER_SECONDS=60`を投入して検証した。

Cloud Runログで以下を実測確認した:

- `00:08:53`: STARTUP probe成功(7回目の試行)、初回LIVENESS probe成功(モデルロード完了・正常応答を実際に確認してから合格させている)
- `00:09:28`〜`00:09:38`: 60秒経過後、`/health`が3回連続で503(`{"status":"forced-failure",...}`)を返す
- `00:09:38`: `LIVENESS HTTP probe failed 3 times consecutively for container "paddle-ocr-1" ... The instance has been shut down.`(SIGTERM、決定論的に発火)

「凍結した(疑似)インスタンスをCloud Runのliveness probeが検知し強制終了する」という設計上の防波堤が実機で機能することを確認した。検証後、テスト用revisionは削除し、本番トラフィック(100%固定revision)には影響がないことを確認済み。

## PR4c実測値

Stage 1(golden screening)・Stage 2(速度改善)は完了済み(dev実機、1ページあたりp50=6.4秒/p95=7.4秒)。この数値は6ページgoldenの`--repeat`周回から算出した**1ページ実測値の線形外挿**であり、20p/71pの「PASS」表記は「Stage 3の実データ負荷試験へ進めてよいか」の一次スクリーニング結果に過ぎない(`scripts/paddle-ocr-verify.ts`の`REPORT_NOTES`参照、PR6着手のGo判定そのものではない)。2026-09-15時点の代替エビデンスとして、kanameone本番Cloud Loggingの`phaseTimings`実測(実在する最大文書73ページ、Gemini処理時代のログだが非OCR部分の実測として有効)で非OCRオーバーヘッド9.9秒(設計マージン50秒の約1/5)を確認済み。詳細は`docs/handoff/GOAL.md`「ADR-0025 PaddleOCR PR4b」節参照。

**Stage 3(本格負荷試験、`--mode=load`)は実装完了(2026-09-18)。実測値の取得(Phase B、`intensity=full`、1/20/71/160ページをそれぞれN=20〜30回・cold/warm分離で計測)はこのPRのスコープ外であり、マージ後に別途5回のGHA dispatchで実施する(`docs/handoff/GOAL.md`「ADR-0025 PaddleOCR」節参照)。** 実装時点で判明している設計上の注意点:

- **coldはバースト方式**(`--concurrency=1`下で3件同時発火、最大値を代理指標とする)で計測する。当初の承認済み計画(revision強制作成→Ready確認直後に送信)は、Cloud Runの`--startup-probe`(`httpGet.path=/health`)自体がモデルロード完了を待ってからrevisionをReadyにする仕様のため原理的に成立しないと実コード検証で判明し、この方式へ差し替えた
- **完了率ゲートはpage単位で判定する**(2026-09-18decision-maker確定。71ページなら1,420リクエスト中の成功率≥95%。trial単位[20回中19回完走]で同じ完了率95%を要求すると、71ページ全て成功する確率として1ページあたり約99.93%の成功率が必要になり、page単位の許容不良率(5%)の約70分の1(約2桁)まで厳しくなる。健全な状態でもインフラ雑音でFAILしうるため採用しない。2026-09-18 Fable 5.1レビュー指摘により「約3桁」から訂正)
- p95は右側打ち切り(未完走trialを+Infinity扱いで順位統計に含める)で算出する。除外方式は生存者バイアスで下方に歪むため採用しない
- **onCreateトリガーは`timeoutSeconds=540`のハード上限**(GCP仕様、event-drivenトリガーは900秒にできない)があり、71ページ級書類は初回試行(onCreate)では完走せずscheduled経路(`processOCR`、900秒)へフォールバックする既存設計(ADR-0023、2026-08-01の実インシデントを受けた決定)である。850秒ゲートはscheduled経路を対象にしている
- 本ハーネスは`--concurrency=1`の単一ストリーム測定であり、本番の複数文書同時処理時の輻輳(`max-instances=3`飽和・キュー待ち)は測定していない
- `wallMs`はGHA runner(米国)↔asia-northeast1のネットワーク往復を含み、本番(同一リージョン内のCloud Functions↔Cloud Run)より系統的に大きい

実行方法(1回のdispatch=1 tier×1 series。71ページwarm系列単独で約175分を要するため単独実行すること): GitHub Actions「PaddleOCR Verify (ADR-0025 PR4c Stage 1/3)」を`mode=load`・`tier`・`series`・`intensity`を指定して実行する。詳細は本ファイル「運用ランブック」節参照。71ページで基準未達の場合はPass1切替(PR6)着手をNo-Goとし、イメージ削減・min-instances見直し・並列化・基準自体の再検討のいずれかをdecision-makerに諮る(承認済み計画の失敗判定表)。

## 運用ランブック(PR8)

### ロールアウト手順

PaddleOCRへの切替はL1(環境変数)/L2(Firestoreフラグ)の2層ゲートで制御する(`functions/src/utils/featureFlags.ts`の`resolveOcrProvider`)。

1. **L1: `OCR_PROVIDER=paddle`** — Cloud Functionsのデプロイ時環境変数。クライアントの`scripts/clients/<client>.env`に設定し、`deploy-paddle-ocr.yml`または通常のFunctionsデプロイで反映(**再デプロイが必要**、即時反映ではない)。L1が`paddle`でない場合、L2の値によらず常にGeminiへ(fail-closed)。
2. **L2: Firestore `settings/features.paddleOcr`** — GitHub Actions `Run Operations Script`経由で即時切替可能(再デプロイ不要):
   ```bash
   gh workflow run "Run Operations Script" -f environment=<env> -f script='set-feature-flag --flag paddleOcr --value true --dry-run'  # 確認
   gh workflow run "Run Operations Script" -f environment=<env> -f script='set-feature-flag --flag paddleOcr --value true'            # 実行
   ```
3. **canary許可リスト(段階導入)**: `paddleOcrAllowlist`(docId配列)で対象文書を限定できる。`set-paddle-ocr-allowlist --set`(GHA経由)で設定、未設定(フィールド不在)時は全docIdが対象になる点に注意(全面展開前は必ずallowlistを設定すること)。

推奨順序: L1をdevへ反映・canary確認 → L2 allowlistで少数文書に限定してkanameone/cocoroへ展開 → 実績確認後allowlist解除で全面展開。

### ロールバック手順(緊急停止)

**第一選択: L2フラグの即時無効化**(再デプロイ不要、秒単位で反映):
```bash
gh workflow run "Run Operations Script" -f environment=<env> -f script='set-feature-flag --flag paddleOcr --value false'
```
これにより新規OCR処理は全てGeminiへ即座にフォールバックする。処理中(in-flight)のリクエストは完走する。

**重要な注意**: Geminiへのフォールバックは**あくまで暫定策**であり、恒久的な運用方針ではない。Gemini 3.5 FlashのVertex AI日本リージョン(asia-northeast1)従量課金は公式には非サポート(ADR-0025参照、非公式動作に依存)で、いつ塞がれてもおかしくない状態がPaddleOCR移行の動機そのもの。ロールバック後は原因調査・修正を優先し、Gemini運用を前提に長期間放置しないこと。

L1(`OCR_PROVIDER`環境変数)を`gemini`に戻す完全ロールバックは再デプロイを要するため、緊急停止時はまずL2で止め、根本対応後に恒久措置としてL1も戻すか判断する。

### 監視方法

- **Cloud Run health**: `GET /health`(`modelLoaded: true`・`imageDigest`が最新デプロイと一致することを確認)
- **liveness probe**: 凍結インスタンスは自動検知・強制終了される(上記「Cloud Run liveness probeによるインスタンス強制入れ替え」節)。`LIVENESS HTTP probe failed`ログの頻発は異常兆候
- **処理時間の内訳**: Cloud Logging(`resource.type="cloud_run_revision" AND resource.labels.service_name="processocr"`)で`event:"phaseTimings"`を検索すると、文書ごとの`pageLoopMs`(OCR)/`masterLoadMs`/`candidateGeminiMs`/`customerMatchMs`等の内訳が取得できる:
  ```bash
  gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="processocr" AND textPayload:"] phaseTimings for"' --project=<project-id> --limit=100 --freshness=7d
  ```
- **OCRエンジンの来歴**: `documents/{id}.ocrExtraction.version`が`PP-OCRv6_medium/...`(PaddleOCR)か`gemini-3.5-flash`(Gemini)かで実際に使われたエンジンを文書単位で確認できる

### コスト監視

- **現状**: 自動アラート・予算通知は**未設定**(2026-09-15時点)。GCP Console(Cloud Run > paddle-ocr サービス > 指標、または課金 > レポート)での手動確認が必要
- kanameone canaryの運用コスト実測・精度統計検証は実施中(1-2週間の実績蓄積待ち、`docs/handoff/GOAL.md`参照)。判明した参考値: Gemini概算$50/月 vs Cloud Run想定$4-9/月(いずれも実測ではなく参考値)
- **TODO**: Cloud Billing予算アラート(GCPコンソールまたは`gcloud billing budgets create`)の設定は未着手。運用コスト実測が出揃った後、想定レンジを大幅に超えた場合に通知される仕組みの導入を検討する

## ローカル開発

```bash
# ビルド(Cloud Run想定のlinux/amd64を明示)
docker buildx build --platform linux/amd64 -t paddle-ocr-local --load .

# 起動
docker run -p 8080:8080 paddle-ocr-local

# 動作確認
curl http://127.0.0.1:8080/health
curl -X POST http://127.0.0.1:8080/ocr -H "Content-Type: application/pdf" --data-binary @sample.pdf

# テスト(paddleocr/paddlepaddle不要、軽量)
pip install -r requirements-test.txt
pytest tests/
```
