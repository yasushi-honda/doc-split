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
4. **段階的ロールアウト**: PR0(spike、完了)→PR1(サービス基盤、a/b/c分割、完了)→PR2(品質ゲートのCI化、a/b分割、完了)→PR3(クライアント/ディスパッチャー、dead code、完了・2026-09-26)→PR4(バッチ処理・フロントエンド)→PR5(dev有効化)→PR6(kanameone/cocoro展開)→PR7(手動経路の非同期化、完全なGemini依存脱却に必須)。PR4以降は個別にdecision-maker再承認が必要

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
2. **捏造検知は4段階(左文脈抽出→助詞トリム→verbatim判定→再結合判定)**: PR0のPython版が出していた誤検出16件(地の文巻き込み)を解消しつつ、D3の3件(`水無月訪問看護`等)を「原典の括弧書き略記の言い換え」として`recombined`(捏造ではない)に分類する。実装中に「・」(中黒)を名前構成文字に含めていたためリスト列挙・箇条書き記号を巻き込む新規の誤検出を発見し、区切り文字として扱うよう修正した
3. **再結合判定は限定的な構文変換のみを許容**(`/plan-crossreview` codex High指摘反映): 当初「原典中の前後30文字以内の近接一致」で判定する設計だったが、これは無関係な語の偶然の近接一致による真の捏造も`recombined`(既定WARN)としてゲートを通してしまう。原典中に`{suffix}（{core}）`という完全一致の括弧書き略記パターンが実在するかのみを見る判定へ厳格化した
4. **既知の限界**: 助詞トリムは`lastIndexOf`ベースの単純一致のため、1文字助詞(「も」等)が固有名詞の先頭1文字と偶然一致するケース(「もみじ整形外科」等)では誤ってトリムしうる。PR0結果28run全件では未発生(形態素解析は依存コストの観点からPR2a時点では不採用)
5. **カバー率は`mustCover`/`optionalFacts`に分離**(`/plan-crossreview` codex High指摘反映): 率(ヒット数÷facts数)のみで判定すると、重要事実(氏名等)の脱落が非必須事実(品目等)の充足で相殺されてしまう。`meta.json`に`mustCover`(必須、個別判定)・`optionalFacts`(任意、率算入のみ)・`minCoveredFacts`(丸め誤差を避けた整数個数)を追加した。D9(facts=`三好陽子/歩行器/9月20日`)は「歩行器」がv2プロンプトの必須5項目に品目が無いため8/8回欠落する構造的な結果であり、`mustCover=[氏名,日付]`・`minCoveredFacts=2`として85%一律ゲートの対象外にした
6. **v2プロンプトはデータファイル化、本番`summaryPromptBuilder.ts`は無改変**: `scripts/fixtures/sarashina-summary-golden/prompt-v2.txt`に固定し、ドリフトガードが`bench.py`のリテラルとの一致(クロス言語ドリフト検知)・`manifest.json`のSHA-256一致を検証する。PR3スコープ(本番プロンプトへの実装)を先取りしない
7. **テスト配置は`functions/test/`(mocha)と`scripts/lib/`(node:test)の2箇所**: `shared/`配下のロジックは`functions/test/customerIdentity.test.ts`の前例に倣い`functions/test/summaryFabricationScan.test.ts`・`sarashinaSummaryScanCorpus.test.ts`に、ドリフトガードは`scripts/lib/paddleOcrModelHashes.test.ts`の前例に倣い`scripts/lib/sarashinaSummaryGoldenDrift.test.ts`に配置。いずれも既存CI配線(`cd scripts && npm test`・`npm run test:functions`)で拾われるため`.github/workflows/ci.yml`の変更は不要
8. **verbatim判定は助詞トリムの後に、core全体の完全一致のみで行う**(`codex review`実装後レビューP2指摘): 当初はverbatim判定(左文脈の右詰め部分列のいずれかがsourceに一致すれば検出しない)を助詞トリムより先に行っていたが、この設計だと実在する`青葉クリニック`に捏造プレフィックス`新`を付けた`新青葉クリニック`が、部分列`青葉クリニック`だけでverbatim一致しバイパスされる欠陥があった。助詞トリムを先に行いcoreを確定させたうえで、`core+suffix`全体の完全一致のみを見る順序へ変更した
9. **正規化に改行除去を追加**(`codex review`実装後レビューP2指摘): 当初`normalizeForFabricationScan`は空白・タブのみを除去し改行を除去していなかった。PaddleOCRのレイアウト都合で実在の組織名がページ・行境界で分断される(`青葉\nクリニック`等)ケースで、sourceText側の改行が残ったまま文字列比較すると一致せず、実在する組織名を誤ってfabricatedと判定する偽陽性を招いていた。改行(`\r`/`\n`)も空白と同様に除去する設計へ修正した(summaryText/sourceText両方に同じ正規化を適用するため一貫性は保たれる)
10. **`DEFAULT_PARTICLES`はロジック側で長さ降順にソートしてから使う**(pr-review-toolkit code-reviewer/pr-test-analyzer、複数エージェントが独立に同一箇所を検出): 助詞トリムは長い語を先に評価しないと短い語が先にマッチして残余(`という点`の`点`等)がcoreへ混入するが、配列の記述順に「長い語を先に置く」不変条件を手動維持する設計は破綻しやすく、実際に`した際`が`した`より後にある状態でコミットされていた。ソート責務を配列の記述順からロジック側(`trimParticles`関数内)へ移し、記述順に依存しない設計へ修正した
11. **`NAME_CHAR`に「々」(踊り字)を追加**(`codex review` 2回目指摘、P2): 「佐々木クリニック」のような日本語人名頻出の踊り字がNAME_CHARに含まれていなかったため、左文脈抽出が「々」の手前で止まり、捏造プレフィックス(「新佐々木クリニック」等)の検出漏れを招いていた
12. **既知の限界として受容した2件(decision-maker確認済み、2026-09-22)**: `codex review` 2回目で追加検出された(a) 組織名内部に助詞と同じ文字列を含む場合のトリム誤り(「さくらの里クリニック」の「の」)、(b) `maxLeftContext`(既定16文字)を超える捏造プレフィックス+長い実在名の組み合わせでの検出漏れ、の2件は、正規表現+文脈判定という設計そのものの限界(形態素解析なしには構造的に解決できない)に起因し、PR0結果28run全件では未発生の理論的な攻撃パターンであるため、これ以上の精緻化は行わないとdecision-makerと合意した。「現状こう振る舞う」ことを対照コーパステスト(`functions/test/summaryFabricationScan.test.ts`の「【既知の限界】」テスト)で固定し、将来の意図しない挙動変化を検知できるようにしている。本スキャナはPR4で捏造検知の唯一の安全装置ではなく複数の防御層の1つとして機能する設計であることに留意(詳細は`shared/summaryFabricationScan.ts`冒頭コメント参照)
13. **coreがORG_SUFFIX語彙自体と一致する場合も検出しない**(`codex review` 3回目指摘、P2): 「訪問看護ステーションが担当」(suffix=`ステーション`、core=`訪問看護`)のような、固有名詞を伴わない一般的なサービス種別の連結表現がfabricatedと誤検出されていた。`orgSuffixSet`を新設し、trimParticles後のcoreが別のORG_SUFFIX語彙自体と一致する場合も汎用語として除外するよう修正した(回帰テスト: `functions/test/summaryFabricationScan.test.ts`)。同時に、`scripts/lib/sarashinaSummaryGoldenDrift.test.ts`にbench.py側の独立した`MAX_INPUT`定数をmanifest.jsonと直接突合するテストを追加した(3回目codex review指摘、P2: 本番`summaryPromptBuilder.ts`との一致だけではbench.py側の切り詰め値が将来ズレても検知できない構造的な穴があった)。両修正とも既存41+7テストが緑のまま追加でき、`FABRICATION_SCAN_CONFIG_VERSION`(config内容のハッシュ)は変化しなかったため`manifest.json`の再生成は不要だった
14. **4回目codex reviewで新たに2件(いずれも実装検証で実バグと確認)**: (a) suffix語彙同士が包含関係(「グループホーム」⊃「ホーム」)の場合、外側の「グループホーム」がgenericCore判定(左文脈が空文字)で候補にすら入らないと、内側の「ホーム」だけが生き残り「グループ」を捏造coreとして誤検出する偽陽性(「利用先はグループホームです」で再現確認)。suffix自体の包含関係を左文脈確定より前の段階(生マッチ`rawMatches`)で解消するよう修正した。(b) 「株式会社」「有限会社」は実務では「株式会社みずほ」のようにプレフィックス表記される方が一般的だが、①〜③の判定は一貫して「core+suffix」(名前が先)の順序のみを前提にしており、プレフィックス表記の捏造企業名が左文脈の空判定で検出をすり抜ける偽陰性だった(スキャナの目的そのものを損なう重大度が高い指摘のため「既知の限界」として受容せず修正)。`PREFIX_CAPABLE_SUFFIXES`(`株式会社`/`有限会社`の2語彙のみ、他のsuffix語彙はプレフィックスとして使われる日本語表現が存在しないため対象外)を新設し、`extractRightContext`/`trimParticlesFromPrefix`(既存の左方向ロジックと対称)による右方向の追加パスで「suffix+core」順の候補も生成するよう修正した。回帰テスト4件追加、functions(2307)/scripts(436)全テストPASS、`FABRICATION_SCAN_CONFIG_VERSION`は変化なし(ロジック変更のみでconfig内容は不変のため)
15. **5回目codex reviewの新規指摘は既知の限界として受容(decision-maker確認済み、2026-09-22)**: 4回目修正で追加したプレフィックス方向(右方向)の`trimParticlesFromPrefix`に、既存の【既知の限界】2(組織名内部に助詞と同じ文字列を含む場合の左方向トリム誤発動)と構造的に同一の限界が対称的に存在する: 企業名の先頭1文字が助詞と偶然一致する場合(「株式会社のぞみ」の「の」)、空文字までトリムされgenericCore判定で除外され検出をすり抜ける。正規表現+文脈判定という設計そのものの限界(境界が助詞の1文字と偶然一致するケース)であり、PR0実データ28runでは未発生の理論的な攻撃パターンのため、2回目で既に受容した同種の限界の延長として追加の精緻化は行わないと判断した。「現状こう振る舞う」ことを対照コーパステスト(`functions/test/summaryFabricationScan.test.ts`の【既知の限界】テスト、計3件)で固定した。この時点でcodex reviewを5回実施し、新規実バグ4件は全て修正済み・残る既知の限界は4件(いずれも正規表現+文脈判定の設計限界に起因、うち3件〔項目1「もみじ整形外科」型・項目2「さくらの里」型・項目3`maxLeftContext`超過型〕は左方向、1件〔項目4「株式会社のぞみ」型、項目2と対称構造〕は右方向)であることを確認し、PR2aのレビューを収束させた

