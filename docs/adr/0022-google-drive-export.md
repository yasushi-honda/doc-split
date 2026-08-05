# ADR-0022: Google Drive エクスポート連携（Phase 1）

## Status
Accepted (2026-07-20)

## Context

介護施設向けクライアント（cocoro、kaname）から、書類（ケアプラン・医療・介護保険証等）のPDFを利用者ごとにGoogleドライブへ自動振り分けエクスポートしたいという要望があった。用途はNotebookLM投入、インターネットFAX（eFAX等）送信。

両クライアントの実際のフォルダ構成は非対称：

- **かなめ**: 事業所（固定）→ ケアマネ（姓頭文字+半角スペース+氏名）→ 利用者（フリガナ頭文字+全角スペース+氏名）→ 書類カテゴリ → （ケアプランのみ）年月、の5階層
- **cocoro**: 共有フォルダ（固定）→ ケアマネ別カルテ → 利用者、の3階層。担当ケアマネ変更時はフォルダごと新担当配下へ移動する運用

個別対応ではなく、共通の仕組みで両対応する方針をdecision-makerが明示。設計相談と実機技術検証（`doc-split-dev`環境でのブラウザ実機テスト）を経て、以下の設計判断を確定した。

## Decision

### 1. OAuth接続はGmail連携と完全に独立させる

既存のGmail OAuth連携（`functions/src/utils/gmailAuth.ts`、`gmail.readonly`スコープ固定）とは別に、Google Drive専用の接続を新設する（`settings/drive`、Secret Manager名`drive-oauth-client-id`/`-secret`/`-refresh-token`）。同一Googleアカウントをデフォルトの接続先として選べるが、別アカウントでの接続も構造上妨げない。既存のGmail接続コード（Secret Manager読み書きヘルパー、Callable Functionの骨格）は再利用しつつ、認証情報自体は独立管理する。

### 2. スコープは `drive.file` に確定

`doc-split-dev`環境で実機検証を行い、以下を確認した：
- **`drive.file`スコープ + Google Picker（`setEnableDrives(true)`） + `supportsAllDrives=true`** の組み合わせで、Shared Drive内へのフォルダ作成が成功する。フルスコープ`drive`は不要。
- Shared Driveのルート自体はPickerで選択できず、1階層以上のサブフォルダを選ぶ必要がある（UI上に明示する制約）。
- `drive.file`スコープでは完全削除（`files.delete`）が拒否され、`files.update({trashed:true})`によるゴミ箱移動のみ許可される。

`drive.file`はGoogleが「非破壊的で最小権限」と位置づけるスコープであり、アプリが触れられる範囲をユーザーがPicker操作で明示的に選択したファイル・フォルダに限定できる。フルスコープ`drive`（Drive全体への読み書き）を避けることで、同意取得の重み・監査対象範囲を最小化する。

### 3. フォルダ構成はテナントごとのセグメント型テンプレートで表現する

フォルダ階層を「固定文字列」「ケアマネ（命名フォーマット可変）」「利用者（命名フォーマット可変）」「書類カテゴリ」「日付（条件付き）」という判別可能unionのセグメント配列として定義し（`DriveFolderSegment` / `DriveFolderTemplate`、`shared/types.ts`）、テナントごとに`settings/drive.template`へ保存する。かなめ・cocoro双方の非対称な階層を、コード改修なしに設定の違いだけで表現できる。

フリガナ欠損時（`CustomerMaster.furigana`は既知の欠損ケースがある、Issue #338）は、デフォルトで**エクスポートを停止**（`furiganaFallback:'stop'`）し、エラー一覧に表示する（fail-visible）。テナントが明示的にopt-inした場合のみ、氏名の先頭文字で代替する（`useNameInitial`）。誤った利用者フォルダへの配置は「配置されない」より遥かに危険という判断による。

