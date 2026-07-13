---
updated: 2026-07-13
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
- [ ] A. 候補抽出用・第2Gemini呼出しのスパイク（pageText入力でのresponseSchema実現性・grounding検証手法・プロンプトインジェクション対策の検証、出力トークン実測）
- [ ] B. 候補抽出呼出し実装（`ocrProcessor.ts`に新規関数追加、既存`ocrWithGemini()`は無改修、ドキュメント単位で1回呼出し、Aに依存）
- [ ] C. `extractors.ts`拡張 + 保守的arbitration実装（同点全文優先・grounding必須・日付特別扱い・強根拠昇格ルール、Bと並列可能）
- [ ] D. `processDocument()`統合（候補抽出+arbitration組込み、失敗時は既存動作へフォールバック、B,Cに依存）
- [ ] E. 単体テスト追加（extractors.ts新関数・arbitrationロジック・フォールバックケース、C,Dに依存）
- [ ] F. A/Bテストハーネス拡張 + 4項目gate化 + 日付/書類種別用の人手ラベル付き固定評価セット新規整備（層化抽出: 複数人名/複数日付/FAX/手書き/複数ページ、B,Cと並列着手可）
- [ ] G. dev環境A/Bテスト実行（4項目の精度・トークン増分・grounding失敗率確認、D,E,Fに依存）
- [ ] H. kanameone confirmed-replay検証（read-only、Gが良好な場合のみ実施、番号単位認可）
- [ ] I. prod展開判断+実施（Hが基準を満たす場合のみ、kanameone→cocoro順、番号単位認可）

## 🔄 中断点（in-flight）
なし

## 監視・確認事項（トリガー待ち、前ミッション#547/#548から継続）
- egress実削減効果の翌月請求での実測確認（未実施。8月上旬の7月分請求書で確認）
- #548試算（全対策後¥23,000/月）の実額最終確認（実額は7月分請求書確定後）
- dev環境のテストデータ`phase-e-devcheck-001`/`phase-e-devcheck-002`の後片付け（任意）
- 前ミッション（#547/#548運用コスト圧縮2トラック）は2026-07-10技術完了・2026-07-12是正確認済み。詳細はgit history（`git log -p docs/handoff/GOAL.md`）およびdocs/handoff/LATEST.md/archive参照
