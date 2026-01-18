/**
 * 全ファイルに対してOCR処理を実行するメインエントリポイント
 * 本番環境で定期実行される想定の関数です。
 */
function runOCRForAllFiles() {
  const SCRIPT_NAME = "runOCRForAllFiles";
  Logger.log(`[${SCRIPT_NAME}] OCR処理の実行を開始します。`);

  try {
    // システムチェック（configの前に実行）
    checkSystemReady(SCRIPT_NAME);

    // configの確認
    if (!config) {
      throw new Error("グローバル設定オブジェクト (config) が定義されていません");
    }

    // 1. サービスアカウント認証情報の確認
    if (!SA_CREDENTIALS) {
      const errorMessage = "サービスアカウント認証情報 (SA_CREDENTIALS) のロードに失敗しました。\n" +
        "スクリプトプロパティ 'SA_CREDENTIALS_JSON' の設定を確認してください。\n" +
        "特に private_key 内の改行文字が正しい形式（\\n）でエスケープされているか確認してください。\n" +
        "処理を中止します。";
      Logger.log(`[${SCRIPT_NAME}] 重大な設定エラー: ${errorMessage}`);

      // エラー通知の送信
      if (config && config.errorNotificationEmails) {
        sendErrorNotification_("OCR処理 - 重大設定エラー", errorMessage, config);
      }
      return;
    }

    // 2. プライベートキーの形式確認（改行が正しく処理されているか）
    if (SA_CREDENTIALS.private_key) {
      const keyLines = SA_CREDENTIALS.private_key.split('\n');
      if (keyLines.length < 5) { // 正常なキーは複数行になるはず
        Logger.log(`[${SCRIPT_NAME}] 警告: プライベートキーの行数が少なすぎます (${keyLines.length}行)。改行文字の形式を確認してください。`);

        // 自動修正を試行
        const correctedKey = SA_CREDENTIALS.private_key.replace(/\\n/g, '\n');
        const correctedLines = correctedKey.split('\n');

        if (correctedLines.length > keyLines.length) {
          Logger.log(`[${SCRIPT_NAME}] プライベートキーの自動修正を適用します。修正後: ${correctedLines.length}行`);
          SA_CREDENTIALS.private_key = correctedKey;
        } else {
          const warningMessage = `プライベートキーの形式に問題がある可能性があります。\n` +
            `現在の行数: ${keyLines.length}行\n` +
            `正常な形式では25行以上になる必要があります。\n` +
            `スクリプトプロパティ 'SA_CREDENTIALS_JSON' の private_key フィールドを確認してください。`;
          Logger.log(`[${SCRIPT_NAME}] ${warningMessage}`);

          if (config && config.errorNotificationEmails) {
            sendErrorNotification_("OCR処理 - プライベートキー形式警告", warningMessage, config);
          }
        }
      } else {
        Logger.log(`[${SCRIPT_NAME}] プライベートキーの形式確認完了 (${keyLines.length}行)`);
      }
    }

    // 3. 基本設定の確認
    if (!config) {
      const errorMessage = "グローバル設定オブジェクト (config) が定義されていません。";
      Logger.log(`[${SCRIPT_NAME}] 設定エラー: ${errorMessage}`);

      // フォールバック通知（config無しでも最低限の通知）
      try {
        MailApp.sendEmail(
          "hy.unimail.11@gmail.com", // configから取得できない場合のフォールバック
          "[OCR処理システム] 重大設定エラー",
          errorMessage
        );
      } catch (e) {
        Logger.log(`[${SCRIPT_NAME}] フォールバック通知送信失敗: ${e.message}`);
      }
      return;
    }

    // 4. 必須設定項目の詳細確認
    const requiredConfigKeys = [
      'targetFolderId',
      'destinationFolderId',
      'geminiModel',
      'sheets',
      'errorNotificationEmails' // 通知先も必須として確認
    ];

    const missingKeys = requiredConfigKeys.filter(key => !config[key]);
    if (missingKeys.length > 0) {
      const errorMessage = `設定オブジェクト (config) に必須項目が不足しています: ${missingKeys.join(', ')}\n` +
        `現在の設定確認:\n` +
        `- targetFolderId: ${config.targetFolderId || '未設定'}\n` +
        `- destinationFolderId: ${config.destinationFolderId || '未設定'}\n` +
        `- errorFolderId: ${config.errorFolderId || '未設定'}\n` +
        `- geminiModel: ${config.geminiModel || '未設定'}\n` +
        `- errorNotificationEmails: ${config.errorNotificationEmails || '未設定'}`;
      Logger.log(`[${SCRIPT_NAME}] 設定エラー: ${errorMessage}`);
      sendErrorNotification_("OCR処理 - 設定不足エラー", errorMessage, config);
      return;
    }

    // 5. スプレッドシート設定の詳細確認
    const requiredSheetConfigs = ['documentMaster', 'customerMaster', 'officeMaster', 'documentTransaction'];
    const missingSheetConfigs = requiredSheetConfigs.filter(key => !config.sheets[key]);

    if (missingSheetConfigs.length > 0) {
      const errorMessage = `スプレッドシート設定 (config.sheets) に必須項目が不足しています: ${missingSheetConfigs.join(', ')}\n` +
        `設定確認が必要なマスターデータ:\n` +
        `- 書類マスター (documentMaster)\n` +
        `- 顧客マスター (customerMaster) \n` +
        `- 事業所マスター (officeMaster)\n` +
        `- トランザクション (documentTransaction)`;
      Logger.log(`[${SCRIPT_NAME}] スプレッドシート設定エラー: ${errorMessage}`);
      sendErrorNotification_("OCR処理 - スプレッドシート設定エラー", errorMessage, config);
      return;
    }

    // 5. Cloud Function URLの確認
    if (!CLOUD_FUNCTION_INVOCATION_URL || CLOUD_FUNCTION_INVOCATION_URL.trim() === '') {
      const errorMessage = "Cloud Function URL (CLOUD_FUNCTION_INVOCATION_URL) が設定されていません。\n" +
        "定数 CLOUD_FUNCTION_INVOCATION_URL の値を確認してください。";
      Logger.log(`[${SCRIPT_NAME}] 設定エラー: ${errorMessage}`);
      sendErrorNotification_("OCR処理 - Cloud Function URL未設定", errorMessage, config);
      return;
    }
    Logger.log(`[${SCRIPT_NAME}] Cloud Function URL確認完了: ${CLOUD_FUNCTION_INVOCATION_URL}`);

    // 6. Gmail連携設定の確認（オプション）
    if (config.gmail) {
      Logger.log(`[${SCRIPT_NAME}] Gmail連携設定を確認:`);
      Logger.log(`  - ログスプレッドシート: ${config.gmail.logSpreadsheetId || '未設定'}`);
      Logger.log(`  - 対象ラベル: ${config.gmail.targetLabel || '未設定'}`);
      Logger.log(`  - 検索演算子: ${config.gmail.labelSearchOperator || 'OR'}`);
    }

    // 6. 事前認証テスト（オプション：本番では省略可能）
    Logger.log(`[${SCRIPT_NAME}] 事前認証テストを実行します...`);
    if (!performQuickAuthTest_()) {
      const errorMessage = "認証テストに失敗しました。\n" +
        "サービスアカウントの設定またはIAM権限を確認してください。\n" +
        "詳細はGoogle Apps Scriptのログを確認してください。";
      Logger.log(`[${SCRIPT_NAME}] 認証エラー: ${errorMessage}`);
      sendErrorNotification_("OCR処理 - 認証テスト失敗", errorMessage, config);
      return;
    }
    Logger.log(`[${SCRIPT_NAME}] 事前認証テスト成功`);

    // 7. マスターデータへのアクセステスト（オプション）
    Logger.log(`[${SCRIPT_NAME}] マスターデータアクセステストを実行します...`);
    const masterDataStatus = testMasterDataAccess_(config);
    if (!masterDataStatus.success) {
      const errorMessage = `マスターデータへのアクセスに問題があります:\n${masterDataStatus.errors.join('\n')}`;
      Logger.log(`[${SCRIPT_NAME}] マスターデータエラー: ${errorMessage}`);
      sendErrorNotification_("OCR処理 - マスターデータアクセスエラー", errorMessage, config);
      // 警告として扱い、処理は継続
    } else {
      Logger.log(`[${SCRIPT_NAME}] マスターデータアクセステスト成功`);
    }
    // 8. メイン処理の実行
    Logger.log(`[${SCRIPT_NAME}] メインのOCR処理を開始します...`);
    Logger.log(`[${SCRIPT_NAME}] 処理設定サマリー:`);
    Logger.log(`  - 対象フォルダ: ${config.targetFolderId}`);
    Logger.log(`  - 移動先フォルダ: ${config.destinationFolderId}`);
    Logger.log(`  - エラーフォルダ: ${config.errorFolderId || '未設定'}`);
    Logger.log(`  - Geminiモデル: ${config.geminiModel}`);
    Logger.log(`  - 通知先: ${config.errorNotificationEmails}`);

    processFolderOCR(config);
    Logger.log(`[${SCRIPT_NAME}] OCR処理が完了しました。`);

  } catch (error) {
    Logger.log(`[${SCRIPT_NAME}] エラー: ${error.message}`);
    
    // 予期せぬエラーのキャッチ
    const criticalErrorMessage = `runOCRForAllFiles実行中に予期せぬエラーが発生しました。\n` +
      `エラー詳細: ${error.stack || error.message}\n` +
      `発生時刻: ${new Date().toLocaleString('ja-JP')}`;
    Logger.log(`[${SCRIPT_NAME}] 予期せぬエラー: ${criticalErrorMessage}`);

    // エラー通知（既存のsendErrorNotification_を活用）
    if (config && config.errorNotificationEmails) {
      sendErrorNotification_("OCR処理 - 予期せぬ実行エラー", criticalErrorMessage, config);
    } else {
      // configが利用できない場合のフォールバック通知
      try {
        MailApp.sendEmail(
          "hy.unimail.11@gmail.com",
          "[OCR処理システム] 予期せぬ実行エラー",
          criticalErrorMessage
        );
      } catch (mailError) {
        Logger.log(`[${SCRIPT_NAME}] フォールバック通知送信失敗: ${mailError.message}`);
      }
    }
  }
}

