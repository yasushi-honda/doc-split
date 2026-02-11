# Claude Code 自動納品

<style>
/* フォームセクション */
.delivery-form {
  background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
  border-radius: 12px;
  padding: 24px;
  margin: 20px 0;
  border-left: 4px solid #1a365d;
}
.delivery-form h3 {
  margin-top: 0;
  color: #1a365d;
}
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin: 16px 0;
}
@media (max-width: 600px) {
  .form-grid { grid-template-columns: 1fr; }
}
.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.form-group.full-width {
  grid-column: 1 / -1;
}
.form-group label {
  font-size: 13px;
  font-weight: 600;
  color: #475569;
}
.form-group input {
  padding: 8px 12px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  font-size: 14px;
  font-family: 'Fira Code', monospace;
  background: white;
  color: #1e293b;
  transition: border-color 0.2s;
}
.form-group input:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}
.form-group input::placeholder {
  color: #94a3b8;
}
.optional-tag {
  font-size: 11px;
  color: #94a3b8;
  font-weight: normal;
}

/* プロンプト出力 */
.prompt-output {
  position: relative;
  background: #0f172a;
  border-radius: 8px;
  margin: 20px 0;
  overflow: hidden;
}
.prompt-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px;
  background: #1e293b;
  border-bottom: 1px solid #334155;
}
.prompt-label {
  font-size: 13px;
  font-weight: 600;
  color: #94a3b8;
}
.copy-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}
.copy-btn:hover {
  background: #2563eb;
  transform: translateY(-1px);
}
.copy-btn.copied {
  background: #10b981;
}
.prompt-body {
  padding: 16px;
  color: #e2e8f0;
  font-family: 'Fira Code', 'Consolas', monospace;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 500px;
  overflow-y: auto;
}
.prompt-body .placeholder {
  color: #f59e0b;
  font-weight: bold;
}
.prompt-body .filled {
  color: #34d399;
  font-weight: bold;
}

/* ステップカード */
.step-card {
  background: white;
  border-radius: 8px;
  padding: 16px 20px;
  margin: 12px 0;
  border: 1px solid #e2e8f0;
  display: flex;
  align-items: flex-start;
  gap: 14px;
}
.step-num {
  background: #1a365d;
  color: white;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  font-size: 14px;
  flex-shrink: 0;
}
.step-content {
  flex: 1;
}
.step-content strong {
  color: #1a365d;
}
.step-content code {
  background: #f1f5f9;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 13px;
}

/* 注意ボックス */
.warn-box {
  background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
  border-radius: 8px;
  padding: 15px 20px;
  margin: 15px 0;
  border-left: 4px solid #f59e0b;
  color: #78350f;
}
.warn-box strong { color: #92400e; }
.info-box {
  background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%);
  border-radius: 8px;
  padding: 15px 20px;
  margin: 15px 0;
  border-left: 4px solid #3b82f6;
  color: #1e3a5f;
}
.info-box strong { color: #1e40af; }
/* バリデーションエラー */
.input-error {
  border-color: #ef4444 !important;
  box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.15) !important;
}
.copy-btn:disabled, .copy-btn-disabled {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none;
}
</style>

<div class="success-box">
<strong>Claude Codeで新規納品を自動実行</strong>するためのプロンプトジェネレーターです。<br>
フォームに情報を入力 → プロンプトをコピー → Claude Codeに貼り付けるだけで納品が完了します。
</div>

---

## 納品シナリオ

### シナリオ1: 基本納品（Gmail連携なし）

**必要な情報:**
- ✅ プロジェクトID（クライアントから受領）
- ✅ 管理者メールアドレス（クライアントから受領）

**Claude Codeで自動実行される内容:**
- Firebase Hosting デプロイ
- Firestore/Storage ルール設定
- 管理者ユーザー登録
- Cloud Functions デプロイ
- マスターデータ投入（CSV受領時）

**所要時間:** 約10分（Claude Code実行のみ）

---

### シナリオ2: 完全納品（Gmail自動取得含む）

**必要な情報:**
- ✅ プロジェクトID（クライアントから受領）
- ✅ 管理者メールアドレス（クライアントから受領）
- ✅ **OAuth認証情報**（開発者が事前にGCP Consoleで設定）
  - Client ID
  - Client Secret
  - 認証コード

**Claude Codeで自動実行される内容:**
- シナリオ1の内容すべて
- **Gmail OAuth設定** ← 追加
- Gmail自動取得の有効化

**所要時間:** 約5分（OAuth設定） + 約10分（Claude Code実行） = 約15分

**推奨:** 実運用ではGmail連携が必須のため、シナリオ2を推奨します。