### PR2b実装知見(実機ゲートハーネス)

`scripts/lib/sarashinaSummaryScore.ts`(カバー率・数値捏造・金額混入・cross-entity判定)+`scripts/lib/sarashinaSummaryVerify.ts`+`scripts/sarashina-summary-verify.ts`(CLIエントリ)+`.github/workflows/sarashina-summary-verify.yml`を実装する過程で、`/plan-crossreview`(grip自白+codex 2パス、着手前)と`codex review`(実装後、2回)の指摘を反映した。詳細は`scripts/fixtures/sarashina-summary-golden/README.md`を参照。

1. **`cloudRunVerifyCommon.ts`への抽出は「サービス非依存であることが構造的に保証できる関数のみ」に限定した**(`/plan-crossreview` codex High指摘): 当初「ロジック変更ゼロの移動のみ」と説明していたが、`sendOcrWithRetries`はPDF Buffer payload・OCR用retry方針を型・実装に埋め込んでおり単純な共通化はOCR方針の無自覚な混入を招く。抽出対象を`decodeJwtExpSeconds`/`IdTokenProvider`/`mintIdToken`/`classifyFailure`/`snapshotsMatch`/`parseEnvField`/`requireEnvField`/`sha256File`/`summarizeLatencies`/`gateVerdict`/`sleep`/`parsePositiveIntMinutesToMs`のみに縮小し、`getServiceSnapshot`/`resolveServiceUrl`/リクエスト送信+リトライ本体はSarashina側で独自実装した(安全方針: timeout/504はその場でリトライしない)
2. **cross-entity判定は`PASS`/`FAIL`/`NOT_EVALUATED`の3値**(`/plan-crossreview` codex High指摘反映): 当初「inconclusiveでもpassed:true」という設計だったが、対象者取り違えを構造的に緑判定しうると指摘され、`NOT_EVALUATED`は「全ゲートPASS」の集計から除外する設計へ変更した(v2プロンプトの関係者列挙行〔複数人物同一行〕は判定不能としてスキップする既知の限界がある)
3. **金額混入検知(`checkAmountProhibition`)はモジュール自体がFAIL/WARNのポリシーを持たず、構造化結果のみを返す**(`/plan-crossreview` codex指摘反映): 「金額とは何か」の陽性/陰性/境界の対照コーパスが未整備なため、FAIL/WARNの判断は呼び出し側(9ゲート表)の責務とし、初回実装時点では`amount-absence`ゲートをWARN専用にした
4. **PR0結果28run(v1プロンプト分)への回帰テスト固定はPR2aと同じ教訓を踏襲**: 「Pythonプロトタイプでの実測は設計検証であり実装の証明ではない」ため、`scoreSummary()`実装後に実際に28run全件へ実行した結果を`scripts/fixtures/sarashina-summary-golden/pr0-score-expected.json`に固定し、`scripts/lib/sarashinaSummaryScoreCorpus.test.ts`で回帰検証する。28run全件でblocking 0件・warningsは全件`出力形状: eos-token`(生テキスト末尾の`</s>`残留、正規化前に判定する契約通りの検知であり不具合ではない)
5. **runtime-contractは3層に分離し、各層が主張する範囲を明確にした**(`/plan-crossreview` codex指摘7反映): (a) `/props`実測値(build_info/model_alias/total_slots/`default_generation_settings.n_ctx`)、(b) `gcloud run services describe`によるrevision/image一貫性(サービススナップショット比較、`inconclusive`判定側の責務)、(c) manifest.json同士の静的検証(`sarashinaSummaryGoldenDrift.test.ts`)。**`/props`の正確なスキーマはllama.cpp公式server READMEで確認したうえ、`.github/workflows/deploy-sarashina-summary.yml`の実デプロイ検証ログ(build_info/model_alias実測一致)で裏取りした**(`total_slots`はトップレベル、`n_ctx`は`default_generation_settings`配下。**訂正(comment-analyzer指摘)**: `model_ftype`は`/props`にトップレベルで実在する(実測: `scripts/fixtures/sarashina-summary-golden/pr0-verification/results/props.json`参照)。量子化タイプは静的層(c)で`expected-model-hashes.json`のfileNameと既に突合済みのため、`checkRuntimeContract`では実行時の重複検証はあえて行わない設計判断であり、「フィールドが存在しないため検証できない」という理由ではない)
6. **v1プロンプトは本番`summaryPromptBuilder.ts`の`buildSummaryPrompt`をそのまま呼び出す**(`/plan-crossreview` codex指摘2反映): 独自実装で再現すると切り詰め・fallbackラベル等の文言がドリフトしうるため、`scripts/lib/sarashinaSummaryVerify.ts`から本番関数を直接importする(v2プロンプトはPR0の参考結果に留め、PR3で改めて判断する)
7. **9ゲート表のうち`output-sanity`はWARN専用とし、`scoreSummary()`自身の`blocking`/`warnings`分類とは意図的に異なる構成にした**: `scoreSummary()`は`thinking-leak`をblocking扱いするが、実機ゲートハーネスの9ゲート表(`runtime-contract`/`fabrication`/`recombination`(WARN)/`coverage-aggregate`/`coverage-per-doc`/`numeric-fabrication`/`amount-absence`(WARN)/`determinism`/`output-sanity`(WARN))では`output-sanity`を`thinking-leak`込みでWARN専用として扱う設計判断のため、`sarashinaSummaryVerify.ts`は`scoreSummary()`を直接使わず個々の判定関数(`evaluateCoverage`/`scanNumericFabrication`/`checkAmountProhibition`/`analyzeOutputShape`/`checkCrossEntity`)を呼び出しゲート表へ再構成する
8. **cross-entity判定(D8対象)は9ゲート表に含めない**: 実装順序ステップ4で明示されたゲート一覧に存在しないため、レポートの参考情報(`crossEntityByDoc`)として記録するに留め、exitCodeへは影響させない
9. **`codex review`(実装後、model_reasoning_effort=high)で検出した4件を反映**: (P1)timedOutが1件でもあれば同一docに成功runがあってもレポート全体をinconclusiveにする(サーバ側で処理継続中の可能性があり以降のサンプルが汚染されうるため、`scripts/paddle-ocr-verify.ts`の`inconclusiveByTimeout`と同じ設計)。(P1)budget超過・早期break等で要求した(doc,run)の一部が1回も送信されなかった場合、`docsWithoutSuccessfulRun`(recordsに存在するdocのみ見る)では検知できず部分実行のままPASSしうるため、要求された全(doc,run)キー集合と実際に送信されたキー集合を直接突き合わせる設計に修正した。(P2)`/props`取得にAbortController経由のtimeout(既定60秒)を追加し、無応答時にハーネス全体がbudgetチェックにも到達できず固まる事故を防止した。(P2)`sarashinaSummaryScoreCorpus.test.ts`に(resultFile,doc,run)キー集合の双方向一致テストを追加し、生JSONへのrun追加や`expected.runs`からの削除を検知できるようにした
10. **ワークフローのconcurrency groupはデプロイworkflowと意図的に同一にする**(`deploy-sarashina-summary-${environment}`): `.github/workflows/paddle-ocr-verify.yml`と同じ設計で、計測中にデプロイworkflowが起動されると自動的にキュー待ちになり、サービススナップショット比較(事後検知)より確実な排他が得られる
11. **`workflow_dispatch`のデフォルトブランチ制約(PR1cで既に遭遇済み)への対処**: featureブランチへのpush直後は本workflowがmain未反映のため`gh workflow run`が404になる。PR2bの完了手順を「①コードPRをマージ→②main上で本workflowをworkflow_dispatch実行→③run URL・成果物を追記する小さなdocsコミットで記録」の2段階に明確化した(①の時点ではコード自体はdev実機を叩かない限りテスト・ビルドに影響しないため、実装済み・実機検証待ちの状態でマージしてよい)

