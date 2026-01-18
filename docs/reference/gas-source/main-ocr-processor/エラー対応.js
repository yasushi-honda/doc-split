/**
 * 最小限のOCR失敗追跡システム
 * - メール通知（必須）
 * - 既存の「エラー履歴T」スプレッドシートへの記録
 */

/**
 * エラー履歴T設定を取得（configオブジェクトから）
 * @returns {Object} エラー履歴設定
 */
function getErrorHistoryConfig_() {
  return config.sheets.errorHistory;
}

/**
 * OCR失敗情報をチェックしてメール通知 + エラー履歴記録
 * @param {Object} file ファイル情報
 * @param {Object} ocrResponse OCRレスポンス
 * @param {Object} config 設定
 */
function checkAndRecordOCRFailures_(file, ocrResponse, config) {
  const SCRIPT_NAME = "checkAndRecordOCRFailures_";
  
  try {
    // OCR完全失敗の場合
    if (typeof ocrResponse === 'string' && ocrResponse.startsWith("エラー:")) {
      Logger.log(`[${SCRIPT_NAME}] OCR完全失敗を検出: ${file.name}`);
      
      const errorData = {
        errorType: ERROR_TYPES.OCR_COMPLETE_FAILURE,
        fileName: file.name,
        fileId: file.id,
        totalPages: undefined,        // 数値型フィールドは無記入
        successPages: undefined,
        failedPages: undefined,
        failedPageNumbers: "",
        errorDetails: ocrResponse,
        fileUrl: `https://drive.google.com/file/d/${file.id}/view`
      };
      
      // エラー履歴に記録
      recordErrorToHistory_(errorData);
      
      // メール通知（緊急）
      sendOCRFailureEmail_(errorData, config, true);
      
      return;
    }
    
    // OCR成功レスポンスの場合、部分失敗をチェック
    if (!ocrResponse || !ocrResponse.success || !ocrResponse.ocrResults) {
      return; // 有効なレスポンスでない場合はスキップ
    }
    
    const fileInfo = ocrResponse.fileInfo;
    const processingInfo = ocrResponse.processingInfo;
    const ocrResults = ocrResponse.ocrResults;
    
    const totalPages = fileInfo.totalPages || 0;
    const successfulPages = processingInfo.successfulPages || ocrResults.length;
    const failedPages = processingInfo.failedPages || 0;
    
    // 失敗ページがある場合
    if (failedPages > 0) {
      Logger.log(`[${SCRIPT_NAME}] OCR部分失敗を検出: ${file.name} (${failedPages}/${totalPages}ページ失敗)`);
      
      // 失敗ページ番号を特定
      const receivedPageNumbers = ocrResults.map(page => page.pageNumber).sort((a, b) => a - b);
      const expectedPageNumbers = Array.from({length: totalPages}, (_, i) => i + 1);
      const missingPageNumbers = expectedPageNumbers.filter(pageNum => !receivedPageNumbers.includes(pageNum));
      
      const errorData = {
        errorType: ERROR_TYPES.OCR_PARTIAL_FAILURE,
        fileName: file.name,
        fileId: file.id,
        totalPages: totalPages,        // 数値
        successPages: successfulPages, // 数値
        failedPages: failedPages,      // 数値
        failedPageNumbers: missingPageNumbers.join(', '),
        errorDetails: `${failedPages}ページでOCR処理失敗。受信ページ: [${receivedPageNumbers.join(', ')}]`,
        fileUrl: `https://drive.google.com/file/d/${file.id}/view`
      };
      
      // エラー履歴に記録
      recordErrorToHistory_(errorData);
      
      // 失敗率に応じてメール通知
      const failureRate = failedPages / totalPages;
      const isUrgent = failureRate >= 0.5; // 50%以上失敗で緊急通知
      
      sendOCRFailureEmail_(errorData, config, isUrgent);
      
    } else {
      Logger.log(`[${SCRIPT_NAME}] OCR処理正常完了: ${file.name} (${totalPages}ページ全て成功)`);
    }
    
  } catch (error) {
    Logger.log(`[${SCRIPT_NAME}] OCR失敗チェック中にエラー: ${error.message}`);
  }
}

