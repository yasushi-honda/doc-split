/**
 * Gmail添付ファイル処理システム（バッチ処理＆ハッシュ強化＋スクリプトプロパティ版）
 *
 * このスクリプトは、指定されたラベルが付いたGmailメッセージから添付ファイルを取得し、
 * 指定されたGoogleドライブフォルダに保存するとともに、処理ログをGoogleスプレッドシートに記録します。
 *
 * 特徴:
 * - AppSheetからの呼び出しに対応
 * - 重複ファイルのスキップ機能（MD5ハッシュによる強化＋スクリプトプロパティで管理）
 * - エラー発生時も処理を続行し、エラーログを記録
 * - ファイル編集処理を行わないため、「マイドライブ」へのファイル追加問題を回避
 * - スプレッドシートへの書き込みをバッチ化し、呼び出し回数を最小限に抑制
 * - 処理済みファイルのハッシュリストはスクリプトプロパティで一元管理（常に最新200件を保持）
 */

/**
 * AppSheetから呼び出されるエントリーポイント関数
 *
 * @param {string} folderIdParam - 添付ファイルの保存先GoogleドライブフォルダID（必須）
 * @param {string} spreadsheetIdParam - ログ記録用GoogleスプレッドシートID（必須）
 * @param {string} sheetNameParam - ログシート名（必須）
 * @param {string} labelsParam - Gmail検索対象のラベル（カンマ区切り、例:"faximo,重要"）（必須）
 */
function processAttachmentsFromAppSheet(folderIdParam, spreadsheetIdParam, sheetNameParam, labelsParam) {
  const SCRIPT_NAME = "processAttachmentsFromAppSheet"; // ログ出力用の関数名
  try {
    // --- 必須パラメータの検証 ---
    if (!folderIdParam || !spreadsheetIdParam || !sheetNameParam || !labelsParam) {
      const errorMsg = '必須パラメーター (folderIdParam, spreadsheetIdParam, sheetNameParam, labelsParam) が不足しています。';
      Logger.log(`[${SCRIPT_NAME}] エラー: ${errorMsg}`);
      throw new Error(errorMsg); // AppSheet側にもエラーを返すためにthrowする
    }

    // --- labelsParam を配列に変換 ---
    // カンマ区切りの文字列をトリムし、空の要素を除外してラベル名の配列を作成
    const targetLabels = labelsParam.split(',')
      .map(label => label.trim())
      .filter(label => label !== '');

    if (targetLabels.length === 0) {
      const errorMsg = '検索対象のラベルが正しく指定されていません。カンマ区切りで1つ以上のラベルを指定してください。';
      Logger.log(`[${SCRIPT_NAME}] エラー: ${errorMsg}`);
      throw new Error(errorMsg);
    }
    Logger.log(`[${SCRIPT_NAME}] AppSheetから受け取ったラベル: "${labelsParam}", パース後: [${targetLabels.join(", ")}]`);

    // --- processAttachments 関数に渡すパラメータオブジェクトを構築 ---
    const params = {
      destinationFolderId: folderIdParam,
      logSpreadsheetId: spreadsheetIdParam,
      logSheetName: sheetNameParam,
      targetLabels: targetLabels, // 配列化されたラベル
      maxThreads: MANUAL_EXECUTION_CONFIG.maxThreads,
      cacheSize: MANUAL_EXECUTION_CONFIG.cacheSize,
      labelSearchOperator: config.gmail.labelSearchOperator, // ★★★ グローバルconfigから検索演算子を取得 ★★★
      errorNotificationEmails: config.errorNotificationEmails // エラー通知先も渡す
    };
    Logger.log(`[${SCRIPT_NAME}] processAttachments へ渡すパラメータ: ${JSON.stringify(params)}`);

    // --- メイン処理の呼び出し ---
    processAttachments(params);

    Logger.log(`[${SCRIPT_NAME}] 【正常終了】AppSheetからの呼び出し処理が正常に完了しました。（現状は定期自動実行のみ）`);
    // AppSheet側への成功応答が必要な場合はここで return する値を調整

  } catch (e) {
    // この関数レベルでの致命的なエラー
    const criticalErrorMsg = `processAttachmentsFromAppSheetで致命的なエラーが発生しました: ${e.message}`;
    Logger.log(`[${SCRIPT_NAME}] 【致命的エラー】${criticalErrorMsg}\nスタックトレース: ${e.stack || 'N/A'}`);
    if (config && config.errorNotificationEmails) {
      sendErrorNotification_(
        `${SCRIPT_NAME} - 致命的エラー`, // 件名
        `${criticalErrorMsg}\nスタックトレース: ${e.stack || 'N/A'}`, // 本文
        config // 設定オブジェクト
      );
    }
  }
}

/**
 * メール単位での時間ベース処理システム（修正版）
 * 指定された時間範囲内のメールを、制限を考慮して安全に処理します
 */

/**
 * 時間ベース・メール単位での添付ファイル処理メイン関数
 * 
 * @param {Object} params - 設定パラメーターオブジェクト
 * @param {string} params.destinationFolderId - 添付ファイル保存先フォルダID（必須）
 * @param {string} params.logSpreadsheetId - ログ記録用スプレッドシートID（必須）
 * @param {string} params.logSheetName - ログシート名（必須）
 * @param {string[]} params.targetLabels - Gmail検索対象のラベル配列（必須）
 * @param {string} [params.labelSearchOperator="AND"] - ラベル検索時の論理演算子
 * @param {number} [params.timeRangeMinutes=5] - 処理対象の時間範囲（分）
 * @param {number} [params.maxMessages=50] - 1回の実行で処理する最大メール数
 * @param {number} [params.maxAttachmentsPerExecution=100] - 1回の実行で処理する最大添付ファイル数
 * @param {number} [params.cacheSize=200] - スクリプトプロパティに保持する最新の処理済みファイル件数
 * @param {string} [params.errorNotificationEmails] - エラー通知先メールアドレス
 */