### PR3実装知見(モデルルーティング・クライアント・ディスパッチャー、dead code)

L1(`SUMMARY_PROVIDER`環境変数)/L2(`settings/features.sarashinaSummary`+`sarashinaSummaryAllowlist`)ゲート、Sarashina HTTPクライアント(`functions/src/ocr/sarashinaSummaryClient.ts`)、provider別ディスパッチャー(`functions/src/ocr/summaryPass.ts`)を実装した。**呼び出し元は一切追加していない**(`generateSummaryBatch`/`regenerateSummary.ts`の配線はPR4のスコープ)。`/plan-crossreview`(grip自白可視化+codex 2パス独立診断)を経て設計を確定し、decision-maker承認のうえ実装した。

1. **マスタープランからの意図的な差分(4点)**: (a) `retry.ts`は変更しない — `withRetry`の`isTransientError`が504/timeoutをリトライ対象に含めるため、`SarashinaSummaryClient`は`RETRY_CONFIGS`エントリではなく`withBackoffRetry`(shouldRetry述語で`kind==='transient'`のみ再送)を使う。`RETRY_CONFIGS`への追加は死に設定になるため見送った。(b) `summaryPromptBuilder.ts`はv1プロンプト文面を無変更のまま`MIN_OCR_LENGTH_FOR_SUMMARY`定数のみ移設(下記2参照)。v2プロンプト採用はPR2bで一度も本番検証されていないため見送り、#1018の実測(文言変更で欠落パターンの改善効果ゼロ)とも整合させた。(c) `.github/workflows/deploy-functions.yml`への`SUMMARY_PROVIDER`/`SARASHINA_SUMMARY_URL`注入・run.invoker付与はPR4bへ延期(dead codeで既定`none`のため不要)。(d) ネットワークエラーの再送範囲をPR2bハーネスより狭める(下記5参照)。
2. **`MIN_OCR_LENGTH_FOR_SUMMARY`を`summaryPromptBuilder.ts`へ移設**: `summaryGenerator.ts`はimport経路で`admin.firestore()`を呼ぶ`utils/rateLimiter.ts`に依存するため、admin非依存の`summaryPass.ts`がこの定数だけを読めない問題があった。`summaryPromptBuilder.ts`(import文ゼロ契約)へ実体を移設し、`summaryGenerator.ts`からは`export { MIN_OCR_LENGTH_FOR_SUMMARY };`で再exportする(`regenerateSummary.ts`の既存importは無改変)。
3. **リクエストbody定義をPR2bハーネスと共有する新規モジュール`functions/src/ocr/sarashinaSummaryRequest.ts`(import文ゼロ)を作成**(`/plan-crossreview` codex指摘反映): 本番clientとハーネス(`scripts/lib/sarashinaSummaryVerify.ts`)がそれぞれ独自にリクエストbodyを定義すると、レビュー後に片方だけ変更されドリフトする構造的リスクがある。`buildSarashinaChatRequestBody`/`SARASHINA_SUMMARY_MAX_TOKENS`(1024)/`SARASHINA_SUMMARY_TEMPERATURE`(0.2、いずれもPR2b実機ゲートで全ゲートPASSを確認した値)を単一の情報源とし、`sarashinaSummaryVerify.ts`の`buildChatRequestBody`/`DEFAULT_MAX_TOKENS`/`DEFAULT_TEMPERATURE`はこのモジュールへの薄い委譲(型・関数名は維持、CLI・既存テストのimportは無改変)に変更した。`normalizeSarashinaContent`(末尾`</s>`除去)も同モジュールに置く。
4. **`SarashinaSummaryError`は`status`ではなく`httpStatus`フィールドを使う**: `utils/retry.ts`の`isTransientError`は`.status`/`.code`/メッセージ中の"timeout"を読んでtransient判定するため、`status`という名前のプロパティを持たせると、PR4で`classifySummaryError`(`is429Error`/`isTransientError`を使う既存関数)にそのまま渡された場合に誤読される。PR4は`classifySummaryError`より先に`err instanceof SarashinaSummaryError`を判定すること。
5. **ネットワークエラーの再送はPR2bハーネスより保守的にした**(`/plan-crossreview`反映): ハーネスはネットワークエラー全般を1回再送するが、本番clientは`cause.code`(nested含む、最大5階層)が`ECONNREFUSED`/`ENOTFOUND`/`EAI_AGAIN`(接続確立前に失敗したことが明確)の場合のみtransientとして1回再送し、それ以外(`ECONNRESET`・cause不在・未知のコード)は「再送すると二重推論を否定できない」としてtimeout扱い(再送しない)にする。`cause.code`の実際の値はPR4/PR5の初回canaryで実測記録すること(未検証のまま安全側の既定を敷いている)。
6. **`finish_reason:'length'`(出力上限1024トークンで途中切れ)は成功として保存させない**(`/plan-crossreview` High指摘反映): `SarashinaSummaryError.kind='incomplete'`としてthrowする(`'stop'`以外の値は全てエラー、未知値は`'permanent'`)。途中切れの要約をそのまま`SummaryField`として保存すると、ユーザーには「短いが正常な要約」に見えてしまう。
7. **context超過(400 `exceed_context_size_error`)は1回だけ短縮再送する**(decision-maker決定、2026-09-26): 当初計画では実機でエラー本文を採取する予定だったが、`hy.unimail.11@gmail.com`が対象SA(`sarashina-summary-runtime`等)への`iam.serviceAccountTokenCreator`を持たずID token取得不可と判明(project-level `roles/owner`はリソースレベルのimpersonation権限を含まない)。IAM変更は見送り、代わりにllama.cppソースコード(`ggml-org/llama.cpp` `tools/server/server-context.cpp`/`server-common.cpp`、`gh api`経由で2026-09-26に直接取得・確認)でエラー形状を裏取りした:
   ```json
   {"error": {"code": 400, "message": "request (300 tokens) exceeds the available context size (100 tokens), try increasing it", "type": "exceed_context_size_error"}}
   ```
   `type`は`exceed_context_size_error`で固定(HTTPステータス400)。`message`はプロンプト内容のechoではなくllama.cpp側が生成する定型文(トークン数のみ)であることをソースで確認済みのため、このエラー種別に限り`SarashinaSummaryError.message`へ含める(他のエラー種別は上流がrequest内容をechoする可能性を排除できないため、type/codeのみに留めPII非露出を優先する)。`summaryPass.ts`はこのmessageから正規表現(`\((\d+)\s*tokens?\)[^(]*\((\d+)\s*tokens?\)`、2種の文言差異に両対応)でprompt token数・context sizeを抽出し、文字数ベースの比率(10%の安全マージン込み)で`ocrResult`を切り詰めて**1回だけ**再送する。400は生成前拒否のため二重推論にならない。2回目も超過、またはmessageからトークン数を抽出できない場合はそのままthrowする。**実機での形状確認(このソースコード裏取りが実際のdevデプロイと一致するか)はPR4b(run.invoker付与)以降の初回canaryへ申し送る**。
