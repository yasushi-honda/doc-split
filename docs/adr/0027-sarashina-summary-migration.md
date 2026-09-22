# ADR-0027: 要約生成のGemini依存解消(自前ホスティングSarashina2.2-3B、非同期自動生成への転換)

## Status

Accepted (2026-09-22)。plan-crossreview(grip判断モード可視化 + codex 2パス独立診断)を経て設計確定、decision-maker承認済み。PR0(spike)で品質・処理能力・コストを実測し、PR1(サービス基盤)着手を決定した。実装は`/Users/yyyhhh/.claude/plans/logical-baking-lighthouse.md`を正とする。

## Context

### 発端

ADR-0025([PaddleOCR移行](0025-paddleocr-migration.md))と同根の問題。Vertex AI Gemini 3.5 FlashのVertex AI日本リージョン(asia-northeast1)従量課金は公式には非サポート(非公式利用に依存)であり、正規移行先(Single-zone Provisioned Throughput)は個別契約・キャンセル不可・最低月額$2,200〜3,000。ADR-0025はOCR(Pass1)のみを対象とし、要約生成(`regenerateSummary`)は「手動トリガー・低頻度」を理由に明示的にスコープ外としていた。

2026-09-21、decision-makerの意向により「要約もいずれはPaddleOCRと同様に自前ホスティングSLM(Cloud Run、CPUのみ、asia-northeast1)へモデルルーティングしたい」という将来検討として候補調査・実機検証を実施し、当日中に品質・コスト・アーキテクチャ・コンプライアンスの検討が完了、decision-makerが実装移行を正式決定した。

### 候補調査・実機検証の経緯

WebSearch/WebFetchで2026-09-21時点の情報を収集し、Qwen3.5-4B/Gemma4 E4B/llm-jp-4-8b-instruct/Sarashina2.2-3B/PLaMo 2 8B/ELYZA-Diffusion-Instruct-1.0-Dream-7B等を比較。

**1次実機検証(dev、Cloud Run 8vCPU/32GiB、CPUのみ)**: 3候補(Sarashina2.2-3B/Qwen3.5-4B/llm-jp-4-8b-instruct)をGGUF量子化(Q4_K_M)でデプロイし、架空の模擬介護文書4種(FAX送付状〜居宅サービス計画書8,000字)で本番同等プロンプトを実行。

- **Qwen3.5-4B(不採用)**: 実在しない年齢(「42歳」等)を3/3回再現性ある形で捏造
- **llm-jp-4-8b-instruct(不採用)**: 精度は高いが長文で700秒超と遅すぎる
- **Sarashina2.2-3B(Q4_K_M、この段階では条件付き)**: 事業所名の記載が一切ない正式書式の書類(D9、福祉用具貸与確認書)で、実在しない事業所名「介護サポート株式会社」を、温度0.2/0(決定論的)の両方で合計8/8回、完全な再現性をもって捏造した。一方、体裁のない単なるメモ(D10、固有名詞ゼロ)では5/5回とも正直に「記載なし」と回答。**捏造は常時発生ではなく「正式書類の体裁+一部項目の欠落」という実運用で典型的な条件で誘発される**点が重要な発見

**プロンプト改善+量子化変更(v2)**: 必須5項目(種類/関係者/日付/金額/状態変化)を明示し箇条書き形式に変更するプロンプトへ改善(長文でのカバー率56%→94%)。加えて量子化を**Q4_K_M→Q8_0**へ変更し、D9/D10相当の固有名詞捏造テストで**捏造0/8回**を達成。PLaMo 2 8B(ライセンス制約あり)・ELYZA-Diffusion(未検証情報多数)は、判明している条件だけでSarashinaより不利な要素を抱えており深掘りを打ち切った。

### PR0(spike)での再現性検証(2026-09-21〜22実施・完了)

`/plan-crossreview`(codex 2パス独立診断)で「2026-09-21の品質検証結果は、fixture・使用したGGUF/llama.cppバージョン・ビルド設定がリポジトリに一切残っておらず監査不能」という指摘を受け、PR0として独立した再ビルド・再デプロイでの再現性検証を実施した。