function processAttachmentsByTimeRange(params) {
  const SCRIPT_NAME = "processAttachmentsByTimeRange";
  const startTime = new Date();
  const summary = {
    processedEmails: 0,
    processedAttachments: 0,
    skippedAttachments: 0,
    errors: [],
    timeRange: null
  };

  try {
    // --- 必須パラメータの検証 ---
    if (!params || !params.destinationFolderId || !params.logSpreadsheetId || !params.logSheetName ||
      !Array.isArray(params.targetLabels) || params.targetLabels.length === 0) {
      const errorMsg = '設定パラメーターが不足しているか、型が正しくありません。(destinationFolderId, logSpreadsheetId, logSheetName, targetLabels(配列) は必須です)';
      Logger.log(`[${SCRIPT_NAME}] エラー: ${errorMsg}`);
      throw new Error(errorMsg);
    }

    // --- パラメータの設定とデフォルト値 ---
    const localConfig = {
      destinationFolderId: params.destinationFolderId,
      logSpreadsheetId: params.logSpreadsheetId,
      logSheetName: params.logSheetName,
      targetLabels: params.targetLabels,
      labelSearchOperator: params.labelSearchOperator || "AND",
      timeRangeMinutes: params.timeRangeMinutes || 5,        // デフォルト5分
      maxMessages: params.maxMessages || 50,                 // デフォルト50メール
      maxAttachmentsPerExecution: params.maxAttachmentsPerExecution || 100, // デフォルト100添付ファイル
      cacheSize: params.cacheSize || 200
    };

    // --- 処理対象時間範囲の計算 ---
    const endTime = new Date();
    const startTimeRange = new Date(endTime.getTime() - (localConfig.timeRangeMinutes * 60 * 1000));
    summary.timeRange = `${startTimeRange.toLocaleString('ja-JP')} ～ ${endTime.toLocaleString('ja-JP')}`;

    Logger.log(`[${SCRIPT_NAME}] 【開始】メール単位処理開始: ${startTime.toLocaleString('ja-JP')}`);
    Logger.log(`[${SCRIPT_NAME}] 【設定】処理対象時間範囲: ${summary.timeRange} (${localConfig.timeRangeMinutes}分間)`);
    Logger.log(`[${SCRIPT_NAME}] 【設定】検索対象ラベル: ${localConfig.targetLabels.join(', ')}`);
    Logger.log(`[${SCRIPT_NAME}] 【設定】ラベル検索演算子: ${localConfig.labelSearchOperator}`);
    Logger.log(`[${SCRIPT_NAME}] 【設定】最大処理メール数: ${localConfig.maxMessages}`);
    Logger.log(`[${SCRIPT_NAME}] 【設定】最大処理添付ファイル数: ${localConfig.maxAttachmentsPerExecution}`);

    const logEntries = [];
    let processedFileHashes = loadProcessedFileHashes();
    Logger.log(`[${SCRIPT_NAME}] 【情報】スクリプトプロパティから処理済みファイルハッシュを ${processedFileHashes.length} 件ロードしました。`);

    const destinationFolder = getDestinationFolder(localConfig.destinationFolderId);

    // --- 時間範囲指定でのメール検索 ---
    const messages = findMessagesByTimeRange(
      localConfig.targetLabels,
      startTimeRange,
      endTime,
      localConfig.maxMessages,
      localConfig.labelSearchOperator
    );

    if (messages.length === 0) {
      Logger.log(`[${SCRIPT_NAME}] 【情報】指定時間範囲内に処理対象メールは見つかりませんでした。`);
      logSummary_(SCRIPT_NAME, startTime, summary);
      return;
    }

    Logger.log(`[${SCRIPT_NAME}] 【検索結果】${messages.length}件のメールが見つかりました。`);

    // --- 各メールの処理（添付ファイル数制限付き） ---
    let totalAttachmentsProcessed = 0;

    for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
      // 添付ファイル処理数の上限チェック
      if (totalAttachmentsProcessed >= localConfig.maxAttachmentsPerExecution) {
        Logger.log(`[${SCRIPT_NAME}] 【制限】添付ファイル処理上限 (${localConfig.maxAttachmentsPerExecution}) に達したため、残りのメールは次回処理します。`);
        break;
      }

      const message = messages[messageIndex];
      const messageSubject = message.getSubject() || "(件名なし)";
      const messageDate = message.getDate();

      Logger.log(`[${SCRIPT_NAME}] メール処理中 [${messageIndex + 1}/${messages.length}]: ${messageSubject} (${messageDate.toLocaleString('ja-JP')})`);

      try {
        const attachments = message.getAttachments();

        if (attachments.length === 0) {
          Logger.log(`  [${SCRIPT_NAME}] 【情報】添付ファイルなし`);
          summary.processedEmails++;
          continue;
        }

        Logger.log(`  [${SCRIPT_NAME}] 【情報】添付ファイル数: ${attachments.length}`);

        // 添付ファイルの処理
        for (let attachmentIndex = 0; attachmentIndex < attachments.length; attachmentIndex++) {
          // 添付ファイル処理数の上限チェック
          if (totalAttachmentsProcessed >= localConfig.maxAttachmentsPerExecution) {
            Logger.log(`    [${SCRIPT_NAME}] 【制限】添付ファイル処理上限に達したため、残りの添付ファイルは次回処理します。`);
            break;
          }

          const attachment = attachments[attachmentIndex];
          const fileName = attachment.getName();

          Logger.log(`    [${SCRIPT_NAME}] 添付ファイル処理中 [${attachmentIndex + 1}/${attachments.length}]: ${fileName}`);

          try {
            const fileSize = Math.round(attachment.getSize() / 1024);
            const hash = computeFileHash(attachment);

            // 重複チェック
            const isDuplicate = processedFileHashes.some(entry =>
              entry.hash === hash || (entry.filename === fileName && entry.size === attachment.getSize())
            );

            if (isDuplicate) {
              Logger.log(`      [${SCRIPT_NAME}] 【スキップ】既に処理済み: ${fileName} (ハッシュ: ${hash})`);
              summary.skippedAttachments++;
              totalAttachmentsProcessed++; // スキップもカウント
              continue;
            }

            // ファイル保存
            Logger.log(`      [${SCRIPT_NAME}] 【保存】${fileName} (${fileSize}KB), ハッシュ: ${hash}`);
            const file = destinationFolder.createFile(attachment);
            Logger.log(`      [${SCRIPT_NAME}] 【完了】ファイルURL: ${file.getUrl()}`);

            summary.processedAttachments++;
            totalAttachmentsProcessed++;

            // ログエントリ追加
            logEntries.push([
              fileName,
              hash,
              fileSize,
              messageSubject,
              messageDate,
              file.getUrl(),
              message.getPlainBody().substring(0, 500) + (message.getPlainBody().length > 500 ? "..." : "")
            ]);

            // 処理済みリストに追加
            processedFileHashes.push({
              filename: fileName,
              hash: hash,
              size: attachment.getSize(),
              timestamp: new Date().toISOString()
            });

            // キャッシュサイズ管理
            if (processedFileHashes.length > localConfig.cacheSize) {
              processedFileHashes = processedFileHashes.slice(-localConfig.cacheSize);
            }

          } catch (attachmentError) {
            const errorMsg = `添付ファイル処理エラー: ${fileName}, エラー: ${attachmentError.message}`;
            Logger.log(`      [${SCRIPT_NAME}] 【エラー】${errorMsg}\n${attachmentError.stack || 'N/A'}`);
            summary.errors.push(`${SCRIPT_NAME} (添付): ${errorMsg}`);
            totalAttachmentsProcessed++; // エラーもカウント
          }
        }

        summary.processedEmails++;

      } catch (messageError) {
        const errorMsg = `メール処理エラー: ${messageSubject}, エラー: ${messageError.message}`;
        Logger.log(`  [${SCRIPT_NAME}] 【エラー】${errorMsg}\n${messageError.stack || 'N/A'}`);
        summary.errors.push(`${SCRIPT_NAME} (メール): ${errorMsg}`);
      }
    }

    // --- ログのバッチ書き込み ---
    if (logEntries.length > 0) {
      writeLogsToSheet_(localConfig.logSpreadsheetId, localConfig.logSheetName, logEntries, summary);
    } else {
      Logger.log(`[${SCRIPT_NAME}] 【情報】新規に処理した添付ファイルはありませんでした。スプレッドシートへの書き込みは行いません。`);
    }

    saveProcessedFileHashes(processedFileHashes);
    Logger.log(`[${SCRIPT_NAME}] 【情報】処理済みファイルハッシュをスクリプトプロパティに ${processedFileHashes.length} 件保存しました。`);

  } catch (mainError) {
    const errorMsg = `processAttachmentsByTimeRangeのメイン処理でエラーが発生しました: ${mainError.message}`;
    Logger.log(`[${SCRIPT_NAME}] 【致命的エラー】${errorMsg}\nスタックトレース: ${mainError.stack || 'N/A'}`);
    summary.errors.push(`${SCRIPT_NAME}: ${errorMsg}`);

    // グローバルconfigを使用できる場合の通知
    if (config && config.errorNotificationEmails) {
      sendErrorNotification_(`${SCRIPT_NAME} - 致命的エラー`, `${errorMsg}\nスタックトレース: ${mainError.stack || 'N/A'}`, config);
    }
  } finally {
    logSummary_(SCRIPT_NAME, startTime, summary);
  }
}