`documentCategory`セグメントのフォルダ名は、`doc.category`（OCR実行時点のmastersスナップショット）ではなく**export実行時点で`masters/documents/items`を`doc.documentType`で都度引き直した`category`**を優先し、欠損時のみ`doc.documentType`（書類種別、例:「介護保険被保険者証」）へフォールバックする（2026-08-05修正、kanameoneからの「書類名ではなくカテゴリ名で分類してほしい」という要望対応）。`doc.category`ではなく都度解決を採用した理由（`codex review`P1指摘、2026-08-05）: OCR完了後にユーザーが書類詳細で`documentType`のみを手動訂正しても、`useDocumentEdit.ts`は`documentType`/`documentTypeKey`のみ更新し`doc.category`は追従しないため、`doc.category`をそのまま使うと訂正前の書類種別に対応する古いカテゴリでエクスポートされ誤ったフォルダに配置されるリスクがあった。masters側のcategoryもoptionalで欠損しうる（Issue #338と同型）ため、フリガナと異なりこちらはfail-visibleにせずdocumentTypeへのフォールバックを採用した: 書類カテゴリの欠損は「誤った顧客への配置」のような安全上の懸念を伴わず、既存の成功エクスポートを新規にfail-closedへ倒す方が実害が大きいと判断したため。

`date`セグメントの`onlyForCategories`は書類種別名の配列として運用されており（`buildDetailed5TierPreset(documentCategoryNames)`参照）、上記の表示用`documentCategory`（category優先）とは別概念である。この2つを同一フィールドで扱うと、documentCategoryの表示値をcategory優先化した際にdateセグメントの一致判定まで巻き込まれ、既存テンプレートのdateセグメントが無言で欠落する回帰を生む（`codex review`P1指摘、2026-08-05）。`FolderPathDocInput`では`documentCategory`（表示名）と`documentType`（date判定専用）を独立フィールドとして分離し、この2つの意味的乖離を型レベルで表現している。

### 4. フォルダの解決は find-or-create、同名2件以上は停止

各セグメントの子フォルダ検索で、0件なら作成・1件なら再利用・**2件以上なら`AmbiguousFolderError`を投げて停止**する。これにより、「既存フォルダ構造への合流」と「新規ルートからの作成」の両ケースを、単一のロジックで一律に処理できる（ルートに空フォルダを選べば実質新規、既存構造のあるフォルダを選べば実質合流）。曖昧な状態での自動選択は誤配置リスクがあるため、常に停止を優先する。

同一parent+nameに解決する**異なるdocument**が近接タイミングで検証されると、双方が0件マッチを観測して`files.create()`を呼び、重複フォルダが作成されうる（決定4本文の「同名2件以上は停止」は同一検索内の話であり、この異docId間の競合は別問題）。これを防ぐため、0件マッチ時のみ`driveFolderLocks`コレクション（Admin SDK専有）へのFirestoreトランザクションで所有権を主張してから作成する。所有権トークン（fencing token）は決定6の`driveExportRunId`クレーム機構と同型で、staleとみなされ他の実行にロックを奪われた場合でも元の実行が誤って新しい保有者のロックを削除しないようにする。ロック獲得に失敗した場合は`FolderCreationInProgressError`をthrowし、新しい待機/リトライ機構は作らず既存のcatch-and-set-error機構（`driveExportStatus:'error'`→次回スケジュールスイープで自動リトライ）に委ねる（`functions/src/drive/findOrCreateFolder.ts`）。

### 5. 同期トリガーは「確認ボタン」押下（`verified` false→true）

documentの`verified`フィールドがfalse→trueになる瞬間を、Cloud Functions側のFirestoreトリガー（`onDocumentWritten('documents/{docId}')`）で検知してエクスポートを開始する。OCR誤読・利用者取り違えが確定する前の情報を外部Driveへ誤って流出させるリスクを、人間のレビュー完了という明示的なゲートで防ぐ。この方式はcocoro側で承認済み。既存の確認フロー（`useDocumentVerification.ts`の`markAsVerified`、3つの呼び出し元）には一切変更を加えない。

### 6. Drive系フィールドはAdmin SDK専有、outboxパターンで状態管理

`driveExportStatus`（`(フィールド不在) → exporting → exported`、失敗時`error`）と`driveFileId`/`driveExportedAt`/`driveExportError`/`driveExportRunId`を document に追加し、**通常時はCloud Functions（Admin SDK）からのみ書き込む**設計にする。フロントエンドからの再送は直接Firestore書き込みではなく、Callable Function（`retryDriveExport`）経由に限定する。

