# クライアント様向け：GCPプロジェクトセットアップ

<style>
.client-hero {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 40px 30px;
  border-radius: 12px;
  text-align: center;
  margin: 20px 0;
}
.client-hero h1 {
  color: white !important;
  margin: 0 0 15px 0;
  font-size: 32px;
}
.client-hero p {
  font-size: 18px;
  margin: 0;
  opacity: 0.95;
}
.download-card {
  background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
  border-radius: 12px;
  padding: 24px;
  margin: 20px 0;
  border-left: 4px solid #667eea;
}
.download-btn {
  display: inline-block;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white !important;
  padding: 16px 32px;
  border-radius: 8px;
  text-decoration: none !important;
  font-weight: bold;
  font-size: 18px;
  transition: transform 0.2s, box-shadow 0.2s;
  box-shadow: 0 4px 6px rgba(0,0,0,0.1);
}
.download-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 12px rgba(0,0,0,0.15);
}
.step-timeline {
  position: relative;
  padding-left: 40px;
  margin: 30px 0;
}
.step-timeline::before {
  content: '';
  position: absolute;
  left: 15px;
  top: 0;
  bottom: 0;
  width: 3px;
  background: linear-gradient(to bottom, #667eea, #764ba2);
}
.timeline-item {
  position: relative;
  padding: 20px 0;
}
.timeline-item::before {
  content: attr(data-step);
  position: absolute;
  left: -32px;
  top: 20px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  font-size: 14px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.2);
}
.faq-item {
  background: white;
  border-radius: 8px;
  padding: 20px;
  margin: 12px 0;
  border: 1px solid #e2e8f0;
}
.faq-item h4 {
  margin-top: 0;
  color: #667eea;
}
</style>

<div class="client-hero">
  <h1>DocSplit セットアップガイド</h1>
  <p>所要時間: 約5分 | 必要なもの: Googleアカウント・課金アカウント</p>
</div>

---

## このページについて

DocSplitをご利用いただくには、お客様のGoogle Cloud Platform（GCP）アカウントで新規プロジェクトを作成し、開発者に権限を付与する必要があります。

このページでは、**自動化スクリプト**を使用した簡単なセットアップ方法をご案内します。

---

## セットアップ方法（2つの選択肢）

### ✅ 推奨：自動化スクリプトを使用（約5分）

コマンドラインツールを使用できる方向けです。対話形式で必要な情報を入力するだけで、自動的にセットアップが完了します。

### 📱 手動セットアップ（約10分）

GUIから手動でセットアップしたい方向けです。画面の指示に従って操作します。

---

## 方法1: 自動化スクリプトを使用（推奨）

<div class="step-timeline">

<div class="timeline-item" data-step="1">
<h3>事前準備</h3>

**事前準備は不要です！**

以下はスクリプトが自動で対応します：
- ✅ gcloud CLI のインストール（未インストール時）
- ✅ Google Cloud への認証（ブラウザが自動で開きます）

**お客様がご用意いただくもの:**
- Googleアカウント（GCPプロジェクトを作成するアカウント）
- 課金アカウント（すでにお持ちの場合）

</div>

<div class="timeline-item" data-step="2">
<h3>スクリプトのダウンロード</h3>

<div class="download-card">

**お使いのOSを選んでください:**

<br>

**Mac の方:**

<a href="https://raw.githubusercontent.com/yasushi-honda/doc-split/main/scripts/client-setup-gcp.command" class="download-btn" download>
📥 client-setup-gcp.command をダウンロード
</a>

<small>※ ダウンロード後、ダブルクリックで実行できます。ターミナルの知識は不要です。</small>

<br><br>

**Linux の方:**

<a href="https://raw.githubusercontent.com/yasushi-honda/doc-split/main/scripts/client-setup-gcp.sh" class="download-btn" download>
📥 client-setup-gcp.sh をダウンロード
</a>

<small>※ ターミナルで実行します（下記の「スクリプトの実行」を参照）。</small>

<br><br>

**Windows の方:**

<a href="https://raw.githubusercontent.com/yasushi-honda/doc-split/main/scripts/client-setup-gcp.bat" class="download-btn" download>
📥 client-setup-gcp.bat をダウンロード
</a>

<small>※ ダウンロード後、ダブルクリックで実行できます。</small>

</div>

