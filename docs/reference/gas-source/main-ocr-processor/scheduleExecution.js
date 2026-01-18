// =========================================================================
// Gmail処理 実行設定（一元管理）
// =========================================================================

/**
 * 自動実行用設定（時間ベース処理）
 */
const AUTO_EXECUTION_CONFIG = {
  timeRangeMinutes: 10,                    // 処理対象時間範囲（分）
  maxMessages: 50,                        // 最大メール数
  maxAttachmentsPerExecution: 100,        // 最大添付ファイル数
  cacheSize: 200                          // キャッシュサイズ
};

/**
 * 手動実行用設定（スレッドベース処理）
 */
const MANUAL_EXECUTION_CONFIG = {
  maxThreads: 100,                         // 最大スレッド数
  cacheSize: 200                          // キャッシュサイズ
};

// =========================================================================
// 実行関数
// =========================================================================

/**
 * 自動実行関数（トリガー用）
 * 時間ベース処理で安全に実行します
 * 
 * トリガー間隔の目安：
 * - 1分毎: 軽量処理用（最大20メール、50添付）
 * - 5分毎: 標準処理用（最大50メール、100添付）
 * - 10分毎: 大量処理用（最大100メール、200添付）
 * - 30分毎: バッチ処理用（最大200メール、400添付）
 * 
 * @function scheduleExecution
 * @description Google Apps Scriptのトリガーから呼び出される自動実行関数
 */
function scheduleExecution() {
  const SCRIPT_NAME = "scheduleExecution";
  Logger.log(`[${SCRIPT_NAME}] 自動実行を開始します`);
  
  try {
    checkSystemReady(SCRIPT_NAME);
    
    // 認証情報確認
    if (!SA_CREDENTIALS) {
      const errorMsg = "サービスアカウント認証情報がロードされていません";
      Logger.log(`[${SCRIPT_NAME}] エラー: ${errorMsg}`);
      if (config?.errorNotificationEmails) {
        sendErrorNotification_("自動実行 - 認証エラー", errorMsg, config);
      }
      throw new Error(errorMsg);
    }

    // 設定確認
    if (!config?.targetFolderId || !config?.gmail?.logSpreadsheetId || 
        !config?.gmail?.logSheetName || !config?.gmail?.targetLabel) {
      const errorMsg = "必須設定が不足しています";
      Logger.log(`[${SCRIPT_NAME}] エラー: ${errorMsg}`);
      if (config?.errorNotificationEmails) {
        sendErrorNotification_("自動実行 - 設定エラー", errorMsg, config);
      }
      throw new Error(errorMsg);
    }

    // 時間ベース処理実行
    Logger.log(`[${SCRIPT_NAME}] 時間ベース処理開始（${AUTO_EXECUTION_CONFIG.timeRangeMinutes}分間）`);
    processAttachmentsFromAppSheetTimeRange(
      config.targetFolderId,
      config.gmail.logSpreadsheetId,
      config.gmail.logSheetName,
      config.gmail.targetLabel,
      AUTO_EXECUTION_CONFIG.timeRangeMinutes
    );

    Logger.log(`[${SCRIPT_NAME}] 自動実行完了`);

  } catch (error) {
    const errorMsg = `自動実行エラー: ${error.message}`;
    Logger.log(`[${SCRIPT_NAME}] ${errorMsg}`);
    if (config?.errorNotificationEmails) {
      sendErrorNotification_("自動実行 - 実行エラー", `${errorMsg}\n${error.stack}`, config);
    }
    throw error;
  }
}

/**
 * 自動実行関数（OCR処理込み）
 * メール取得処理（時間ベース）→ OCR処理を連続して実行します
 * 
 * 処理の流れ：
 * 1. Gmail添付ファイル取得・保存（時間ベース処理）
 * 2. 保存されたファイルのOCR処理・情報識別
 * 3. ファイル名変更・整理
 * 
 * @function scheduleExecutionWithOCR
 * @description メール取得からOCR処理まで一括で自動実行する関数（トリガー用）
 */
