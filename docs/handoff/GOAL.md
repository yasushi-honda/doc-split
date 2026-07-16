---
updated: 2026-07-16
---
<!-- session134: 新ミッション着手。前ミッション(Issue #664 phantom count恒久修正、ADR-0021)はsession133で完全達成済み(全文はdocs/handoff/LATEST.md session133サマリ参照予定、git history PR #669/#670/#671でも追跡可)。本ミッションは前ミッションの発端だった「複数顧客FAX複製機能」の設計相談の本体で、Issue #664解決によりブロッカーが除去されたため着手。kanameone現場(平出さん)の要件確定(2026-07-16受領): ①複数利用者記載FAXは検出人数分複製して各利用者フォルダへ配信、後からCMが手動分割 ②担当CMタブの利用者配下フォルダ表記を書類種別名→カテゴリ名に変更。 -->

## 現在のミッション

kanameone現場要件2件を実装する。①「複数顧客FAX複製機能」: OCRで複数の顧客候補を検出した受信FAXを検出人数分複製し、各コピーに異なるcustomerIdを割り当てて各利用者フォルダへ配信する(後から担当CMが手動分割で整理する運用)。②「担当CMフォルダのカテゴリ表記化」: 担当CM別タブの利用者配下フォルダ表記を書類種別名からカテゴリ名(master.category)に変更する。

## 背景・why

- 発端はsession133の設計相談。「ページ分割の自動提案は精度が低いため、複数利用者記載のFAXは分割せず全員に同じものを配信し、後で担当CMごとに操作してもらう方が良い」という現場提案(decision-maker経由)。前提整備としてIssue #664(create/delete順序不同のphantom count)をADR-0021(materialized projection)で先行解決済み
- 2026-07-16に現場(平出さん)から要件が確定: 「利用者3名が記載されている4ページのFAXが届いた際、3名それぞれのフォルダに4ページのファイルが届くようにしてほしい。あとで手動で分割作業をするイメージ」+ カテゴリ表記化の新規要望
- 現場報告のバグ「自動分割後に手動修正しても『分割内容の確認』ボタンで反映されない」は、主要経路はPR #632で修正済み。残存経路(手動修正後の自動検出再実行でインデックスキーのsegmentEditsが誤適用)が特定済みで、本ミッションで修正する
- 実装前のFE/BE横断影響調査完了(session134、Explore 4並列)。要点: ①cleanup-duplicates.jsがfileName単独判定のため複製コピーを誤削除する破壊的リスク(実コード確認済み、複製実装と同一PRで判定キー拡張必須) ②複製注入点はOCR後(ocrProcessor最終tx内)が推奨=Gemini課金N倍回避 ③searchIndexerのgetAll未chunk化(kanameoneで512MiB OOM 201件既発)の前倒し対応が事実上必須 ④再処理経由の再複製無限ループのガード必須 ⑤FE: firestoreToDocument/getReprocessClearFields/useDocumentGroups.ts:189のas Document直キャスト経路への複製フィールド追加 ⑥手動顧客選択UI(選択待ちバッジ等)の意味変化

## 完了の定義

- [x] AC-a: 担当CM別タブで利用者展開時のフォルダがカテゴリ名で表示され、カテゴリ未運用環境では従来の書類種別表示にフォールバックすること(証明: `frontend`で`npx vitest run src/lib/__tests__/groupDocumentsByCategory.test.ts` 10件PASS + ブラウザスクショ)
- [ ] AC-b: 複数顧客候補を検出したFAXが検出人数分のdocumentとして各顧客に配信されること(証明: integration test PASS + dev環境実機確認)
- [ ] AC-c: 複製コピーの再処理で再複製が発生しないこと(証明: ループガードのunit/integration test PASS)
- [ ] AC-d: cleanup-duplicates.jsが意図的な複製コピーを削除対象にしないこと(証明: 判定キー拡張のテスト or dry-run実証)
- [ ] AC-e: 複製導入後もkanameone/cocoroでsearchIndexerのOOMが増加しないこと(証明: getAll chunk化 + デプロイ後のエラーログ確認)
- [ ] AC-f: 分割確認画面の残存バグ(手動修正後の自動検出再実行でsegmentEdits誤適用)が修正されること(証明: PdfSplitModal.test.tsxに再現テスト追加しPASS)
- [ ] AC-g: 全テスト・lint・型チェック・buildがPASSし、kanameone本番(必要ならcocoro)へ展開されること(証明: 各コマンド実行結果 + デプロイ記録)
- 不変条件: 複製機能はクライアント別feature flagで制御し、既定OFFで導入する(kanameoneのみON想定)。ADR-0021の集計モデル・ADR-0016のidentity設計(docId namespace)を変更しない

## 進行中のtasks

- [x] 0. FE/BE横断影響調査(Explore 4並列: BE/FE/カテゴリ/運用インフラ)+cleanup-duplicates.js破壊的リスクの実コード裏取り
- [x] 1. カテゴリ表記化の実装(B案: documentTypeKey→master.category join、全未分類時は書類種別フォールバック)。`groupDocumentsByCategory.ts`新設+テスト10件、`CustomerSubGroup.tsx`フォルダ汎用化、`GroupDocumentList.tsx`にuseDocumentTypes注入。テスト343/lint 0/build PASS
- [ ] 2. カテゴリ表記化のブラウザ確認(#193教訓)+PR作成+/code-review+ui-verifiedラベル+マージ(decision-maker認可)
- [ ] 3. 複数顧客FAX複製機能の/impl-planフル計画(設計判断3点の確定: 注入点OCR後/Storage共有or独立コピー/件数N倍の意味論了承。承認後にタスク分解を本節へ追記)
- [ ] 4. (impl-plan承認後に分解) 複製機能の実装・防御的改修・テスト・展開
- [ ] 5. 分割確認画面の残存バグ修正(AC-f)

## 🔄 中断点（in-flight）

- 対象タスク: 2. カテゴリ表記化のブラウザ確認+PR
- 直前の状態: feat/cm-folder-category-labelブランチで実装完了、全品質ゲートPASS、未コミット
- 次の一手: コミット→ブラウザ確認(ローカルvite or dev環境)→PR作成
- 検証コマンド: `git -C /Users/yyyhhh/Projects/doc-split status && cd frontend && npx vitest run src/lib/__tests__/groupDocumentsByCategory.test.ts`