| 項目 | 実測結果 |
|---|---|
| 品質基準実験(D9/D10) | **PASS**。D9で捏造0/8回(温度0.2×5回、温度0×3回)、D10も誤検出以外の捏造なし。2026-09-21の結果を独立した再ビルド・再デプロイで再現 |
| カバー率(D1〜D4) | D1=100%、D2=95%、D4=100%、D3(長文)=100%、数値捏造は全て0件 |
| 処理時間(ウォーム、3回中央値) | D1(短文)=34秒、D2=54秒、D4=88秒、D3(長文)=170〜204秒 |
| コールドスタート(`ready_wait_s`) | 20.5秒〜65.9秒のレンジ |
| コンテキスト長 | `-c 16384`と指定しても`max_position_embeddings=8192`でハードクランプされる(実害はPR0時点では無し、PR1詳細設計で入力長管理の必要性を確認) |
| 出力トークン上限 | PR0時点では「`-n`/`LLAMA_ARG_N_PREDICT`が全く機能しない」と誤認したが、PR1設計時のソースコード確認で訂正: `max_tokens`省略時のみ機能するフォールバックであり、`/props`の`n_predict:-1`は表示上の実装に起因する(詳細は実装計画「主要な設計判断」1a-5参照) |
| クライアント切断後の実挙動 | クライアントが接続を打ち切った後もサーバー側は生成を継続し、新規リクエストは約2分40秒間ブロックされた。ブロックの機序はCloud Runの`No available container instances`(`--concurrency=1`+`--max-instances`によるキャパシティ枯渇)であり、Cloud Runの`--timeout`設定に到達したこととは別事象(PR1設計時にllama.cppのソースコードでも429を返さないことを確認し訂正、詳細はサービスREADME参照) |
| コストレンジ | 月$106.5〜$115.4(コールドスタート20.5秒/65.9秒それぞれの前提) |

検証用リソース(Cloud Runサービス・Artifact Registry repo)はPR0完了後にdevから削除済み。fixture(D1〜D10)は`scripts/fixtures/sarashina-summary-golden/`へコミット済み。

### 検討して見送った代替案(記録)

| 候補 | 見送り理由 |
|---|---|
| Qwen3.5-4B | 実在しない年齢を再現性ある形で捏造 |
| llm-jp-4-8b-instruct | 精度は高いが長文で700秒超と実用外 |
| Sarashina2.2-3B(Q4_K_M) | 情報欠落条件下で事業所名を再現性ある形で捏造。Q8_0へ量子化変更し解消 |
| PLaMo 2 8B | 「PLaMo Community License」(年商10億円以下は無償だが利用登録フォーム提出必須、再配布にライセンス波及制限)でMITより制約が強い。サイズも3Bの約2〜3倍でCPUではより遅い |
| ELYZA-Diffusion-Instruct-1.0-Dream-7B | 日本語ベンチマーク数値・CPU実測情報ともにモデルカードに記載なく未検証 |

### アーキテクチャ方針の転換(明示クリック→非同期自動生成)

当初は現行の`regenerateSummary`(明示クリック・同期待ち)のモデルだけをSarashina化する案を検討したが、decision-makerの「お客様目線で数分待たされる体験はあり得ない」という指摘を踏まえ、**OCR完了イベント駆動の非同期自動生成**へアーキテクチャを転換した。確定した設計方針:

- Cloud Scheduler定期ポーリング(間隔はPR0実測を踏まえ確定、実装計画参照)。Cloud Run Jobsは使わない
- `min-instances=0`(非同期処理のためコールドスタート許容、コスト最小化。OCR本体のPaddleOCRが`min-instances=1`なのはFunctionsの同期タイムアウト制約を受けるためであり、要約には同じ制約がない)
- 未処理0件ならSarashina Cloud Runへのリクエスト自体を送らず推論コストはゼロ
- 対象は新規OCR完了分のみ(既存の過去文書のバックフィルはスコープ外)

### データ委託構造・コンプライアンス整理

GCPプロジェクトの契約主体はクライアント自身であり、doc-split運営者はその環境を借りてシステムを構築する立場(Vertex AI利用時もCloud Run自前ホスティング時も共通)。インフラ責任(可用性・パッチ・物理セキュリティ)もどちらのケースでも引き続きGoogleが担う。**変わるのはアプリケーション層の責任のみ**: Vertex AI利用時はGoogleの完成品AIサービスの精度・品質をGoogleが担保するが、Cloud Run自前ホスティング時はモデルの選定・実装・チューニング・保守をdoc-split運営者が引き受ける。データの渡し先も、Vertex AI(クライアントのプロジェクトから呼び出すが実際の推論はGoogle運営の別レイヤーのマルチテナント推論基盤で行われ、東京リージョン指定は非公式)から、Cloud Run内(クライアントのプロジェクト内に専有デプロイされたコンテナで完結、リージョン指定は公式サポート)に変わる。これが東京リージョン非公式利用リスクを解消する技術的な核心。

