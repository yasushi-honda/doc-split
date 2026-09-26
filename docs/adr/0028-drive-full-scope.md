# ADR-0028: Drive OAuthスコープを`drive.file`からフルスコープ`drive`へ拡張する

## Status
Accepted (2026-09-23)

## Context

kanameoneから「医療フォルダを手動でDrive上の別の場所から保存先フォルダへ移動したところ、
医療フォルダが2つできた」という報告があった(Issue #1028、P1)。

dev環境で実機再現し、根本原因を確定した: `getDriveClient()`(`functions/src/utils/driveAuth.ts`)
のOAuthトークンが`drive.file`スコープ(ADR-0022 Decision 2で確定)しか持たないため、人が
Drive UIで作成・移動したフォルダは`files.list`で一切見えない(appが一度も`files.create`/
`files.get`していないファイル・フォルダはdrive.fileスコープの構造上不可視)。このため
`findOrCreateFolder`は既存フォルダを「0件」と誤判定し、同名フォルダを新規作成し続ける。

再現性は100%(タイミング非依存)であり、Issue #811(索引反映遅延によるタイミング依存の重複、
claimプロトコルで対策済み)・Issue #871(claimが既にあるフォルダの手動移動、承認付き
再同期ワークフローで対策済み)のいずれとも異なる、appが**そもそも一度もそのフォルダの存在を
認識したことがない**ケースであり、既存の対策はいずれも適用できない。

decision-maker判断(本セッション、AskUserQuestion経由): クライアントは業務上、手動での
フォルダ作成・移動を今後も続ける前提である。運用ルールで「手動操作をしないでほしい」と
案内する方向は採らず、技術的にこのケースを検出・処理できるようにする。

## Decision

### 1. スコープはフルスコープ`drive`に変更する。ただしバックエンド永続token(code flow)のみ

`drive.metadata.readonly`の追加(検出のみ、書込みは不可)も検討したが、以下の理由で確定却下する:
- `drive.metadata.readonly`は「Drive内のファイルのメタデータを閲覧する」専用スコープであり、
  フォルダの作成・移動・ファイルの書込みという本要件を構造的に満たせない(Google公式の
  スコープ定義上明白な不一致であり、実機での403検証を待つまでもない)。
- Google Drive API scopesの分類上、`drive`・`drive.readonly`・`drive.metadata`・
  `drive.metadata.readonly`は全て「restricted」区分であり(`drive.file`のみ
  「non-sensitive」)、`drive.metadata.readonly`を選んでも審査コストは`drive`と変わらない。
  審査コストが同じなら、要件を満たせるフルスコープを選ぶ方が合理的。

一方、Google Picker用のtoken(フロントエンド、`initTokenClient`、フォルダ選択専用の短命
access token)は**意図的に`drive.file`のまま変更しない**。GoogleはPickerとの併用に
`drive.file`を推奨しており、フォルダ選択という用途に対してバックエンドの永続tokenと
同じ広い権限を渡す必要はない(最小権限)。

### 2. 既存の同名重複は「人が作った側」を残す

decision-maker判断: 同一parent+nameの重複が既に存在する場合、appが作成したフォルダの中身
(PDF)を人が作成したフォルダへ移動し、空になったapp側フォルダをtrashする。クライアントが
意図して配置したフォルダ(共有設定や他のファイルを含みうる)を尊重する。

統合の自動実行は「`docSplitFolderClaim`タグ無しのフォルダがちょうど1件・タグ有りが
ちょうど1件・タグ有り側に子フォルダが無い」場合のみに限定する。タグの有無だけでは
「人が作った」ことの証明にならない(旧claimプロトコル導入前のapp作成フォルダも無タグの
ため)が、この限定条件下では誤統合のリスクを実務上十分に小さくできると判断した。それ以外
(3件以上の重複、タグ無し/有りが複数、統合元に子フォルダがある等)は全てmanual-reviewとし、
自動処理しない。実装は`scripts/audit-drive-sibling-duplicates.ts`(read-only棚卸し)・
`scripts/execute-drive-sibling-merge.ts`(承認制の統合実行)を参照。

### 3. kanameoneの同意画面(外部・本番公開)は、内部化を優先する

decision-maker判断: プロジェクトがkanameone.com組織配下であることを確認できれば、
OAuth同意画面のユーザータイプを「内部」へ切り替える(審査不要)。組織配下でない、
または内部化できない場合は、Gmail連携(`gmail.readonly`)と同じ状態(外部・未審査)の
まま進める。