function scheduleExecutionWithOCR() {
  const SCRIPT_NAME = "scheduleExecutionWithOCR";
  const totalStartTime = new Date();
  let gmailProcessingTime = 0;
  let ocrProcessingTime = 0;
  
  Logger.log(`\n${"=".repeat(80)}`);
  Logger.log(`[${SCRIPT_NAME}] 📧→🔍 【自動一括処理開始】メール取得 + OCR処理を開始します`);
  Logger.log(`[${SCRIPT_NAME}] 開始時刻: ${totalStartTime.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);
  Logger.log(`${"=".repeat(80)}`);
  
  try {
    checkSystemReady(SCRIPT_NAME);
    
    // 基本確認 (認証情報、必須設定)
    if (!SA_CREDENTIALS) {
      throw new Error("サービスアカウント認証情報がロードされていません");
    }
    if (!config?.targetFolderId || !config?.gmail?.logSpreadsheetId || 
        !config?.gmail?.logSheetName || !config?.gmail?.targetLabel) {
      throw new Error("Gmail処理に必要な必須設定が不足しています");
    }
    // OCR処理に必要な設定もここで確認しておくとより良い (runOCRForAllFiles内でもチェックされるが早期発見のため)
    if (!config?.destinationFolderId || !config?.geminiModel || !config?.sheets?.documentTransaction) {
        throw new Error("OCR処理に必要な必須設定が不足しています");
    }


    // === ステップ1: Gmail添付ファイル処理 (時間ベース) ===
    Logger.log(`[${SCRIPT_NAME}] 📧 【ステップ1】Gmail添付ファイル取得処理 (時間ベース) を開始します...`);
    Logger.log(`[${SCRIPT_NAME}]   処理対象時間範囲: ${AUTO_EXECUTION_CONFIG.timeRangeMinutes}分間`);
    const gmailStartTime = new Date();
    
    processAttachmentsFromAppSheetTimeRange(
      config.targetFolderId,
      config.gmail.logSpreadsheetId,
      config.gmail.logSheetName,
      config.gmail.targetLabel,
      AUTO_EXECUTION_CONFIG.timeRangeMinutes // AUTO_EXECUTION_CONFIGから取得
    );
    
    gmailProcessingTime = (new Date().getTime() - gmailStartTime.getTime()) / 1000;
    Logger.log(`[${SCRIPT_NAME}] ✅ 【ステップ1完了】Gmail処理完了（実行時間: ${gmailProcessingTime.toFixed(2)}秒）`);

    // 少し間を置く（ファイルシステムの同期待ち）
    // GmailでファイルがDriveに保存されてから、Drive APIでそのファイルがリストされるまでに
    // わずかな遅延が生じる場合があるため。
    Logger.log(`[${SCRIPT_NAME}] ⏳ ファイルシステム同期待ち（5秒）...`); // 少し長めに設定
    Utilities.sleep(5000); 

    // === ステップ2: OCR処理 ===
    Logger.log(`[${SCRIPT_NAME}] 🔍 【ステップ2】OCR処理を開始します...`);
    const ocrStartTime = new Date();
    
    runOCRForAllFiles(); // これはフォルダ内の全ファイルを対象とする
    
    ocrProcessingTime = (new Date().getTime() - ocrStartTime.getTime()) / 1000;
    Logger.log(`[${SCRIPT_NAME}] ✅ 【ステップ2完了】OCR処理完了（実行時間: ${ocrProcessingTime.toFixed(2)}秒）`);

    // === 処理完了 ===
    const totalEndTime = new Date();
    const totalExecutionTime = (totalEndTime.getTime() - totalStartTime.getTime()) / 1000;
    
    Logger.log(`\n${"=".repeat(80)}`);
    Logger.log(`[${SCRIPT_NAME}] 🎉 【自動一括処理完了】全処理が正常に完了しました`);
    Logger.log(`[${SCRIPT_NAME}] 完了時刻: ${totalEndTime.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);
    Logger.log(`[${SCRIPT_NAME}] 📊 処理時間サマリー:`);
    Logger.log(`[${SCRIPT_NAME}]   - Gmail処理: ${gmailProcessingTime.toFixed(2)}秒`);
    Logger.log(`[${SCRIPT_NAME}]   - OCR処理: ${ocrProcessingTime.toFixed(2)}秒`);
    Logger.log(`[${SCRIPT_NAME}]   - 合計時間: ${totalExecutionTime.toFixed(2)}秒`);
    Logger.log(`${"=".repeat(80)}\n`);

  } catch (error) {
    const totalEndTime = new Date();
    const totalExecutionTime = (totalEndTime.getTime() - totalStartTime.getTime()) / 1000;
    const errorMsg = `自動一括処理エラー: ${error.message}`;
    
    Logger.log(`\n${"=".repeat(80)}`);
    Logger.log(`[${SCRIPT_NAME}] ❌ 【自動一括処理エラー】${errorMsg}`);
    Logger.log(`[${SCRIPT_NAME}] エラー発生時刻: ${totalEndTime.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);
    Logger.log(`[${SCRIPT_NAME}] 📊 エラー時処理時間:`);
    Logger.log(`[${SCRIPT_NAME}]   - Gmail処理: ${gmailProcessingTime.toFixed(2)}秒`);
    Logger.log(`[${SCRIPT_NAME}]   - OCR処理: ${ocrProcessingTime.toFixed(2)}秒`);
    Logger.log(`[${SCRIPT_NAME}]   - 合計時間: ${totalExecutionTime.toFixed(2)}秒`);
    Logger.log(`${"=".repeat(80)}\n`);
    
    if (config?.errorNotificationEmails) {
      sendErrorNotification_(
        "自動一括処理 - 実行エラー", 
        `${errorMsg}\n\n処理時間詳細:\n- Gmail処理: ${gmailProcessingTime.toFixed(2)}秒\n- OCR処理: ${ocrProcessingTime.toFixed(2)}秒\n- 合計時間: ${totalExecutionTime.toFixed(2)}秒\n\nスタックトレース:\n${error.stack}`, 
        config
      );
    }
    // 自動実行の場合、エラーを再スローするとトリガーが失敗として記録される
    throw error; 
  }
}

/**
 * 手動実行関数
 * スレッドベース処理で柔軟に実行します
 * 
 * スレッド数の目安：
 * - 1スレッド: テスト用・安全確認用
 * - 5スレッド: 標準的な手動実行用
 * - 10スレッド: 大量処理用（現在の設定）
 * - 15スレッド以上: API制限に注意が必要
 * 
 * @function manualExecution  
 * @description Google Apps Scriptエディタから手動で実行する関数
 */
function manualExecution() {
  const SCRIPT_NAME = "manualExecution";
  Logger.log(`[${SCRIPT_NAME}] 手動実行を開始します`);
  
  try {
    checkSystemReady(SCRIPT_NAME);
    
    // 基本確認
    if (!SA_CREDENTIALS) {
      throw new Error("サービスアカウント認証情報がロードされていません");
    }
    if (!config?.targetFolderId || !config?.gmail?.logSpreadsheetId || 
        !config?.gmail?.logSheetName || !config?.gmail?.targetLabel) {
      throw new Error("必須設定が不足しています");
    }

    // スレッドベース処理実行
    Logger.log(`[${SCRIPT_NAME}] スレッドベース処理開始（最大${MANUAL_EXECUTION_CONFIG.maxThreads}スレッド）`);
    processAttachmentsFromAppSheet(
      config.targetFolderId,
      config.gmail.logSpreadsheetId,
      config.gmail.logSheetName,
      config.gmail.targetLabel
    );

    Logger.log(`[${SCRIPT_NAME}] 手動実行完了`);

  } catch (error) {
    const errorMsg = `手動実行エラー: ${error.message}`;
    Logger.log(`[${SCRIPT_NAME}] ${errorMsg}`);
    if (config?.errorNotificationEmails) {
      sendErrorNotification_("手動実行 - 実行エラー", `${errorMsg}\n${error.stack}`, config);
    }
    throw error;
  }
}

/**
 * 手動実行関数（OCR処理込み）
 * メール取得処理 → OCR処理を連続して実行します
 * 
 * 処理の流れ：
 * 1. Gmail添付ファイル取得・保存（スレッドベース処理）
 * 2. 保存されたファイルのOCR処理・情報識別
 * 3. ファイル名変更・整理
 * 
 * @function manualExecutionWithOCR
 * @description メール取得からOCR処理まで一括で実行する関数
 */
function manualExecutionWithOCR() {
  const SCRIPT_NAME = "manualExecutionWithOCR";
  const totalStartTime = new Date();
  let gmailProcessingTime = 0;
  let ocrProcessingTime = 0;
  
  Logger.log(`\n${"=".repeat(80)}`);
  Logger.log(`[${SCRIPT_NAME}] 📧→🔍 【一括処理開始】メール取得 + OCR処理を開始します`);
  Logger.log(`[${SCRIPT_NAME}] 開始時刻: ${totalStartTime.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);
  Logger.log(`${"=".repeat(80)}`);
  
  try {
    checkSystemReady(SCRIPT_NAME);
    
    // 基本確認
    if (!SA_CREDENTIALS) {
      throw new Error("サービスアカウント認証情報がロードされていません");
    }
    if (!config?.targetFolderId || !config?.gmail?.logSpreadsheetId || 
        !config?.gmail?.logSheetName || !config?.gmail?.targetLabel) {
      throw new Error("必須設定が不足しています");
    }

    // === ステップ1: Gmail添付ファイル処理 ===
    Logger.log(`[${SCRIPT_NAME}] 📧 【ステップ1】Gmail添付ファイル取得処理を開始します...`);
    const gmailStartTime = new Date();
    
    processAttachmentsFromAppSheet(
      config.targetFolderId,
      config.gmail.logSpreadsheetId,
      config.gmail.logSheetName,
      config.gmail.targetLabel
    );
    
    gmailProcessingTime = (new Date().getTime() - gmailStartTime.getTime()) / 1000;
    Logger.log(`[${SCRIPT_NAME}] ✅ 【ステップ1完了】Gmail処理完了（実行時間: ${gmailProcessingTime.toFixed(2)}秒）`);

    // 少し間を置く（ファイルシステムの同期待ち）
    Logger.log(`[${SCRIPT_NAME}] ⏳ ファイルシステム同期待ち（2秒）...`);
    Utilities.sleep(2000);

    // === ステップ2: OCR処理 ===
    Logger.log(`[${SCRIPT_NAME}] 🔍 【ステップ2】OCR処理を開始します...`);
    const ocrStartTime = new Date();
    
    runOCRForAllFiles();
    
    ocrProcessingTime = (new Date().getTime() - ocrStartTime.getTime()) / 1000;
    Logger.log(`[${SCRIPT_NAME}] ✅ 【ステップ2完了】OCR処理完了（実行時間: ${ocrProcessingTime.toFixed(2)}秒）`);

    // === 処理完了 ===
    const totalEndTime = new Date();
    const totalExecutionTime = (totalEndTime.getTime() - totalStartTime.getTime()) / 1000;
    
    Logger.log(`\n${"=".repeat(80)}`);
    Logger.log(`[${SCRIPT_NAME}] 🎉 【一括処理完了】全処理が正常に完了しました`);
    Logger.log(`[${SCRIPT_NAME}] 完了時刻: ${totalEndTime.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);
    Logger.log(`[${SCRIPT_NAME}] 📊 処理時間サマリー:`);
    Logger.log(`[${SCRIPT_NAME}]   - Gmail処理: ${gmailProcessingTime.toFixed(2)}秒`);
    Logger.log(`[${SCRIPT_NAME}]   - OCR処理: ${ocrProcessingTime.toFixed(2)}秒`);
    Logger.log(`[${SCRIPT_NAME}]   - 合計時間: ${totalExecutionTime.toFixed(2)}秒`);
    Logger.log(`[${SCRIPT_NAME}] 🎯 結果: メール取得 → ファイル保存 → OCR処理 → ファイル整理 完了`);
    Logger.log(`${"=".repeat(80)}\n`);

  } catch (error) {
    const totalEndTime = new Date();
    const totalExecutionTime = (totalEndTime.getTime() - totalStartTime.getTime()) / 1000;
    const errorMsg = `一括処理エラー: ${error.message}`;
    
    Logger.log(`\n${"=".repeat(80)}`);
    Logger.log(`[${SCRIPT_NAME}] ❌ 【一括処理エラー】${errorMsg}`);
    Logger.log(`[${SCRIPT_NAME}] エラー発生時刻: ${totalEndTime.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);
    Logger.log(`[${SCRIPT_NAME}] 📊 エラー時処理時間:`);
    Logger.log(`[${SCRIPT_NAME}]   - Gmail処理: ${gmailProcessingTime.toFixed(2)}秒`);
    Logger.log(`[${SCRIPT_NAME}]   - OCR処理: ${ocrProcessingTime.toFixed(2)}秒`);
    Logger.log(`[${SCRIPT_NAME}]   - 合計時間: ${totalExecutionTime.toFixed(2)}秒`);
    Logger.log(`${"=".repeat(80)}\n`);
    
    if (config?.errorNotificationEmails) {
      sendErrorNotification_(
        "一括処理 - 実行エラー", 
        `${errorMsg}\n\n処理時間詳細:\n- Gmail処理: ${gmailProcessingTime.toFixed(2)}秒\n- OCR処理: ${ocrProcessingTime.toFixed(2)}秒\n- 合計時間: ${totalExecutionTime.toFixed(2)}秒\n\nスタックトレース:\n${error.stack}`, 
        config
      );
    }
    throw error;
  }
}