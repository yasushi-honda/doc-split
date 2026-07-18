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

- [ ] AC-A1: `firestore.indexes.json`のfieldOverrideがkanameone/cocoro両環境に反映済み(証明: `firebase deploy`実行ログ+Firebase Console目視)
- [ ] AC-A2: `search_index/00000644`を含むcanary(5-10件)で書き込みが成功する(証明: force-reindex.js実行ログ、エラーゼロ)
- [ ] AC-A3: 4391件の段階復旧で成功/失敗/未処理を集計し、未解決0件(証明: force-reindex.js実行結果集計)
- [ ] AC-A4: 最終`force-reindex --all-drift --dry-run`が`drift: 0件`(証明: GHA実行結果)
- [ ] AC-B1: `generateDocumentTokens({fileName: 'DOC260718-L1-20260718131435.pdf'})`のトークンに`"26"`・`"l1"`・時刻断片を含まない(証明: tokenizer.test.ts新規ケース)
- [ ] AC-B2: `phone_number`/`document_id`/`office_name`/`unknown`の4分類それぞれを個別にテスト(証明: tokenizer.test.ts)
- [ ] AC-B3: `田中太郎_介護保険.pdf`は従来通りbigram込み(回帰確認、証明: 既存テストケース)
- [ ] AC-B4: prefix抽出失敗時(拡張子のみ・空文字)はエラーを投げず、かつ不正な空トークンも生成しない(証明: 境界値テスト)
- 不変条件: `measure-field-byte-sizes`は1MiBサイズ上限の安全確認であり、index entry数上限問題の直接証明ではないことを記録する。復旧(Phase A)はtokenizer修正(Phase B)の完了を待たずに実施可能(field override単独でインデックス上限エラーは解消するため)。

## 進行中のtasks

**Phase A（即時対症 + 復旧）**
- [ ] A-1. `measure-field-byte-sizes`実行(kanameone, GHA, read-only)で`search_index/00000644`の実サイズ実測、1MiB上限への安全マージン確認
- [ ] A-2. `firestore.indexes.json`の`fieldOverrides`に`search_index.postings`除外設定を追加(A-1と並列可)
- [ ] A-3. dev環境で`firebase deploy --only firestore:indexes`実行+emulatorで検索機能の回帰確認
- [ ] A-4. `/code-review low`(config変更のみ)
- [ ] A-5. kanameone+cocoroへ`firestore:indexes`デプロイ(GHA)
- [ ] A-6. kanameone本番で新規ドキュメント1件の正常インデックスを事後確認
- [ ] A-7. `force-reindex.js` dry-run→canary(5-10件)→段階実行で4391件復旧
- [ ] A-8. drift再scanで0件確認+Issue #680へ進捗コメント投稿

**Phase B（tokenizer品質改善、Phase A完了後に通常ペースで着手）**
- [ ] B-1. `tokenizer.ts`修正(`generateFieldTokens()`に`includeBigrams`オプション追加、fileNameを`extractFilenameInfo()`のprefix経由に変更、`prefixType`別bigram制御)
- [ ] B-2. `tokenizer.test.ts`に単体テスト追加(AC-B1〜B4対応、B-1に依存)
- [ ] B-3. dev環境でemulatorテスト全PASS確認+fax様fileNameパターンの手動処理確認
- [ ] B-4. `/code-review`(実コード変更)
- [ ] B-5. kanameone+cocoroへfunctionsデプロイ(GHA)
- [ ] B-6. Issue #680クローズ+案3(dfガード)の別Issue起票要否をtriage判断(再開条件を明記)

## 🔄 中断点（in-flight）

A-7実行中（force-reindex --all-drift --execute、GHA run 29633999249、2026-07-18 06:26開始）。1712→1929件処理・失敗0件で正常進行中だが、逐次処理(1件あたり約4.4秒、atomic batch writer)のため4389件全体で約5.3時間かかる見込み。GHA workflowのtimeout-minutes未設定(デフォルト6時間)に対し余裕は限定的。タイムアウトしても各ドキュメント復旧は冪等なため`force-reindex --all-drift --execute`再実行で残りを拾って継続可能(実害なし、decision-maker確認済み「ベストプラクティスかつ安全策で進める」)。

**follow-up候補（Phase A/Bをブロックしない別トラック）**: `scripts/force-reindex.js`はFirestore公式ベストプラクティス(2026-07-18 WebFetch確認、`firebase.google.com/docs/firestore/best-practices`)が推奨する`BulkWriter`ではなく非推奨のatomic batch writerを1件ずつ逐次実行している。将来の大規模復旧作業の高速化のため、BulkWriter化 or 並列度導入を検討する価値あり（ただし複数docが同一`search_index/{tokenId}`へ競合書き込みする構造のため、単純並列化はFirestoreスロットリング/競合リトライの設計が必要）。triage要否は次回判断。

- 検証コマンド: `git -C /Users/yyyhhh/Projects/doc-split status && git -C /Users/yyyhhh/Projects/doc-split log --oneline -3`