例外として、`frontend/src/hooks/useDocuments.ts`の`getReprocessClearFields()`（再処理時のフィールドクリア）は、`driveExportStatus`/`driveExportedAt`/`driveExportError`/`driveExportRunId`の4フィールドを`deleteField()`で削除する。これは`documents` collectionの`firestore.rules` update許可フィールドリスト（`hasOnly([...])`方式）への追加が必要（`retryCount`/`provenance`等の既存の派生フィールドと同型）だが、削除または無変更のみを許可する専用ガードにより、FEが値を新規設定・上書きすることはできない（#178教訓の延長。再処理でDriveエクスポートのクレーム状態が残存すると、訂正後の再確認がトリガーのクレームでスキップされ、二度と再エクスポートされなくなる不具合の再発防止）。

**`driveFileId`は削除(deleteField)自体も拒否する**（様子見#47対応、2026-07-22）: 上記4フィールドは「削除または無変更のみ許可」だが、`driveFileId`は次項の通り再処理でも意図的にクリアしないため、クライアントSDK経由での削除を正当化する業務フローが存在しない。`firestore.rules`側で`driveFileId`のみ「存在有無の遷移(追加/削除)自体を禁止し、存在する場合は値も不変」という一段厳しいガードに変更し、アプリコード側（クリア対象からの除外）1箇所のみに依存しない多層防御とした。

**`driveFileId`は例外的に再処理時もクリアしない**（code-review xhigh指摘対応、2026-07-21）。理由は次項参照。

トリガー自身の書き戻し（`driveExportStatus`の更新）による再発火は、`before?.verified !== true && after.verified === true`という「立ち上がりエッジのみ」の判定で防ぐ（既存の`searchIndexer.ts`のハッシュ比較と同じ思想）。

**状態遷移図**（code-review CONFIRMED指摘対応で`pending`状態を廃止し2段階クレームを1段階へ統合、所有権トークン`driveExportRunId`を追加）:

```mermaid
stateDiagram-v2
    [*] --> exporting: verified false→true検知\n(driveExportTrigger.ts、単一トランザクションでクレーム+runId発行)
    [*] --> error: バックフィル(scripts/backfill-drive-export.ts)\n※flag OFF時にverifiedされたdocの遡及対応、下記参照
    exporting --> exported: exportDocument()成功\n(所有権チェック付き書戻し)
    exporting --> error: exportDocument()失敗\n(所有権チェック付き書戻し)
    error --> exporting: 手動リトライ(retryDriveExport)\nまたは定期リトライ(1時間経過、driveExportScheduled)
    exporting --> exporting: 定期リトライ(10分経過、クラッシュ想定の再クレーム)\n※新runId発行、旧runIdの書戻しはsuperseded
    exported --> [*]
```

**flag OFF→ON時のバックフィル（code-review指摘#43対応、2026-07-22）**: `driveExportTrigger.ts`はFeature Flag OFF中は完全no-op（`driveExportStatus`フィールド自体を一切書き込まない）ため、OFF期間中にverifiedされたdocumentは`(フィールド不在)`のまま取り残される。トリガーは`verified`のrising edgeのみを見るため再度発火せず、定期スイープ（`driveExportScheduled.ts`）も`driveExportStatus in ['error','exporting']`のみを対象とするため`(フィールド不在)`のdocを一生拾わない。`scripts/backfill-drive-export.ts`（管理スクリプト、`--dry-run`対応）が`verified==true`かつ`driveExportStatus`フィールド不在のdocを見つけ、`driveExportStatus:'error'`に一時的にマークすることで、上記の既存`error`リトライ経路に乗せる（新規Cloud Functionは作らない。実際のDrive API呼び出しは定期スイープが通常通り実行する）。

`exporting`から`exporting`への自己遷移（定期リトライによる再クレーム）は、新しい`driveExportRunId`を発行して所有権を移す。並行して実行されていた古い実行(古いrunId)が後から完了して書き戻そうとしても、書戻し直前に再読込した`driveExportRunId`が自分のものと一致しない場合は書き込みをスキップする(`functions/src/ocr/ocrRunGuard.ts`の`ocrRunId`所有権検証と同じ思想)。これにより、`exportDocument()`の`files.create()`前段の`appProperties`(`docSplitDocId`)による冪等性チェックと合わせて、リトライ時のDriveファイル重複作成・Firestore状態の二重書き込みを防ぐ。