---

## 開発者の前提条件

<div class="warn-box">
以下がすべて満たされていることを確認してから作業を開始してください。
</div>

| 条件 | 確認方法 |
|------|---------|
| macOS / Linux / WSL 環境 | `uname` |
| Node.js >= 20 インストール済み | `node --version` |
| Firebase CLI インストール済み | `firebase --version`（未導入時: `npm install -g firebase-tools`） |
| doc-split リポジトリをクローン済み＋依存インストール済み | `ls CLAUDE.md && ls frontend/node_modules` （未実行時: `npm install`） |
| `gcloud` CLI 認証済み | `gcloud auth list` |
| ADC（Application Default Credentials）設定済み **または** サービスアカウントJSONキー受領済み | `gcloud auth application-default login` **または** `export GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json` |
| **クライアントのGCPプロジェクトへのオーナー権限 または JSONキー** | クライアントから招待済み、または組織アカウント環境の場合はJSONキー受領済み（[クライアント向けガイド](client/)参照） |
| Python 3 インストール済み | `python3 --version` |

---

## 事前準備（人間が行う作業）

### 共通（シナリオ1・2両方で必要）

<div class="step-card">
  <div class="step-num">1</div>
  <div class="step-content">
    <strong>クライアントにGCPプロジェクト作成を依頼</strong><br>
    <a href="client/" target="_blank">クライアント向けセットアップガイド</a>を共有し、以下を依頼:<br>
    • <code>client-setup-gcp</code> スクリプトを実行してもらう<br>
    • プロジェクトID（例: <code>docsplit-abc-kaigo</code>）を受領<br>
    <br>
    <strong>パターンA: 通常環境（外部ドメイン権限付与成功）</strong><br>
    • 開発者（あなた）がオーナー権限で招待されていることを確認<br>
    <br>
    <strong>パターンB: 組織アカウント環境（自動的にサービスアカウント方式に切替）</strong><br>
    • プロジェクトID + <strong>JSONキーファイル</strong>を受領<br>
    • 環境変数設定: <code>export GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json</code><br>
    <br>
    <small>※ クライアントがスクリプトを実行すると、GCPプロジェクト作成・課金設定・権限付与（または サービスアカウント作成）が自動で完了します</small>
  </div>
</div>

<div class="step-card">
  <div class="step-num">2</div>
  <div class="step-content">
    <strong>クライアントから受領</strong><br>
    管理者メールアドレス、マスターデータCSV
  </div>
</div>

---

### Gmail連携時のみ（シナリオ2で必要）

<div class="info-box">
<strong>シナリオ1（Gmail連携なし）の場合は、このセクションをスキップしてください。</strong><br>
以下はGmail自動取得を有効化する場合のみ必要です（約5分）。
</div>

<div class="step-card">
  <div class="step-num">3</div>
  <div class="step-content">
    <strong>GCP Console で OAuth 同意画面を設定</strong><br>
    <a href="https://console.cloud.google.com/apis/credentials/consent" target="_blank">OAuth同意画面</a>（クライアントのプロジェクトを選択）→ User Type: <code>外部</code> → アプリ名: <code>DocSplit</code>、サポートメール入力 → スコープ追加: <code>gmail.readonly</code> → テストユーザーに<strong>監視対象のGmailアドレス</strong>を追加
  </div>
</div>

<div class="step-card">
  <div class="step-num">4</div>
  <div class="step-content">
    <strong>GCP Console で OAuth クライアントID作成</strong><br>
    <a href="https://console.cloud.google.com/apis/credentials" target="_blank">認証情報ページ</a>（同じプロジェクト）→ 「認証情報を作成」→「OAuth クライアント ID」→ 種類: <code>デスクトップアプリ</code><br>
    → <strong>Client ID</strong> と <strong>Client Secret</strong> をメモ
  </div>
</div>

<div class="step-card">
  <div class="step-num">5</div>
  <div class="step-content">
    <strong>OAuth 認証コードを取得</strong><br>
    doc-split ディレクトリで以下のコマンドを実行:<br>
    <code>./scripts/setup-gmail-auth.sh --get-code --client-id=&lt;上で取得したClient ID&gt;</code><br>
    ブラウザが自動で開く → Googleログイン（Step 3で追加したテストユーザーでログイン） → ターミナルに表示された<strong>認証コード</strong>をコピー
  </div>
</div>

---

## プロンプト生成フォーム

<div class="info-box">
<strong>段階的な入力が可能です</strong><br>
OAuth認証情報やCSVは空欄でもプロンプト生成できます。空欄の場合はプレースホルダー（<code>&lt;client-id&gt;</code>等）が表示されるので、後から手動で置き換えてください。
</div>