## Decision

1. **Sarashina2.2-3B-instruct-v0.1(Q8_0量子化)を自前ホスティング**: `mmnga/sarashina2.2-3b-instruct-v0.1-gguf`(コミュニティ配布GGUF、MITライセンス継承)を`services/sarashina-summary/`のCloud Runサービスとしてデプロイする。PaddleOCRとは異なりFastAPIラッパーを作らず、llama.cpp server(OpenAI互換API)を直接使う(理由・詳細差分は実装計画「主要な設計判断」1・1a参照)
2. **要約生成をOCR完了イベント駆動の非同期処理へ転換**: `documents/{docId}`に新フィールド`summaryState`を追加し、Cloud Scheduler定期ポーリング+`generateSummaryBatch`(逐次処理)で処理する。既存の手動再生成(`regenerateSummary`)はGemini呼び出しのまま第一弾(PR1〜PR6)では残す
3. **モデルルーティングは3値(`none`/`sarashina`/`gemini`)、fail-safe先は`none`**: 既定`none`とし、デプロイしただけで全文書が無言でGemini自動要約される事故を防ぐ(詳細は実装計画「主要な設計判断」2参照)
4. **段階的ロールアウト**: PR0(spike)→PR1(サービス基盤、a/b/c分割)→PR2(品質ゲートのCI化)→PR3(クライアント/ディスパッチャー)→PR4(バッチ処理・フロントエンド)→PR5(dev有効化)→PR6(kanameone/cocoro展開)→PR7(手動経路の非同期化、完全なGemini依存脱却に必須)。PR1以降は個別にdecision-maker再承認が必要

詳細な変更内容・PR構成・検証方法は実装計画(`/Users/yyyhhh/.claude/plans/logical-baking-lighthouse.md`、decision-maker個人のローカル環境にのみ存在しリポジトリには含まれない)を正とする。ただし、以下の「PR1a実装知見」節に、PR1a実装時にリポジトリ内のコード・ドキュメントを保守する上で必要な技術的要点を転記し、実装計画ファイルにアクセスできない環境でも本ADRとサービスREADME(`services/sarashina-summary/README.md`)だけで判断できるようにしている(pr-review-toolkit comment-analyzer指摘反映)。

### PR1a実装知見(サービス基盤の技術的詳細)

PaddleOCR(`services/paddle-ocr/`)を複製元として実装する過程で、llama.cppのソースコード・GHCRのイメージconfig・Hugging Face API・GCPのIAM権限を実機で裏取りし、以下の技術的要点を確定させた。詳細・検証コマンドは`services/sarashina-summary/README.md`を参照。