**`driveFileId`優先のmove/rename/内容更新**（code-review xhigh指摘対応、2026-07-21）: 当初の実装では`getReprocessClearFields()`が`driveFileId`も削除していたため、再処理でフォルダパスが変わる訂正（利用者取り違えの修正等）をすると、`exportDocument()`の`appProperties`検索が新しいフォルダ配下しか見ないため旧フォルダに誤配置ファイルが孤児として残り続け、フォルダパスが変わらない訂正では内容が更新されない（stale content）、という2つの不具合があった。`shared/types.ts`の`driveFileId`コメントが元々「重複防止・**再送先**の一意キー」としていた設計意図に立ち返り、`driveFileId`を再処理でもクリアせず保持するよう変更した。`exportDocument()`は`doc.driveFileId`がある場合、`drive.files.get()`で実体を確認したうえで`drive.files.update()`（`addParents`/`removeParents`でフォルダ移動、`requestBody.name`でリネーム、`media`で内容更新を1回のAPI呼び出しで実施）を直接行う。ファイルがDrive上に見つからない（404、手動削除等）場合のみ、従来の`appProperties`ベースのfind-or-create（`findOrUploadFile()`）にフォールバックする。

**既知の残課題（本修正のスコープ外）**: 初回エクスポート時（`driveFileId`が未設定）に2つの実行が真に並走すると、`findOrUploadFile()`のlist-then-createがTOCTOU競合を起こし、Drive上に同一`docId`のファイルが重複作成されうる（以後`AmbiguousFileError`で恒久停止）。Phase 2以降でDrive側の排他制御（例: 作成前にFirestore側でアップロード試行中マーカーを持つ等）を検討する。

**`findOrUploadFile()`のappProperties一致ファイル再利用時も内容(media)を最新化する**（様子見#54対応、2026-07-22）: `driveFileId`が404/`trashed`でフォールバックした場合、または初回エクスポートで過去の孤児アップロードと一致した場合、以前は該当ファイルのidだけを再利用し内容は更新していなかった。この孤児ファイルが`resolveDriveFile()`のフォールバック経由で見つかった場合、現在の`fileUrl`の内容と一致する保証がない（過去の失敗実行時点の内容のまま古くなっている可能性がある）ため、idを再利用する場合も`files.update()`で内容を必ず最新化するよう変更し、`driveFileId`優先パスと同じ「内容は常に最新」という保証を両経路で揃えた。

**Phase1の既知の制約: `verified`維持のままの編集では再エクスポートされない**（PLAUSIBLE#49、2026-07-22決定）: `driveExportTrigger.ts`の`justVerified`判定（`verified`のfalse→true立ち上がりエッジのみ）は、`verified:true`のまま`customerName`/`documentType`等を編集した場合には反応しない設計である。バグではなく意図的な設計判断として本ADRに明記する: Phase1スコープでは、エクスポート後に内容を訂正する場合は運用上「一旦`verified:false`に戻してから再確認する」フローを前提とし、`verified`を維持したままの編集は再エクスポートの対象外とする。この制約を解消する自動再エクスポートの仕組みはPhase2以降で検討する。

**kanameone/cocoro本番展開 Phase D/E再設計（Codex High指摘5件対応、2026-07-23）**: dev環境実装完了後、kanameone(876件)/cocoro(93件)への本番展開設計をCodexセカンドオピニオン（MCP, effort=high）がレビューし、以下5件のHigh指摘を受けて再設計した。