/**
 * エラー履歴Tスプレッドシートに記録
 * @param {Object} errorData エラーデータ
 */
function recordErrorToHistory_(errorData) {
  const SCRIPT_NAME = "recordErrorToHistory_";
  
  try {
    Logger.log(`[${SCRIPT_NAME}] エラー履歴Tに記録開始: ${errorData.fileName}`);
    
    // 設定を取得
    const errorHistoryConfig = getErrorHistoryConfig_();
    
    // スプレッドシートとシートを取得
    const spreadsheet = SpreadsheetApp.openById(errorHistoryConfig.spreadsheetId);
    let sheet = spreadsheet.getSheetByName(errorHistoryConfig.sheetName);
    
    // シートが存在しない場合は作成
    if (!sheet) {
      Logger.log(`[${SCRIPT_NAME}] エラー履歴Tシートを新規作成します`);
      sheet = spreadsheet.insertSheet(errorHistoryConfig.sheetName);
      
      // ヘッダー行を作成
      const headers = [
        "エラーID",
        "エラー発生日時", 
        "エラー種別",
        "ファイル名",
        "ファイルID",
        "総ページ数",
        "成功ページ数",
        "失敗ページ数",
        "失敗ページ番号",
        "エラー詳細",
        "ファイルURL",
        "ステータス"
      ];
      
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      
      // ヘッダー行をフォーマット
      const headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setBackground('#ff6b6b');
      headerRange.setFontColor('white');
      headerRange.setFontWeight('bold');
      
      Logger.log(`[${SCRIPT_NAME}] ヘッダー行を作成しました`);
    }
    
    // データ行を準備
    const errorId = `OCR_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const errorDate = new Date();
    
    // 数値型フィールドの処理（数値でない場合は空白）
    const totalPages = (typeof errorData.totalPages === 'number' && !isNaN(errorData.totalPages)) 
                        ? errorData.totalPages 
                        : '';
    const successPages = (typeof errorData.successPages === 'number' && !isNaN(errorData.successPages)) 
                          ? errorData.successPages 
                          : '';
    const failedPages = (typeof errorData.failedPages === 'number' && !isNaN(errorData.failedPages)) 
                         ? errorData.failedPages 
                         : '';
    
    const rowData = [
      errorId,                           // A: エラーID
      errorDate,                         // B: エラー発生日時
      errorData.errorType,               // C: エラー種別
      errorData.fileName,                // D: ファイル名
      errorData.fileId,                  // E: ファイルID
      totalPages,                        // F: 総ページ数（数値型または空白）
      successPages,                      // G: 成功ページ数（数値型または空白）
      failedPages,                       // H: 失敗ページ数（数値型または空白）
      errorData.failedPageNumbers || '', // I: 失敗ページ番号
      errorData.errorDetails,            // J: エラー詳細
      errorData.fileUrl,                 // K: ファイルURL
      "未対応"                           // L: ステータス
    ];
    
    // データを追加
    sheet.appendRow(rowData);
    
    Logger.log(`[${SCRIPT_NAME}] ✅ エラー履歴Tに記録完了: ${errorId}`);
    
  } catch (error) {
    Logger.log(`[${SCRIPT_NAME}] エラー履歴記録失敗: ${error.message}`);
    // エラー履歴の記録失敗は処理を止めない（ログだけ出力）
  }
}

/**
 * 汎用エラー記録関数（OCR以外のエラー用）
 * @param {Object} errorData エラーデータ
 */
function recordGeneralError_(errorData) {
  const SCRIPT_NAME = "recordGeneralError_";
  
  try {
    Logger.log(`[${SCRIPT_NAME}] 汎用エラー記録開始: ${errorData.errorType}`);
    
    // errorDataを正規化してrecordErrorToHistory_を呼び出す
    const normalizedData = {
      errorType: errorData.errorType,
      fileName: errorData.fileName || "不明",
      fileId: errorData.fileId || "",
      totalPages: errorData.totalPages,      // 数値またはundefined
      successPages: errorData.successPages,  // 数値またはundefined
      failedPages: errorData.failedPages,    // 数値またはundefined
      failedPageNumbers: errorData.failedPageNumbers || "",
      errorDetails: errorData.errorDetails || "詳細不明",
      fileUrl: errorData.fileUrl || ""
    };
    
    // 既存の記録関数を再利用
    recordErrorToHistory_(normalizedData);
    
    Logger.log(`[${SCRIPT_NAME}] ✅ 汎用エラー記録完了`);
    
  } catch (error) {
    Logger.log(`[${SCRIPT_NAME}] 汎用エラー記録失敗: ${error.message}`);
    // エラー記録の失敗は処理を止めない
  }
}

/**
 * OCR失敗メール通知を送信（既存のsendErrorNotification_を活用）
 * @param {Object} errorData エラーデータ
 * @param {Object} config 設定
 * @param {boolean} isUrgent 緊急フラグ
 */
function sendOCRFailureEmail_(errorData, config, isUrgent = false) {
  const SCRIPT_NAME = "sendOCRFailureEmail_";
  
  try {
    // 件名を設定（既存関数が[OCR処理システム通知]を付けるので、それを考慮）
    let subject;
    if (errorData.errorType === ERROR_TYPES.OCR_COMPLETE_FAILURE) {
      subject = `🚨【緊急】OCR完全失敗 - ${errorData.fileName}`;
    } else if (isUrgent) {
      subject = `🚨【緊急】OCR大量ページ失敗 - ${errorData.fileName}`;
    } else {
      subject = `⚠️【注意】OCR部分失敗 - ${errorData.fileName}`;
    }
    
    // メール本文を作成
    const body = createOCRFailureEmailBody_(errorData);
    
    // 既存のsendErrorNotification_関数を使用してメール送信
    sendErrorNotification_(subject, body, config);
    
    Logger.log(`[${SCRIPT_NAME}] ✅ OCR失敗通知メールを既存関数経由で送信`);
    Logger.log(`  - 種別: ${errorData.errorType}`);
    Logger.log(`  - 緊急度: ${isUrgent ? '緊急' : '通常'}`);
    
  } catch (error) {
    Logger.log(`[${SCRIPT_NAME}] メール送信処理エラー: ${error.message}`);
  }
}

/**
 * OCR失敗メール本文を作成
 * @param {Object} errorData エラーデータ
 * @returns {string} メール本文
 */
function createOCRFailureEmailBody_(errorData) {
  const timestamp = new Date().toLocaleString('ja-JP');
  
  let body = `OCR処理でエラーが発生しました。

📄 ファイル情報:
- ファイル名: ${errorData.fileName}
- ファイルID: ${errorData.fileId}
- ファイルURL: ${errorData.fileUrl}

`;

  if (errorData.errorType === ERROR_TYPES.OCR_COMPLETE_FAILURE) {
    body += `🚨 エラー詳細:
- エラー種別: 完全失敗（ファイル全体でOCR処理不可）
- エラー詳細: ${errorData.errorDetails}

💡 対応方法:
1. ファイルが破損していないか確認してください
2. ファイル形式がサポート対象（PDF、画像）か確認してください
3. ファイルサイズが制限内（50MB以下推奨）か確認してください
4. Cloud Function の状態を確認してください
`;
  } else {
    body += `⚠️ エラー詳細:
- エラー種別: 部分失敗（一部ページでOCR処理失敗）
- 総ページ数: ${errorData.totalPages}ページ
- 成功ページ数: ${errorData.successPages}ページ
- 失敗ページ数: ${errorData.failedPages}ページ
- 失敗ページ番号: ${errorData.failedPageNumbers}

💡 対応方法:
1. 失敗ページが白紙または図表のみでないか確認してください
2. 失敗ページの画質・解像度を確認してください
3. 必要に応じて失敗ページを手動で処理してください
4. 頻繁に発生する場合はOCR設定の見直しを検討してください
`;
  }

  body += `
🕐 発生時刻: ${timestamp}

📋 詳細確認:
- エラー履歴スプレッドシート: https://docs.google.com/spreadsheets/d/${getErrorHistoryConfig_().spreadsheetId}
- Google Apps Script ログ: 詳細な処理ログを確認できます

---
このメールは自動送信されています。
OCR処理システム`;

  return body;
}

/**
 * 既存のextractTextFromFile_関数を拡張（最小限の変更）
 * @param {string} fileId ファイルID
 * @param {string} fileMimeType MIMEタイプ
 * @param {string} geminiModel モデル名
 * @param {Object} config 設定（オプション）
 * @returns {Object|string} OCR結果
 */
function extractTextFromFileWithMinimalFailureTracking_(fileId, fileMimeType, geminiModel, config = '') {
  const SCRIPT_NAME = "extractTextFromFileWithMinimalFailureTracking_";
  
  // 元のOCR処理を実行
  const ocrResponse = extractTextFromFile_(fileId, fileMimeType, geminiModel);
  
  // 失敗追跡機能（ファイル情報が必要な場合のみ追加処理）
  if (config && config.errorNotificationEmails) {
    try {
      // ファイル情報を取得
      let fileInfo;
      try {
        const fileMetadata = Drive.Files.get(fileId, { 
          fields: 'id,name,mimeType',
          supportsAllDrives: true 
        });
        fileInfo = {
          id: fileId,
          name: fileMetadata.name,
          mimeType: fileMetadata.mimeType
        };
      } catch (error) {
        fileInfo = { 
          id: fileId, 
          name: "ファイル名取得失敗", 
          mimeType: fileMimeType 
        };
      }
      
      // OCR失敗をチェックして通知・記録
      checkAndRecordOCRFailures_(fileInfo, ocrResponse, config);
      
    } catch (error) {
      Logger.log(`[${SCRIPT_NAME}] 失敗追跡処理でエラー: ${error.message}`);
      // 失敗追跡のエラーは元の処理に影響させない
    }
  }
  
  return ocrResponse;
}

/**
 * エラー履歴確認用の便利関数
 */
function checkRecentOCRErrors(days = 7) {
  const SCRIPT_NAME = "checkRecentOCRErrors";
  
  try {
    const errorHistoryConfig = getErrorHistoryConfig_();
    const spreadsheet = SpreadsheetApp.openById(errorHistoryConfig.spreadsheetId);
    const sheet = spreadsheet.getSheetByName(errorHistoryConfig.sheetName);
    
    if (!sheet) {
      Logger.log(`[${SCRIPT_NAME}] エラー履歴Tシートが見つかりません`);
      return [];
    }
    
    const dataRange = sheet.getDataRange();
    const values = dataRange.getValues();
    
    if (values.length <= 1) {
      Logger.log(`[${SCRIPT_NAME}] エラー履歴データがありません`);
      return [];
    }
    
    // 過去N日のエラーをフィルタリング
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const recentErrors = values.slice(1).filter(row => {
      const errorDate = new Date(row[1]); // B列: エラー発生日時
      return errorDate >= cutoffDate;
    });
    
    Logger.log(`[${SCRIPT_NAME}] 過去${days}日間のOCRエラー: ${recentErrors.length}件`);
    
    // 統計情報をログ出力
    const completeFailures = recentErrors.filter(row => row[2] === ERROR_TYPES.OCR_COMPLETE_FAILURE).length;
    const partialFailures = recentErrors.filter(row => row[2] === ERROR_TYPES.OCR_PARTIAL_FAILURE).length;
    const unresolvedErrors = recentErrors.filter(row => row[11] === "未対応").length;
    
    Logger.log(`  - 完全失敗: ${completeFailures}件`);
    Logger.log(`  - 部分失敗: ${partialFailures}件`);
    Logger.log(`  - 未対応: ${unresolvedErrors}件`);
    
    return recentErrors;
    
  } catch (error) {
    Logger.log(`[${SCRIPT_NAME}] エラー履歴確認中にエラー: ${error.message}`);
    return [];
  }
}

/**
 * エラー履歴の手動テスト用関数
 */
function testErrorHistoryLogging() {
  const SCRIPT_NAME = "testErrorHistoryLogging";
  
  Logger.log(`[${SCRIPT_NAME}] エラー履歴記録テストを開始`);
  
  // テスト用のエラーデータ
  const testErrorData = {
    errorType: "OCRテスト失敗",
    fileName: "test_document.pdf",
    fileId: "test_file_id_12345",
    totalPages: 5,
    successPages: 3,
    failedPages: 2,
    failedPageNumbers: "2, 4",
    errorDetails: "テスト用のエラーデータです",
    fileUrl: "https://drive.google.com/file/d/${test_file_id_12345}/view"
  };
  
  // エラー履歴に記録
  recordErrorToHistory_(testErrorData);
  
  Logger.log(`[${SCRIPT_NAME}] エラー履歴記録テスト完了`);
}

/**
 * エラー通知メールを送信します。
 * configオブジェクトに通知先メールアドレスが設定されている場合のみ送信します。
 *
 * @param {string} subject メールの件名。
 * @param {string} body メールの本文。
 * @param {object} config グローバル設定オブジェクト。
 * @param {string|Array<string>} [config.errorNotificationEmails] (任意) 通知先メールアドレス（カンマ区切り文字列または文字列配列）。
 */
function sendErrorNotification_(subject, body, config) {
  const SCRIPT_NAME = "sendErrorNotification_";
  try {
    if (config && config.errorNotificationEmails) {
      let recipients = "";
      if (typeof config.errorNotificationEmails === 'string') {
        recipients = config.errorNotificationEmails;
      } else if (Array.isArray(config.errorNotificationEmails)) {
        recipients = config.errorNotificationEmails.join(',');
      }

      if (recipients) {
        MailApp.sendEmail(recipients, `[OCR処理システム通知] ${subject}`, body);
        Logger.log(`[${SCRIPT_NAME}] エラー通知メールを送信しました。宛先: ${recipients}, 件名: ${subject}`);
      } else {
        Logger.log(`[${SCRIPT_NAME}] 通知先メールアドレスが空のため、メールは送信されませんでした。`);
      }
    } else {
      Logger.log(`[${SCRIPT_NAME}] configオブジェクトまたは通知先メールアドレスが未設定のため、メールは送信されませんでした。`);
    }
  } catch (e) {
    Logger.log(`[${SCRIPT_NAME}] エラー通知メールの送信中にエラーが発生しました。エラー: ${e.stack || e}`);
  }
}

/**
 * エラー記録のテスト関数（改修版）
 * 各エラー種別が正しく記録されるかテスト
 */
function testAllErrorTypes() {
  const SCRIPT_NAME = "testAllErrorTypes";
  Logger.log(`[${SCRIPT_NAME}] 全エラー種別のテスト開始`);
  
  // テストデータ配列
  const testCases = [
    {
      errorType: ERROR_TYPES.OCR_COMPLETE_FAILURE,
      fileName: "test_ocr_complete_failure.pdf",
      fileId: "test_id_001",
      totalPages: undefined,
      successPages: undefined,
      failedPages: undefined,
      failedPageNumbers: "",
      errorDetails: "テスト: OCR完全失敗",
      fileUrl: "https://drive.google.com/file/d/test_id_001/view"
    },
    {
      errorType: ERROR_TYPES.OCR_PARTIAL_FAILURE,
      fileName: "test_ocr_partial_failure.pdf",
      fileId: "test_id_002",
      totalPages: 10,
      successPages: 8,
      failedPages: 2,
      failedPageNumbers: "3, 7",
      errorDetails: "テスト: OCR部分失敗（2ページ失敗）",
      fileUrl: "https://drive.google.com/file/d/test_id_002/view"
    },
    {
      errorType: ERROR_TYPES.EXTRACTION_ERROR,
      fileName: "test_extraction_error.pdf",
      fileId: "test_id_003",
      totalPages: undefined,
      successPages: undefined,
      failedPages: undefined,
      failedPageNumbers: "",
      errorDetails: "テスト: 情報抽出エラー（顧客名識別失敗）",
      fileUrl: "https://drive.google.com/file/d/test_id_003/view"
    },
    {
      errorType: ERROR_TYPES.FILE_OPERATION_ERROR,
      fileName: "test_file_operation_error.pdf",
      fileId: "test_id_004",
      totalPages: undefined,
      successPages: undefined,
      failedPages: undefined,
      failedPageNumbers: "",
      errorDetails: "テスト: ファイル処理エラー（移動失敗）",
      fileUrl: "https://drive.google.com/file/d/test_id_004/view"
    },
    {
      errorType: ERROR_TYPES.SYSTEM_ERROR,
      fileName: "test_system_error.pdf",
      fileId: "test_id_005",
      totalPages: undefined,
      successPages: undefined,
      failedPages: undefined,
      failedPageNumbers: "",
      errorDetails: "テスト: システムエラー（認証失敗）",
      fileUrl: "https://drive.google.com/file/d/test_id_005/view"
    }
  ];
  
  // 各テストケースを実行
  testCases.forEach((testData, index) => {
    Logger.log(`[${SCRIPT_NAME}] テスト ${index + 1}/${testCases.length}: ${testData.errorType}`);
    recordErrorToHistory_(testData);
  });
  
  Logger.log(`[${SCRIPT_NAME}] ✅ 全エラー種別のテスト完了`);
  Logger.log(`[${SCRIPT_NAME}] エラー履歴Tスプレッドシートで結果を確認してください`);
  Logger.log(`[${SCRIPT_NAME}] URL: https://docs.google.com/spreadsheets/d/${config.sheets.errorHistory.spreadsheetId}`);
}

/**
 * 統合テスト: processFolderOCRのエラーハンドリング動作確認
 * 実際のファイル処理なしで、エラー記録の動作のみテスト
 */
function testErrorRecordingIntegration() {
  const SCRIPT_NAME = "testErrorRecordingIntegration";
  Logger.log(`[${SCRIPT_NAME}] 統合テスト開始`);
  
  // テスト用のファイル情報（実際には存在しないファイル）
  const testFile = {
    id: "integration_test_file_id",
    name: "integration_test.pdf",
    mimeType: "application/pdf"
  };
  
  // テストケース1: OCR完全失敗のシミュレーション
  Logger.log(`[${SCRIPT_NAME}] テスト1: OCR完全失敗のシミュレーション`);
  const ocrCompleteFailureResponse = "エラー: Cloud Functionへの接続に失敗しました";
  
  checkAndRecordOCRFailures_(testFile, ocrCompleteFailureResponse, config);
  
  // テストケース2: OCR部分失敗のシミュレーション
  Logger.log(`[${SCRIPT_NAME}] テスト2: OCR部分失敗のシミュレーション`);
  const ocrPartialFailureResponse = {
    success: true,
    fileInfo: {
      fileName: testFile.name,
      totalPages: 5
    },
    ocrResults: [
      { pageNumber: 1, text: "ページ1のテキスト" },
      { pageNumber: 2, text: "ページ2のテキスト" },
      { pageNumber: 4, text: "ページ4のテキスト" }
      // ページ3と5が欠けている = 部分失敗
    ],
    processingInfo: {
      totalPages: 5,
      successfulPages: 3,
      failedPages: 2
    }
  };
  
  checkAndRecordOCRFailures_(testFile, ocrPartialFailureResponse, config);
  
  // テストケース3: recordGeneralError_の動作確認
  Logger.log(`[${SCRIPT_NAME}] テスト3: 汎用エラー記録の動作確認`);
  recordGeneralError_({
    errorType: ERROR_TYPES.EXTRACTION_ERROR,
    fileName: "integration_test_extraction.pdf",
    fileId: "integration_test_extraction_id",
    totalPages: undefined,
    successPages: undefined,
    failedPages: undefined,
    failedPageNumbers: "",
    errorDetails: "統合テスト: 顧客名が識別できませんでした",
    fileUrl: "https://drive.google.com/file/d/integration_test_extraction_id/view"
  });
  
  Logger.log(`[${SCRIPT_NAME}] ✅ 統合テスト完了`);
  Logger.log(`[${SCRIPT_NAME}] エラー履歴Tスプレッドシートで以下を確認してください:`);
  Logger.log(`[${SCRIPT_NAME}]   1. OCR完全失敗のレコード（数値列が空白）`);
  Logger.log(`[${SCRIPT_NAME}]   2. OCR部分失敗のレコード（5ページ中2ページ失敗、失敗ページ番号: 3, 5）`);
  Logger.log(`[${SCRIPT_NAME}]   3. 情報抽出エラーのレコード（数値列が空白）`);
  Logger.log(`[${SCRIPT_NAME}] URL: https://docs.google.com/spreadsheets/d/${config.sheets.errorHistory.spreadsheetId}`);
}