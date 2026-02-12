# トラブルシューティング

DocSplit環境構築時のよくある問題と解決策をまとめています。

<div class="info-box">

**問い合わせ前のチェックリスト**
- エラーメッセージの全文をコピー
- 実行したコマンドを記録
- 以下の環境情報を収集:
  ```bash
  gcloud --version
  gcloud auth list
  gcloud config list
  ```

</div>

---

## 1. gcloud CLIインストール関連

### Mac: Gatekeeperの警告

**症状**: 「開発元を検証できないため開けません」と表示される

**原因**: macOSのセキュリティ機能がダウンロードしたファイルを保護

**解決策**:
- システム設定 → プライバシーとセキュリティ → 「このまま許可」をクリック
- または、ターミナルで隔離属性を削除:
  ```bash
  xattr -d com.apple.quarantine client-setup-gcp.sh
  chmod +x client-setup-gcp.sh
  ```

---

### Mac: PATHが通らない

**症状**: `gcloud: command not found`

**原因**: インストール後、環境変数が読み込まれていない

**解決策**:
1. ターミナルを完全に再起動
2. それでもダメな場合:
   ```bash
   source $HOME/google-cloud-sdk/path.bash.inc
   source $HOME/google-cloud-sdk/completion.bash.inc
   ```
3. `.bash_profile` または `.zshrc` に以下を追記:
   ```bash
   if [ -f '$HOME/google-cloud-sdk/path.bash.inc' ]; then
     . '$HOME/google-cloud-sdk/path.bash.inc'
   fi
   ```

---

### Windows: PATHが通らない

**症状**: `gcloud は、内部コマンドまたは外部コマンド...として認識されていません`

**原因**: インストール後、環境変数が反映されていない

**解決策**:
1. コマンドプロンプト/PowerShellを再起動
2. それでもダメな場合、手動でPATH追加:
   - システム環境変数 → Path → 新規
   - `%LOCALAPPDATA%\Google\Cloud SDK\google-cloud-sdk\bin` を追加
   - OK → 再起動

<div class="warning-box">

**注意**: 環境変数の変更後は、必ずターミナルを再起動してください。

</div>

---

### Linux: curlがない

**症状**: `curl: command not found`

**解決策**:
```bash
# Ubuntu/Debian
sudo apt update && sudo apt install curl

# CentOS/RHEL
sudo yum install curl

# Fedora
sudo dnf install curl
```

---

## 2. 認証エラー

### ブラウザが開かない

**症状**: `gcloud auth login` 実行後、ブラウザが起動しない

**原因**: リモートサーバー、ヘッドレス環境、またはSSH接続中

**解決策**:
```bash
gcloud auth login --no-launch-browser
```
表示されたURLを手動でコピーし、ローカルPCのブラウザに貼り付けて認証してください。

---

### 複数Googleアカウントで誤ったアカウントが選択される

**症状**: 認証画面で意図しないアカウントが表示される

**解決策**:
1. **推奨**: シークレットウィンドウで認証
2. または、既存認証を全削除してから再認証:
   ```bash
   gcloud auth revoke --all
   gcloud auth login
   ```

---

### SSOリダイレクトでエラー

**症状**: 組織のSSO画面に飛んだ後、エラーが出る

**原因**: 組織のSSO設定でGCP Consoleへのアクセスが制限されている

**解決策**: IT管理者に以下を依頼:
- `console.cloud.google.com` へのアクセス許可
- SAML/OAuth設定の確認

---

## 3. プロジェクト作成エラー

### `The project ID you specified is already in use`

**原因**: プロジェクトIDはGCP全体でユニーク（世界で1つだけ）

**解決策**: 別のIDを指定
```bash
# 例
docsplit-abc-kaigo    → docsplit-abc-kaigo-2
docsplit-test         → docsplit-test-20250213
```

<div class="info-box">

**Tips**: プロジェクトIDは変更不可なので、最初から組織名や日付を含めることを推奨します。

</div>

---

### `Quota exceeded for quota metric 'Project creation requests'`

**症状**: プロジェクト作成が失敗する

**原因**: プロジェクト作成数の上限（デフォルト: 1日5個、累計12個）

**解決策**:
1. 不要なプロジェクトを削除（削除後30日で完全削除）
2. GCPサポートにQuota引き上げを申請:
   - https://console.cloud.google.com/iam-admin/quotas
   - `Compute Engine API` → `Project creation requests` → 上限引き上げをリクエスト

---

### `User is not authorized to create project`

**症状**: プロジェクト作成権限がない

**原因**: Google Workspace組織でプロジェクト作成権限が制限されている

**解決策**: 組織の管理者に以下を依頼:
- 自分のアカウントに `resourcemanager.projectCreator` ロールを付与
- または、手動でプロジェクトを作成してもらう

---

## 4. 課金紐付けエラー

### 課金アカウントが表示されない

**症状**: スクリプト実行中、課金アカウント選択で何も表示されない

**原因**: 課金アカウントが未作成

**解決策**:
1. https://console.cloud.google.com/billing/create で新規作成
2. クレジットカード情報を登録
3. スクリプトを再実行

<div class="warning-box">

**重要**: 無料枠内の利用でも、課金アカウントの紐付けは必須です。

</div>

---

### `The caller does not have permission`

**症状**: 課金アカウントの紐付けができない

**原因**: 課金アカウントの管理権限がない

