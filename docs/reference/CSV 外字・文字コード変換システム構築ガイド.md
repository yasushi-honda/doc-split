# Google Apps Script × Cloud Run functions 連携

## CSV 外字・文字コード変換システム構築ガイド（完全版 / Cloud Functions Gen 2 対応）

### 目的

Shift\_JIS (CP932) で外字を含む CSV を Google スプレッドシートへ取り込み、外字を Unicode 私的利用領域 (PUA) にマッピングして UTF‑8 に変換する仕組みを、**Cloud Run functions (＝ Cloud Functions Gen 2) \+ GAS** で構築する。

---

## 0\. システム概要

![][image1]

## ---

## 1\. 前提

* Google Cloud プロジェクト運用経験  
* Python / Google Apps Script 基礎  
* gcloud CLI 利用可

---

## 2\. GCP 準備

```
PROJECT_ID="csv-gaiji-converter"
gcloud projects create $PROJECT_ID --name="CSV Gaiji Converter"
gcloud config set project $PROJECT_ID

gcloud services enable \
  cloudfunctions.googleapis.com \
  run.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com

SA=csv-converter-svc
gcloud iam service-accounts create $SA \
  --display-name "CSV Converter Service Account for Gaiji Processing"
SERVICE_ACCOUNT_EMAIL="$SA@$PROJECT_ID.iam.gserviceaccount.com"
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SERVICE_ACCOUNT_EMAIL" \
  --role="roles/run.serviceAgent"
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SERVICE_ACCOUNT_EMAIL" \
  --role="roles/logging.logWriter"
```

---

## 3\. Cloud Run functions (Gen 2, Python)

### 3‑1 ディレクトリ

```
src/
├ main.py
└ requirements.txt
```

### 3‑2 main.py

```py
import base64, logging
from flask import jsonify, abort, request

GAIJI_MAP = {
    # b"\xf0\x40": "\uE000",  # 例
}

def _abort(st,msg):
    logging.error(msg); abort(st,msg)

def _convert(src:bytes)->str:
    out=bytearray(); i=0
    while i<len(src):
        b1=src[i]
        if b1<=0x7F or 0xA1<=b1<=0xDF:
            out.append(b1); i+=1; continue
        if i+1>=len(src):
            raise UnicodeDecodeError("cp932",src,i,i+1,"incomplete")
        pair=src[i:i+2]
        if pair in GAIJI_MAP:
            out.extend(GAIJI_MAP[pair].encode())
        else:
            out.extend(pair.decode("cp932").encode())
        i+=2
    return out.decode()

def convert_csv_gaiji_http(request):
    if request.method!="POST":
        return _abort(405,"POST only")
    body=request.get_json(force=True)
    sjis=base64.b64decode(body["csv_data_base64"])
    utf8=_convert(sjis)
    return jsonify({"success":True,"utf8_csv_data":utf8})
```

### 3‑3 requirements.txt

```
functions-framework>=3.0.0
```

### 3‑4 デプロイ

Cloud Console → \*\*Cloud Run › サービス → \+コンテナをデプロイ ▾ → \*\****関数を書く(Write a function)*** で以下を入力。

| 項目 | 値 |
| :---- | :---- |
| 関数名 | `csv-gaiji-converter-function` |
| ランタイム | Python 3.10 |
| ソース | インラインで main.py / requirements.txt 貼付 |
| エントリポイント | `convert_csv_gaiji_http` |
| 認証 | **認証が必要** |
| 実行 SA | `$SERVICE_ACCOUNT_EMAIL` |
| メモリ/Timeout | 512 MiB / 300 s |

CLI 派は:

```
gcloud functions deploy csv-gaiji-converter-function \
  --gen2 --runtime python310 --region asia-northeast1 \
  --entry-point convert_csv_gaiji_http --trigger-http \
  --source=src --memory 512Mi --timeout 300s \
  --service-account $SERVICE_ACCOUNT_EMAIL --no-allow-unauthenticated
```

デプロイ後の関数 URL を控え、それが **audience** となる。

---