- **flag ON時のallowlist機構**（指摘: flag ON直後は他ユーザーの通常確認操作も全てDrive書込みトリガー対象になり、1件だけのコントロールテストが成立しない）: `settings/features.driveExportAllowlist`（string配列）を新設し、`getDriveExportGate()`（`functions/src/utils/featureFlags.ts`）が単一snapshotで`{enabled, allowlist}`を返す。`driveExportTrigger.ts`のみがこのallowlistでゲートされる（`allowlist!==null && !allowlist.includes(docId)`なら早期return）。**sweep(`driveExportScheduled.ts`)・手動retry(`retryDriveExport.ts`)は意図的にallowlist非対象**（sweepのスコープはbackfillの`--limit`が決め、retryはadmin個別操作でmass export不可なため）。allowlist契約: フィールド不在=null=制限なし（dev環境の全展開挙動を保持）、空配列=block-all（staging用）、不正値（非配列/非string混在）はfail-closedで空配列扱い。**空配列にすることと全展開は別**（空配列は全拒否）: 全展開時は`--remove`でフィールド自体を削除すること（`scripts/set-drive-allowlist.js`の`--set`/`--clear-empty`/`--remove`）。
- **backfillのcanary機構**（指摘: `scripts/backfill-drive-export.ts`に`--limit`/`--expected-count`/manifest/選択的rollbackが無く、cocoro先行実行も全量投入でしかなくcanaryにならない）: `--limit N`（対象を先頭N件に制限）、`--expected-count N`（対象件数が一致することを**書込み前に**アサート、不一致なら書込みゼロで中断）、`--manifest-out <path>`（`{runId, projectId, timestamp, docIds[]}`をJSON出力）、`--rollback <manifest>`（manifest記載docIdのうち、まだbackfillのsentinelエラーマーカーのままのものだけを`FieldValue.delete()`でfield-absentへ復帰。exported/exporting/実エラーへ進んだdocは意図的にskip）を追加。
- **race修正**（指摘: 通常の確認操作とbackfillが競合し`driveExportStatus`を書き戻すリスク）: 従来の無条件`batch.update`を、各docの`updateTime`（Firestore Timestampオブジェクトをそのまま渡す）を`lastUpdateTime`preconditionとする個別`update()`に置換。read→write間に別の書込みが入ると`FAILED_PRECONDITION`(code 9)でskip・ログ出力し、相手の状態を上書きしない。**注意**: precondition値をISO文字列等へ変換して往復させるとnanosecond精度が失われ常に不一致になり全書込みが無言で失敗する（emulatorで実証済みの罠、`Timestamp`オブジェクトを直接渡すことが必須）。
- **ロールバック意味論の明記**（指摘:「flag OFF」はロールバックではない）: flag OFFは**新規開始のみ停止**する。`driveExportTrigger.ts`/`driveExportScheduled.ts`のflagチェックは各実行の開始時点のみで、既に`exporting`へクレーム済みのexportは完走し、**作成済みのDrive上のPDFは自動削除されない**（`appProperties`/`docSplitDocId`による冪等性チェックがあるため、再度flag ONにしても重複作成はされない）。`backfill --rollback`はFirestoreの`driveExportStatus`/`driveExportError`マーカーのみを復帰する操作であり、Drive上の実体には一切関与しない。
- **完了時間・異常停止基準**（指摘: 未定義）: `scripts/drive-export-status-report.ts`（read-only）が`verified==true`の状態分布（exported/exporting/error内訳をbackfillマーカーと実エラーに分割/フィールド不在）を集計する。主シグナルは**exported数の単調増加**（定期スイープ10件/15分が目安）、副シグナルは実エラー比率（>20%で警告表示）。Stage D（コントロールテスト）着手前は本レポートで`error=0`かつ`exporting=0`（既存の滞留docがないこと）を確認するentry gateとする。

段階的展開runbook（Stage D: allowlist+1件コントロールテスト → Stage E1: `--limit`小規模canary backfill → Stage E2: allowlist `--remove`＋残り全件backfill、cocoro先行→kanameone）は`docs/handoff/GOAL.md`に記録し、実際のflag ON/backfill本実行はPhase C（各クライアントのGoogle Drive OAuth接続完了）確認後、番号単位の明示認可で別途実施する。

**顧客未確定ゲート（同姓同名リスク対応、2026-07-25）**: Phase C事前確認の過程で、クライアントから「利用者フォルダの表記ゆれ」を懸念する質問を受けて調査した結果、決定3（フォルダ構成）に本質的な盲点があることが判明した。`resolveCustomerSegment()`（`functions/src/drive/folderPath.ts`）が生成する利用者フォルダ名は`doc.customerName`文字列（+フリガナ由来の頭文字）のみで決まり、`customerId`を一切参照しない。同姓同名の別人が手動選択未解決のまま`verified: true`にされた場合、決定5の「確認ボタン起点」ゲートは顧客同一性の確認までは保証しないため、OCRが仮に選んだ顧客情報のまま外部Driveへエクスポートされてしまう。フリガナ欠損時に停止する既存のfail-visible設計（決定3）と非対称なギャップだった。

