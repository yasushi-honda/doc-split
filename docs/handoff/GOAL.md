---
updated: 2026-07-18
---
<!-- 前ミッション(複数顧客FAX複製機能)は全AC達成済みで2026-07-18に完遂アーカイブ。全文はdocs/handoff/LATEST.md「複数顧客FAX複製機能ミッション 完遂サマリ」参照。本ミッションはそのフォローアップ観測中に発見したIssue #680の修正。 -->

## 現在のミッション

Issue #680（kanameone本番、`search_index`肥大化によるsearchIndexer機能停止）を修正する。走査9770件中4391件(45%)が検索インデックス未構築(drift)の状態を解消し、再発を防止する。

## 背景・why

- 2026-07-18、複数顧客FAX複製機能のAC-eフォローアップ観測中に発見。`search_index/{tokenHash}`ドキュメントがFirestoreの「1ドキュメントあたりの自動インデックスエントリ数上限」を超過し`too many index entries`エラーで`batch.commit()`が失敗し続けている。2026-07-05以前から継続する既存障害で、複製機能のflag ONとは無関係。
- 原因調査完了(Issue #680コメント参照): `search_index/00000644` = bigram`"26"`(fileNameの西暦下2桁)、`search_index/00000d45` = bigram`"l1"`(fax gatewayのレーン番号`-L1-`)。原因は`documents.fileName`(Gmail添付ファイル名=fax gateway命名規則`{prefix}-L{レーン番号}-{YYYYMMDDHHMMSS}.pdf`)が無条件でbigram化されていたこと。
- `/impl-plan`フルモード+Codexセカンドオピニオン(plan mode, effort=high, 2回相談)を経て設計確定。

### 設計確定の経緯

1. **原因調査**: `force-reindex.js --all-drift --dry-run`(GHA経由、read-only)で実測、走査9770件中4391件がdrift(`hash (none)`＝検索インデックス未構築)。日付トークン(YYYY/YYYY-MM/YYYY-MM-DD、2015〜2035年総当たり)は該当せず、drift対象docの実fileNameから逆算して`"26"`/`"l1"`を特定。
2. **Codexセカンドオピニオン1回目**: 4候補(1.tokenizer修正 2.フィールドオーバーライド 3.dfガード 4.組み合わせ)を提示、「1+2+3の段階導入」を推奨。
3. **追加検証**: Firestore公式ドキュメント(map型フィールドのindex exemptionはサブフィールドに継承)+コードグレップ(`postings`への`where`/`orderBy`クエリなし)で案2の安全性を確認。また案1単独では`document_id`型prefix(`DOC260718`等、西暦下2桁を内包)から`"26"`を完全排除できないことが判明。
4. **decision-maker判断**: ロールアウトを2フェーズ分割(Phase A=即時対症+復旧、Phase B=tokenizer品質改善を通常ペースで後続)に決定。
5. **Codexセカンドオピニオン2回目**: 確定計画(Phase A/B分割+tokenizer設計詳細+AC)をレビュー、前回助言との整合性を確認。AC分割・追加テストケース(document_id由来の`"26"`非生成の明示テスト)・dfガードの再開条件明文化を反映して計画確定。

## 採用設計

### Phase A: 即時対症 + 復旧（config変更のみ）
`firestore.indexes.json`に`search_index.postings`のfieldOverride追加。Firestoreの自動インデックスエントリ数上限そのものに抵触しないようにする(tokenizer.ts側のロジックは変更しない)。これにより4391件の復旧(`force-reindex.js`)が可能になる。

### Phase B: tokenizer品質改善（Phase A完了後、通常ペースで着手）
`functions/src/utils/tokenizer.ts`の`generateFieldTokens()`に`includeBigrams`オプションを追加。fileNameのトークン化を生fileNameではなく`functions/src/utils/extractors.ts`の既存関数`extractFilenameInfo()`が返す`prefix`経由に変更。**`prefixType === 'office_name'`(日本語テキスト)の場合のみbigram化を継続、`phone_number`/`document_id`/`unknown`の場合はkeywordのみ**(短い数字bigramは検索価値が低く汚染源になりやすい一方、長い完全一致keywordは文書ごとに一意性が高く安全かつ検索的に有用なため)。この設計により`document_id`型prefix(`DOC260718`)からも`"26"`が生成されなくなる(bigram自体を生成しないため)。

### スコープ外（別Issue起票候補、triage判断待ち）
案3(高頻度トークンの実行時ガード、dfが閾値を超えたトークンへの書き込みスキップ)。再開条件: 特定トークンのdf・postingsサイズが閾値(例: df 10,000件 or ドキュメントサイズ500KB)を超えたら再検討する。

## 完了の定義

- [x] AC-A1: `firestore.indexes.json`のfieldOverrideがkanameone/cocoro両環境に反映済み(証明: PR #681マージ+`Deploy Firestore Indexes`workflow実行成功+`gcloud firestore indexes fields describe postings --collection-group=search_index`でINDEXESテーブル空を確認、両環境)
- [x] AC-A2: `search_index/00000644`を含むcanary(5件)で書き込みが成功する(証明: `force-reindex --doc-id --execute`5件全て`[OK]`、too many index entriesエラーなし)
- [x] AC-A3: 4389+161件(2回に分けて実行、1回目はGHA 6時間タイムアウトで4228件時点でcancelledだが冪等性により実害なし)の段階復旧で成功/失敗/未処理を集計し、未解決0件(証明: 2回目実行ログ「走査: 9781件/drift: 161件/再index: 161件/失敗: 0件」)
- [x] AC-A4: 最終`force-reindex --all-drift --dry-run`が`drift: 0件`(証明: GHA実行結果「走査: 9781件/drift: 0件」)
- [ ] AC-B1: `generateDocumentTokens({fileName: 'DOC260718-L1-20260718131435.pdf'})`のトークンに`"26"`・`"l1"`・時刻断片を含まない(証明: tokenizer.test.ts新規ケース)
- [ ] AC-B2: `phone_number`/`document_id`/`office_name`/`unknown`の4分類それぞれを個別にテスト(証明: tokenizer.test.ts)
- [ ] AC-B3: `田中太郎_介護保険.pdf`は従来通りbigram込み(回帰確認、証明: 既存テストケース)
- [ ] AC-B4: prefix抽出失敗時(拡張子のみ・空文字)はエラーを投げず、かつ不正な空トークンも生成しない(証明: 境界値テスト)
- 不変条件: `measure-field-byte-sizes`は1MiBサイズ上限の安全確認であり、index entry数上限問題の直接証明ではないことを記録する。復旧(Phase A)はtokenizer修正(Phase B)の完了を待たずに実施可能(field override単独でインデックス上限エラーは解消するため)。

## 進行中のtasks

**Phase A（即時対症 + 復旧）**
- [x] A-1. `measure-field-byte-sizes`実行(kanameone, GHA, read-only)。ただし既存スクリプトが`documents`コレクション用でsearch_index未対応と判明、AC-A1〜A4の実測で代替(スコープ調整)
- [x] A-2. `firestore.indexes.json`の`fieldOverrides`に`search_index.postings`除外設定を追加(PR #681)
- [x] A-3. dev環境で`firebase deploy --only firestore:indexes`実行+`gcloud firestore indexes fields describe`で反映確認+unit49件/integration20件PASS(回帰なし)
- [x] A-4. `/code-review low`実施、指摘事項0件。加えて`/review`+`/codex review-diff`(largeTier hook要求)も実施、指摘事項なし
- [x] A-5. kanameone+cocoroへ`firestore:indexes`デプロイ(新設`deploy-firestore-indexes.yml`workflow経由、kanameoneはFirebase CLI/gcloudローカルログイン失効のためGHA SA鍵認証が必須だった)
- [x] A-6. kanameone本番でcanary5件により正常インデックスを確認(too many index entriesエラーなし)
- [x] A-7. `force-reindex.js`で4389+161件(2回実行)を復旧、失敗0件
- [x] A-8. drift再scanで0件確認+Issue #680へ進捗コメント投稿完了

**Phase B（tokenizer品質改善、Phase A完了後に通常ペースで着手）**
- [ ] B-1. `tokenizer.ts`修正(`generateFieldTokens()`に`includeBigrams`オプション追加、fileNameを`extractFilenameInfo()`のprefix経由に変更、`prefixType`別bigram制御)
- [ ] B-2. `tokenizer.test.ts`に単体テスト追加(AC-B1〜B4対応、B-1に依存)
- [ ] B-3. dev環境でemulatorテスト全PASS確認+fax様fileNameパターンの手動処理確認
- [ ] B-4. `/code-review`(実コード変更)
- [ ] B-5. kanameone+cocoroへfunctionsデプロイ(GHA)
- [ ] B-6. Issue #680クローズ+案3(dfガード)の別Issue起票要否をtriage判断(再開条件を明記)

## 🔄 中断点（in-flight）

**Phase A 完了(2026-07-18)**。kanameone本番のsearch_index未構築状態(drift)は解消済み(drift: 0件確認済み)。次はPhase B(tokenizer品質改善、B-1〜B-6)着手待ち。急ぎではない(Phase Aで根本のFirestoreインデックス上限エラーは既に解消済みのため)。

**Phase A実行時の実績メモ**: `force-reindex --all-drift --execute`は逐次処理(1件あたり約5秒、atomic batch writer)のため4389件でGHAの6時間タイムアウトに抵触し1回目は4228件で`cancelled`。各ドキュメント復旧は冪等なため実害なく、2回目の実行(残り161件)で完了。

**follow-up候補（Phase A/Bをブロックしない別トラック）**: `scripts/force-reindex.js`はFirestore公式ベストプラクティス(2026-07-18 WebFetch確認、`firebase.google.com/docs/firestore/best-practices`)が推奨する`BulkWriter`ではなく非推奨のatomic batch writerを1件ずつ逐次実行しており、今回の6時間タイムアウト抵触の直接原因。将来の大規模復旧作業の高速化のため、BulkWriter化 or 並列度導入を検討する価値あり（ただし複数docが同一`search_index/{tokenId}`へ競合書き込みする構造のため、単純並列化はFirestoreスロットリング/競合リトライの設計が必要）。triage要否は次回判断。

- 検証コマンド: `git -C /Users/yyyhhh/Projects/doc-split status && git -C /Users/yyyhhh/Projects/doc-split log --oneline -3`