**実施記録(2026-09-26)**: kanameoneのGCPプロジェクト(`docsplit-kanameone`)を対象に、Google Cloud Console(Google Auth Platform「対象」ページ)でユーザーの種類を「外部」→「内部」へ切替済み(実機操作・確認はPlaywright MCP経由)。既存のDrive接続アカウント`systemkaname@kanameone.com`がkanameone.com Workspaceアカウントであるため、既存連携への影響なし。この切替により、`drive`フルスコープが未検証スコープであることに起因するGoogleの「未確認のアプリ」警告画面が発生しなくなった。cocoro(`docsplit-cocoro`)は同ページ確認の結果、元から「内部」設定済みであり対応不要だった。

**kanameone本番展開のGo条件**(内部化できない場合を含め、必ず満たすこと):
- Drive連携は専用のGoogleアカウントで行う(クライアントの個人アカウントと分離)
- 連携アカウントが日常的にアクセスする共有範囲を、業務データ(rootFolderId配下)のみに
  限定する運用をクライアントと合意する
- Secret Manager(`drive-oauth-refresh-token`等)のIAMを最小権限に保つ
- トークン失効・再連携手順を文書化し、実機で1回テストする
- 本Go条件の受け入れ判断者(decision-maker)を明記する

## Consequences

### Pros
- 人が手動作成・移動したフォルダを、appが正規の保存先として検出・採用できるようになる。
  手動操作による重複作成が構造的に起きなくなる(Issue #1028の再発防止)。
- Picker用tokenを`drive.file`のまま維持することで、最小権限の原則を可能な限り保つ。

### Cons
- refresh tokenが連携アカウントのアクセス可能なDrive範囲(Shared Drive含みうる)への
  読み書き権限を持つ。Go条件(専用アカウント・共有範囲限定・IAM最小化)で緩和するが、
  ADR-0022時点の「app作成分のみ」という説明責任の軽さは失われる。
- **既存app管理フォルダとの新規衝突は、今後も繰り返し発生する運用コストとして受容する**
  (decision-maker確認済み、2026-09-23クロスレビュー後の再確認)。`resolved` claimは最長5分間
  `files.get`のみで信頼される(3段ラダー、`driveFolderClaim.ts`)。「既にapp側フォルダが
  ある場所へ人が同名フォルダを移動する」通常操作は、この5分の窓の間は検出されず、5分経過後の
  完全検索で2件を検出して`divergent`化する(自動統合はされない。kanameoneは
  `driveFolderClaimRead`が既に有効なため、この経路は本番で常時稼働している)。`divergent`は
  人手解除するまで対象customer/category配下のexportが停止し続ける。今回のスコープ拡張が
  解消するのは「appがまだclaimを持っていない場所に人がフォルダを置く」ケース(Issue #1028
  本体)のみであり、「既存app管理フォルダと衝突する形で新たに同名フォルダを作る」ケースは、
  クライアントが手動フォルダ操作を続ける限り今後も定期的に発生しうる。解消手順は
  `docs/context/monitoring-setup.md`のIssue #871 SOP(`classify-drive-claim-divergence`→
  `execute-drive-claim-resync`のrelease-claim)をそのまま使う。
- 表記ゆれ(全角/半角スペース違いのフォルダ名)は完全一致検索では同一とみなされない(既存課題、
  対象外)。

## Alternatives Considered

- **`drive.metadata.readonly`の追加**: 却下(Decision 1参照)。要件を構造的に満たせない。
- **運用ルール化(手動操作を控えるようクライアントへ案内)**: 却下。decision-maker判断により、
  クライアントの業務上の実際のワークフロー(手動フォルダ作成・移動)を制限する方向は
  採らないと決定した。
- **検出・修復ツールの運用定着のみ(スコープ拡張なし)**: 却下。既存の`drive.file`スコープの
  読み取り専用ツール(`investigate-drive-folder-duplicate-by-name.ts`等)も同じスコープ
  制約を持つため、本件の障害パターン(人が手動作成した未認識フォルダ)を原理的に検出できない
  ことが判明した。

## References
- Issue #1028(本件、kanameoneからの報告・dev実機再現・原因確定)
- Issue #811(claimプロトコル、索引反映遅延によるタイミング依存重複への対策)
- Issue #871(divergent承認付き再同期ワークフロー、claimが既にあるフォルダの手動移動への対策)
- ADR-0022(Google Drive エクスポート Phase 1、`drive.file`スコープ確定の経緯、本ADRが
  Decision 2を置換する)
- `docs/context/monitoring-setup.md`(棚卸し・統合の運用SOP)
- 関連コード: `functions/src/utils/driveAuth.ts` / `functions/src/drive/exchangeDriveAuthCode.ts` /
  `scripts/audit-drive-sibling-duplicates.ts` / `scripts/execute-drive-sibling-merge.ts`