初回実装（`customerConfirmed`/`needsManualCustomerSelection`のデュアルリードのみでブロック）は`/code-review`（10角度並列xhigh）で2つの致命的な破綻を指摘され、パッチではなく再設計した:
- **過確定・素通り**: `useDocumentEdit.ts`の`shouldSetCustomerConfirmed`は「現在の顧客名が有効値」でありさえすれば、同姓同名候補を選び直さず無関係なフィールド（例: 書類日付）だけ直して保存しても`customerConfirmed:true`にしてしまい、ゲートを素通りする。
- **過剰ブロック**: 分割フロー（`splitDocumentBuilder.ts`/`documentUtils.ts`）は「人間がそのフィールドを実際に編集(touched)したか」でのみ判定するため、OCRが正しく一意認識していても人間が顧客欄を触らなければ`customerConfirmed`が恒久的にfalseのままになり、kanameoneの主要機能である複数顧客FAX複製フローが実質ブロックされうる。

**最終設計**: ゲートは「同姓同名マスターが実在し人間確認が済んでいない」ケースへの対応を主眼としつつ、顧客名未設定/sentinel値・customerId↔name乖離（マスター改名の取り残し等）も併せてブロック対象とした（decision-maker承認済み。OCRが別名を取り違えるスコア僅差誤認識は明示的にOut of Scope、下記参照。**2026-07-25追記**: 当初本文は「守備範囲は同姓同名マスターの衝突のみ」と要約していたが、実データ監査でcocoro〈同名衝突0組〉でも顧客未確定docが36件検出されたことから要約が実態と乖離していたと判明し訂正した。下記1-4の判定順序自体は初出時点から変更なし）。マスターの`isDuplicate`フラグは登録時のみ自動付与され事後の追加・改名では更新されない（`MastersPage.tsx`の`handleForceAdd`は新規レコードのみに付与、`useMasters.ts`の`updateCustomer`は重複チェック自体が無い）ため信用せず、`functions/src/drive/customerAmbiguityGate.ts`が`exportDocument()`のdoc取得直後（Drive API/Storage呼び出し前）で以下を順に判定する:

1. sentinel値（「不明顧客」「未判定」）・空文字は常に未確定扱い。
2. `doc.customerId`の指すマスター名と`doc.customerName`が乖離している場合（マスター改名の取り残し等）も未確定扱い（`furigana`取得のため既に読み込み済みのマスターdocを再利用、追加読み込みコストゼロ）。
3. 既存の人間確定デュアルリード（`customerConfirmed !== undefined ? customerConfirmed : needsManualCustomerSelection !== undefined ? !needsManualCustomerSelection : false`、両方undefinedのレガシーdocは「未確定」として扱い次段の曖昧性チェックに委ねる〈後述〉、`customerConfirmed:true`+`needsManualCustomerSelection:true`という不整合docは通過）で確定済みならここで終了。
4. 未確定と判定された場合のみ、`masters/customers/items`への`where('name','==',...).limit(2)`ライブクエリで実際に同名マスターが2件以上存在するかを確認し、存在する場合のみ`CustomerUnconfirmedError`をthrowする。

この設計により、顧客名未設定/sentinel値・customerId↔name乖離・同名マスターが実在し未選択、の3系統を正確にブロックしつつ、「分割フローでOCRが正しく一意認識し人間が触らなかった」ケースは通過するようになった（過剰ブロックの解消）。過確定の解消は`useDocumentEdit.ts`側で対応: `shouldSetCustomerConfirmed`は、顧客名が同名マスター衝突を持つ（曖昧な）場合のみ、顧客欄(`customerName`/`customerId`)への明示的なtouchを要求する。曖昧でない大多数のケース（推定95%超）では既存のIssue #396 AC5「保存=確定」挙動を維持し、選択待ちバッジの点灯頻度への影響を最小化した。あわせて`confirmedBy`/`confirmedAt`を書き込むよう修正した（従来`officeConfirmed`側との非対称があり、`confirmedBy`が空のため診断スクリプトが人間確定を正しく再判別できなかった）。

FAX複製フロー（`functions/src/ocr/faxDuplication.ts`）はこのゲートを経由しない別の書込経路であり、`buildFaxDuplicationMemberOverride()`が無条件で`customerConfirmed:true`を書き込む。同名マスター2件（`isDuplicate`未設定）を「別人2名」と誤認して複製すると、新ゲートの人間確定判定で即通過しライブクエリすら実行されず、Finding修正後も別人2名の書類が同一フォルダへ合流しうる致命的な穴だった。対策として`planFaxDuplication`自体に同名衝突候補の除外を追加した（`ocrProcessor.ts`が既にメモリ上に持つ顧客マスター全件から`sameNameCollisionNames`を計算して渡す、追加I/Oなし）。

