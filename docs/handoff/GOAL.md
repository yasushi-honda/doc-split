---
updated: 2026-07-14
---
<!-- session121: 新ミッション着手。前ミッション(#547/#548運用コスト圧縮2トラック)は達成済みのためgit historyへ圧縮済み(git log -p docs/handoff/GOAL.md参照)。本ミッションはIssue #548「保留カード」(OCR全文転記→エンティティリスト化)の技術検証から派生。当初コスト削減目的だったが、保守的スコープではコスト削減効果がほぼ見込めないと判明したため「突合精度向上」に目的を再定義(decision-maker合意)。Codexセカンドオピニオン(plan mode)で2点の設計修正(呼出し分離+保守的arbitration)を反映済み -->

## 現在のミッション
OCR突合（documentType/customerName/officeName/date）の精度向上のため、Geminiに文書内の候補テキストを独立呼出しで抽出させ、既存のマスター突合ロジック（`extractors.ts`）と保守的arbitrationで統合する。dev環境でA/B検証を固め、精度が現行を下回らないことを確認できた場合のみkanameone→cocoro本番展開する。

## 背景・why
- 前身のIssue #548「保留カード」（OCR全文転記→エンティティリスト化、コスト削減目的、−¥11,000/月級と試算）を技術検証した結果、保守的スコープ（PDF分割検出・全文表示・要約生成を維持）ではコスト削減効果はほぼ見込めないと判明し、目的を「突合精度向上」に再定義（decision-maker合意、session121）
- Codexセカンドオピニオン（plan mode、session121）で2点の重大な指摘を受け計画に反映済み:
  1. 全文転記とエンティティ抽出を同一Gemini呼出しにすると、PDF分割検出・全文表示・要約生成への「影響ゼロ」という前提が崩れる → **候補抽出を別呼出しに分離**（既存`ocrWithGemini()`は無改修、pageText結合テキストを入力とする新規呼出しを追加）
  2. best-of選択（スコアが高い方を無条件採用）は、誤った候補が偶然マスターと完全一致した場合に正しい既存結果を上書きするリスクがある → **保守的arbitration**（同点は全文系優先、候補はpageText内への逐語的存在確認=grounding必須、日付は種別・根拠込みで特別扱い）
- 不変条件（絶対）: 突合の精度劣化は一切禁止。候補抽出呼出しが失敗しても既存の全文ベース突合にフォールバックし、本体OCR処理は絶対にブロックしない

## 完了の定義
- 候補抽出呼出しの追加が既存`ocrWithGemini()`/pageResults保存処理を一切変更しない（証明: git diffで`functions/src/ocr/ocrProcessor.ts`の既存OCR部分が無改修であることを確認）
- 新ロジックが既存`extractDocumentTypeEnhanced`等のシグネチャを破壊しない（証明: `cd functions && npm test`で既存テスト全PASS）
- 候補抽出呼出しが失敗/タイムアウト/スキーマ逸脱しても既存の全文ベース突合で処理継続する（証明: 単体テストで候補抽出例外ケースを追加しPASS）
- arbitrationが「同点は全文系優先」「grounding必須」「日付は種別・根拠込みで判定」を満たす（証明: 単体テストで誤マスター一致による上書きシナリオを再現し防止できることを確認）
- dev環境A/Bテストで書類種別/顧客/事業所/日付の4項目とも精度が現行を下回らない（証明: 拡張版`compare-gemini-ocr-models-confirmed.ts`相当のdev実行結果）
- kanameone confirmed-replay検証（顧客/事業所は既存実データ、書類種別/日付は新規人手ラベル評価セット）で4項目とも精度が現行同等以上（証明: GitHub Actions実行ログ、read-only）
- 出力トークン増分・コスト増が実測・可視化されている（証明: A/Bハーネスのトークン計測ログ）
- 本番展開後、kanameone/cocoro双方でエラー率が展開前と同水準（証明: `fix-stuck-documents --include-errors --dry-run`でエラー0件）
- 不変条件: 上記いずれかのACが未達の場合、無理に本番展開しない（dev検証止まりで完了とする撤退基準）

## 進行中のtasks
- [x] A. 候補抽出用・第2Gemini呼出しのスパイク（完了、2026-07-13 session121）— `scripts/spike-candidate-extraction.ts`実装、GitHub Actions経由でdev環境実行。結果: 11/11ページ成功・JSON解析失敗0件、grounding率93〜95%(2回実行)、プロンプトインジェクション耐性PASS(2回)、候補抽出呼出し1回あたり概算$0.004(N=11件で$0.044〜0.047)。**重要な発見**: not-grounded事例は「別の妥当な値」ではなく候補抽出呼出し自体の文字レベル転記誤り(「請求書」→「舅求書」等)。Codex指摘のgrounding必須arbitrationが実害を防ぐことを実証。**既知の限界（タスクBで対応）**: Codexセカンドオピニオン(review-diff、1回目)指摘により、本スパイクは**ページ単位**で候補抽出を検証しており、計画上のタスクB実装（**ドキュメント単位**で結合pageTextを1回で処理）とは呼出し粒度が異なる。複数ページ文書の結合テキストでの本番想定プロンプトサイズ・トークンコスト・クロスページの候補選択挙動は未検証のため、タスクB実装時に改めてドキュメント単位での実測を行う。**既知の限界（本スクリプト単独ではスコープ外）**: Codexセカンドオピニオン(review、2回目)指摘により、`ocrPageVerbatim()`の異常応答検知ロジック(`response.candidates?.[0]?.finishReason`/`promptFeedback?.blockReason`ベース)は、zero-candidate応答(candidates配列が空でblockReason/finishReasonも両方undefined)を検知できないギャップがある。このロジックは`scripts/compare-gemini-ocr-models.ts`の`ocrPage()`から複製したもので、既存スクリプトにも同じギャップが存在する（本PRのスコープ外、修正する場合は既存スクリプト側の改修として別途decision-maker判断が必要）
- [x] B. 候補抽出呼出し実装（完了、2026-07-13 session121）— `functions/src/ocr/ocrProcessor.ts`に`extractOcrCandidates(ocrResult, documentId?)`を新規追加（既存`ocrWithGemini()`は無改修、独立した第2Gemini呼出し）。候補抽出はbest-effort設計でAPI失敗/JSON解析失敗時は例外を投げず4項目全nullを返す。**タスクAの既知の限界（ページ単位検証と本番ドキュメント単位実装の粒度乖離）を解消**: `scripts/verify-candidate-extraction-document-level.ts`で実装済み関数を直接import(再実装ではない)しdev環境で実機検証、複数ページ結合テキスト(5-6ページ、662/579文字)で2/2成功・grounding8/8(100%、2回目実行では6/8=75%で「訪問看護報告書」→「舖商看艷報告昸」等のより激しい文字化けも観測、grounding必須arbitrationの必要性を追加裏付け)・ドキュメント単位1回あたり概算$0.0052〜0.0038を確認。`/safe-refactor`(DRY違反=`ocrPageVerbatim`重複を`scripts/lib/geminiOcrCompare.ts`の`ocrPageWithAnomalyDetection()`へ統合、共有可変オブジェクト参照リスク=スプレッドコピー化)、`/code-review medium`(8角度finder+1票検証、CONFIRMED 3件を修正: safeLogError未使用→追加・`documentId`引数追加、型重複→`Pick<OcrCandidateExtractionResult,...>`化、dev-guard重複→現状維持)を実施。functions側テスト1,735 passing・lint 0 errors
  - **タスクC以降で対応する既知の限界（PLAUSIBLE判定4件、`/code-review medium`で検出・decision-maker判断によりdefer）**:
    1. `ocrPageWithAnomalyDetection()`/`extractOcrCandidates()`とも`finishReason==='MAX_TOKENS'`による部分打切りを異常検知できない（`!response.text`の場合のみ検査、非空だが不完全なテキストは素通り）。特に`extractOcrCandidates()`は`finishReason`検査が一切ない
    2. `extractOcrCandidates()`が毎回`new GoogleGenAI()`を構築(`ocrPageWithAnomalyDetection()`は呼出元から`ai`を受け取る設計と不統一、レート制限バイパスにはならないが認証コストの無駄)
    3. `candidateSchema`/`buildCandidateExtractionPrompt`が`scripts/spike-candidate-extraction.ts`と重複(コードベース既存の「複製+同期コメント」パターンの延長)
    4. `usageMetadata`からのトークン集計パターンが6箇所に重複(SDKフィールドアクセスのボイラープレート、リスク低)
  - `/review-pr`(4エージェント並列: code-reviewer/comment-analyzer/silent-failure-hunter/type-design-analyzer)+ `/codex review`セカンドオピニオンも実施。Codexの唯一の指摘(P1「PROJECT_ID未伝播で全候補抽出呼出しが失敗」)は**REFUTED**: `google-github-actions/auth@v2`の`export_environment_variables: true`設定によりジョブ全体に`GCLOUD_PROJECT`/`GOOGLE_CLOUD_PROJECT`が自動エクスポートされることを実行ログで確認、実際の複数回成功実行(実測トークン数あり)とも整合。review-pr新規指摘のうちCONFIRMED相当3件は修正済み(本番コードのGOAL.mdタスク参照コメントをインライン化=将来のミッション圧縮でダングリング参照化するリスクを解消、プロンプト文言「同一」主張の事実誤認を訂正、JSON.parse成功後の型ガード追加でouter catchによるエラー誤分類=`apiCallError`と`jsonParseError`の取り違えを解消)
  - **タスクC以降で対応する既知の限界（追加、review-pr検出）**:
    5. `scripts/verify-candidate-extraction-document-level.ts:83`が`ocrProcessor.ts:331-333`という行番号を直接コメントで参照。将来ocrProcessor.ts上部が変更されるとサイレントに古びる(comment-analyzer指摘、優先度低)
    6. `inputTokens`/`outputTokens`/`thinkingTokens`のトークン3つ組が`OcrProcessingResult`/`OcrCandidateExtractionResult`/`OcrPageResult`の3箇所で重複定義。共通サブ型への切り出しが可能(type-design-analyzer指摘、低リスクDRY改善)
    7. Evaluator分離プロトコル(`rules/quality-gate.md`、5ファイル+新機能で発動条件)が本PRでは未実施(code-reviewer指摘、プロセス確認事項としてdecision-maker判断待ち)
- [x] C. `extractors.ts`拡張 + 保守的arbitration実装（完了、2026-07-14 session122）— `functions/src/utils/extractors.ts`に`arbitrateDocumentType`/`arbitrateOfficeName`/`arbitrateCustomerName`/`arbitrateDate`を新規追加（既存4関数は無改修）。設計はCodexセカンドオピニオン(plan mode)反映: 既存が何らかのマッチ済みなら候補がどれだけ高スコアでも上書きしない、昇格対象は候補を既存関数へ再入力しexact matchの場合のみに限定、候補はOCR全文へのgrounding(逐語一致)必須。「弱い根拠」判定はdecision-maker選択により最も保守的な値(documentType: matchType==='none'のみ/officeName・customerName: bestMatch===nullのみ/date: date===nullのみ)を採用。`/code-review medium`(8角度finder+1票検証)でCONFIRMED 5件検出・修正: isGroundedInTextに最小長ガード追加(短い候補の誤昇格を実機再現・修正)、arbitrateDocumentTypeに既存searchRange=300制約を適用、documentType/customerNameのexact-match昇格に#501対策(computeCommonShortMasters)を適用しoffice系との非対称性を解消、arbitrateDateに全角→半角変換を追加(全角日付が機能しないバグを修正)、日付フォーマット処理を既存formatDateStringヘルパーに統一。functions側テスト1,760 passing・lint 0 errors。PR #643。
  - **タスクD以降で対応する既知の限界（Codexセカンドオピニオン`/codex review-diff`検出、P1、decision-maker判断によりタスクGで実測してから判断）**: documentType/officeName/customerName/dateいずれも、「候補がgroundingされ、かつ候補単体の再照合でexact match」という昇格条件は、部分文字列包含関係の推移律により「既存の全文ベース抽出でも同じマッチが既に見つかっているはず」という関係と論理的に重なる。特にdocumentTypeは今回のsearchRange制約追加によりこの関係がより厳密に成立するため、候補側への昇格が実質的にほぼ発生しない(no-op化する)可能性がある。精度劣化はしない(不変条件維持)が、期待する精度向上効果も出ない可能性がある。タスクF/GのA/Bテストで実際の昇格頻度・効果を実測し、無意味と判明した場合は昇格条件（exact限定の緩和・searchRange制約の見直し等）を再設計する
- [x] D. `processDocument()`統合（完了、2026-07-14 session123）— `functions/src/ocr/ocrProcessor.ts`の`processDocument()`に`extractOcrCandidates()`(タスクB)+`arbitrateDocumentType`/`arbitrateCustomerName`/`arbitrateOfficeName`/`arbitrateDate`(タスクC)を統合。既存の全文ベース抽出結果を無条件に上書きしない設計を維持し、dateMarker解決はarbitration後のdocumentType結果を参照するよう順序調整（候補昇格時にdateMarkerも追従）。候補抽出呼出しのトークンを`totalInputTokens`等へ加算し`trackGeminiUsage`経由の本番コスト計測に反映。契約テスト(`ocrProcessorCandidateArbitrationWiringContract.test.ts`)で配線をlock-in。functions側テスト1,770 passing・lint/tsc 0 errors。`/code-review low`+独立evaluatorエージェント(前提知識なし、AC 10項目個別検証)で全PASS確認済み(HIGH/MEDIUM指摘0件)。PR #644作成・マージ済み(main→dev自動デプロイCI/Deploy workflow両方SUCCESS確認済み、kanameone/cocoroには未反映)。PR上のCodeRabbit指摘(「既存4項目全マッチ時はextractOcrCandidates呼出しが無駄コスト」)は検証の上正当と判断、decision-maker判断で現状PRのままマージ・最適化は別対応で保留。
- [ ] E. 単体テスト追加（extractors.ts新関数・arbitrationロジック・フォールバックケース、C,Dに依存）— **状況(2026-07-14 session123)**: arbitrate*関数のunit testはタスクCで既に追加済み(null候補フォールバックケース含む)、processDocument()統合の配線契約テストはタスクDで追加済み。残りうるスコープは`extractOcrCandidates()`自体のAPI例外/JSON解析失敗パスのmock unit test(現状はタスクA/Bの実機検証のみでカバー、Vertex AI依存のためlocal unit test化は別途モック設計が必要)。decision-maker判断で「実質完了」とみなすか、専用mock testを追加するか要確認
- [x] F. A/Bテストハーネス拡張（完了、2026-07-14 session123）— `scripts/compare-ocr-arbitration-logic.ts`新規追加。既存`compare-gemini-ocr-models.ts`(モデルA/B比較用、gemini-2.5 vs 3.5)とは軸が異なる「ロジックA/B比較」(同一モデルでbaseline=既存抽出のみ/candidate=候補抽出+arbitration統合後)として、documentType/customerName/officeName/dateの4項目全gate化。既存`seed-dev-data.ts`のMIXED_FAX_PDFSを読み取り専用で再利用(日単位ground truthを持つ3segment、「提供月」表記のみの2segmentは日付評価不可のため対象外)し、複数人名/複数日付の層化用に新規フィクスチャ2件(`scripts/fixtures/arbitrationCompareFixtures.ts`)を追加(`seed-dev-data.ts`自体は無改修で副作用回避)。「手書き」原稿は合成PDFでは再現不可のため既知の限界としてスコープ外(decision-maker判断で必要になれば別途実スキャン素材を検討)。**GitHub Actions実機実行結果(doc-split-dev、run ID 29290104624)**: baseline 5/5文書・4項目全100%一致、candidate 5/5文書・4項目全100%一致(複数人名/複数日付distractorを含む5文書全てで精度劣化なし)、候補抽出grounding失敗率10.0%(非null候補20件中2件not-grounded、arbitrationの保守的設計により誤昇格には至らず)、候補抽出トークン増分input=2837/output=515/thinking=1322(5文書で概算$0.0208)。N=5のためdev一次スクリーニング止まり(タスクG本実行で追加検証)。scripts側テスト84 passing。独立evaluatorエージェントでAC 10項目全PASS確認済み。
  - **タスクG以降への申し送り(evaluator指摘、LOW、AC対象外)**: `provenance`(既存/候補どちらの経路で解決したか)は`buildOcrExtractionUpdatePayload`の入力型に含まれず本番Firestoreへ永続化されない。本番でのarbitration有効性・grounding失敗率の継続観測が必要になった場合、別途observability追加を検討
- [x] G. dev環境A/Bテスト実行（完了、2026-07-14 session124）— 対象文書数拡大の手段はdev環境に実運用データが存在しないため「既存フィクスチャ追加」一択と判断（軽量プラン提示→承認待ちなしで着手）。`scripts/fixtures/arbitrationCompareFixtures.ts`のARBITRATION_DISTRACTOR_DOCSに新規5文書を追加しN=5→N=10へ拡大（CUSTOMERS未使用6名を使用、通常ケース=distractorなし2件+複数人名/複数日付バリエーション追加1件ずつ+全角日付表記1件でタスクCの全角→半角変換修正の回帰確認も兼ねる）。feature branch(`feat/ocr-arbitration-taskg-fixtures`)を切りGitHub Actions "Run Operations Script"(environment: dev、script: compare-ocr-arbitration-logic)で実行(run 29294375536)。**結果**: baseline/candidate両方 4項目全一致 10/10(100.0%)、精度劣化なし・失敗率ゲート内で✅PASS。候補抽出grounding失敗率7.5%(非null候補40件中3件not-grounded、タスクFのN=5時点10.0%と同水準)。候補抽出トークン増分input=5393/output=910/thinking=3032(概算$0.043568、N=5時点比でほぼ線形にスケール)。N=10でも再現性を確認、PR未作成(次アクションでPR作成予定)
- [ ] H. kanameone confirmed-replay検証（read-only、Gが良好な場合のみ実施、番号単位認可）— **Gの結果によりH着手の前提条件は満たされた**。番号単位認可は未取得のため次セッションでdecision-makerへ着手可否を確認する
- [ ] I. prod展開判断+実施（Hが基準を満たす場合のみ、kanameone→cocoro順、番号単位認可）

## 🔄 中断点（in-flight）
なし

## 監視・確認事項（トリガー待ち、前ミッション#547/#548から継続）
- egress実削減効果の翌月請求での実測確認（未実施。8月上旬の7月分請求書で確認）
- #548試算（全対策後¥23,000/月）の実額最終確認（実額は7月分請求書確定後）
- dev環境のテストデータ`phase-e-devcheck-001`/`phase-e-devcheck-002`の後片付け（任意）
- 前ミッション（#547/#548運用コスト圧縮2トラック）は2026-07-10技術完了・2026-07-12是正確認済み。詳細はgit history（`git log -p docs/handoff/GOAL.md`）およびdocs/handoff/LATEST.md/archive参照