/**
 * マスターデータへのアクセステストを実行します
 * @param {Object} config 設定オブジェクト
 * @returns {Object} {success: boolean, errors: string[]}
 */
function testMasterDataAccess_(config) {
  const errors = [];

  try {
    // 書類マスターテスト
    try {
      const documentList = getDocumentNameList_(config);
      Logger.log(`testMasterDataAccess_: 書類マスター ${documentList.length}件読み込み成功`);
    } catch (e) {
      errors.push(`書類マスターアクセスエラー: ${e.message}`);
    }

    // 顧客マスターテスト
    try {
      const customerList = getCustomerList_(config);
      Logger.log(`testMasterDataAccess_: 顧客マスター ${customerList.length}件読み込み成功`);
    } catch (e) {
      errors.push(`顧客マスターアクセスエラー: ${e.message}`);
    }

    // 事業所マスターテスト
    try {
      const officeList = getOfficeList_(config);
      Logger.log(`testMasterDataAccess_: 事業所マスター ${officeList.length}件読み込み成功`);
    } catch (e) {
      errors.push(`事業所マスターアクセスエラー: ${e.message}`);
    }

    return {
      success: errors.length === 0,
      errors: errors
    };

  } catch (error) {
    return {
      success: false,
      errors: [`マスターデータテスト中の予期せぬエラー: ${error.message}`]
    };
  }
}

/**
 * 簡易認証テストを実行します
 * @returns {boolean} 認証が成功した場合はtrue、失敗した場合はfalse
 */
function performQuickAuthTest_() {
  try {
    // OAuth2サービスの初期化テスト
    const oauth2Service = getOAuth2Service_();
    if (!oauth2Service) {
      Logger.log("performQuickAuthTest_: OAuth2サービス初期化失敗");
      return false;
    }

    // hasAccessの確認
    if (!oauth2Service.hasAccess()) {
      Logger.log("performQuickAuthTest_: OAuth2 hasAccess = false");
      return false;
    }

    // アクセストークン取得テスト
    const accessToken = oauth2Service.getAccessToken();
    if (!accessToken) {
      Logger.log("performQuickAuthTest_: アクセストークン取得失敗");
      return false;
    }

    Logger.log("performQuickAuthTest_: 認証テスト成功");
    return true;

  } catch (error) {
    Logger.log(`performQuickAuthTest_: 認証テスト中にエラー: ${error.message}`);
    return false;
  }
}