調査の過程で、Drive連携とは独立に存在していた既存バグも発見した: 同姓同名候補の手動選択UI（`MasterSelectField`、`DocumentDetailModal.tsx`）は選んだマスターの`customerId`を保存せず`customerName`のみを保存していた。これによりcustomerNameが不変のままID-onlyで顧客を付け替える保存が、`useDocumentEdit.ts`の`saveChanges`早期return（`changes.length===0`判定）でsilentにスキップされる問題もあわせて修正した（`onChange`で`customerId`も同期、`changes`検知にcustomerId比較を追加）。

`scripts/drive-export-status-report.ts`は「顧客未確定」による`error`を独立集計する新バケットを持つ（`classifyDriveExportError()`、`scripts/lib/driveExportBackfillHelpers.ts`）。Stage D entry gateの`error=0`判定には含めるが（滞留docゼロという意図を維持）、異常停止基準の実エラー比率（20%閾値）からは除外する（顧客未確定は運用課題でありDrive API異常のシグナルではないため）。Phase D（flag ON）着手前の運用として、新設の`scripts/check-customer-master-integrity.js`（read-only）でkanameone/cocoroの同姓同名マスター重複・フリガナ欠損・顧客未確定doc数を可視化し、現場での確定作業・マスタークリーンアップを先行させる。**両フィールド未設定のレガシーdocも、曖昧性が実在すればブロック対象になる**（従来は後方互換で無条件通過だったが、ambiguity-aware化に伴い仕様変更した。この事前クリーンアップ運用で吸収する設計）。

**運用上の限界**: 本ゲートは「衝突を防止する」のではなく「人間が一度確認したことを保証する」に留まる。`MasterSelectField`は`notes`（区別用補足情報）未設定の同名候補を表示上区別できない（cmdkの`value`も名前ベースで衝突する）ため、ユーザーが区別不能な2択から誤って選んでも、選択済みという理由でゲートは通過してしまう。同名マスターには`notes`設定を運用上推奨する。また、既に`exported`状態のdocは再評価されない（マスター追加で事後的に同名衝突が生じても対象外）。既に合流したフォルダの検出は`check-customer-master-integrity.js`のオフライン監査が唯一の手段。

**Out of Scope（本対応では扱わない）**: OCRが別名（例:「田中一郎」/「田中一朗」）をスコア僅差で取り違えるケース（`extractors.ts`の`needsManualSelection`が上位2候補のスコア差≤10で立つ条件のうち、同名マスター衝突以外の分岐）は、既存のOCR精度課題として別途扱い、本ゲートの保護対象外とする（decision-maker承認済み）。フォルダ名への識別子付与（真性の同姓同名・同一ケアマネ担当という構造的衝突への対策）は、現時点でこのパターンの実在が確認できていないため見送った。`furiganaFallback:'useNameInitial'`を選択したテナントでは、`customerId`がnull（「該当なし」選択）のdocがフリガナ参照をスキップしゲートを素通りしうる点も、opt-in済みのリスク面として本対応のスコープ外とする（kanameoneは`'stop'`を維持）。

**プロアクティブ通知UI追加（2026-07-26）**: 上記ゲートはDriveエクスポートを正しくブロックするが、現場管理者が能動的に気づける経路が存在しない（Driveエラー一覧はflag OFF時無表示、既存の「選択待ち」バッジはBEゲートと矛盾する規約でレガシーdocを確定済み扱いにする）ことが判明した。`shared/customerIdentity.ts`に`precheckCustomerIdentity`/`resolveCustomerUnconfirmedReason`を新設し、本ゲート（BE、委譲・挙動不変）とFE側の「同姓同名」バッジ（書類一覧/担当CM別/顧客別/処理履歴/詳細モーダルの5箇所）が同一の判定ロジックを共有するようにした。新規Cloud Function・Scheduler・Firestoreフィールドは追加せず、FEは`useCustomers()`の既存キャッシュ（`staleTime: 5分`）を再利用したライブ判定で実現している。**顧客マスターの追加・改名は最大5分（画面を開いたままならさらに長く）反映が遅れる**——安全性（Driveエクスポートのブロック）は本ゲートのライブクエリが保証するため実害はないが、通知の即時性としては制約として残る。