1. **モデル取得は完全ファイル名指定(curl直接取得)**: `mmnga/sarashina2.2-3b-instruct-v0.1-gguf`は多数の量子化ファイルを含むため、PaddleOCRの`snapshot_download`+`allow_patterns`パターンを機械的に複製すると全量子化を取得してビルドが破綻する事故が起きうる。alpine+curlで完全ファイル名を直接URL指定して取得し、SHA-256をビルド時に検証する
2. **パラメータ設定はENV(`LLAMA_ARG_*`)方式を基本とする**: llama.cppは環境変数を先に処理しCLI引数が後から上書きする実装のため、CMD方式で書いたオプションは`gcloud run deploy --update-env-vars=LLAMA_ARG_*`による再デプロイなしチューニングが無効化される。ただし`-tb`/`--threads-batch`には対応する環境変数が存在しないため、この1オプションのみCMDで明示する(個々のCLIオプションは対応する`LLAMA_ARG_*`のみを上書きするため、この部分的な混在は安全)
3. **有効コンテキスト長は8192固定**: `LLAMA_ARG_CTX_SIZE`をいくら大きく指定しても、モデルの`max_position_embeddings=8192`でハードクランプされる。入力長の事前切り詰め・事前拒否はクライアント(PR3/PR4)の責務
4. **出力トークン上限の正確な仕様**: クライアントが`max_tokens`を省略した場合のみ`LLAMA_ARG_N_PREDICT`がフォールバック上限として効く。明示指定時はクランプされずそのまま通るため、`LLAMA_ARG_N_PREDICT`を「効かないフラグ」として将来削除しないこと。呼び出し元は必ず`max_tokens`を明示すること
5. **Cloud Run 429の発生源はllama.cppではなくCloud Run自体**: llama.cppが返しうるのは503のみで429は返さない。`--max-instances`は「コスト上限」であって「逐次実行の保証」ではなく、逐次実行の担保はクライアント側(`generateSummaryBatch`の逐次ループ+Firestoreのclaim/所有権トークン、PR4)の責務とする
6. **メモリ32GiBはPR0実測条件の保存であり実需要ではない**: 実需要は約5〜6GiBと試算されるが、PR1では32GiBを据え置く(PR0実測条件の再現性を保つため)。削減はPR2以降で実peak RSSを計測してから判断する
7. **runtime SAへの`iam.serviceAccountUser`(actAs)付与はPR1c(デプロイワークフロー実装時)に行う**(PR1b実装時に方針修正、当初はPR1bで今すぐ行う想定だった): PaddleOCR版の実際の構造(`docs/context/delivery-and-update-guide.md`)を確認した結果、actAs付与はインフラ準備スクリプト(PaddleOCR版のPR3相当)ではなく、デプロイワークフロー(PaddleOCR版のPR4b相当)側でデプロイSAへの恒久権限として付与されていることが判明した。「runtime SAが実際に使われる段階で権限を付与する」という一貫した設計であり、Sarashina版もこの構造に合わせる。PR1bの`scripts/setup-sarashina-summary-infra.sh`とdelivery-and-update-guide.mdには、PR1c実装時に付与すべきactAsコマンドを明記済み
8. **`/health`のdigest検証はできない**: PaddleOCR版は`/health`レスポンスの`imageDigest`フィールドで検証しているが、llama.cppの`/health`は`{"status":"ok"}`のみ。代替として`/props`の`build_info`/`model_alias`と`gcloud run services describe`のimage一致を組み合わせる

### PR2a実装知見(固有名詞捏造スキャナ・ドリフトガード)

`shared/summaryFabricationScan.ts`(PR4でバッチ処理から呼ばれる想定、PR2時点ではdead code)を実装する過程で、PR0検証スクリプト(`scan_entity_fabrication.py`、正規表現のみ)の精度課題と、`/plan-crossreview`(grip自白+codex 2パス)での指摘を反映した。詳細は`scripts/fixtures/sarashina-summary-golden/README.md`を参照。