**解決策**: 課金アカウントの管理者に以下を依頼:
- 自分のアカウントに `billing.user` ロールを付与
- または、手動でプロジェクトに課金アカウントを紐付け

---

## 5. 権限付与エラー

### `One or more users named in the policy do not belong to a permitted customer`

**症状**: 開発者への権限付与が失敗

**原因**: 組織ポリシー `iam.allowedPolicyMemberDomains` による外部ユーザー制限

**解決策**: スクリプトが自動で対応を試みますが、失敗する場合は組織の管理者に依頼:
1. 組織ポリシーを確認: https://console.cloud.google.com/iam-admin/orgpolicies
2. `iam.allowedPolicyMemberDomains` → プロジェクトレベルでオーバーライド
3. 「すべて許可」に設定、または `gmail.com` を許可リストに追加

<div class="step-card">

**手動設定手順**:
1. GCP Console → IAMと管理 → 組織のポリシー
2. `Domain restricted sharing` を検索
3. プロジェクトを選択 → ポリシーをカスタマイズ
4. 「ポリシーの適用」→ 置換 → 「すべて許可」
5. 保存

</div>

---

### 組織ポリシー緩和が失敗

**症状**: `Error setting IAM policy: FAILED_PRECONDITION`

**原因**: 組織ポリシーの編集権限がない

**解決策**: 組織の管理者に以下いずれかを依頼:
1. 当該プロジェクトの `iam.allowedPolicyMemberDomains` を `allowAll: true` に設定
2. 開発者のドメイン（`gmail.com`）を許可リストに追加

<div class="error-box">

**重要**: プロジェクトレベルでの緩和が失敗する場合、組織管理者の対応が必須です。

</div>

---

## 6. サービスアカウント関連

### JSONキー作成が失敗

**症状**: `Service account key creation is disabled`

**原因**: 組織ポリシー `iam.disableServiceAccountKeyCreation` が有効

**解決策**: 組織の管理者に依頼:
1. 組織ポリシー → `Disable service account key creation` を検索
2. プロジェクトレベルでポリシーをオーバーライド
3. 「許可」に設定

**代替手段**: Workload Identity連携（高度なユーザー向け）
- サービスアカウントキーなしで認証可能
- 設定は複雑なため、IT管理者と相談してください

---

## 7. 開発者へのエスカレーション基準

以下の場合は作業を中断し、開発者に連絡してください:

<div class="warning-box">

**即座にエスカレーションが必要なケース**:
- 組織管理者の承認が必要な操作がある
- 3回以上同じエラーが繰り返される
- エラーメッセージが本ガイドのいずれにも該当しない
- 課金アカウントの作成権限がない
- プロジェクト削除や課金停止などのエラーメッセージが表示される

</div>

**連絡先**: [開発者のメールアドレスまたはサポート窓口]

---

## 8. デバッグ用ログ収集

開発者に問い合わせる際は、以下の情報を添えると解決が早くなります:

```bash
# 環境情報の収集
gcloud --version > debug-info.txt
gcloud auth list >> debug-info.txt
gcloud config list >> debug-info.txt
gcloud projects list >> debug-info.txt

# エラーの詳細ログ（直前のコマンドに --verbosity=debug を追加して再実行）
gcloud projects create PROJECT_ID --verbosity=debug 2>&1 | tee gcloud-debug.log
```

収集した `debug-info.txt` と `gcloud-debug.log` を開発者に送付してください。

<div class="success-box">

**Tips**: ログファイルに個人情報やクレデンシャルが含まれていないか確認してから送付してください。

</div>

---

## 9. よくある質問（FAQ）

### Q1. 無料枠で使い続けられますか？

A. はい。以下の範囲内であれば無料です:
- Firestore: 1日あたり読み取り50,000件、書き込み20,000件
- Cloud Storage: 5GBまで
- Cloud Functions: 月200万回呼び出しまで

詳細: https://cloud.google.com/free/docs/free-cloud-features

---

### Q2. 複数プロジェクトを作成できますか？

A. はい。ただし、以下の上限があります:
- 1日あたり5個
- 累計12個（不要なプロジェクトを削除すれば追加可能）

---

### Q3. セットアップスクリプトは何度でも実行できますか？

A. はい。既存のリソースがある場合はスキップされます。ただし、以下は注意:
- プロジェクトIDが重複する場合は別のIDを指定
- APIの有効化やサービスアカウント作成は冪等（何度実行しても安全）

---

### Q4. 組織のポリシーがわからない

A. IT管理者に以下を確認してください:
- `iam.allowedPolicyMemberDomains`（外部ユーザー制限）
- `iam.disableServiceAccountKeyCreation`（SAキー作成制限）
- `compute.requireShieldedVm`（Shielded VM強制）

確認方法: https://console.cloud.google.com/iam-admin/orgpolicies

---

### Q5. スクリプトを途中でキャンセルしてしまった

A. 問題ありません。再実行すれば途中から再開されます。
- 既存のリソースはスキップされます
- 削除が必要な場合は、手動でプロジェクトを削除してから再実行

---

## 10. 追加リソース

- [手動セットアップガイド](setup-manual.md)（スクリプトが使えない場合）
- [GCP公式トラブルシューティング](https://cloud.google.com/resource-manager/docs/troubleshooting)
- [Firebase公式ドキュメント](https://firebase.google.com/docs)

<div class="info-box">

**このガイドで解決しない場合**: 開発者に連絡し、エラーメッセージ全文と環境情報（`gcloud --version` など）を提供してください。

</div>