実装過程で、本ゲートと同型の`c.name.trim()`（trimしない前提のFirestore生データへの無条件アクセス）を3箇所で横展開したが、うち1箇所（`DocumentDetailModal.tsx`の候補一覧表示）は当初の実装で型ガードが漏れ、`name`フィールド欠損マスターが存在すると詳細モーダルがクラッシュするregressionを含んでいた。Codexセカンドオピニオン（plan mode）で発見し別PRで修正済み。また、FE側の同名衝突判定（`findSameNameCollisionNames`）はマスター名をtrimしてから集計するが、本ゲートのFirestoreクエリ（上記4.参照）は生値のまま完全一致検索するため、**マスター名に前後空白が付与された場合、FE通知とBEブロックの挙動が食い違いうる**（Codex review-diff指摘）。kanameone/cocoro実データでは前後空白付きマスター名は0件と実測確認済みだが、恒久対応（クエリ側の正規化またはマスター書込み経路への制約強制）は未実施で、`check-customer-master-integrity.js`の手動実行による検出に留まる（日次自動監視は`scheduled-audit.yml`の対象外、office短マスター検出専用のため）。

### 7. スコープはPhase 1（MVP）に限定

Phase 1 = OAuth接続 + Picker + セグメント型テンプレート設定 + 確認ボタン起点のoutboxエクスポート + fileId記録によるfind-or-createの重複防止 + エラー一覧UI + 定期リトライ（Cloud Scheduler）。

Phase 2（担当替え追従の自動フォルダ移動、Shared Drive/Service Accountモード、再送管理UI、本文差替）、Phase 3（NotebookLM/eFAX特化機能）は対象外とし、将来の拡張ポイントとして本ADRに記録するのみとする。

## Consequences

### Pros
- Gmail接続と分離することで、片方の再認可がもう片方を巻き添えにしない
- `drive.file`スコープにより、Google Workspace管理者・エンドユーザーへの説明責任が軽い（最小権限）
- セグメント型テンプレートにより、新規クライアント追加時もコード改修が不要
- fail-visibleな設計（フリガナ欠損・フォルダ重複で停止）により、誤配置による情報漏洩・誤送付のリスクを構造的に排除
- outboxパターンにより、Cloud Functions実行中のクラッシュから定期リトライで自動回復できる
- Admin SDK専有により、firestore.rulesの改ざん可能面を広げない

### Cons
- Shared Driveのルート直下を選択できない制約があり、UI上での説明が必要（実機検証で判明）
- `drive.file`スコープでは完全削除ができず、ゴミ箱移動までしかアプリ側で保証できない
- セグメント型テンプレートは自由度を制約するため、将来的に想定外のフォルダ構成が出た場合は拡張が必要になる
- Phase 1は初回送信のみで、ドキュメント内容の差し替え（本文更新）は非対応（Phase 2で対応）

## Alternatives Considered

- **フロントエンドから直接Drive系フィールドを書き込む案**: 却下。`firestore.rules`のdocuments update許可リストを汚染し、改ざん可能面が広がるため、Admin SDK専有・Callable Function経由に統一した。
- **`onDocumentUpdated`トリガーの採用**: 却下。このプロジェクトのCloud Functionsは全てのFirestoreトリガーを`onDocumentWritten`で統一しており（前例なし）、既存パターンとの一貫性を優先した。
- **フォルダ名重複時の自動選択（先頭を採用する等）**: 却下。誤った利用者フォルダへの配置リスクが「エクスポートされない」リスクより重いと判断し、常に停止を優先した。
- **フルスコープ`drive`の採用**: 却下。実機検証で`drive.file`+`supportsAllDrives=true`の組み合わせで要件を満たせることを確認できたため、より狭いスコープを採用した。

## References
- 関連ドキュメント: `docs/context/data-model.md`（`/settings/drive`、Drive Export状態セクション）
- ADR-0003（Gmail OAuth / Service Account切替）: 同種の認証方式選択の前例
- ADR-0009（クライアント別Feature Flag）: `settings/features.driveExport`フラグの既存パターン
- ADR-0021（ライブ読取集計モデル）: 多重トリガー再発火時のno-op化の根拠
- 実機検証: `doc-split-dev`環境でのGoogle Picker + Drive API v3実機テスト（2026-07-20）
