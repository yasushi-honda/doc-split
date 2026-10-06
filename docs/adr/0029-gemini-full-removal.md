# ADR-0029: Gemini(Vertex AI)を緊急用OCR経路も含めて完全に廃止する

## Status
Accepted (2026-10-06)。ADR-0025・ADR-0027が「明示指定時だけ使う緊急用OCR経路としてGeminiを残す」とした決定を置き換える。

## Context

### 経緯
- ADR-0025(OCR、PaddleOCR)・ADR-0027(要約、Sarashina)で、通常経路のGemini停止を3環境(dev / kanameone / cocoro)で完了した。要約のGemini経路はPR-E(2026-10-06)でコードごと撤去した。
- 残っていたのは、`OCR_PROVIDER=gemini`を明示したデプロイでだけ有効になる**緊急用のOCR経路**(PaddleOCR障害時の逃げ道)。緊急利用の記録(`gemini_ocr_emergency_used`)は3環境とも0件だった。

### 判断の根拠(2026-10-06に確認した事実)
1. **東京の従量課金は公式サポート外**。Gemini 3.5 Flashの公式モデルページ(最終更新2026-10-05、生HTMLで確認)は、Standard PayGoの対象を`global`とマルチリージョン(`us`、`eu`)に限り、「asia-northeast1(ほか4リージョン)ではSingle Zone Provisioned Throughputのみサポートされる」と注記している。東京のML処理・Provisioned Throughputは対象だが、従量課金は対象外である。
2. 実際には、東京のリージョナルエンドポイントへの呼び出しが従量課金形態で受理され、本番で動作していた(`functions/src/ocr/ocrProcessor.ts`が`new GoogleGenAI({ vertexai: true, location: 'asia-northeast1' })`で`gemini-3.5-flash`を呼ぶ。Provisioned Throughputの指定はコードに無かった)。これは**公式がサポートしない経路で、継続の保証がない**。**実際の課金形態と、処理が東京で行われたかは未確認**(確認手段: Cloud Billingの課金SKU、またはGoogleからの書面)。
3. 本番は**要配慮個人情報を扱う方針**(decision-maker判断。根拠: ローカルAI(PaddleOCR・Sarashina)+Google CloudのDPA+日本リージョン+利用者との個人情報同意書+logging)。顧客データ(書類の画像・PDF)を外部AIへ送る経路は、この前提と整合しない。公式がサポートしない経路で、処理場所を説明できない状態で送ることはできない。
4. OCRは非同期(1分ごとの定期処理)で、利用者は完了を待っていない。書類のデータはPaddleOCR障害中も失われない(下記「障害時の運用」)。
5. この判断は、上記1・2の公式資料の読みに依存しない。1・2が揺らいでも、3・4(安全方針)で成立する。

### 公式資料の確認と、事実・未検証の区別
- **公式ページから確認できる事実**: 東京のStandard PayGoは公式の対象外。東京のML処理とSingle Zone Provisioned Throughputは対象。
- **未検証**: 非公式に動作していた間に、実際にどのリージョンで処理されたか。課金がNon-global単価で行われたか。decision-makerの仮説(日本リージョン対応の直後に使い始めたため、従量課金の扱いが変わる前の利用が通っている可能性)は、公式資料に裏付けがなく未検証。
- ADR-0025の2026-10-06追記を参照。

## Decision

1. **Gemini(Vertex AI、`@google/genai`)を本番から完全に廃止する。緊急時も使わない。** OCRはPaddleOCR(自前ホスティングのCloud Run、asia-northeast1)のみ。
2. コードからGemini経路を削除する: `ocrWithGemini`・Gemini用設定(`GEMINI_CONFIG`、料金表、`GEMINI_MODEL_ID`、`GEMINI_OCR_THINKING_BUDGET`)・緊急利用ログ・`rateLimiter.ts`(Gemini使用量の追跡)・`RETRY_CONFIGS.gemini`・`resolveOcrProvider`・未デプロイの`processOCROnCreate.ts`。`@google/genai`の依存も削除する。
3. `OCR_PROVIDER`は`paddle`のみ。デプロイ時(`deploy-functions.yml`、`deploy-to-project.sh`)に`gemini`が宣言されていればエラーで止める。`deploy-functions.yml`の`gemini_model_id_override`入力は削除する。実行時に古い値が残っていても、警告のうえ`paddle`に倒れる(顧客データを外部AIへ送らない)。
4. 契約テスト(`functions/test/geminiSdkImportAllowlistContract.test.ts`、`scripts/lib/geminiSdkImportAllowlistContract.test.ts`)を「Gemini不使用」の内容へ更新する。許可リストは空とし、`@google/genai`の依存・import・`GoogleGenAI`/`generateContent`の呼び出し・Gemini REST直叩きの復活を、CIで検知する。
5. `pass1ModelVersion`の既定値は`'unknown'`とする(従来はGeminiのモデルID)。OCRを実行しておらず、継承元の`ocrExtraction.version`も欠ける再利用経路で、実行していないエンジン名を書かないため。
6. 新規テナントの構築(`setup-tenant.sh`)から、`aiplatform.googleapis.com`の有効化と`roles/aiplatform.user`の付与を削除する。
7. **GCP側の設定(Vertex AI APIの無効化、`roles/aiplatform.user`の剥奪)は、コード撤去の3環境への展開と検証が済んだ後に、環境ごとに番号単位の承認で行う。** 先に外すと、旧コードへ戻したときに権限エラーで失敗する。