/**
 * 指定された時間範囲内のメールを検索する関数
 * 
 * @param {string[]} labelNames - 対象ラベル名の配列
 * @param {Date} startTime - 検索開始時刻
 * @param {Date} endTime - 検索終了時刻
 * @param {number} maxMessages - 最大取得メール数
 * @param {string} [searchOperator="AND"] - ラベル検索演算子（"AND" または "OR"）
 * @return {GoogleAppsScript.Gmail.GmailMessage[]} メール配列
 * @throws {Error} メール検索処理中にエラーが発生した場合
 */
function findMessagesByTimeRange(labelNames, startTime, endTime, maxMessages, searchOperator = "AND") {
  const SCRIPT_NAME = "findMessagesByTimeRange";

  try {
    // ラベル名の検証
    if (!Array.isArray(labelNames) || labelNames.length === 0) {
      Logger.log(`[${SCRIPT_NAME}] 検索対象のラベル名が指定されていません。空の結果を返します。`);
      return [];
    }

    // ラベル部分のクエリ生成
    let joinOperator = ' '; // デフォルトはAND検索
    let operatorDisplay = "AND";

    if (searchOperator && searchOperator.toUpperCase() === 'OR') {
      joinOperator = ' OR ';
      operatorDisplay = "OR";
    }

    const labelQuery = labelNames.map(label => 'label:"' + label.replace(/"/g, '\\"') + '"').join(joinOperator);

    // === 🔧 修正部分：UNIXタイムスタンプを使用した正確な時間指定 ===
    // Gmail検索でUNIXタイムスタンプ（秒単位）を使用することで、タイムゾーン問題を回避
    const startTimeUnix = Math.floor(startTime.getTime() / 1000);
    const endTimeUnix = Math.floor(endTime.getTime() / 1000);

    // Gmail検索クエリの組み立て（修正版）
    const searchQuery = `${labelQuery} after:${startTimeUnix} before:${endTimeUnix} has:attachment`;
    
    Logger.log(`[${SCRIPT_NAME}] Gmail検索クエリ: "${searchQuery}" (検索タイプ: ${operatorDisplay})`);
    Logger.log(`[${SCRIPT_NAME}] 時間範囲: ${startTime.toLocaleString('ja-JP')} ～ ${endTime.toLocaleString('ja-JP')}`);
    Logger.log(`[${SCRIPT_NAME}] UNIXタイムスタンプ: ${startTimeUnix} ～ ${endTimeUnix}`);

    // Gmail検索実行
    const maxThreadsToSearch = Math.min(maxMessages * 2, 200); // スレッド数は控えめに調整
    const threads = GmailApp.search(searchQuery, 0, maxThreadsToSearch);
    Logger.log(`[${SCRIPT_NAME}] ${threads.length}件のスレッドを取得しました。`);

    // === 🔧 修正部分：メール単位での取得（簡素化） ===
    // UNIXタイムスタンプ検索により、Gmail側で正確に絞り込まれているため、
    // 追加の時間チェックは不要。単純にメールを取得する。
    const messages = [];

    for (const thread of threads) {
      if (messages.length >= maxMessages) break;

      const threadMessages = thread.getMessages();
      for (const message of threadMessages) {
        if (messages.length >= maxMessages) break;
        
        // 添付ファイルがあるメールのみ追加
        if (message.getAttachments().length > 0) {
          messages.push(message);
        }
      }
    }

    // 日時順でソート（新しいものから）
    messages.sort((a, b) => b.getDate().getTime() - a.getDate().getTime());

    const finalMessages = messages.slice(0, maxMessages);
    Logger.log(`[${SCRIPT_NAME}] 最終的に ${finalMessages.length}件のメールを取得しました。`);
    
    // 取得したメールの詳細をログ出力（デバッグ用）
    finalMessages.forEach((message, index) => {
      Logger.log(`[${SCRIPT_NAME}] メール${index + 1}: ${message.getSubject()} (${message.getDate().toLocaleString('ja-JP')})`);
    });
    
    return finalMessages;

  } catch (error) {
    const errorMessage = `時間範囲指定メール検索中にエラーが発生しました: ${error.message}`;
    Logger.log(`[${SCRIPT_NAME}] エラー: ${errorMessage}\nスタックトレース: ${error.stack || 'N/A'}`);
    throw new Error(errorMessage);
  }
}

/**
 * scheduleExecution関数から呼び出すためのラッパー関数
 * 
 * @param {string} folderIdParam - 添付ファイルの保存先GoogleドライブフォルダID
 * @param {string} spreadsheetIdParam - ログ記録用GoogleスプレッドシートID
 * @param {string} sheetNameParam - ログシート名
 * @param {string} labelsParam - Gmail検索対象のラベル（カンマ区切り）
 * @param {number} [timeRangeMinutes=5] - 処理対象の時間範囲（分）
 */
function processAttachmentsFromAppSheetTimeRange(folderIdParam, spreadsheetIdParam, sheetNameParam, labelsParam, timeRangeMinutes = 5) {
  const SCRIPT_NAME = "processAttachmentsFromAppSheetTimeRange";

  try {
    // --- 必須パラメータの検証 ---
    if (!folderIdParam || !spreadsheetIdParam || !sheetNameParam || !labelsParam) {
      const errorMsg = '必須パラメーター (folderIdParam, spreadsheetIdParam, sheetNameParam, labelsParam) が不足しています。';
      Logger.log(`[${SCRIPT_NAME}] エラー: ${errorMsg}`);
      throw new Error(errorMsg);
    }

    // --- labelsParam を配列に変換 ---
    const targetLabels = labelsParam.split(',')
      .map(label => label.trim())
      .filter(label => label !== '');

    if (targetLabels.length === 0) {
      const errorMsg = '検索対象のラベルが正しく指定されていません。カンマ区切りで1つ以上のラベルを指定してください。';
      Logger.log(`[${SCRIPT_NAME}] エラー: ${errorMsg}`);
      throw new Error(errorMsg);
    }

    Logger.log(`[${SCRIPT_NAME}] 時間ベース処理開始: ${timeRangeMinutes}分間の範囲で処理`);
    Logger.log(`[${SCRIPT_NAME}] 検索対象ラベル: "${labelsParam}", パース後: [${targetLabels.join(", ")}]`);

    const params = {
      destinationFolderId: folderIdParam,
      logSpreadsheetId: spreadsheetIdParam,
      logSheetName: sheetNameParam,
      targetLabels: targetLabels,
      labelSearchOperator: config.gmail.labelSearchOperator,
      timeRangeMinutes: timeRangeMinutes,    // 時間範囲（分）
      maxMessages: 50,                       // 最大メール数
      maxAttachmentsPerExecution: 100,       // 最大添付ファイル数
      cacheSize: 200,
      errorNotificationEmails: config.errorNotificationEmails
    };

    Logger.log(`[${SCRIPT_NAME}] processAttachmentsByTimeRange へ渡すパラメータ: ${JSON.stringify(params)}`);
    processAttachmentsByTimeRange(params);
    Logger.log(`[${SCRIPT_NAME}] 【正常終了】時間ベース処理が完了しました。`);

  } catch (e) {
    const errorMsg = `processAttachmentsFromAppSheetTimeRangeで致命的なエラーが発生しました: ${e.message}`;
    Logger.log(`[${SCRIPT_NAME}] 【致命的エラー】${errorMsg}\nスタックトレース: ${e.stack || 'N/A'}`);
    if (config && config.errorNotificationEmails) {
      sendErrorNotification_(`${SCRIPT_NAME} - 致命的エラー`, `${errorMsg}\nスタックトレース: ${e.stack || 'N/A'}`, config);
    }
  }
}

/**
 * Gmailから添付ファイルを取得し、Googleドライブに保存、ログをスプレッドシートに記録するメイン関数
 * （バッチ処理＆ハッシュ強化＋スクリプトプロパティ版）
 *
 * @param {Object} params - 設定パラメーターオブジェクト
 * @param {string} params.destinationFolderId - 添付ファイル保存先フォルダID（必須）
 * @param {string} params.logSpreadsheetId - ログ記録用スプレッドシートID（必須）
 * @param {string} params.logSheetName - ログシート名（必須）
 * @param {string[]} params.targetLabels - Gmail検索対象のラベル配列（必須）
 * @param {number} params.maxThreads - Gmailから取得するスレッドの上限（必須）
 * @param {string} [params.labelSearchOperator="AND"] - ラベル検索時の論理演算子 ("AND" または "OR")
 * @param {number} [params.cacheSize=200] - スクリプトプロパティに保持する最新の処理済みファイル件数
 */
function processAttachments(params) {
  const SCRIPT_NAME = "processAttachments"; // ログ出力用の関数名
  const startTime = new Date();
  const summary = {
    processedEmails: 0,
    processedAttachments: 0,
    skippedAttachments: 0,
    errors: []
  };

  try {
    // --- 必須パラメータの検証 ---
    if (!params || !params.destinationFolderId || !params.logSpreadsheetId || !params.logSheetName ||
      !Array.isArray(params.targetLabels) || params.targetLabels.length === 0 || typeof params.maxThreads !== 'number') {
      const errorMsg = '設定パラメーターが不足しているか、型が正しくありません。(destinationFolderId, logSpreadsheetId, logSheetName, targetLabels(配列), maxThreads(数値) は必須です)';
      Logger.log(`[${SCRIPT_NAME}] エラー: ${errorMsg}`);
      throw new Error(errorMsg);
    }

    // --- 設定オブジェクトの組み立て (デフォルト値の設定を含む) ---
    const localConfig = {
      destinationFolderId: params.destinationFolderId,
      logSpreadsheetId: params.logSpreadsheetId,
      logSheetName: params.logSheetName,
      targetLabels: params.targetLabels, // processAttachmentsFromAppSheetで配列に変換済みのはず
      maxThreads: params.maxThreads,
      labelSearchOperator: params.labelSearchOperator || "AND", // デフォルトはAND検索
      cacheSize: params.cacheSize || 200 // デフォルトは200件
    };

    Logger.log(`[${SCRIPT_NAME}] 【開始】処理開始時刻: ${startTime.toLocaleString('ja-JP', { timeZone: "Asia/Tokyo" })}`);
    Logger.log(`[${SCRIPT_NAME}] 【設定】保存先フォルダID: ${localConfig.destinationFolderId}`);
    Logger.log(`[${SCRIPT_NAME}] 【設定】ログスプレッドシートID: ${localConfig.logSpreadsheetId}, シート名: ${localConfig.logSheetName}`);
    Logger.log(`[${SCRIPT_NAME}] 【設定】検索対象ラベル: ${localConfig.targetLabels.join(', ')}`);
    Logger.log(`[${SCRIPT_NAME}] 【設定】ラベル検索演算子: ${localConfig.labelSearchOperator}`);
    Logger.log(`[${SCRIPT_NAME}] 【設定】取得スレッド件数上限: ${localConfig.maxThreads}`);
    Logger.log(`[${SCRIPT_NAME}] 【設定】処理済みハッシュ保持件数: ${localConfig.cacheSize}`);
    Logger.log(`[${SCRIPT_NAME}] 【設定】スクリプトプロパティによる重複チェックを利用します。`);

    const logEntries = []; // バッチ書き込み用ログ配列

    let processedFileHashes = loadProcessedFileHashes(); // スクリプトプロパティからロード
    Logger.log(`[${SCRIPT_NAME}] 【情報】スクリプトプロパティから処理済みファイルハッシュを ${processedFileHashes.length} 件ロードしました。`);

    // --- Gmailから対象メールスレッドを検索 ---
    // findEmailThreads に localConfig.labelSearchOperator を渡すように修正
    const threads = findEmailThreads(localConfig.targetLabels, localConfig.maxThreads, localConfig.labelSearchOperator);
    Logger.log(`[${SCRIPT_NAME}] 【検索結果】${threads.length} 件のスレッドが見つかりました。`);

    if (threads.length === 0) {
      Logger.log(`[${SCRIPT_NAME}] 【情報】処理対象のメールは見つかりませんでした。`);
      // 早期リターンする前にサマリーログを出力することも検討
      logSummary_(SCRIPT_NAME, startTime, summary);
      return;
    }

    const destinationFolder = getDestinationFolder(localConfig.destinationFolderId); // 保存先フォルダ取得

    // --- 各メールスレッドの処理 ---
    threads.forEach((thread, threadIndex) => {
      const threadSubjectHint = thread.getFirstMessageSubject() || "(件名なし)"; // スレッドの最初の件名を取得（ログ用）
      Logger.log(`\n[${SCRIPT_NAME}] スレッド処理開始 [${threadIndex + 1}/${threads.length}]: ${threadSubjectHint}`);
      try {
        const messages = thread.getMessages();
        messages.forEach((message, messageIndex) => {
          const messageSubject = message.getSubject() || "(件名なし)";
          Logger.log(`  [${SCRIPT_NAME}] メール処理中 [${messageIndex + 1}/${messages.length}]: ${messageSubject}`);
          try {
            const attachments = message.getAttachments();
            if (attachments.length === 0) {
              Logger.log(`    [${SCRIPT_NAME}] 【情報】このメールには添付ファイルがありません: ${messageSubject}`);
            } else {
              Logger.log(`    [${SCRIPT_NAME}] 【情報】添付ファイル数: ${attachments.length}`);
              attachments.forEach((attachment, attachmentIndex) => {
                const fileName = attachment.getName();
                Logger.log(`      [${SCRIPT_NAME}] 添付ファイル処理中 [${attachmentIndex + 1}/${attachments.length}]: ${fileName}`);
                try {
                  const fileSize = Math.round(attachment.getSize() / 1024); // KB単位
                  const hash = computeFileHash(attachment); // MD5ハッシュ計算

                  // 重複チェック: ハッシュまたはファイル名で判定 (ファイル名のみの重複も考慮)
                  const isDuplicate = processedFileHashes.some(entry =>
                    entry.hash === hash || (entry.filename === fileName && entry.size === attachment.getSize()) // サイズも加味
                  );

                  if (isDuplicate) {
                    Logger.log(`        [${SCRIPT_NAME}] 【スキップ】既に処理済みのためスキップ: ${fileName} (ハッシュ: ${hash})`);
                    summary.skippedAttachments++;
                    return; // この添付ファイルの処理をスキップ
                  }

                  Logger.log(`        [${SCRIPT_NAME}] 【添付保存】ファイル: ${fileName} (${fileSize}KB), ハッシュ: ${hash}`);
                  const file = destinationFolder.createFile(attachment); // Driveに保存
                  Logger.log(`        [${SCRIPT_NAME}] 【保存完了】ファイルURL: ${file.getUrl()}`);
                  summary.processedAttachments++;

                  logEntries.push([
                    fileName,
                    hash,
                    fileSize,
                    messageSubject,
                    message.getDate(), // メールの受信日時
                    file.getUrl(),
                    message.getPlainBody().substring(0, 500) + (message.getPlainBody().length > 500 ? "..." : "") // 本文一部
                  ]);

                  // 処理済みリストに追加 (ハッシュ、ファイル名、サイズ、日時)
                  processedFileHashes.push({
                    filename: fileName,
                    hash: hash,
                    size: attachment.getSize(),
                    timestamp: new Date().toISOString() // ISO形式で日時を記録
                  });
                  // リストが長くなりすぎないように、古いものから削除 (FIFO)
                  if (processedFileHashes.length > localConfig.cacheSize) {
                    processedFileHashes = processedFileHashes.slice(-localConfig.cacheSize);
                  }

                } catch (attachmentError) {
                  const errorMsg = `添付ファイル処理エラー: ${fileName}, エラー: ${attachmentError.message}`;
                  Logger.log(`        [${SCRIPT_NAME}] 【エラー】${errorMsg}\n${attachmentError.stack || 'N/A'}`);
                  summary.errors.push(`${SCRIPT_NAME} (添付): ${errorMsg}`);
                }
              }); // attachments.forEach
            }
            summary.processedEmails++;
          } catch (messageError) {
            const errorMsg = `メール処理エラー: ${messageSubject}, エラー: ${messageError.message}`;
            Logger.log(`    [${SCRIPT_NAME}] 【エラー】${errorMsg}\n${messageError.stack || 'N/A'}`);
            summary.errors.push(`${SCRIPT_NAME} (メール): ${errorMsg}`);
          }
        }); // messages.forEach
      } catch (threadError) {
        const errorMsg = `スレッド処理エラー: ${threadSubjectHint}, エラー: ${threadError.message}`;
        Logger.log(`  [${SCRIPT_NAME}] 【エラー】${errorMsg}\n${threadError.stack || 'N/A'}`);
        summary.errors.push(`${SCRIPT_NAME} (スレッド): ${errorMsg}`);
      }
    }); // threads.forEach

    // --- ログのバッチ書き込み ---
    if (logEntries.length > 0) {
      writeLogsToSheet_(localConfig.logSpreadsheetId, localConfig.logSheetName, logEntries, summary);
    } else {
      Logger.log(`[${SCRIPT_NAME}] 【情報】新規に処理した添付ファイルはありませんでした。スプレッドシートへの書き込みは行いません。`);
    }

    saveProcessedFileHashes(processedFileHashes); // 更新されたハッシュリストを保存
    Logger.log(`[${SCRIPT_NAME}] 【情報】処理済みファイルハッシュをスクリプトプロパティに ${processedFileHashes.length} 件保存しました。`);

  } catch (mainError) {
    // この関数レベルでの致命的なエラー
    const errorMsg = `processAttachmentsのメイン処理でエラーが発生しました: ${mainError.message}`;
    Logger.log(`[${SCRIPT_NAME}] 【致命的エラー】${errorMsg}\nスタックトレース: ${mainError.stack || 'N/A'}`);
    // グローバルの config.errorNotificationEmails を使用する方針の場合
    if (config && config.errorNotificationEmails) {
      sendErrorNotification_(
        `${SCRIPT_NAME} - 致命的エラー`, // 件名
        `${errorMsg}\nスタックトレース: ${mainError.stack || 'N/A'}`, // 本文
        config // 設定オブジェクト
      );
    }
    // もし params 経由で渡された通知先を使う場合（ただし、sendErrorNotification_の第3引数がconfigオブジェクトなので注意）
    /*
    if (params && params.errorNotificationEmails) {
      sendErrorNotification_(
        `${SCRIPT_NAME} - 致命的エラー`,
        `${errorMsg}\nスタックトレース: ${mainError.stack || 'N/A'}`,
        { errorNotificationEmails: params.errorNotificationEmails } // 一時的なconfig風オブジェクト
      );
    }
    */
  } finally {
    // --- 処理サマリーのログ出力 ---
    logSummary_(SCRIPT_NAME, startTime, summary);
  }
}

/**
 * ログエントリをスプレッドシートにバッチ書き込みするヘルパー関数
 */
function writeLogsToSheet_(spreadsheetId, sheetName, logEntries, summary) {
  const SCRIPT_NAME = "writeLogsToSheet_";
  try {
    Logger.log(`[${SCRIPT_NAME}] 【ログ記録】${logEntries.length}件のログ情報をバッチ処理します...`);
    const logSheet = getLogSheet(spreadsheetId, sheetName);
    if (logSheet) {
      // ヘッダー行が存在するか確認し、なければ作成するロジックを getLogSheet 内に移すか、
      // ここで別途チェック・作成しても良い。今回は getLogSheet がシートを返す前提。
      const header = ["ファイル名", "ハッシュ(MD5)", "サイズ(KB)", "メール件名", "メール受信日時", "ファイルURL", "メール本文(一部)"];
      if (logSheet.getLastRow() === 0) { // シートが空ならヘッダーを書き込む
        logSheet.appendRow(header);
        Logger.log(`[${SCRIPT_NAME}] ログシートにヘッダー行を作成しました。`);
      }
      const lastRow = logSheet.getLastRow();
      logSheet.getRange(lastRow + 1, 1, logEntries.length, logEntries[0].length)
        .setValues(logEntries);
      Logger.log(`[${SCRIPT_NAME}] 【ログ記録】${logEntries.length}件のログを一括記録しました。`);
    } else {
      // getLogSheet内でエラーがthrowされるか、nullが返る想定
      const errorMsg = 'ログシートが取得できませんでした。スプレッドシートIDやシート名を確認してください。';
      Logger.log(`[${SCRIPT_NAME}] 【エラー】${errorMsg}`);
      if (summary) summary.errors.push(`${SCRIPT_NAME}: ${errorMsg}`); // summaryが渡されていればエラー追加
    }
  } catch (batchLogError) {
    const errorMsg = `バッチログ記録エラー: ${batchLogError.message}`;
    Logger.log(`[${SCRIPT_NAME}] 【エラー】${errorMsg}\n${batchLogError.stack || 'N/A'}`);
    if (summary) summary.errors.push(`${SCRIPT_NAME}: ${errorMsg}`);
    Logger.log(`[${SCRIPT_NAME}] 【警告】スプレッドシートへの書き込みに失敗しましたが、重複チェックリストは更新されます。`);
  }
}

/**
 * 処理サマリーをログに出力するヘルパー関数
 */
function logSummary_(scriptName, startTime, summary) {
  const endTime = new Date();
  const executionTime = (endTime.getTime() - startTime.getTime()) / 1000; // 秒単位
  Logger.log(`\n[${scriptName}] ===== 処理サマリー =====`);
  Logger.log(`[${scriptName}] 【完了】処理完了時刻: ${endTime.toLocaleString('ja-JP', { timeZone: "Asia/Tokyo" })}`);
  Logger.log(`[${scriptName}] 【完了】処理時間: ${executionTime.toFixed(2)} 秒`);
  if (summary) { // summaryが渡されている場合のみログ出力
    Logger.log(`[${scriptName}] 【完了】処理メール数: ${summary.processedEmails}`);
    Logger.log(`[${scriptName}] 【完了】処理添付ファイル数: ${summary.processedAttachments}`);
    Logger.log(`[${scriptName}] 【完了】スキップ件数(重複など): ${summary.skippedAttachments}`);
    Logger.log(`[${scriptName}] 【完了】エラー件数: ${summary.errors.length}`);
    if (summary.errors.length > 0) {
      Logger.log(`[${scriptName}] 【エラー詳細】:\n${summary.errors.join('\n')}`);
    }
  } else {
    Logger.log(`[${scriptName}] 【情報】サマリーオブジェクトが提供されませんでした。`);
  }
  Logger.log(`[${scriptName}] ===== サマリー終了 =====`);
}

/**
 * Gmailのスレッドを検索して取得する関数。
 * 指定された複数のラベル名に対し、AND検索またはOR検索を実行できます。
 *
 * @param {string[]} labelNames - 検索対象のGmailラベル名の配列。例: ["FAX", "重要"]
 * @param {number} maxThreads - 一度に取得するメールスレッドの上限数。
 * @param {string} [searchOperator="AND"] - ラベル検索時の論理演算子。"AND" または "OR" を指定。
 *                                          省略時はデフォルトで "AND" (スペース区切り) となります。
 * @return {GoogleAppsScript.Gmail.GmailThread[]} 取得したGmailスレッドの配列。
 * @throws {Error} Gmailの検索処理中にエラーが発生した場合。
 */
function findEmailThreads(labelNames, maxThreads, searchOperator = "AND") { // searchOperator引数を追加し、デフォルト値を "AND" に設定
  const SCRIPT_NAME = "findEmailThreads"; // ログ出力用の関数名
  try {
    // ラベル名が空または配列でない場合はエラーを投げるか、空配列を返すなどの考慮も可能ですが、
    // 呼び出し元でチェックされている前提とします。
    if (!Array.isArray(labelNames) || labelNames.length === 0) {
      Logger.log(`[${SCRIPT_NAME}] 検索対象のラベル名が指定されていません。空の結果を返します。`);
      return [];
    }

    let joinOperator = ' '; // デフォルトはAND検索 (例: "label:A label:B")
    let operatorDisplay = "AND"; // ログ表示用の演算子名

    // searchOperator が "OR" (大文字・小文字問わず) の場合、結合子を " OR " に変更
    if (searchOperator && searchOperator.toUpperCase() === 'OR') {
      joinOperator = ' OR '; // OR検索 (例: "label:A OR label:B")
      operatorDisplay = "OR";
    }

    // 各ラベル名に "label:" プレフィックスを付け、指定された論理演算子で結合して検索クエリを生成
    const searchQuery = labelNames.map(label => 'label:"' + label.replace(/"/g, '\\"') + '"').join(joinOperator);
    // ラベル名にスペースが含まれる可能性を考慮し、ラベル名をダブルクォートで囲むように修正。
    // また、ラベル名自体にダブルクォートが含まれる場合はエスケープする。

    Logger.log(`[${SCRIPT_NAME}] Gmail検索クエリ: "${searchQuery}" (検索タイプ: ${operatorDisplay}, 上限: ${maxThreads}件)`);

    // GmailApp.search を使用してメールスレッドを検索
    // 第1引数: 検索クエリ文字列
    // 第2引数: 開始インデックス (0から)
    // 第3引数: 最大取得件数
    const threads = GmailApp.search(searchQuery, 0, maxThreads);
    Logger.log(`[${SCRIPT_NAME}] ${threads.length}件のメールスレッドが見つかりました。`);

    return threads;

  } catch (error) {
    // エラー発生時はログに詳細を記録し、エラーを再スローして呼び出し元に処理の失敗を通知
    const errorMessage = `Gmailメール検索中にエラーが発生しました: ${error.message}`;
    Logger.log(`[${SCRIPT_NAME}] エラー: ${errorMessage}\nスタックトレース: ${error.stack || 'N/A'}`);
    throw new Error(errorMessage); // エラーを再スロー
  }
}

/**
 * フォルダIDからGoogleドライブのフォルダを取得する関数
 *
 * @param {string} folderId - フォルダID
 * @return {GoogleAppsScript.Drive.Folder} - 取得したフォルダオブジェクト
 * @throws {Error} - フォルダ取得に失敗した場合
 */
function getDestinationFolder(folderId) {
  try {
    const folder = DriveApp.getFolderById(folderId);
    console.log(`【フォルダ取得】 保存先フォルダ: ${folder.getName()} (ID: ${folderId})`);
    return folder;
  } catch (error) {
    console.error(`【エラー】フォルダ取得エラー: ${error.message}`);
    throw new Error(`指定されたフォルダが見つからないか、アクセス権限がありません: ${error.message}`);
  }
}

/**
 * スプレッドシートIDとシート名からログ用シートを取得する関数
 *
 * @param {string} spreadsheetId - スプレッドシートID
 * @param {string} sheetName - シート名
 * @return {GoogleAppsScript.Spreadsheet.Sheet|null} - 取得したシートオブジェクト（存在しなければnull）
 */
function getLogSheet(spreadsheetId, sheetName) {
  try {
    const ss = SpreadsheetApp.openById(spreadsheetId);
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      throw new Error(`シート「${sheetName}」が見つかりません。手動で作成してください。`);
    }
    return sheet;
  } catch (error) {
    console.error(`【エラー】スプレッドシート操作エラー: ${error.message}`);
    return null;
  }
}

/**
 * 添付ファイルの内容からMD5ハッシュを計算する関数
 *
 * @param {Blob} attachment - 添付ファイルのBlobオブジェクト
 * @return {string} - 16進数表現のMD5ハッシュ
 */
function computeFileHash(attachment) {
  try {
    const bytes = attachment.getBytes();
    const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, bytes);
    return digest.map(function (byte) {
      let hex = (byte < 0 ? byte + 256 : byte).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    }).join('');
  } catch (error) {
    console.error(`【エラー】ハッシュ計算エラー: ${error.message}`);
    throw new Error(`ハッシュ計算に失敗しました: ${error.message}`);
  }
}

/**
 * スクリプトプロパティから処理済みファイルのハッシュリストをロードする関数
 *
 * @return {Object[]} - 処理済みファイル情報の配列（各要素は {filename, hash, size, timestamp} の形式）
 */
function loadProcessedFileHashes() {
  const props = PropertiesService.getScriptProperties();
  const json = props.getProperty('processedFileHashes');
  if (json) {
    try {
      return JSON.parse(json);
    } catch (e) {
      console.error(`【警告】スクリプトプロパティのパースエラー: ${e.message}`);
      return [];
    }
  } else {
    return [];
  }
}

/**
 * 処理済みファイルのハッシュリストをスクリプトプロパティに保存する関数
 *
 * @param {Object[]} hashes - 処理済みファイル情報の配列
 */
function saveProcessedFileHashes(hashes) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('processedFileHashes', JSON.stringify(hashes));
}