## 4\. IAM & セキュリティ設定（詳細ガイド）

Cloud Run functions を **「認証が必要」** モードで安全に呼び出すためには、**2 種類の権限** を正しく設定する必要があります。

| 種別 | 何のため？ | 付与するロール | 付与先 | 付与対象リソース |
| :---- | :---- | :---- | :---- | :---- |
| **① 呼び出し権 (Invoker)** | Cloud Run 関数 URL への HTTP リクエストを許可 | `roles/run.invoker` | *あなたの Google アカウント* (または GAS デフォルト SA) | **Cloud Run 関数** |
| **② トークン発行権 (TokenCreator)** | Cloud Run が受理する **audience 付き ID トークン** を GAS から生成 | `roles/iam.serviceAccountTokenCreator` | *あなたの Google アカウント* | **`csv-converter-svc` サービスアカウント個別** |

**ポイント** *TokenCreator 権限はプロジェクトに一括付与しても機能しません。必ず「対象サービスアカウント個別」に付けること* が大切です。

### 4‑1 ① Invoker 権限を付与する手順

#### コンソール操作

1. **Cloud Run › サービス** で対象関数を開く → 上部 **\[ 権限 \]**  
2. **\+ プリンシパルを追加** をクリック  
3. **プリンシパル** に自分の Gmail（または `@appspot.gserviceaccount.com`）  
4. **ロール** → 「Cloud Run」→ **Cloud Run 起動元**  
5. 保存

#### CLI 例

```
gcloud run services add-iam-policy-binding csv-gaiji-converter-function \
  --member="user:your_mail@gmail.com" \
  --role="roles/run.invoker" \
  --region asia-northeast1
```

### 4‑2 ② TokenCreator 権限を付与する手順

#### コンソール操作

1. **IAM と管理 › サービス アカウント** → `csv-converter-svc` をクリック  
2. **\[ 権限を表示 \]** → **\[ アクセス権を付与 \]**  
3. **新しいプリンシパル** に自分の Gmail  
4. **ロール** → **IAM** → **サービス アカウント トークン作成者**  
5. 保存

**よくあるミス**: IAM ページの “プロジェクト レベル” で TokenCreator を付与しても、関数呼び出し時に `getOpenIdToken denied` という 403 が出ます。必ずサービスアカウント個別で付けてください。

#### CLI 例

```
gcloud iam service-accounts add-iam-policy-binding \
  csv-converter-svc@$PROJECT_ID.iam.gserviceaccount.com \
  --member="user:your_mail@gmail.com" \
  --role="roles/iam.serviceAccountTokenCreator"
```

### 4‑3 チェックリスト

- [x] Cloud Run 関数の **認証** は「認証が必要」になっているか？  
- [x] `roles/run.invoker` が呼び出し主体に付与済みか？  
- [x] `roles/iam.serviceAccountTokenCreator` が **SA 個別** に付与されているか？  
- [x] Apps Script の `generateIdToken_()` で audience に **関数 URL** を渡しているか？

### 4‑4 トラブルシューティング早見表

| エラー | 原因 | 確認ポイント |
| :---- | :---- | :---- |
| 403 `getOpenIdToken denied` | TokenCreator 付与忘れ／付与先を間違えた | SA 個別権限を確認 |
| 401 Unauthorized | audience 不一致 or Invoker 権不足 | audience URL ／ Invoker ロール確認 |
| 403 PermissionDenied on Cloud Run | 関数側で認証が必要だが Bearer ヘッダー空 | ID トークン発行処理 or Authorization ヘッダー漏れ |

---

## 5\. Google Apps Script

Google Apps Script

### 5‑1 appsscript.json

```
{
  "timeZone":"Asia/Tokyo",
  "runtimeVersion":"V8",
  "exceptionLogging":"STACKDRIVER",
  "oauthScopes":[
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/script.scriptapp",
    "https://www.googleapis.com/auth/script.container.ui",
    "https://www.googleapis.com/auth/cloud-platform"
  ]
}
```

### 5‑2 Code.gs（抜粋）

