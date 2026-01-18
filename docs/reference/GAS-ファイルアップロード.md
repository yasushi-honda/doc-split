# 2025年5月25日

# **AppSheet連携 新規ファイル処理用スクリプト 仕様書**

## **概要**

本スクリプトは、AppSheet Automationから呼び出され、Google Drive上の指定フォルダ内に新規保存されたファイルを検索・リネームし、メタデータを返すGoogle Apps Script (GAS) です。ファイル名の先頭部分（AppSheetのキー値）を基準に対象ファイルを特定し、指定されたメタデータに基づいてファイル名を変更します。

## **システム構成**

* **呼び出し元**: AppSheet Automation  
* **実行環境**: Google Apps Script  
* **対象リソース**: Google Drive  
* **処理対象**: Google Driveフォルダ内のファイル

## **主要機能**

### **1\. ファイル検索機能**

* AppSheetから渡されたキー値を基に、Google Drive内の対象ファイルを検索  
* ファイル名の最初のピリオド(.)までの部分をキーとして照合  
* 複数該当ファイルが存在する場合は最初に見つかったファイルを処理対象とする

### **2\. ファイル名変更機能**

* 指定されたメタデータ（書類名、顧客名、事業所名、日付）を基にファイル名を生成  
* ファイル名の一意性確保のためファイルIDを使用  
* ファイル名として不適切な文字の自動サニタイズ

### **3\. メタデータ返却機能**

* 処理結果（ファイルID、新ファイル名、URL、MIMEタイプ等）をAppSheetに返却

## **関数仕様**

### **エントリーポイント関数**

#### **`processNewFileFromAppSheet(targetFolderId, fileKey, documentName, customerName, officeName, fileDate)`**

**概要**: AppSheet Automationから呼び出されるメイン関数

**パラメータ**:

* `targetFolderId` (string, 必須): 検索対象のGoogle DriveフォルダID  
* `fileKey` (string, 必須): AppSheetのキー値（ファイル名先頭部分と照合）  
* `documentName` (string, 任意): リネーム用書類名  
* `customerName` (string, 任意): リネーム用顧客名  
* `officeName` (string, 任意): リネーム用事業所名  
* `fileDate` (string, 任意): リネーム用日付（YYYY-MM-DD、YYYY-MM-DDTHH:mm:ss等）

**戻り値**:

```javascript
// 成功時
{
  status: "success",
  fileId: "GoogleDriveファイルID",
  newName: "変更後ファイル名",
  fileUrl: "ファイル共有URL",
  mimeType: "ファイルMIMEタイプ",
  renameSkipped: boolean // 名前変更がスキップされた場合true
}

// ファイル未発見時
{
  status: "not_found",
  message: "エラーメッセージ"
}

// エラー時
{
  status: "error",
  message: "エラーメッセージ"
}
```

### **サポート関数**

#### **`generateUniqueFileName(extractedInfo, fileId, originalExtension)`**

**概要**: メタデータを基に一意のファイル名を生成

**ファイル名形式**:

```
[日付(YYYYMMDD)]_[顧客名]_[事業所名]_[書類名]_[ファイルID先頭8文字].[拡張子]
```

**パラメータ**:

* `extractedInfo` (Object): メタデータオブジェクト  
  * `documentName`: 書類名  
  * `customerName`: 顧客名  
  * `officeName`: 事業所名  
  * `fileDate`: 日付（YYYY/MM/DD形式）  
* `fileId` (string): GoogleDriveファイルID  
* `originalExtension` (string): 元ファイルの拡張子

#### **`sanitizeFileName(fileName)`**

**概要**: ファイル名の不正文字をサニタイズ

**処理内容**:

* 禁止文字（`\ / : * ? " < > |`）を `_` に置換  
* 全角・半角スペースを `_` に置換  
* 連続するアンダースコアを単一に統合  
* 先頭・末尾のアンダースコアを削除

#### **`getToday()`**

**概要**: 現在日付をYYYYMMDD形式で取得（参考関数）

## **データフロー**

1. **AppSheet Automation** → `processNewFileFromAppSheet()` 呼び出し  
2. **入力検証**: 必須パラメータ（`targetFolderId`, `fileKey`）チェック  
3. **フォルダ取得**: 指定されたGoogle DriveフォルダのアクセスとValidation  
4. **ファイル検索**: フォルダ内でキー値に一致するファイルを検索  
5. **ファイル名生成**: メタデータを基に新しいファイル名を生成  
6. **ファイル名変更**: 対象ファイルの名前を変更（同名の場合はスキップ）  
7. **結果返却**: 処理結果をAppSheetに返却

## **エラーハンドリング**

### **エラーパターン**

1. **必須パラメータ不足**

   * Status: `error`  
   * 対応: `targetFolderId`または`fileKey`が未指定  
2. **フォルダアクセス失敗**

   * Status: `error`  
   * 対応: フォルダIDが無効またはアクセス権限不足  
3. **ファイル未発見**

   * Status: `not_found`  
   * 対応: 指定キーに一致するファイルが存在しない  
4. **ファイル名変更失敗**

   * Status: `error`  
   * 対応: Drive API制限またはファイルロック等  
5. **予期せぬエラー**

   * Status: `error`  
   * 対応: システムレベルのエラー

## **制限事項と注意点**

### **制限事項**

* 同一キーを持つファイルが複数存在する場合、最初に見つかったファイルのみ処理  
* ファイル名の最大長制限（OSおよびGoogle Drive制限に準拠）  
* 処理可能なファイル形式制限なし（MIMEタイプ制限なし）

### **注意点**

* AppSheetからの日付形式は複数パターンに対応（ISO形式、ハイフン区切り等）  
* 事業所名が「未判定」の場合はファイル名に含めない  
* ファイルIDの先頭8文字を一意性確保に使用  
* ログ出力による処理トレース対応

## **セキュリティ考慮事項**

* Google Driveのアクセス権限に基づくファイルアクセス制御  
* ファイル名サニタイズによる不正文字の除去  
* 入力パラメータの検証  
* エラー情報の適切な制御（機密情報の非露出）

## **運用考慮事項**

### **ログ出力**

* 処理の各ステップでLogger.log()によるログ出力  
* エラー発生時のスタックトレース出力  
* デバッグ情報の詳細記録

### **パフォーマンス**

* フォルダ内ファイル数に比例した処理時間  
* Google Apps Scriptの実行時間制限（6分）内での処理完了必要

### **メンテナンス**

* 定期的なログ確認  
* エラーパターンの監視  
* AppSheet側との連携テスト

## **バージョン管理**

本仕様書は現在のスクリプトバージョンに基づいて作成されており、機能追加や変更時には本仕様書の更新が必要です。

## **関連ドキュメント**

* Google Apps Script リファレンス  
* Google Drive API ドキュメント  
* AppSheet Automation ガイド

