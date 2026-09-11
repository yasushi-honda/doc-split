# ADR-0025: OCRパイプラインのGemini依存解消(Pass1: 自前ホスティングPaddleOCR / Pass2廃止)

## Status

Accepted (2026-09-12)。plan-crossreview(grip判断モード可視化 + codex 2パス独立診断)を経て設計確定、decision-maker承認済み。実装(PR構成、`/Users/yyyhhh/.claude/plans/shiny-knitting-flamingo.md`参照)は未着手、本ADRが実装着手の前提条件。

## Context

### 発端

Gemini 3.5 FlashのVertex AI日本リージョン(asia-northeast1)従量課金は公式には非サポート(Standard/Priority/Flex PayGoいずれもglobal/us/euのみ)。現状は非公式に動作しているが、塞がれた場合の正規移行先はシングルゾーン プロビジョンド スループット(個別問い合わせ必須・期間中キャンセル不可・最低構成でも月額$2,200〜3,000)。

`gemini-2.5-flash`も廃止予定(no earlier than 2026-10-16、下記「Gemini 2.5 Flash廃止日の一次ソース」参照)のため、「安い旧モデルに退避する」という逃げ道は存在しない。

### 検証の経緯(いずれも本セッションで実地検証済み)

**AWS Bedrock(不採用)**: Claude Haiku 4.5 / Sonnet 4.5 / Amazon Nova 2 Liteを東京リージョンで検証。劣化フィルタ無しのクリーンな分離テスト画像でも3モデルすべてが「擬」を誤読(それぞれ「賀」「塚」「澤」)。画像前処理(自動コントラスト・CLAHE・デノイズ)、高解像度化、プロンプト工夫のいずれでも解消せず、モデルの視覚認識能力に起因する再現性のある弱点と判断。

**PaddleOCR(採用)**: PP-OCRv6 medium、34.5Mパラメータ、CPU推論のみで6〜8秒/文書(ローカルMac実測)。ライセンスはApache 2.0(GitHubのLICENSEおよびHugging Face `PaddlePaddle/PP-OCRv6_medium_det`/`_rec`のモデルカードを完全一致IDで確認済み、2026-09-11時点)。

**最終比較(24文書 × 4フィールド = 96判定、本番の実マッチングロジック(`extractCustomerCandidates`等)を通した実測)**:

| エンジン | 正解 | 危険な誤確定 |
|---|---|---|
| Gemini 2.5 Flash | 96/96 | 0 |
| Gemini 3.5 Flash | 95/96 | 0 |
| **PaddleOCR(自前・CPU)** | **94/96** | **0** |
| Bedrock Claude Sonnet 4.5 | 約87.5% | 0 |
| Bedrock Claude Haiku 4.5 | 62.5〜75% | 0 |

テストデータは新規作成の架空模擬文書のみ(実顧客データ不使用)。旧字体異体字7種(渡邊/渡邉・齋藤/齊藤・髙橋/髙木・澤田・廣瀬/廣田・國分・櫻井)、紛らわしい事業所名ペア3組を双方向、fax劣化/退色/手書き風フォントを含む。

**不一致の内訳(plan-crossreviewでの指摘に基づき明示)**: PaddleOCRの2件の不一致はいずれも簡体字置換(「櫻井」→「樱井」「金額」→「金额」)による全文抽出のfuzzy match失敗で、いずれも安全側の差し戻し(候補ゼロ)であり誤確定はゼロ件。Geminiの不一致(2.5 Flashは0件、3.5 Flashは1件)は文字入れ替え(「わかば」→「わばか」)による同種の差し戻し。96件中1〜2件の差は、質の異なる稀なエラーをそれぞれが持つという関係であり、優劣というよりトレードオフに近い。統計的検定力の厳密な計算はしていないが、いずれのエンジンも危険な誤確定は一貫してゼロという点で意思決定に必要な情報は揃っていると判断した。

### 設計上の決定的な発見: Pass2(LLM候補抽出)は不要

現行実装は2段構成 — Pass1(`ocrWithGemini`、画像→テキスト)と Pass2(`extractOcrCandidates`、テキスト→4フィールドJSON候補、別のGemini呼び出し)。