```javascript
// Code.gs

// スクリプトプロパティからCloud FunctionのURLを取得
const properties = PropertiesService.getScriptProperties();
const CLOUD_FUNCTION_URL = properties.getProperty('CLOUD_FUNCTION_ENDPOINT_URL');
// ★★★ 上記 'CLOUD_FUNCTION_ENDPOINT_URL' は、手順1で設定したプロパティ名と一致させる ★★★

// ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★
// ★★★ 結果を書き込みたいシート名を指定してください ★★★
// ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★
const TARGET_SHEET_NAME = "利用者情報"; // この名前のシートがなければ作成されます

/**
 * スプレッドシートを開いたとき（またはリフレッシュしたとき）にカスタムメニューを作成します。
 * この関数は、スプレッドシートにバインドされたスクリプトの場合、自動的にトリガーされます。
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('CSV外字変換ツール')
    .addItem('CSVをアップロードして変換・入力', 'showFileUploadDialog')
    .addToUi();
}

/**
 * ファイルアップロード用のHTMLダイアログを表示します。
 * この関数がカスタムメニューから呼び出されます。
 */
function showFileUploadDialog() {
  const htmlOutput = HtmlService.createHtmlOutputFromFile('UploadDialogHtml')
    .setWidth(450) // ダイアログの幅を少し広げました
    .setHeight(250); // ダイアログの高さを少し広げました
  SpreadsheetApp.getUi().showModalDialog(htmlOutput, 'CSVファイルアップロードと変換');
}

/**
 * クライアントサイドHTMLから呼び出され、アップロードされたファイルデータをCloud Functionに送信し、
 * 結果をスプレッドシートに書き込みます。
 *
 * @param {object} fileInfo クライアントサイドから渡されるファイル情報オブジェクト。
 *                          { filename: string, mimeType: string, base64Data: string } の形式を期待。
 * @return {object} フロントエンドに返す処理結果オブジェクト。
 *                  { success: boolean, message: string, sheetUrl?: string, warnings?: string[] } の形式。
 */
function processAndWriteCsv(fileInfo) {
  // console.log("GAS: processAndWriteCsv - 開始。受信したファイル情報:", JSON.stringify(fileInfo).substring(0, 200) + "..."); // データが大きいので一部表示
  // ★★★ CLOUD_FUNCTION_URLの存在チェックを追加 ★★★
  if (!CLOUD_FUNCTION_URL) {
    const errorMessage = "エラー: Cloud FunctionのURLがスクリプトプロパティに設定されていません。管理者に連絡し、スクリプトプロパティ 'CLOUD_FUNCTION_ENDPOINT_URL' を設定してください。";
    console.error("GAS: " + errorMessage);
    // SpreadsheetApp.getUi().alert("設定エラー", errorMessage, SpreadsheetApp.getUi().ButtonSet.OK); // これはサーバーサイド関数からは直接使えない
    return { success: false, message: errorMessage }; // クライアントにエラーを返す
  }

  if (!fileInfo || !fileInfo.base64Data || !fileInfo.filename) {
    console.error("GAS: processAndWriteCsv - 無効なファイル情報です。", fileInfo);
    return { success: false, message: "エラー: アップロードされたファイル情報が無効か、データが空です。" };
  }

  const originalFilename = fileInfo.filename;
  const base64CsvData = fileInfo.base64Data;

  console.log(`GAS: ファイル '${originalFilename}' の処理を開始します。Base64データ長: ${base64CsvData.length}`);

  try {
    // 1. Cloud Functionを呼び出すためのIDトークンを取得
    const serviceAccountEmail = "csv-converter-svc@csv-gaiji-converter.iam.gserviceaccount.com";
    const idToken = generateIdToken_(serviceAccountEmail, CLOUD_FUNCTION_URL);

    if (!idToken) {
      // 通常、ユーザーがスクリプトエディタから実行している場合はidTokenが取得できるはず。
      // トリガー実行などでサービスアカウントとして動く場合も取得可能。
      console.error("GAS: IDトークンの取得に失敗しました。スクリプトの実行権限やプロジェクト設定を確認してください。");
      throw new Error("IDトークンの取得に失敗しました。適切な権限でスクリプトが実行されているか確認してください。");
    }
    console.log("GAS: IDトークン取得成功。(トークン自体はログに出力しません)");

    // 2. Cloud Functionに送信するペイロード(JSON形式)を作成
    const payload = JSON.stringify({
      filename: originalFilename,
      csv_data_base64: base64CsvData // Base64エンコードされたCSVデータ
    });

    // 3. Cloud Functionを呼び出すためのオプションを設定
    const options = {
      method: "POST",
      contentType: "application/json",
      payload: payload,
      headers: {
        "Authorization": "Bearer " + idToken // IDトークンをAuthorizationヘッダーに含める
      },
      muteHttpExceptions: true // HTTPエラー(4xx, 5xx)を例外としてスローせず、レスポンスオブジェクトで処理する
    };

    console.log("GAS: Cloud Function呼び出し準備完了。URL: " + CLOUD_FUNCTION_URL);

    // 4. Cloud Functionを呼び出し
    const httpResponse = UrlFetchApp.fetch(CLOUD_FUNCTION_URL, options);
    const responseCode = httpResponse.getResponseCode();
    const responseBodyText = httpResponse.getContentText();

    console.log(`GAS: Cloud Functionからの応答コード: ${responseCode}`);
    // console.log(`GAS: Cloud Functionからの応答ボディ (最初の500文字): ${responseBodyText.substring(0, 500)}`); // デバッグ用に必要なら

    // 5. Cloud Functionからのレスポンスを処理
    if (responseCode === 200) { // HTTP OK
      const cfResponse = JSON.parse(responseBodyText);
      if (cfResponse.success && typeof cfResponse.utf8_csv_data === 'string') {
        console.log("GAS: Cloud FunctionでのCSV変換成功。");
        if (cfResponse.warnings && cfResponse.warnings.length > 0) {
          console.warn("GAS: Cloud Functionからの変換警告:", cfResponse.warnings.join("; "));
        }

        // 6. 変換されたUTF-8 CSVデータをスプレッドシートに書き込む
        const targetSheet = getOrCreateSheetByName(TARGET_SHEET_NAME);
        clearAndWriteDataToSheet(targetSheet, cfResponse.utf8_csv_data);

        const successMessage = `ファイル '${originalFilename}' の変換と '${TARGET_SHEET_NAME}' への書き込みが完了しました。`;
        console.log("GAS: " + successMessage);
        return {
          success: true,
          message: successMessage,
          sheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl() + "#gid=" + targetSheet.getSheetId(),
          warnings: cfResponse.warnings
        };
      } else {
        // Cloud Function側で success: false が返ってきた場合
        const errorMessage = `Cloud Functionでの変換処理に失敗しました。詳細: ${cfResponse.error || "Cloud Functionから具体的なエラーメッセージがありませんでした。"}`;
        console.error("GAS: " + errorMessage, cfResponse);
        return { success: false, message: errorMessage, warnings: cfResponse.warnings };
      }
    } else {
      // HTTPエラーが発生した場合 (4xx, 5xxなど)
      const errorMessage = `Cloud Functionの呼び出しでHTTPエラーが発生しました。ステータス: ${responseCode}。応答: ${responseBodyText.substring(0, 500)}`;
      console.error("GAS: " + errorMessage);
      return { success: false, message: errorMessage };
    }

  } catch (e) {
    // GASスクリプト内での予期せぬエラー
    const errorMessage = `GASスクリプトの実行中にエラーが発生しました: ${e.message || e.toString()}`;
    console.error("GAS: " + errorMessage, e.stack); // スタックトレースもログに出力
    return { success: false, message: errorMessage };
  }
}

/**
 * 指定された名前のシートを取得します。なければ作成します。
 * @param {string} sheetName 取得または作成するシートの名前。
 * @return {GoogleAppsScript.Spreadsheet.Sheet} シートオブジェクト。
 */
function getOrCreateSheetByName(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    console.log(`GAS: シート '${sheetName}' を新規作成しました。`);
  } else {
    console.log(`GAS: 既存のシート '${sheetName}' を使用します。`);
  }
  return sheet;
}

/**
 * UTF-8 CSV文字列データを指定されたシートに書き込みます。
 * 書き込み前にシートの既存の内容はすべてクリアされます。
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet 書き込み先のシートオブジェクト。
 * @param {string} utf8CsvStringData 書き込むUTF-8エンコードされたCSV文字列。
 */
function clearAndWriteDataToSheet(sheet, utf8CsvStringData) {
  try {
    if (typeof utf8CsvStringData !== 'string' || utf8CsvStringData.trim() === "") {
      sheet.clearContents();
      console.log(`GAS: 書き込むCSVデータが空のため、シート '${sheet.getName()}' をクリアしました。`);
      return;
    }

    // Utilities.parseCsv はUTF-8文字列を期待し、2次元配列を返します。
    const dataArray = Utilities.parseCsv(utf8CsvStringData);

    if (dataArray && dataArray.length > 0 && dataArray[0].length > 0) {
      sheet.clearContents(); // 既存の内容をクリア
      
      // ★★★ 大量データ対策: バッチ処理で書き込み ★★★
      const BATCH_SIZE = 500; // 一度に書き込む行数（500行ずつ）
      const numRows = dataArray.length;
      const numCols = dataArray[0].length;
      
      console.log(`GAS: 合計 ${numRows} 行、${numCols} 列のデータを ${BATCH_SIZE} 行ずつバッチ処理で書き込みます。`);
      
      for (let startRow = 0; startRow < numRows; startRow += BATCH_SIZE) {
        const endRow = Math.min(startRow + BATCH_SIZE, numRows);
        const batchData = dataArray.slice(startRow, endRow);
        const batchSize = batchData.length;
        
        // シートの行番号は1始まり
        sheet.getRange(startRow + 1, 1, batchSize, numCols).setValues(batchData);
        
        console.log(`GAS: ${startRow + 1}行目 〜 ${endRow}行目 (${batchSize}行) を書き込みました。`);
        
        // API制限を避けるため、バッチ間に短い待機を入れる
        if (endRow < numRows) {
          Utilities.sleep(100); // 100ミリ秒待機
        }
      }
      
      console.log(`GAS: シート '${sheet.getName()}' に 全${numRows}行、${numCols}列のデータ書き込み完了。`);
    } else {
      sheet.clearContents();
      console.log(`GAS: CSVデータをパースしましたが、書き込む有効なデータがありませんでした。シート '${sheet.getName()}' をクリアしました。`);
    }
  } catch (e) {
    console.error(`GAS: シートへのデータ書き込み中にエラーが発生しました: ${e.toString()}`, e.stack);
    throw new Error(`シートへのデータ書き込みエラー: ${e.message}`);
  }
}

/**
 * Cloud Run 認証付き呼び出し用 ID トークンを生成する
 */
function generateIdToken_(serviceAccountEmail, audienceUrl) {
  const url = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${serviceAccountEmail}:generateIdToken`;
  const payload = {
    audience: audienceUrl,
    includeEmail: true
  };
  const headers = {
    Authorization: 'Bearer ' + ScriptApp.getOAuthToken()
  };
  const res = UrlFetchApp.fetch(url, {
    method: 'POST',
    contentType: 'application/json',
    headers,
    payload: JSON.stringify(payload)
  });
  return JSON.parse(res.getContentText()).token;
}
```

---

## 6\. テスト手順

1. スプレッドシートを開きメニューから CSV をアップロード  
2. ダイアログに「完了」表示 → シート更新  
3. Cloud Logging で関数 200 応答を確認

---

## 7\. トラブルシューティング

| エラー | 原因・対処 |
| :---- | :---- |
| 403 `getOpenIdToken denied` | TokenCreator 権限が SA 個別にない → 付与する |
| 401 Unauthorized | audience ミスマッチ or Invoker 権欠如 |

---

[image1]: <data:image/png;base64,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>