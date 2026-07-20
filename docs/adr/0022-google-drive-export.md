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

### 4. フォルダの解決は find-or-create、同名2件以上は停止

各セグメントの子フォルダ検索で、0件なら作成・1件なら再利用・**2件以上なら`AmbiguousFolderError`を投げて停止**する。これにより、「既存フォルダ構造への合流」と「新規ルートからの作成」の両ケースを、単一のロジックで一律に処理できる（ルートに空フォルダを選べば実質新規、既存構造のあるフォルダを選べば実質合流）。曖昧な状態での自動選択は誤配置リスクがあるため、常に停止を優先する。

### 5. 同期トリガーは「確認ボタン」押下（`verified` false→true）

documentの`verified`フィールドがfalse→trueになる瞬間を、Cloud Functions側のFirestoreトリガー（`onDocumentWritten('documents/{docId}')`）で検知してエクスポートを開始する。OCR誤読・利用者取り違えが確定する前の情報を外部Driveへ誤って流出させるリスクを、人間のレビュー完了という明示的なゲートで防ぐ。この方式はcocoro側で承認済み。既存の確認フロー（`useDocumentVerification.ts`の`markAsVerified`、3つの呼び出し元）には一切変更を加えない。

### 6. Drive系フィールドはAdmin SDK専有、outboxパターンで状態管理

`driveExportStatus`（`pending → exporting → exported`、失敗時`error`）と`driveFileId`/`driveExportedAt`/`driveExportError`を document に追加し、**Cloud Functions（Admin SDK）からのみ書き込む**設計にする。これにより `firestore.rules` の documents update許可フィールドリスト（`hasOnly([...])`方式）への変更が不要になり、改ざん可能面を広げない。フロントエンドからの再送は直接Firestore書き込みではなく、Callable Function（`retryDriveExport`）経由に限定する。

トリガー自身の書き戻し（`driveExportStatus`の更新）による再発火は、`before?.verified !== true && after.verified === true`という「立ち上がりエッジのみ」の判定で防ぐ（既存の`searchIndexer.ts`のハッシュ比較と同じ思想）。

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
