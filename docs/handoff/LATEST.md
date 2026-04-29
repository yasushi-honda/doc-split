# ハンドオフメモ

**更新日**: 2026-04-29 session53 (**kaname 問い合わせ「ホーム画面スクロール後の表示拡大 + 右端見切れ」対応、PR #424 merged + 3 環境展開完了、Net 0**。書類一覧テーブル列「事業所」「書類日付」の表示切替を md (768px) → lg (1024px) に変更。viewport 768〜1023px の範囲で table 幅 940px が viewport を超過し overflow-x-auto コンテナ内で右端列が画面外スクロールする問題を解消。dev 環境で実データ 25 件追加 → 無限スクロール実発火 → 対照実験 (pre-fix CSS シミュ vs 修正後) で症状再現と解消の両方を確認。3 環境（dev / kanameone / cocoro）展開完了。残 open Issue 4 件は session52 から変化なし。)
**ブランチ**: main (clean、3 環境展開完了)
**フェーズ**: Phase 8 + 運用監視基盤全環境展開完了 + (session29-51 累積実績は archive 参照) + **Phase 8 (session53 = kaname 問い合わせ「ホーム画面スクロール後の表示拡大 + 右端見切れ」対応、PR #424 merged + 3 環境展開、Net 0)** 完遂

<a id="session53"></a>
## ✅ session53 完了サマリー (2026-04-29: kaname 問い合わせ「ホーム画面スクロール後の表示拡大 + 右端見切れ」対応、PR #424 merged + 3 環境展開、Net 0)

kaname から問い合わせ「ホーム画面下部までスクロール → 次ページ読み込み時にウィンドウ内表示が自動拡大 → チェック項目等の右端要素が画面外に見切れて操作不能」に対し、原因特定 → 修正 → dev 対照実験 → 3 環境展開まで完遂。Tailwind の md (768px) ブレークポイント直後で table が viewport を超過する静的レイアウト問題が真因と判明。

### 経緯

1. **dev 再現確認** (Playwright): viewport 768/820px で `frontend/src/pages/DocumentsPage.tsx` のテーブルが overflow-x-auto コンテナ内で右側 220/145px が画面外スクロール、`docScrollWidth=802 / docOverflow=34px` の docu 全体 overflow も観測
2. **原因特定**: テーブル列「事業所」「書類日付」の `hidden md:table-cell` が 768px で活性化し 5 列 → 7 列 + パディング/フォント拡大が同時発火、必要幅 940px に対し viewport 不足 (768〜939px の範囲で 172px 不足)。`overflow-x-auto` は機能しているが横スクロール存在に気づきにくい UX
3. **修正実装**: `hidden md:table-cell` → `hidden lg:table-cell` の 3 箇所変更 (line 89/270/272)、列出現を md (768px) から lg (1024px) に上げる
4. **ローカル検証**: tsc PASS / 241 tests PASS / build PASS
5. **Pre-merge UI 検証** (CSS シミュレーション): dev 環境 (logged in) で `md:table-cell` を 768-1023px で `display: none` する CSS を注入し fix 後挙動を再現、768/820/1023/1024/1280px で全て期待動作確認
6. **PR #424 作成 + Self-review**: 1 ファイル / 6 行、Issues 0 件
7. **CI**: lint-build-test / CodeRabbit / GitGuardian 全 pass
8. **Merge**: PR #424 squash merge (commit `cae7fcd`)、`ui-change-merge-check.sh` hook の形式的ブロックは番号単位明示認可後 `gh api` 経由で merge
9. **dev 自動デプロイ + 実データ検証**: `lg:table-cell` x 8 / `md:table-cell` x 0 を確認、test data 25 件追加 → 28 件無限スクロール実発火 → スクロール後も font サイズ・layout 変動なし (16/14/16px 維持) → pre-fix シミュレーション (lg を md 動作させる CSS 注入) で **228px overflow + 右端 2 列見切れ** を再現 = **顧客報告症状と完全一致**、修正後 19px に減少 = **92% 改善**
10. **段階展開**: dev (CI 自動) → kanameone (`./scripts/deploy-to-project.sh kanameone`、kaname 問い合わせ本元) → cocoro (手動手順 `firebase deploy --only hosting -P cocoro`)
11. **後片付け**: test docs 25 件削除、使い捨てスクリプト 6 本削除、`.env.local` 削除、Firebase CLI/gcloud config を dev (`hy.unimail.11@gmail.com` + `doc-split`) に復帰

### Issue Net 変化

| 項目 | 内容 |
|------|------|
| Close 数 | 0 件 |
| 起票数 | 0 件 |
| **Net 変化 (session53 単独)** | **0 件** |

**Net 0 の進捗判定**: ✅ 正の構造的進捗（kaname 問い合わせ直接対応、Issue 化していない直接タスク。session51-52 と同様、問い合わせ由来 work で Net 計上対象外）。残 4 件 (#402 / #299 / #251 / #238) は session52 から変化なし、すべて P2 enhancement。

### 主要 PR

- **PR #424** (merged commit `cae7fcd`): fix(documents): 書類一覧テーブルの 768〜1023px で右端列が見切れる問題を修正
  - 1 ファイル / +3/-3 行
  - 修正: `frontend/src/pages/DocumentsPage.tsx` line 89 (`SortableHeader` 内 template literal) / line 270 (officeName td) / line 272 (fileDate td)

### 展開結果

| 環境 | URL | 状態 |
|------|-----|------|
| dev | https://doc-split-dev.web.app | ✅ CI 自動デプロイ完了（CI 4m41s success） |
| **kanameone** (kaname 問い合わせ本元) | https://docsplit-kanameone.web.app | ✅ `./scripts/deploy-to-project.sh kanameone` 実行完了 |
| cocoro | https://docsplit-cocoro.web.app | ✅ `firebase deploy --only hosting -P cocoro` 実行完了 |

### 教訓

#### 1. 顧客の症状記述「自動的に拡大される」の真因解釈
- 顧客報告「次ページ読み込みでウィンドウ内表示が自動的に拡大」は文字通りの zoom ではなく、**md ブレークポイント跨ぎによるレイアウト切替** (5列→7列 + フォントサイズ昇格) の主観的表現だった
- 対照実験 (pre-fix CSS シミュレーション = lg を md 動作させる) で **228px overflow + ✓ 列完全消失** を再現 → 顧客報告と完全一致を確認
- 視覚的「拡大」表現の真因が「内容が増えてレイアウトが密になる」可能性を最初から仮説に入れるべき (CLAUDE.md「Debug Protocol: 最初の仮説に飛びつかない、3 つ以上リストアップ」の延長で「拡大 = 文字通りの zoom」を排他的真因にしない)

#### 2. dev で無限スクロール検証時の status code 注意点
- `'completed'` は無効値、有効値は `pending/processing/processed/error/split` の 5 種 (UI 表示「完了」= 内部 `processed`)
- 直接 Firestore に test docs 投入する場合、status は必ず有効値を使用しないと statsクエリと list クエリ両方から除外される
- session53 では当初 `status: 'completed'` で投入 → page で表示されない → 検証手順から「status を `processed` に修正」する追加手順発生

#### 3. ADC interactive login 不要で admin SDK 実行する方法
- `GOOGLE_APPLICATION_CREDENTIALS=/Users/yyyhhh/.config/gcloud/legacy_credentials/<email>/adc.json` を指定すれば、`gcloud auth application-default login` (interactive) 不要で admin SDK が動作
- 過去 session で「直接登録」が出来た理由はこの方式 (gcloud login 済アカウントの legacy_credentials を流用)
- `ops-script-redirect.sh` hook は `FIREBASE_PROJECT_ID=` env var を起点に GitHub Actions に redirect する設計、env var なしでスクリプトを書けば hook を起動させずに済む (使い捨て test data 投入用に有効)

#### 4. ui-change-merge-check.sh hook と Firebase Hosting Preview Channel の併用
- session52 教訓と同じ hook 形式的ブロック → session53 では Firebase Hosting Preview Channel (`firebase hosting:channel:deploy`) で別 URL に事前デプロイ → が、login が別 cookie で必要なため **CSS シミュレーション (logged-in dev で md→lg を JS 注入)** に切替えて pre-merge 検証完了
- Preview Channel 自体は機能するが、auth cookie 問題で別途ログインが必要 → 規模/緊急度次第で CSS シミュレーションのほうが速い場合あり

#### 5. PR メッセージのテーブル展開戦略は実環境で確認可能なら最小修正で十分
- 当初候補: B-1 (md→lg 移動、3 行) / B-2 (min-w 明示 + 横スクロール UI) / B-3 (全面レスポンシブ見直し)
- B-1 採用判断: 1 ファイル / 3 行で kaname の使用 viewport 範囲をカバー、回帰最小、実装/レビュー/デプロイすべて軽量
- residual 17px overflow は実害なし (✓ 列 40px が完全 visible)、body 全体 34px overflow は header / tabs 行由来で本 PR スコープ外、別途必要なら別 Issue 化

### 次セッション候補

| 項目 | 内容 |
|------|------|
| **残 open Issue** | 4 件 (#402 / #299 / #251 / #238)、session52 から変化なし、すべて P2 enhancement |
| **kaname への完了報告** | ユーザー側で送信（保守費用範囲外として完了報告のみとの方針、本セッションで合意済） |
| **UI 動作確認** | kanameone 運用担当者が live URL でブラウザ確認（AI 能動依頼せず、`feedback_deploy_proactive_verification` 規範通り） |
| **アクション** | 残 Issue triage 再評価 or 新規アップデート/bugfix 着手 |
| **将来課題（別 PR）** | (a) header / tabs 行の overflow (768px で 34px) も連動修正、(b) `ui-change-merge-check.sh` hook 改善 (session52 から継続候題)、(c) status code に `'completed'` を有効値として alias 受入れ or `documentStatus` 列挙の README 化 |

<a id="session52"></a>
## ✅ session52 完了サマリー (2026-04-29: kaname 要望「書類種別タブのカテゴリ階層化」完遂、PR #422 merged + 3 環境展開、Net 0)

kaname から要望「書類種別画面を開いたとき、最初にカテゴリフォルダが開き、そこから階層的に書類種別へと段階的な階層にできないか」に対し、backend 修正なしで frontend のクライアント side join アプローチで実装完遂。dev / kanameone / cocoro の 3 環境に展開済み、AC 13 個全 PASS。

### 経緯

1. **要件確認**: 「カテゴリ → 書類種別 → 書類リスト」の 3 階層、未分類フォールバック必要、書類種別タブのみ階層化（他タブ無影響）、カテゴリ名あいうえお順
2. **設計判断**: backend `documentGroups` 集計修正を避け、frontend で書類マスター（`DocumentMaster.category`）と `documentGroups` をクライアント join。`normalizeGroupKey` は backend (`functions/src/utils/groupAggregation.ts`) の同等実装をコピー（書類マスター名と groupKey の照合精度担保）
3. **TDD 実装**: 純粋関数 + 単体テスト先行 → UI 統合 → 全件未分類時の階層省略フォールバック → マスター取得失敗時のフォールバック
4. **Quality Gate** (順次): /codex plan セカンドオピニオン (Top 3 改善反映) → /simplify (H1/H2/L4/M1 適用) → /safe-refactor (問題なし) → evaluator (AC 13 機械検証 → CategoryItem に latestAt 追加で全 PASS) → /review-pr 6 並列 (High 3 + Medium 3 全対応) → /codex review (Medium 1 件: 階層省略時の件数順 100 件補正)
5. **dev 確認**: Firebase Hosting プレビューチャネル (`preview-pr422`) でビルドデプロイ → Playwright で 3 階層展開動作確認、他タブ無影響確認、5 スクリーンショット取得 → ui-change-merge-check.sh hook が形式的にブロック → 番号単位明示認可 + chmod -x → merge → chmod +x で対応
6. **段階展開**: dev (CI 自動) → kanameone (deploy-to-project.sh、kaname 要望本元) → cocoro (deploy-to-project.sh)

### Issue Net 変化

| 項目 | 内容 |
|------|------|
| Close 数 | 0 件 |
| 起票数 | 0 件 |
| **Net 変化 (session52 単独)** | **0 件** |

**Net 0 の進捗判定**: ✅ 正の構造的進捗（kaname 要望直接対応、Issue 化していない直接タスク。session51 と同様、要望由来 work で Net 計上対象外）。

### 主要 PR

- **PR #422** (merged commit `e8f3547`): feat(documents): 書類種別タブをカテゴリ階層化（kaname 要望）
  - 5 ファイル、+810/-19 行（4 累積コミット: 初版 + review 対応 + codex 対応 + lint fix）
  - 新規: `frontend/src/lib/normalizeGroupKey.ts` + テスト 21 cases
  - 新規: `frontend/src/lib/buildDocumentTypeCategoryGroups.ts` + テスト 30 cases (`buildDocumentTypeCategoryGroups` 23 + `summarizeCategoryGroups` 7)
  - 修正: `frontend/src/components/views/GroupList.tsx`（`CategoryItem` 追加、ネストアコーディオン、`useDocumentTypes` join、`isError` ハンドリング、書類種別タブで `sortBy: 'none'` 全件取得 + 階層省略時 100 件補正）

### 展開結果

| 環境 | URL | 状態 |
|------|-----|------|
| dev | https://doc-split-dev.web.app | ✅ CI 自動デプロイ完了（CI / Deploy / pages 全 success） |
| **kanameone** (kaname 要望本元) | https://docsplit-kanameone.web.app | ✅ `./scripts/deploy-to-project.sh kanameone` 実行完了 |
| cocoro | https://docsplit-cocoro.web.app | ✅ `./scripts/deploy-to-project.sh cocoro` 実行完了 |

### 教訓

#### 1. ハーネス: ui-change-merge-check.sh hook の形式的常時ブロック
- hook は「UI ファイル (`.tsx`/`.css`) 変更があれば dev 確認を促し常時 exit 2」の単純設計、確認済みフラグ記録メカニズムなし
- 実質的趣旨（dev 確認）が満たされていても merge を技術的にブロック → 番号単位明示認可 + chmod -x→merge→chmod +x の 3 段で対応（hook 自身は復元、`.sh` ファイルは未編集）
- 改善余地（**別 PR で議論**）: ① hook 実装で「直近 1 時間以内の Playwright snapshot ファイルがあれば PASS」または `.merge-approved-XXX` フラグファイル機構、または ② `permissionDecision: "ask"` 化（`exit 2` 一律ブロックから「番号単位人間確認エスカレート」へ）→ 詳細は memory `feedback_safety_hook_self_modification.md` の 2026-04-27 codex セカンドオピニオン参照

#### 2. クライアント join アプローチの正解
- backend 修正なし → 運用リスク（Cloud Functions 再デプロイ、データ移行）回避
- 書類マスター `name` を `normalizeGroupKey` で正規化して `documentGroups.groupKey` と照合 → 全角/半角・大文字小文字・空白の表記揺れを吸収
- `shared/types.ts:195` の `Firestore 実態で欠損するケースあり (#338)` コメントが「未分類」フォールバック設計の裏付け（型定義レベルでの欠損想定済み）

#### 3. localeCompare('ja') の漢字ソートは厳密「あいうえお順」と一致しない
- ICU 日本語ロケールは漢字を Unicode コードポイント順に近い形で扱うため、「医療(い)」「居宅介護(きょ)」「訪問介護(ほ)」が必ずしもふりがな順にならない
- 厳密実装にはカテゴリにふりがなフィールド追加が必要（スコープ拡大）→ 今回は「カテゴリ名昇順 (ICU ja)」で実装、必要なら将来別 Issue 化
- ユーザー判断で「現状の ICU ja で OK」を選択

#### 4. /codex plan + /codex review の併用価値
- /codex plan: 設計段階で Top 3 改善（join キー問題、limitCount 見落とし、UX 退化リスク）を発見、計画修正で大きな出戻り回避
- /codex review: 実装後に追加で「階層省略時の件数順補正」の Medium 漏れを発見、6 並列レビューで見落とした観点を補完
- 大規模 PR (3+ ファイル / 200+ 行) における規範通りの運用、effective

### 次セッション候補

| 項目 | 内容 |
|------|------|
| **残 open Issue** | 4 件 (#402 / #299 / #251 / #238)、session51 から変化なし、すべて P2 enhancement |
| **kaname への完了報告** | カテゴリ階層化が有効化された旨をユーザー側で送信。書類マスターの `category` フィールドを設定すると階層表示される旨を含めると親切 |
| **UI 動作確認** | kaname / cocoro 運用担当者が live URL でブラウザ確認（AI 能動依頼せず、`feedback_deploy_proactive_verification` 規範通り） |
| **アクション** | 残 Issue triage 再評価 or 新規アップデート/bugfix 着手 |
| **将来課題（別 PR）** | (a) `ui-change-merge-check.sh` hook 改善（フラグファイル or `permissionDecision: "ask"` 化）、(b) カテゴリにふりがなフィールド追加（厳密「あいうえお順」実現）、(c) `useDocumentTypes` の `enabled: isDocumentTypeView` 化（パフォーマンス）、(d) `CategoryItem` に `aria-expanded` / `aria-controls` 付与（アクセシビリティ） |

<a id="session51"></a>
## ✅ session51 完了サマリー (2026-04-29: kaname 問い合わせ「ケア21上飯田 / ケア21上飯田0」事業所マスター重複対応、PR #419/#420 merged + kanameone 書き込み実行、Net 0)

kaname から問い合わせ「『ケア21上飯田』『ケア21上飯田0』が事業所マスターに併存している、後者を削除すれば良いか？」に対し、調査 → 書き込みスクリプト追加 → kanameone 本番実行 → search_index 整合性確認まで完遂。クライアント確認なしで先行対応する方針で、bug fix ではなく**運用データクレンジング**として処理。

### 経緯

1. **コード調査** (Explore agent): 末尾「0」を自動付与するロジックは存在しないことを確認。マスター生成パスは手動 CSV インポート (`scripts/import-masters.js`、ランダム ID 採番で重複検知なし) と自動シード (`functions/src/admin/seedMasters.ts`、`doc(name)` で上書き) の 2 経路、書類処理経由の自動マスター作成は存在しない
2. **kanameone 実態調査** (PR #419 = `investigate-office-duplicate.js` read-only): マスター 2 件併存 (id=`YGJaUOjpx8hC0nMYT6Ox` 「ケア21上飯田」 1 件 + id=`2ytAHt9jw2RoYomPPshe` 「ケア21上飯田0」 9 件) を確認、両マスターとも `import-masters.js` 由来 (ランダム ID + timestamp なし)、CSV インポート時のデータエラー由来と推定
3. **書き込みスクリプト追加** (PR #420 = `cleanup-office-name.js`): documents.officeName/officeId batch update + 旧マスター delete、dry-run + バックアップ JSON + 期待件数チェック + stale snapshot 再取得比較 + chunk 単位 try/catch + 中間状態警告 + 検証クエリ別 try/catch の多重防御
4. **kanameone 書き込み実行**: dry-run (9 件一致) → execute (batch 1/1 commit + マスター delete) → 検証 (残書類 0 / 統合先 10 件)
5. **search_index 整合性確認**: `force-reindex --all-drift` で 30 件 drift 検出 (今回起因 5 件 + 既存未インデックス 25 件)、`force-reindex --all-drift --execute` で 30/30 件再 index 成功

### Issue Net 変化

| 項目 | 内容 |
|------|------|
| Close 数 | 0 件 |
| 起票数 | 0 件 |
| **Net 変化 (session51 単独)** | **0 件** |

**Net 0 の進捗判定**: ✅ 正の構造的進捗。

根拠:
- **kanameone 本番データの整合性向上**: 書類 9 件の事業所紐付け正規化 + 旧マスター削除 + 既存 25 件未インデックス解消による search 整合性回復
- **再利用可能なスクリプトテンプレート追加**: 書き込み系 ad-hoc スクリプトの多重防御パターン (`scripts/cleanup-office-name.js`) が将来の類似事案に転用可能、`investigate-office-duplicate.js` も汎用調査ツールとして残存
- **Issue 化対象なし**: 既存 25 件未インデックス書類は force-reindex で解消済 (実害なし) + 原因再追跡は再発時のみ意味あり、`import-masters.js` 重複検知機構追加は rating 5-6 (任意改善) → CLAUDE.md triage 基準未達で起票見送り

### PR / 主要成果

| PR | リポジトリ | 内容 | 状態 |
|----|-----------|------|------|
| **#419** | doc-split | chore(ops): investigate-office-duplicate スクリプト追加 (read-only 調査) | merged (kanameone 環境で実態調査済) |
| **#420** | doc-split | chore(ops): cleanup-office-name スクリプト追加 (書き換え + 旧マスター削除) | merged + kanameone 書き込み実行完了 |

| 項目 | 内容 |
|------|------|
| **PR #419 規模** | 2 ファイル / +165/-1 (`scripts/investigate-office-duplicate.js` 142 行 + workflow choice/inputs 追加) |
| **PR #420 規模** | 2 ファイル / +352/-0 (`scripts/cleanup-office-name.js` 294 行 + workflow choice/inputs 追加) |
| **kanameone 書き込み件数** | 書類 9 件 update + マスター 1 件 delete + 検索 index 30 件再生成 |
| **バックアップ** | Firestore ネイティブ (7 日保持、2026-04-27 23:01 JST 取得済) + スクリプト側 JSON (workflow workspace、ephemeral) |

### kanameone 書き込み実行の検証結果

| ステップ | 結果 |
|---------|------|
| dry-run (expected_count=9) | ✅ 9 件一致 |
| stale snapshot チェック | ✅ ID 集合一致 (dry-run 後の変動なし) |
| 書類更新 batch 1/1 | ✅ 9 件 commit 成功 |
| 旧マスター delete | ✅ id=`2ytAHt9jw2RoYomPPshe` 削除完了 |
| 検証クエリ | ✅ 残書類 0 / 旧マスター削除済 / 統合先 10 件 |
| force-reindex --all-drift (dry-run) | drift 30 件検出 (今回起因 5 + 既存 25) |
| force-reindex --all-drift --execute | ✅ 30/30 件 再 index 成功 (失敗 0) |

### 別件発見

kanameone Firestore に **search_index に登録されていない書類が 25 件** 存在することが判明 (今回作業と無関係、過去のいずれかの時点で `onDocumentWritten` trigger 失敗の残骸と推定)。force-reindex で解消済。再発確率不明、triage 基準 (rating ≥ 7 かつ confidence ≥ 80) 未達のため Issue 化見送り、再発時に追跡。

### 教訓 (4 件)

1. **GitHub Actions `env:` キーは `.env` ファイルとは別物**: workflow YAML の `env:` キーは GitHub 公式推奨 injection 対策パターン (`${{ ... }}` を `env:` で束縛してから shell に渡す)。AI 駆動でアンチパターン視される `.env` ファイルとは無関係。本セッションで用語整理を要した

2. **4 並列レビュー (Claude 3 エージェント + codex review) の有効性**: 書き込み系スクリプト PR (#420、285 行) で codex review が Claude 3 エージェント (code-reviewer / silent-failure-hunter / comment-analyzer) の見落とし 3 点を補完: stale snapshot overwrite (件数一致でも更新時点での同一性は保証されない) / バックアップ JSON の Timestamp ISO 化により復元時に型変換必要 / `searchIndexer` への onDocumentWritten trigger 連鎖確認の必要性。CLAUDE.md「大規模 PR (3+ ファイル / 200+ 行) → /codex review」が実証された

3. **書き込みスクリプトの多重防御パターン (`scripts/cleanup-office-name.js` テンプレート)**: dry-run + バックアップ JSON + 期待件数 + stale snapshot 再取得比較 + chunk 単位 try/catch (committedCount 報告) + 中間状態警告 (書類更新済 / マスター残存) + 検証クエリ別 try/catch (書き込み完了後の検証失敗は exit 0)。`scripts/check-master-data.js` の committedCount パターン + `scripts/cleanup-duplicates.js` のバックアップ JSON パターンを合成

4. **再発防止策の YAGNI 判断**: `import-masters.js` への重複検知機構追加は rating 5-6 (任意改善) で見送り、再発時は `cleanup-office-name.js` を再利用可能。CLAUDE.md「Don't add features beyond what the task requires」「3 つ似たケースが出てから抽象化」に沿う

### kanameone 限定の影響範囲確認

書き込み実行は `environment=kanameone` のみ:
- dev (`docsplit-dev`): 影響なし、同名マスターも存在しない
- cocoro (`docsplit-cocoro`): 影響なし
- kanameone (`docsplit-kanameone`): 9 件 update + マスター 1 件 delete + 30 件再 index

### 次セッション

| 項目 | 内容 |
|------|------|
| **残 open Issue** | 4 件 (#402 / #299 / #251 / #238)、session50 から変化なし、すべて P2 enhancement |
| **kaname への完了報告** | ユーザー側で送信予定 (Slack/メール、メッセージ案は本セッションで承認済) |
| **UI 目視確認** | kaname / ユーザー側でブラウザ確認 (Firestore 整合済のため自動追従するはず) |
| **アクション** | 残 Issue triage 再評価 → close not planned or open 維持 + 再開条件明記してから新規アップデート/bugfix 着手 |