既存の仲裁ロジック(`arbitrateCustomerName`/`arbitrateOfficeName`等、`functions/src/utils/extractors.ts` 1437行目〜)では、Pass2の候補が採用されるのは **①全文ベース抽出が何も見つけられず`bestMatch === null`** かつ **②候補がOCRテキストに実在** かつ **③その候補を再マッチしたとき`matchType === 'exact'`** の3条件が揃った場合のみ。

Pass2用のプロンプトは「原文どおりに転記せよ、補正するな」と指示しているため、OCRが文字化けしていればPass2も文字化けしたまま返し、③の完全一致再マッチに失敗して昇格しない。これは**Pass2をどのLLMで実装しても(Gemini/Bedrock/Phi-4-mini いずれでも)、文字レベルのOCR崩れは救済できない**ことを意味する。実際にPhi-4-mini-instructをローカルで動かして検証済み: 崩れたOCRテキスト(「高橋美穗様」)から正しく候補を抽出させ、それを実物の`arbitrateCustomerName`に通したところ、想定どおり`exact`再マッチに失敗し`bestMatch`は`null`のままだった。

一方、全文ベース抽出(いずれも正規表現とfuzzy matchのみの非AI関数)だけで96判定中94件が解決する。**この論証の限界**: 証明できているのは「Pass2は文字レベルのOCR崩れを救済できない」ことであり、「実運用でPass2に救済価値が全く無い」ことの証明ではない。全文ベース抽出が書式差(全角/半角、スペース位置等)でマッチに失敗し、Pass2が正規化された候補を返すことで救済するケースは理論上ありうる。このためPass2廃止の実施順序は「先に廃止して観察する」のではなく「先に可観測化し、実データで昇格率を計測してから廃止判断する」とした(下記PR構成参照)。

### 検討して見送った代替案(記録)

| 候補 | 見送り理由 |
|---|---|
| AWS Bedrock Claude(Pass1) | 「擬」等の漢字誤読、精度が明確に劣る |
| AWS Bedrock Claude(Pass2) | 上記のとおりPass2自体が不要と判明。WIFによる無鍵クロスクラウド認証の設計まで完了していたが運用複雑性が割に合わない |
| Gemma 4(E2B/E4B) | Google独自ライセンス。per-client配置が"Distribution"に該当するか法務確認が必要。加えて生成型VLMのためBedrock系と同じ視覚誤読リスク |
| Phi-4-mini-instruct(MIT、3.8B) | 実機検証の結果、上記のとおりPass2の救済能力がない |
| Sarashina2.2-OCR(MIT、3〜4B) | 実機ダウンロードして検証。CPU推論で1文書17分以上経過しても完了せず、CPU専用Cloud Run構成では実用不可 |
| GiNZA(MIT、日本語NLP) | NER精度(ENE 53.9〜70.8)が単独運用には不足、補助信号どまり |
| Amazon Textract / Google Document AI / Cloud Vision API | いずれも東京リージョン非対応(公式ドキュメントで確認済み) |

### コスト試算(実データに基づく、2026-09-12実測)

**現状(kanameone、Gemini実費)**: 2026年8月請求実績で月額¥19,236(Vertex AI)。

**PaddleOCR移行後の想定コスト(kanameone、Cloud Run)**:

`inspect-ocr-volume-stats.js`(`scripts/`、read-only、PR #896)をGitHub Actions経由でkanameoneに対して実行し、直近90日間の実データを取得した(母集団20,000件上限で完全カバー、FAX複製機能(faxDuplication、ADR-0024)による多重計上は`distributionId`でグルーピングして排除済み):

| 指標 | 値 |
|---|---|
| 対象期間 | 90日 |
| processed文書件数(FAX複製込み) | 11,491件 |
| 実OCR実行数(FAX複製排除後) | 9,625件 |
| 合計ページ数 | 21,535ページ |
| 平均ページ数/文書 | 2.24 |
| 最大ページ数 | 71ページ |
| ページ数帯分布 | 1ページ57.0%、2-20ページ42.3%、21-50ページ0.6%、51-100ページ0.02% |

30日換算: 21,535ページ ÷ 90日 × 30日 ≈ **7,178ページ/月**。

**Cloud Run料金(公式、2026-09-11 Playwright実機確認)**: `cloud.google.com/run/pricing`より、asia-northeast1(東京)は「Tier 1」料金適用対象と明記(WebFetchはJS描画未対応で本文取得不可のため、Playwright MCPで実レンダリングしDOM抽出)。本計画の構成(`--concurrency=1 --min-instances=0`)は「サービス(リクエストベースの課金)」に該当し、Tier 1のデフォルト単価は以下:

| 項目 | 単価 |
|---|---|
| CPU(アクティブ時、1 vCPU秒あたり) | $0.000024 |
| メモリ(アクティブ時、1 GiB秒あたり) | $0.0000025 |
| リクエスト(100万件あたり) | $0.40 |
| 無料枠(月次、請求先アカウント単位) | CPU 180,000 vCPU秒、RAM 360,000 GiB秒、リクエスト200万件 |

**重要な確認事項**: dev/kanameone/cocoroは`gcloud billing projects describe`で確認したところ、それぞれ異なる請求先アカウント(`01817F-AFD15C-E57676`/`01C403-C98331-DB4449`/`011325-341F3B-B6900F`)に紐付いており、**無料枠はクライアントごとに独立して適用される**(共有されない)。

**試算(`services/paddle-ocr`の計画構成 `--cpu=2 --memory=4Gi`、ローカルPoC実測6〜8秒/ページを暫定的に使用)**:

- 1ページあたり: CPU 2vCPU×6〜8秒=12〜16 vCPU秒、メモリ 4GiB×6〜8秒=24〜32 GiB秒
- 月間(7,178ページ): CPU 86,136〜114,848 vCPU秒、メモリ 172,272〜229,696 GiB秒、リクエスト約7,178件
- **CPU・メモリともに月次無料枠(180,000 vCPU秒・360,000 GiB秒)の範囲内**、リクエストも無料枠(200万件)を大幅に下回る
- → **kanameoneの現状の実際の利用量では、PaddleOCR Cloud Runの計算コストは概算で月額$0(無料枠内)**

**この試算の既知の限界(過信しないこと)**:
1. 6〜8秒/ページはローカルMac実測であり、**Cloud Run実機(2vCPU/4GiBコンテナ)でのレイテンシは未実測**。コールドスタート(`--min-instances=0`のため断続的な負荷で頻発しうる)のCPU消費は含まれていない。実機負荷試験(計画書「検証方法」参照、1/20/71/160ページの4パターン)で確定させる
2. `processedAt`は文書取込時刻でありOCR完了時刻ではないため、90日間の値は「取込量」の近似(スクリプトのdocstring参照)
3. Artifact Registryのストレージ・Cloud Buildのビルド費用は含まない(クリーンアップポリシーで最新2件保持のため軽微と想定)
4. cocoroは現時点でkanameoneより文書量が少ないと見られ(GOAL.md記載の過去実績ベース)、同様に無料枠内に収まる可能性が高いが、本ADRでは未計測(実装時に同スクリプトで確認する)

**結論**: 実データに基づく試算では、Gemini実費(¥19,236/月)からPaddleOCR移行後は計算コストがほぼゼロになる可能性が高いが、上記の限界(特にCloud Run実機レイテンシ未計測)により、**この試算はまだ「合格」の確定判断には使わず、PR実装時の負荷試験結果で再確認する**(検証方法・PR構成の着手条件を参照)。

### Gemini 2.5 Flash廃止日の一次ソース(確認結果と限界)

`functions/src/utils/config.ts`のコード注記「2026-10-16廃止予定」について、2026-09-11時点で以下を確認した:
- Google Cloud公式の静的ドキュメントページ(`docs.cloud.google.com/vertex-ai/generative-ai/docs/deprecations`)には該当の記載なし(最終更新2026-01-06、gemini-2.5-flash自体の記載が無い)
- Google AI Developer Forum上の複数の独立したスレッドで、Vertex AIユーザー向けの個別メール通知として「no earlier than 2026-10-16」という内容が言及されている(コミュニティ経由の二次情報、Google公式スタッフによる本文中の直接確認は本セッションでは取得できず)
- **結論**: この日付は「確定した固定日」ではなく「これより早くは廃止しない」という下限であり、かつ本セッションで一次ドキュメントによる完全な確認はできていない。事業影響の大きい判断(本ADRのような移行是非の判断)の根拠としては十分だが、正確な確定日が必要な場面ではGoogle Cloudサポート/営業への個別確認を推奨する

### decision-maker承認済み事項

- 各クライアント(dev/kanameone/cocoro)の個別GCPプロジェクト内に、そのクライアント専用でPaddleOCRサービスをデプロイする(共有マネージドサービスを介さず、クライアントのデータ境界を越えない)
- ホスティング基盤はGCEではなく**Cloud Run**。理由: 本リポジトリにはCloud FunctionsからGCE内部IPへ到達するためのVPCコネクタが一切存在せず、一方Cloud RunはIAMベースのサービス間認証(IDトークン+`roles/run.invoker`)がVPC構築なしで完結し、`docs/context/gcp-migration-scope.md`の「APIキー不使用・Workload Identity」方針とも整合する

## Decision

1. **Pass1をPaddleOCRに置換**: `functions/src/ocr/ocrProcessor.ts`にディスパッチャー(`ocrPass1`)を追加し、`OCR_PROVIDER`(feature flag)で`gemini`/`paddle`を切替可能にする
2. **Pass2は廃止**: `extractOcrCandidates`の呼び出しを`pass2Disabled`ゲートで無効化できるようにする。ただし前述の限界(実運用での救済価値の完全な否定はできていない)があるため、**先に昇格率を可観測化し、実データで計測してから廃止判断する**(廃止を先行させない)
3. **Issue #895(空確定バグ)の最小ガードを先行導入**: PaddleOCRのマッチ率低下(簡体字置換等)により候補ゼロ(`bestMatch === null`)ケースが増える可能性があるため、`bestMatch !== null`を`customerConfirmed`/`officeConfirmed`確定条件に追加する最小修正を、Pass1切替(canary)より前に完了させる
4. **段階的ロールアウト**: dev→kanameone→cocoro(ADR-0005準拠)。Pass1切替とPass2廃止は独立したfeature flagで、L1(環境変数)/L2(Firestoreフラグ)の2層でいつでもロールバック可能

詳細な変更内容・PR構成・検証方法は実装計画(`/Users/yyyhhh/.claude/plans/shiny-knitting-flamingo.md`)を正とする。

## Consequences

**良い影響**:
- Vertex AI日本リージョンPayGo停止リスクを解消(Provisioned Throughput月$2,200〜3,000の強制契約を回避)
- 実データに基づく試算では計算コストがほぼゼロ(無料枠内)になる可能性が高い
- Pass2廃止によりAI呼び出し自体が完全消滅すれば(可観測化での計測結果次第)、レイテンシも改善しうる

**悪い影響・リスク**:
- PaddleOCR固有の簡体字置換弱点により、旧字体を含む顧客・事業所名で安全側の差し戻し(手動確認)が増える可能性(危険な誤確定はゼロと確認済みだが、業務コストの増分は未計測)
- 自前ホスティングサービス(PaddleOCR Cloud Run)の運用責任(デプロイ・監視・障害対応)がdoc-splitチームに追加される
- Cloud Run実機でのレイテンシ・コールドスタートは未実測であり、コスト試算・ユーザー体感とも実装時の負荷試験結果次第で見直しが必要

**スコープ外(本ADRの対象外)**:
- 手動トリガーの`regenerateSummary`(要約再生成、低頻度)は同じくGemini依存だが自動処理パス外のため対象外、別途扱う
- Issue #895の完全な修正(office側`officeAmbiguityGate.ts`新設等)は本移行と独立した別トラックとする(最小ガードのみ本計画に含める、上記Decision 3参照)

## 関連

- 実装計画: `/Users/yyyhhh/.claude/plans/shiny-knitting-flamingo.md`
- [ADR-0024](0024-multi-customer-detection.md) — FAX複製機能(faxDuplication)、コスト試算のボリューム統計で多重計上排除のため参照
- Issue #895(空確定バグ、本ADR承認と同時期に起票)
- グローバルメモリ: `reference_japanese_ocr_model_accuracy_2026.md`(AWS Bedrock/PaddleOCRの日本語OCR精度比較)、`reference_aws_bedrock_ismap_and_pricing_2026.md`(AWS Bedrock ISMAP適合性・料金)