### 障害時の運用(PaddleOCRが止まったとき)
- **外部AIへは逃がさない。**
- OCRの再試行は、一時エラーは5回目の失敗で`status:'error'`に確定(再試行は4回、1分間隔)、429は8回目の失敗で確定(再試行は7回、指数バックオフ)する。非一時エラー(403/400等)は再試行せず即確定する(その場合は復旧操作だけでは直らず、原因の調査が要る)。**書類のデータは失われないが、自動では再処理されない**(自動救済`rescueErroredDocuments`は429系のerrorのみ、最大3回)。
- 許容する停止は「復旧後にerror書類を再投入するまでの遅延」。
- 検知: `processocr_error`アラートを起点に、AIが件数を読み取って確認・提案する。再投入(`fix-stuck-documents --include-errors`のdry-run→本実行、`run-ops-script.yml`経由)は、**番号単位の承認後にAIが実行する**(decision-maker決定)。
- 不良リビジョンが原因の場合に限り、直前の健全なリビジョンへ`gcloud run services update-traffic`で戻す。Cloud Runや依存先の長期障害には効かない。手順は`services/paddle-ocr/README.md`の「PaddleOCR障害時の運用」を参照。

### 決定から展開完了までの暫定措置
3環境へのコード展開が済むまで、旧コードには緊急経路が残る。**2026-10-06以降、`ocr_provider_override=gemini`を運用上使わない**(`docs/handoff/GOAL.md`に明記)。

## Consequences

**良い影響**:
- 顧客データを外部AIへ送る経路が、通常・緊急を問わず存在しなくなる。契約書・同意書・クライアント向け文書の説明が「外部AIへは送信しない」で一貫する。
- 公式がサポートしない経路への依存、モデル退役(2.5 Flash 2026-10-20)への追従、Gemini用の使用量・費用の管理が不要になる。

**悪い影響・リスク**:
- 緊急時に外部へ逃がせない。PaddleOCRの長期障害では、OCRの完了が遅れる(書類は失われない)。復旧後のerror書類の再投入が必要になる。
- ロールバック手段はCloud Runリビジョンの切替のみ(不良リビジョンの場合に限る)。戻し先の健全性は、展開前に各環境のリビジョン履歴を確認し、devで切替・復帰を実演して確認する。
- 過去に処理された書類の`ocrExtraction.version`には`gemini-*`が残る(履歴として残す)。`stats/gemini/daily`の既存データも履歴として残す(書き込みは止まる)。

**スコープ外(意図的に残す)**:
- トークン数の項目(`inputTokens`等、Paddleは常に0)。永続化された型(`PersistedPageOcrResult`)と分割子の`pageResults`コピーに波及するため、別件。
- retry・429判定。PaddleOCRの`fetch`とSarashinaのエラー分類が同じ関数を使っている。
- `SummaryProvider`の`'gemini'`値と`parseSummaryProvider('gemini')→'none'`。過去ドキュメントの`summaryProvider:'gemini'`をフロントが読むための互換。
- `getPaddleOcrGate`とL2フラグ(`settings/features.paddleOcr*`)。本番のOCR判定では未使用の、別の整理対象。
- 開発側のPII処理ツール(`/pii-gemini`、専用GCPプロジェクト)。本番とは別系統。

## Alternatives Considered

- **緊急用経路を残す(現状維持)**: 公式非サポートで継続保証がなく、処理場所を説明できない。要配慮個人情報を扱う方針と整合しない。緊急利用の実績は0件。
- **専用契約(Provisioned Throughput、Single Zone)で正規に使う**: 営業窓口経由の契約で、最低でも月額数十万円規模(月額$2,200〜3,000の記録、ADR-0025)・期間中キャンセル不可。緊急利用0件の経路には見合わない。
- **Gemini globalエンドポイントを緊急用にする**: 国外を含む処理になり、顧客データ(要配慮個人情報を含みうる)の送信先として説明できない。

## References
- ADR-0025(PaddleOCR)・ADR-0027(Sarashina要約)。2026-10-06の追記も参照
- Gemini 3.5 Flash 公式モデルページ(`docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-5-flash`、最終更新2026-10-05)
- `docs/handoff/GOAL.md`「Gemini完全廃止」
- `services/paddle-ocr/README.md`「PaddleOCR障害時の運用」