1. **「誤検出13→0」は実装前は未検証の設計提案だった**(`/plan-crossreview` codex High指摘): 当初のプラン記述はPlan agentの設計検証結果を「確認済み」と書いてしまっていたが、実際にコードとして実装・実行するまでは未証明だった。PR2a実装時にPR0結果JSON(28run)へ実際に実行し、`scripts/fixtures/sarashina-summary-golden/pr0-fabrication-expected.json`に期待値を固定、`functions/test/sarashinaSummaryScanCorpus.test.ts`で継続的に回帰検証する設計にした
2. **捏造検知は4段階(左文脈抽出→verbatim判定→助詞トリム→再結合判定)**: PR0のPython版が出していた誤検出16件(地の文巻き込み)を解消しつつ、D3の3件(`水無月訪問看護`等)を「原典の括弧書き略記の言い換え」として`recombined`(捏造ではない)に分類する。実装中に「・」(中黒)を名前構成文字に含めていたためリスト列挙・箇条書き記号を巻き込む新規の誤検出を発見し、区切り文字として扱うよう修正した
3. **再結合判定は限定的な構文変換のみを許容**(`/plan-crossreview` codex High指摘反映): 当初「原典中の前後30文字以内の近接一致」で判定する設計だったが、これは無関係な語の偶然の近接一致による真の捏造も`recombined`(既定WARN)としてゲートを通してしまう。原典中に`{suffix}（{core}）`という完全一致の括弧書き略記パターンが実在するかのみを見る判定へ厳格化した
4. **既知の限界**: 助詞トリムは`lastIndexOf`ベースの単純一致のため、1文字助詞(「も」等)が固有名詞の先頭1文字と偶然一致するケース(「もみじ整形外科」等)では誤ってトリムしうる。PR0結果28run全件では未発生(形態素解析は依存コストの観点からPR2a時点では不採用)
5. **カバー率は`mustCover`/`optionalFacts`に分離**(`/plan-crossreview` codex High指摘反映): 率(ヒット数÷facts数)のみで判定すると、重要事実(氏名等)の脱落が非必須事実(品目等)の充足で相殺されてしまう。`meta.json`に`mustCover`(必須、個別判定)・`optionalFacts`(任意、率算入のみ)・`minCoveredFacts`(丸め誤差を避けた整数個数)を追加した。D9(facts=`三好陽子/歩行器/9月20日`)は「歩行器」がv2プロンプトの必須5項目に品目が無いため8/8回欠落する構造的な結果であり、`mustCover=[氏名,日付]`・`minCoveredFacts=2`として85%一律ゲートの対象外にした
6. **v2プロンプトはデータファイル化、本番`summaryPromptBuilder.ts`は無改変**: `scripts/fixtures/sarashina-summary-golden/prompt-v2.txt`に固定し、ドリフトガードが`bench.py`のリテラルとの一致(クロス言語ドリフト検知)・`manifest.json`のSHA-256一致を検証する。PR3スコープ(本番プロンプトへの実装)を先取りしない
7. **テスト配置は`functions/test/`(mocha)と`scripts/lib/`(node:test)の2箇所**: `shared/`配下のロジックは`functions/test/customerIdentity.test.ts`の前例に倣い`functions/test/summaryFabricationScan.test.ts`・`sarashinaSummaryScanCorpus.test.ts`に、ドリフトガードは`scripts/lib/paddleOcrModelHashes.test.ts`の前例に倣い`scripts/lib/sarashinaSummaryGoldenDrift.test.ts`に配置。いずれも既存CI配線(`cd scripts && npm test`・`npm run test:functions`)で拾われるため`.github/workflows/ci.yml`の変更は不要

## Consequences

**良い影響**:
- Vertex AI日本リージョンPayGo停止リスクを解消(OCRに続き要約もGemini依存から脱却する経路が確立)
- 非同期自動生成により、ユーザーが要約の待ち時間を一切体感しない設計に改善(現行の明示クリック・同期待ちより体験が向上)
- 未処理0件時は推論コストがゼロになる設計

**悪い影響・リスク**:
- 自前ホスティングサービス(Sarashina Cloud Run)の運用責任(デプロイ・監視・障害対応)がdoc-splitチームに追加される
- 第一弾(PR1〜PR6)完了時点では「Gemini依存脱却」は未完了(手動経路`regenerateSummary`はGeminiに残る)。完全な脱却にはPR7(任意ではなく必須フォローアップ)が必要
- Cloud Run timeoutを跨いだ場合、コンテナ側の生成処理が継続し新規リクエストを一時的にブロックする既知の挙動があり、クライアント側でリトライ・所有権保護の設計が必要(実装計画「主要な設計判断」3・8参照)
- 有効コンテキスト長が8192トークンに固定され、`-c`指定を大きくしても伸びない。長文OCR結果は入力長管理が必要(実装計画「主要な設計判断」1a-4参照)

**スコープ外(本ADRの対象外)**:
- 手動トリガーの`regenerateSummary`の非同期化はPR7(第二弾)の対象。第一弾完了時点ではスコープ外
- 固有名詞捏造ゲートの本格的なCI恒久化(golden manifestとの自動突合)はPR2のスコープ

## 関連

- 実装計画: `/Users/yyyhhh/.claude/plans/logical-baking-lighthouse.md`
- [ADR-0025](0025-paddleocr-migration.md) — 同根の問題(Gemini非公式利用リスク)に対するOCR側の先行事例、複製元パターンの多くを参照
- `docs/handoff/GOAL.md` — 候補調査・アーキテクチャ検討の詳細な経緯
- `scripts/fixtures/sarashina-summary-golden/` — PR0で使用したfixture・検証結果・PR0実測時点の暫定検証スクリプト
- グローバルメモリ: `reference_japanese_slm_summarization_cpu_evaluation_2026.md`(日本語要約SLM評価)
