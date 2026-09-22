# Sarashina要約 品質検証fixture(D1〜D10)

ADR-0027(要約生成Gemini依存脱却、Sarashina2.2-3B移行)のPR0で実施する固有名詞捏造テスト・カバー率検証に使う模擬介護文書。**全て架空のデータ**(氏名・事業所名・日付・金額は実在しない)。

## 由来

2026-09-21のセッションでSarashina2.2-3B(Q4_K_M/Q8_0量子化)のCPU実用性を検証した際に作成した模擬文書一式。当初はセッション固有のスクラッチパッドディレクトリにのみ存在し、リポジトリにコミットされていなかった(`/plan-crossreview`のcodexレビューで「品質検証の再現性が無い」とHigh指摘された論点への対応として、PR0でこの場所へ移設した)。

## 構成

| ファイル | 用途 | 特徴 |
|---|---|---|
| D1〜D4 | カバー率検証 | 実在しない事業所名・氏名を含む正式書式(FAX送付状〜居宅サービス計画書、250〜9,940字) |
| D5 | 金額捏造検知 | 出典に金額の記載が一切ない |
| D6 | 数値取り違え検知 | 類似する数値が複数箇所に登場する |
| D7 | OCR劣化耐性 | OCR誤読を模したノイズを含む |
| D8 | 対象者取り違え検知 | 複数利用者・複数日付・複数受診先が混在する合同報告書 |
| D9 | **固有名詞捏造検知の本丸** | 正式書式だが事業所名の記載が一切ない(福祉用具貸与確認書)。Q4_K_M量子化ではここで実在しない事業所名を8/8回捏造した |
| D10 | 固有名詞捏造の対照群 | 体裁のないメモ、固有名詞ゼロ |

`meta.json`は各文書の`title`(書類種別)・`chars`/`chars_used`・`facts`(カバー率判定用の期待キーワード全体)を保持する。**PR2aで`role`(`coverage`/`numeric`/`cross-entity`/`fabrication`)・`mustCover`(必須事実、個別に充足を判定)・`optionalFacts`(任意事実、率算入のみ)・`minCoveredFacts`(丸め誤差を避けた整数個数の基準)を追加**した(`/plan-crossreview`のcodex High指摘反映、「歩行器のような非必須事実の充足で氏名等の重要事実脱落を相殺してしまう」設計上の穴を解消)。D9は`mustCover=['三好 陽子','9月20日']`・`optionalFacts=['歩行器']`・`minCoveredFacts=2`(実測67%は「歩行器」がv2プロンプトの必須5項目に品目が無いため8/8回欠落する構造的な結果であり、fabrication検知の対象・coverage 85%ゲートの対象外)。D5〜D8はPR0で未実行のため`mustCover`は暫定的に`facts`をそのまま採用しており、PR2bの実機ゲート初回実行値で見直すこと。

## 固有名詞捏造スキャナ(PR2a、実装済み)

`shared/summaryFabricationScan.ts`が正式なTypeScript実装。PR0の`pr0-verification/scan_entity_fabrication.py`(正規表現のみ、地の文巻き込みで誤検出多数)を、左文脈抽出→verbatim判定→助詞トリム→再結合判定の4段階アルゴリズムへ置き換えた。

**重要な経緯(`/plan-crossreview`のcodex High指摘)**: 当初「実データ28runで誤検出13→0を確認済み」とプランに記載していたが、これは実装前の設計提案に過ぎず未検証だった。PR2a実装時に実際にPR0結果JSON(28run)へ実行し、`pr0-fabrication-expected.json`に期待値を固定したうえで`functions/test/sarashinaSummaryScanCorpus.test.ts`で回帰検証している(fabricated=0件、recombined=3件〔D3 run3の`水無月訪問看護`等、原典の括弧書き略記`訪問看護（水無月）`の言い換えであり捏造ではない〕)。

- `manifest.json`: モデルハッシュ(`services/sarashina-summary/expected-model-hashes.json`のミラー)・fixtureハッシュ(docs/*.txt, meta.json)・プロンプトハッシュ(`prompt-v2.txt`)・捏造スキャナ設定ハッシュ(`fabricationScanConfigVersion`)を集約。`scripts/lib/sarashinaSummaryGoldenDrift.test.ts`がこれら全ての整合をCIで検証する(`cd scripts && npm test`、既存配線を流用、追加のCI変更は不要)
- `prompt-v2.txt`: PR0検証で使ったv2プロンプト(`bench.py`の`build_prompt_v2`と同一文面)をデータファイルとして固定。本番`functions/src/ocr/summaryPromptBuilder.ts`は無改変(PR3スコープを侵さない)。ドリフトガードが`bench.py`のリテラルと突合しクロス言語ドリフトを検知する
- 既知の限界: 助詞トリムは`lastIndexOf`ベースの単純一致のため、1文字助詞(「も」等)が固有名詞の先頭1文字と偶然一致するケース(例:「もみじ整形外科」)では誤ってトリムしうる。PR0結果28run全件では未発生(コーパス回帰テストで確認済み)。詳細は`shared/summaryFabricationScan.ts`冒頭コメント参照

## 使い方(PR0時点の記録、Pythonスクリプトによる暫定検証)

## PR0実測結果(2026-09-21〜22実施・完了)

`pr0-verification/`に、PR0で実際に使用したDockerfile・cloudbuild.yaml・検証スクリプト(`bench.py`/`scan_entity_fabrication.py`/`score.py`)と、実験結果(`results/`配下、モデルのpropsレスポンス含む)を保存している。

- 使用モデル: `https://huggingface.co/mmnga/sarashina2.2-3b-instruct-v0.1-gguf`(コミュニティ配布Q8_0量子化)
- イメージdigest: `asia-northeast1-docker.pkg.dev/doc-split-dev/slm-bench/sarashina-pr0@sha256:75040ceb4ce18b8ea1d0065186abfac094733de4a4995c602bfb0eac1d34874b`(検証用リソースは実測後に削除済み、digestのみ記録として残す)
- ベースイメージ: `ghcr.io/ggml-org/llama.cpp:server`(build_info: `b11065-ce8caa6e6`)
- 結果サマリ: D9(事業所名欠落)で捏造0/8回、D1〜D4カバー率95〜100%・数値捏造0件。前回(セッション固有のスクラッチパッドのみで実施)の結果を独立した再ビルド・再デプロイで再現できた
- 詳細な実測結果・重大な発見(出力トークン数上限がサーバー起動時設定に依存できない等)は`~/.claude/plans/logical-baking-lighthouse.md`の「PR0実測結果」節を参照(プランファイルは個人のホームディレクトリにありリポジトリ外のため、本移行を正式に実装する際は該当内容をADR(`docs/adr/0027-sarashina-summary-migration.md`)へ転記すること)
