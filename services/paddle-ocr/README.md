# PaddleOCR Cloud Runサービス

ADR-0025(PaddleOCR移行)のPR4: 自前ホスティングPaddleOCR(PP-OCRv6 medium)をCloud Run上でHTTPサービスとして提供する。詳細な意思決定の経緯は[`docs/adr/0025-paddleocr-migration.md`](../../docs/adr/0025-paddleocr-migration.md)を参照。

## 本サービスが証明すること/しないこと

- **証明すること**: 固定済みPaddleOCRモデル(重みSHA-256で同一性を担保)を使い、本番と同一の入力形式(PDF/JPEG/PNG/TIFF/GIF)・ページ分割経路でOCRを実行できること。
- **証明しないこと**: Cloud Run実機でのコスト・精度・レイテンシの定量評価。これはPR4c(`scripts/paddle-ocr-verify.ts`)の実測結果、およびPR6着手可否のゲート判定をもって成立する。実測値は本ファイル末尾に追記する。

## エンドポイント契約

### `GET /healthz`

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

上記の通りアプリ層では真のハングを止められないため、Cloud Runの**liveness probe**(`GET /healthz`、既定`periodSeconds=30,timeoutSeconds=5,failureThreshold=10`=検知窓300秒)を導入し、`/healthz`自体が応答不能になった凍結インスタンスをプラットフォーム側からSIGKILL+強制置換する設計にした。probe失敗時の挙動(Cloud Run公式ドキュメントで確認済み): コンテナはSIGKILLで停止、処理中のリクエストはHTTP 503で終了、オートスケーリングが同一リビジョン内で新インスタンスを起動する(新リビジョン不要)。

**この仕組みの限界(重要)**: liveness probeは「凍結した単一インスタンスを隔離する」防波堤であり、「リトライすれば必ず成功する」ことを保証する仕組みではない。同一の入力(特定の破損パターンを持つ画像など)が毎回ネイティブ推論をハングさせ、呼び出し元が同じ入力を再送し続ける場合、「503→リトライ→新インスタンスも同じ入力で再びハング」という置換ループが理論上起こりうる。この無限ループを防ぐ最終防波堤は、Functions側の既存リトライ上限(`maxRetries`到達で`status: error`に確定させる設計)である(PR5/PR6でPaddleOCRクライアントがこの既存基盤を使う前提、契約テストで担保すべき)。

`startup probe`(既定`periodSeconds=5,timeoutSeconds=3,failureThreshold=24`=起動猶予120秒)は、モデルロード完了を待つための設定であり、cold start全体(コンテナpull含む)のレイテンシ計測とは別物である。cold latencyの実測はPR4cで別途行う。

liveness窓(300秒)はPR4b時点では暫定値であり、Cloud Run実機での単一ページ処理時間の実測(p95/最大値)を確認したうえで、PR4c完了後に最終値を確定する。

## PR4c実測値(未実施)

Cloud Run実機での1/20/71/160ページ負荷試験結果は、PR4c完了後にここへ追記する。

## ローカル開発

```bash
# ビルド(Cloud Run想定のlinux/amd64を明示)
docker buildx build --platform linux/amd64 -t paddle-ocr-local --load .

# 起動
docker run -p 8080:8080 paddle-ocr-local

# 動作確認
curl http://127.0.0.1:8080/healthz
curl -X POST http://127.0.0.1:8080/ocr -H "Content-Type: application/pdf" --data-binary @sample.pdf

# テスト(paddleocr/paddlepaddle不要、軽量)
pip install -r requirements-test.txt
pytest tests/
```