<div class="delivery-form">
<h3>クライアント情報</h3>
<div class="form-grid">
  <div class="form-group">
    <label>プロジェクトID *</label>
    <input type="text" id="project-id" placeholder="docsplit-clientname" oninput="updatePrompts()">
  </div>
  <div class="form-group">
    <label>管理者メール *</label>
    <input type="text" id="admin-email" placeholder="admin@example.com" oninput="updatePrompts()">
  </div>
</div>

<h3>Gmail OAuth 認証情報 <span class="optional-tag">（OAuth設定後に入力）</span></h3>
<div class="form-grid">
  <div class="form-group">
    <label>Client ID <span class="optional-tag">任意</span></label>
    <input type="text" id="client-id" placeholder="123456789.apps.googleusercontent.com" oninput="updatePrompts()">
  </div>
  <div class="form-group">
    <label>Client Secret <span class="optional-tag">任意</span></label>
    <input type="text" id="client-secret" placeholder="GOCSPX-xxxx" oninput="updatePrompts()">
  </div>
  <div class="form-group full-width">
    <label>認証コード <span class="optional-tag">任意</span>（<code>./scripts/setup-gmail-auth.sh --get-code --client-id=X</code> で取得）</label>
    <input type="text" id="auth-code" placeholder="4/0AY-xxxx" oninput="updatePrompts()">
  </div>
</div>

<h3>マスターデータCSV <span class="optional-tag">（クライアントから受領後に入力）</span></h3>
<div class="form-grid">
  <div class="form-group">
    <label>顧客CSV <span class="optional-tag">任意</span></label>
    <input type="text" id="csv-customers" placeholder="path/to/customers.csv" oninput="updatePrompts()">
  </div>
  <div class="form-group">
    <label>書類種別CSV <span class="optional-tag">任意</span></label>
    <input type="text" id="csv-documents" placeholder="path/to/documents.csv" oninput="updatePrompts()">
  </div>
  <div class="form-group">
    <label>事業所CSV <span class="optional-tag">任意</span></label>
    <input type="text" id="csv-offices" placeholder="path/to/offices.csv" oninput="updatePrompts()">
  </div>
  <div class="form-group">
    <label>ケアマネCSV <span class="optional-tag">任意</span></label>
    <input type="text" id="csv-caremanagers" placeholder="path/to/caremanagers.csv" oninput="updatePrompts()">
  </div>
</div>

<h3>追加オプション</h3>
<div class="form-grid">
  <div class="form-group">
    <label>追加許可ドメイン <span class="optional-tag">任意</span></label>
    <input type="text" id="extra-domain" placeholder="example.com" oninput="updatePrompts()">
  </div>
</div>

<div id="validation-errors"></div>
</div>

---

## 最小版プロンプト

<div class="prompt-output">
  <div class="prompt-header">
    <span class="prompt-label">Claude Code に貼り付け</span>
    <button class="copy-btn" id="copy-minimal" onclick="copyPrompt('minimal')">
      コピー
    </button>
  </div>
  <div class="prompt-body" id="prompt-minimal"></div>
</div>

---

## フル版プロンプト

<div class="prompt-output">
  <div class="prompt-header">
    <span class="prompt-label">Claude Code に貼り付け（オプション全部入り）</span>
    <button class="copy-btn" id="copy-full" onclick="copyPrompt('full')">
      コピー
    </button>
  </div>
  <div class="prompt-body" id="prompt-full"></div>
</div>

---

## 納品後の確認

納品完了後、以下を確認してください:

| 確認項目 | 方法 |
|---------|------|
| ログイン | `https://<project-id>.web.app` に管理者メールでログイン |
| Gmail取得 | テストメール送信 → ラベル付与 → 5分後に書類一覧に表示 |
| OCR処理 | 取得された書類のメタ情報が推定されているか |
| PDF閲覧 | 詳細画面でPDFが表示されるか |
| マスター照合 | 顧客名が正しく推定されるか |

---

## 次回以降のアップデート

`setup-tenant.sh` により `.firebaserc` にエイリアスが自動登録されます。以降のアップデートは以下で実行できます:

```bash
# フロントエンドのみ（通常のアップデート）
./scripts/deploy-to-project.sh <project-id>

# 全クライアント一括
./scripts/deploy-all-clients.sh
```

詳細は [納品・アップデートガイド](context/delivery-and-update-guide.md) を参照してください。

---

> **関連ドキュメント**: [納品フロー詳細](deployment-flow.md) | [セットアップ手順](setup-guide.md) | [Gmail設定ガイド](operation/gmail-setup-guide.md)