</div>

<div class="timeline-item" data-step="3">
<h3>スクリプトの実行</h3>

**Mac の方:**
1. ダウンロードした `client-setup-gcp.command` をFinderでダブルクリック
2. ターミナルが自動で開き、セットアップが開始されます

**Linux の方:**
```bash
chmod +x client-setup-gcp.sh
./client-setup-gcp.sh
```

**Windows の方:**
1. ダウンロードした `client-setup-gcp.bat` をダブルクリック
2. コマンドプロンプトが自動で開き、セットアップが開始されます

<div class="info-box">
<strong>自動で実行される内容:</strong><br>
1. gcloud CLI のインストール確認（未インストール時は自動インストール）<br>
2. Google Cloud への認証（ブラウザが開きます）<br>
3. プロジェクト情報の入力（次のステップ）
</div>

</div>

<div class="timeline-item" data-step="4">
<h3>情報の入力</h3>

画面の指示に従って、以下を入力してください：

1. **プロジェクトID**（例: `docsplit-abc-kaigo`）
   - 小文字・数字・ハイフンのみ
   - 6〜30文字
   - 世界中で一意である必要があります

2. **開発者のメールアドレス**（開発者から受領）

3. **課金アカウントID**（画面に表示されるリストから選択）

</div>

<div class="timeline-item" data-step="5">
<h3>完了</h3>

セットアップが完了すると、プロジェクトIDが表示されます。

このプロジェクトIDを**開発者に連絡**してください。開発者が引き続きセットアップを進めます。

</div>

</div>

---

## 方法2: 手動セットアップ（GUI）

スクリプトを使用しない場合、以下の手順で手動セットアップできます。

### Step 1: GCPコンソールにアクセス

以下のURLにアクセスしてください：

**https://console.cloud.google.com**

### Step 2: 新しいプロジェクトを作成

1. 画面上部の「**プロジェクトを選択**」→「**新しいプロジェクト**」をクリック
2. 以下を入力：
   - **プロジェクト名**: `DocSplit`
   - **プロジェクトID**: `docsplit-<your-company>`（例: `docsplit-abc-kaigo`）
3. 「**作成**」ボタンをクリック

### Step 3: 課金を有効化

1. 左メニュー「**お支払い**」→「**アカウントをリンク**」
2. 既存の課金アカウントを選択
3. 「**アカウントを設定**」をクリック

### Step 4: 開発者に権限を付与

1. 左メニュー「**IAM と管理**」→「**IAM**」
2. 「**アクセスを許可**」ボタンをクリック
3. 以下を入力：
   - **新しいプリンシパル**: `<開発者のメールアドレス>`（開発者から受領）
   - **ロール**: `オーナー`
4. 「**保存**」をクリック

### Step 5: 完了

プロジェクトIDを開発者に連絡してください。

---

## よくある質問（FAQ）

<div class="faq-item">
<h4>Q. gcloud コマンドが見つかりません</h4>
<p>A. gcloud CLI がインストールされていません。「事前準備」の手順に従ってインストールしてください。</p>
</div>

<div class="faq-item">
<h4>Q. プロジェクト作成に失敗しました</h4>
<p>A. 以下を確認してください：</p>
<ul>
  <li>プロジェクトIDが既に使用されていないか（別のIDで再試行）</li>
  <li>Google Cloudでプロジェクト作成権限があるか（組織管理者に確認）</li>
</ul>
</div>

<div class="faq-item">
<h4>Q. 課金アカウント紐付けに失敗しました</h4>
<p>A. 以下を確認してください：</p>
<ul>
  <li>課金アカウントIDが正しいか</li>
  <li>課金アカウントの権限があるか（組織管理者に確認）</li>
</ul>
</div>

<div class="faq-item">
<h4>Q. スクリプトが実行できません（Mac）</h4>
<p>A. 以下のコマンドで実行権限を付与してください：</p>
<pre><code>chmod +x client-setup-gcp.sh</code></pre>
</div>

<div class="faq-item">
<h4>Q. セットアップ後、何をすればよいですか？</h4>
<p>A. プロジェクトIDを開発者に連絡してください。開発者が引き続きセットアップを進めます。お客様側での作業は完了です。</p>
</div>

---

## サポート

ご不明な点がございましたら、開発者にお問い合わせください。