8. **`summaryPass.ts`のgemini経路は`generateSummaryCore(`をリテラル呼び出しする**: `summaryBuilderCallerContract.test.ts`のCORE_DELEGATE_PATTERNはソース文字列をgrepするため、DI関数参照(`deps.geminiSummarize`)だけでは検知されない。`textCap.ts`/`loadMasterData.ts`と同じlazy require(`require('./summaryGenerator') as typeof import('./summaryGenerator')`)パターンで`generateSummaryCore(ocrResult, documentType)`をリテラル呼び出しし、`summaryPass.ts`を`CORE_CALLERS`へ登録した。これにより`summaryPass.ts`はgemini経路の呼び出し元テストがDI無しでもadmin非依存のまま実行できる(デフォルト実装を使わないテストはadmin初期化不要)。
9. **`summaryWritePayloadContract`の全文走査に配慮した戻り値設計**: `generateSummaryForProvider`の戻り値はshorthandプロパティ構文(`{ provider, summary, finishReason }`)にし、`summary:\s*\{`パターン(コメント・型注釈内含め全文走査で検知される)に一致しないようにした。`summary`がobject literalではなく変数のため、この契約テストへの登録は不要だった。
10. **PR4への申し送り(3点)**: (a) timeout予算 — 最悪`620秒×2+2秒`になりうるため、バッチ処理のFunctions timeoutは`attempts×requestTimeoutMs`以上を確保するか、スケジュール実行時は`attempts=1`を渡すこと。`regenerateSummary`(onCall 60秒)はそのままではSarashinaを呼べない(PR7)。(b) `classifySummaryError`は上記4の理由で`instanceof SarashinaSummaryError`を先に判定すること。(c) `deploy-functions.yml`に`summary_provider_override`入力・`SARASHINA_SUMMARY_URL`解決・fail-fast(sarashina選択時にURL空ならデプロイ失敗)を追加しないと、「L1=geminiロールバック」が運用上実行できない。

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
