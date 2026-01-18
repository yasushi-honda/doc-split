/**
 * 指定されたフォルダ内の全ての対象ファイルに対してOCR処理と情報識別、ファイル名変更、ログ記録を行います。
 * この関数は、OCR処理バッチのメインロジックを担います。
 *
 * 処理の主な流れ:
 * 1. 対象フォルダ、移動先フォルダ、エラーフォルダへのアクセス権を確認します。
 * 2. 書類マスター、顧客マスター、事業所マスターのデータをスプレッドシートから読み込みます。
 * 3. 対象フォルダ内のファイルを一つずつ処理します。
 *    a. ファイルが処理対象（PDFまたは画像）か判定します。
 *    b. ファイルをBase64エンコードし、Cloud Function経由でOCRを実行します。
 *    c. OCR結果から書類名、顧客名、事業所名、日付を抽出・識別します。
 *    d. 抽出情報に基づいて新しいファイル名を生成します。
 *    e. ファイル名を変更し、指定された移動先フォルダへファイルを移動します。
 *    f. 処理結果をログ用スプレッドシートに記録します。
 * 4. エラーが発生したファイルは、エラーフォルダへ移動し、エラー通知を行います。
 * 5. 全体処理完了後、サマリーをログに出力し、必要に応じて管理者に通知します。
 *
 * @param {object} globalConfig グローバル設定オブジェクト。
 * @param {string} globalConfig.targetFolderId OCR処理対象のファイルが格納されているGoogle DriveフォルダID。
 * @param {string} globalConfig.destinationFolderId OCR処理後にファイルが移動されるGoogle DriveフォルダID。
 * @param {string} [globalConfig.errorFolderId] (任意) OCR処理や情報識別に失敗したファイルが移動されるGoogle DriveフォルダID。
 * @param {string} globalConfig.geminiModel OCR処理に使用するGeminiモデル名。
 * @param {object} globalConfig.sheets 各種マスターデータやログ記録用スプレッドシートの設定を含むオブジェクト。
 */
function processFolderOCR(globalConfig) {
  const SCRIPT_NAME = "processFolderOCR"; // ログ出力用の関数名

  // 最初にシステムチェック
  try {
    checkSystemReady(SCRIPT_NAME);
  } catch (error) {
    Logger.log(`[${SCRIPT_NAME}] ${error.message}`);
    if (globalConfig && globalConfig.errorNotificationEmails) {
      sendErrorNotification_(
        "OCR処理 - システム初期化エラー",
        error.message,
        globalConfig
      );
    }
    return; // 処理を中断
  }

  Logger.log(`[${SCRIPT_NAME}] OCR処理バッチを開始します。対象フォルダID: ${globalConfig.targetFolderId}`);

  // カウンター変数の詳細化
  let processedFileCount = 0;     // ファイル処理成功数（OCR+移動完了）
  let errorFileCount = 0;         // ファイル処理失敗数（OCR or 移動失敗）
  let logErrorCount = 0;          // ログ記録失敗数
  let skippedFileCount = 0;       // スキップファイル数

  try { // --- スクリプト全体の主要な処理を囲む try-catch ブロック ---

    // --- 1. フォルダ存在チェックとアクセス権取得 ---
    // 指定されたGoogle DriveフォルダIDが有効で、アクセス可能かを確認するヘルパー関数です。
    const checkFolderAccess = (folderId, folderName) => {
      try {
        // Drive.Files.getを使用してフォルダのメタデータを取得できるかでアクセスを確認
        // supportsAllDrives: true で共有ドライブも考慮
        // fields: 'id,name' で取得する情報を限定し、API呼び出しの効率を上げる
        Drive.Files.get(folderId, { supportsAllDrives: true, fields: 'id,name' });
        Logger.log(`[${SCRIPT_NAME}] ${folderName} (${folderId}) にアクセスできました。`);
        return true;
      } catch (e) {
        Logger.log(`[${SCRIPT_NAME}] ${folderName} (${folderId}) へのアクセスに失敗しました: ${e.message}`);
        return false;
      }
    };

    // 対象フォルダのアクセス確認
    if (!checkFolderAccess(globalConfig.targetFolderId, "対象フォルダ")) {
      const errorMessage = `指定された対象フォルダID (${globalConfig.targetFolderId}) が無効か、アクセス権限がありません。処理を中断します。`;
      Logger.log(`[${SCRIPT_NAME}] 重大なエラー: ${errorMessage}`);
      sendErrorNotification_("OCR処理 - 対象フォルダアクセスエラー", errorMessage, globalConfig);
      return; // 処理を中断
    }
    // 移動先フォルダのアクセス確認
    if (!checkFolderAccess(globalConfig.destinationFolderId, "移動先フォルダ")) {
      const errorMessage = `指定された移動先フォルダID (${globalConfig.destinationFolderId}) が無効か、アクセス権限がありません。処理を中断します。`;
      Logger.log(`[${SCRIPT_NAME}] 重大なエラー: ${errorMessage}`);
      sendErrorNotification_("OCR処理 - 移動先フォルダアクセスエラー", errorMessage, globalConfig);
      return; // 処理を中断
    }
    // エラーフォルダが設定されていればアクセス確認
    if (globalConfig.errorFolderId && !checkFolderAccess(globalConfig.errorFolderId, "エラーフォルダ")) {
      const errorMessage = `指定されたエラーフォルダID (${globalConfig.errorFolderId}) が無効か、アクセス権限がありません。処理を中断します。`;
      Logger.log(`[${SCRIPT_NAME}] 重大なエラー: ${errorMessage}`);
      sendErrorNotification_("OCR処理 - エラーフォルダアクセスエラー", errorMessage, globalConfig);
      return; // 処理を中断
    }

    // --- 2. マスターデータ読み込み ---
    // OCR結果から情報を識別するために必要な各種マスターデータをスプレッドシートから読み込みます。
    Logger.log(`[${SCRIPT_NAME}] 各種マスターデータをスプレッドシートから読み込んでいます...`);
    const documentList = getDocumentNameList_(globalConfig); // 書類名と日付マーカーのリスト
    const customerList = getCustomerList_(globalConfig);    // 顧客名と同姓同名フラグのリスト
    const officeList = getOfficeList_(globalConfig);      // 事業所名のリスト
    Logger.log(`[${SCRIPT_NAME}] マスターデータ読み込み完了。書類マスター: ${documentList.length}件, 顧客マスター: ${customerList.length}件, 事業所マスター: ${officeList.length}件`);

    // マスターデータが空の場合の警告（処理は続行するが、識別の精度に影響が出る可能性があるため）
    if (documentList.length === 0) {
      Logger.log(`[${SCRIPT_NAME}] 警告: 書類マスターのデータが0件です。書類名の識別が正しく行われない可能性があります。`);
    }
    if (customerList.length === 0) {
      Logger.log(`[${SCRIPT_NAME}] 警告: 顧客マスターのデータが0件です。顧客名の識別が正しく行われない可能性があります。`);
    }

    // --- 3. ファイルごとの処理ループ ---
    // Drive.Files.list を使用して対象フォルダ内のファイル一覧を取得します。
    const listResponse = Drive.Files.list({
      q: `'${globalConfig.targetFolderId}' in parents and trashed = false`, // 検索クエリ: 指定フォルダ内かつゴミ箱にないファイル
      supportsAllDrives: true,                // 共有ドライブ内のアイテムも検索対象に含める
      includeItemsFromAllDrives: true,        // 共有ドライブのアイテムを含める (念のため両方指定)
      fields: 'files(id, name, mimeType, parents)', // 取得するファイル情報フィールドを限定 (ID, 名前, MIMEタイプ, 親フォルダ情報)
      pageSize: 1000                          // 一度に取得する最大ファイル数
    });

    const filesToProcess = listResponse.files; // 取得したファイルオブジェクトの配列
    // 処理対象ファイルがない場合はログを出力して終了
    if (!filesToProcess || filesToProcess.length === 0) {
      Logger.log(`[${SCRIPT_NAME}] 対象フォルダID "${globalConfig.targetFolderId}" に処理対象ファイルが見つかりませんでした。処理を終了します。`);
      return;
    }
    Logger.log(`[${SCRIPT_NAME}] 対象フォルダから ${filesToProcess.length} 件のファイルを取得しました。`);

    // 取得したファイルを一つずつ処理
    for (let index = 0; index < filesToProcess.length; index++) {
      const file = filesToProcess[index];
      const originalFileName = file.name;     // 元のファイル名
      const fileId = file.id;                 // ファイルID
      const mimeType = file.mimeType;         // MIMEタイプ
      // 現在の親フォルダIDを取得 (ファイルを移動する際に、元の親から削除するために使用)
      const currentParentFolderId = file.parents && file.parents.length > 0 ? file.parents[0] : null;

      // 進捗表示を追加
      Logger.log(`\n[${SCRIPT_NAME}] ========================================`);
      Logger.log(`[${SCRIPT_NAME}] 処理進捗: ${index + 1}/${filesToProcess.length} (${((index + 1) / filesToProcess.length * 100).toFixed(0)}%)`);
      Logger.log(`[${SCRIPT_NAME}] ファイル処理開始: "${originalFileName}" (ID: ${fileId}, MIME: ${mimeType})`);

      try { // --- 個別ファイル処理を囲む try-catch ブロック ---
        // このブロック内で発生したエラーは、このファイルの処理に限定され、他のファイルの処理は続行されます。

        // 3a. 処理対象ファイル形式かチェック (PDFまたは画像ファイルのみを対象)
        if (!mimeType.startsWith("image/") && mimeType !== "application/pdf") {
          Logger.log(`[${SCRIPT_NAME}] ファイル "${originalFileName}" は処理対象外のMIMEタイプ (${mimeType}) です。スキップします。`);
          skippedFileCount++; // スキップカウンター増加
          Logger.log(`[${SCRIPT_NAME}] [DEBUG] skippedFileCount増加: ${skippedFileCount - 1} → ${skippedFileCount}`);
          continue; // 次のファイルの処理へ
        }

        // 3b. OCR実行（新形式対応）
        Logger.log(`[${SCRIPT_NAME}] ファイル "${originalFileName}" (ID: ${fileId}) をCloud Functionに送信します...`);

        // 失敗追跡を有効化
        const ocrResponse = extractTextFromFileWithMinimalFailureTracking_(
          fileId,
          mimeType,
          globalConfig.geminiModel,
          globalConfig
        );

        // ★★★ 新形式レスポンスの検証 ★★★
        if (typeof ocrResponse === 'string' && ocrResponse.startsWith("エラー:")) {
          throw new Error(`OCR処理に失敗しました: ${ocrResponse}`);
        }

        if (!ocrResponse || !ocrResponse.success || !ocrResponse.ocrResults || !Array.isArray(ocrResponse.ocrResults)) {
          throw new Error(`OCR処理に失敗、またはCloud Functionから無効な応答がありました。レスポンス: ${JSON.stringify(ocrResponse).substring(0, 200)}`);
        }

        // 3c. 全ページから情報を収集して統一ファイル名を生成
        const fileInfo = ocrResponse.fileInfo;
        const ocrResults = ocrResponse.ocrResults;
        const totalPages = fileInfo.totalPages;

        // OCR結果受信成功のログ
        Logger.log(`[${SCRIPT_NAME}] Cloud Functionから応答を受信。ファイル: ${fileInfo.fileName}, 総ページ数: ${totalPages}, 受信ページ数: ${ocrResults.length}`);
        Logger.log(`[${SCRIPT_NAME}] 受信したOCR結果から情報を抽出します...`);

        let allCustomerEntries = []; // 全ページの顧客エントリを収集
        let documentNameForFile = STATUS_UNDETERMINED;
        let officeNameForFile = STATUS_UNDETERMINED;
        let fileDateForFile = "";

        // 全ページを先にスキャンして統合情報を収集
        for (let pageIndex = 0; pageIndex < ocrResults.length; pageIndex++) {
          const pageResult = ocrResults[pageIndex];
          const pageText = pageResult.text;

          const docMatchResult = getBestMatchingDocumentName_(pageText, documentList);
          const customerCandidates = getBestMatchingCustomerCandidates_(pageText, customerList);
          const officeNameResult = getBestMatchingOffice_(pageText, officeList);
          const fileDateResult = getDateFromOCR_(pageText, docMatchResult.dateMarker);

          // 統合情報を更新（最初に見つかった有効な情報を使用）
          if (documentNameForFile === STATUS_UNDETERMINED && docMatchResult.documentName !== STATUS_UNDETERMINED) {
            documentNameForFile = docMatchResult.documentName;
          }
          if (officeNameForFile === STATUS_UNDETERMINED && officeNameResult !== STATUS_UNDETERMINED) {
            officeNameForFile = officeNameResult;
          }
          if (!fileDateForFile && fileDateResult) {
            fileDateForFile = fileDateResult;
          }

          // 顧客エントリを収集（ページ番号も記録）
          customerCandidates.forEach(candidate => {
            allCustomerEntries.push({
              ...candidate,
              pageNumber: pageResult.pageNumber,
              docName: docMatchResult.documentName,
              officeName: officeNameResult,
              fileDate: fileDateResult
            });
          });
        }

        // ファイル全体で顧客が見つからない場合のみ「未登録顧客」を追加
        allCustomerEntries = ensureCustomerEntries_(allCustomerEntries);

        Logger.log(`[${SCRIPT_NAME}] 情報収集完了。総顧客エントリ数: ${allCustomerEntries.length}`);

        // ====================================================================
        // 3d. ファイル名生成（複数ページ・複数顧客対応）
        // ====================================================================
        Logger.log(`[${SCRIPT_NAME}] ファイル名生成を開始します...`);

        const newFileNameWithoutExt = generateOptimalFileName_({
          documentName: documentNameForFile,
          officeName: officeNameForFile,
          fileDate: fileDateForFile,
          customerEntries: allCustomerEntries,
          fileId: fileId
        });

        const originalExtension = originalFileName.includes('.') ? "." + originalFileName.split('.').pop().toLowerCase() : "";
        const newFileName = newFileNameWithoutExt + originalExtension;

        Logger.log(`[${SCRIPT_NAME}] ファイル名生成完了`);
        Logger.log(`[${SCRIPT_NAME}]   - 元ファイル名: "${originalFileName}"`);
        Logger.log(`[${SCRIPT_NAME}]   - 新ファイル名: "${newFileName}"`);

        // ファイルURLを生成（移動前でも有効なURL）
        const fileUrl = `https://drive.google.com/file/d/${fileId}/view`;
        Logger.log(`[${SCRIPT_NAME}]   - ファイルURL: ${fileUrl}`);
        Logger.log(`[${SCRIPT_NAME}]   - 注: このURLはフォルダ移動後も有効です（ファイルIDベースのため）`);

        // ====================================================================
        // 3e. ユニーク顧客ごとのログ記録（一括書き込み版）
        // 
        // 【設計方針】
        //   - ログ記録を先に実行（ファイル移動前）
        //   - SpreadsheetApp.openByIdは1回のみ
        //   - setValues()で一括書き込み（All or Nothing）
        //   - ログ成功を確認してからファイル移動
        // 
        // 【データ整合性保証】
        //   - ログ成功 = ファイルはdestinationFolder
        //   - ログ失敗 = ファイルはtargetFolder（自動再処理）
        //   - 中間状態なし
        // 
        // 【重複レコード防止】
        //   - All or Nothing方式により部分成功なし
        //   - 再処理時も同じ動作のため重複しない
        // ====================================================================
        Logger.log(`[${SCRIPT_NAME}] ユニーク顧客の抽出とログ記録を開始します...`);

        const uniqueCustomerMap = new Map();

        // 全顧客エントリからユニーク顧客を抽出し、最適なエントリを選択
        allCustomerEntries.forEach(entry => {
          const customerKey = entry.customerName;

          if (!uniqueCustomerMap.has(customerKey)) {
            uniqueCustomerMap.set(customerKey, entry);
            Logger.log(`[${SCRIPT_NAME}] 新規顧客を記録: "${customerKey}" (ページ${entry.pageNumber}, マッチ: ${entry.matchType})`);
          } else {
            const existingEntry = uniqueCustomerMap.get(customerKey);
            let shouldReplace = false;

            if (entry.matchType === 'exact' && existingEntry.matchType !== 'exact') {
              shouldReplace = true;
              Logger.log(`[${SCRIPT_NAME}] 顧客 "${customerKey}" を完全一致で更新 (ページ${entry.pageNumber})`);
            } else if (entry.matchType === existingEntry.matchType) {
              const currentScore = (entry.docName !== STATUS_UNDETERMINED ? 1 : 0) +
                (entry.officeName !== STATUS_UNDETERMINED ? 1 : 0) +
                (entry.fileDate ? 1 : 0);
              const existingScore = (existingEntry.docName !== STATUS_UNDETERMINED ? 1 : 0) +
                (existingEntry.officeName !== STATUS_UNDETERMINED ? 1 : 0) +
                (existingEntry.fileDate ? 1 : 0);

              if (currentScore > existingScore) {
                shouldReplace = true;
                Logger.log(`[${SCRIPT_NAME}] 顧客 "${customerKey}" をより詳細な情報で更新 (ページ${entry.pageNumber}, スコア: ${currentScore} > ${existingScore})`);
              }
            }

            if (shouldReplace) {
              uniqueCustomerMap.set(customerKey, entry);
            }
          }
        });

        Logger.log(`[${SCRIPT_NAME}] ユニーク顧客抽出完了。対象顧客数: ${uniqueCustomerMap.size}件`);

        // ====================================================================
        // ログデータ生成（スプレッドシート書き込み前に全顧客分を配列化）
        // ====================================================================
        Logger.log(`[${SCRIPT_NAME}] ログデータ生成を開始します...`);

        const allLogRows = [];
        let dataGenerationErrors = 0;

        for (const [customerName, bestEntry] of uniqueCustomerMap) {
          Logger.log(`[${SCRIPT_NAME}] 顧客 "${customerName}" のログデータ生成中...`);
          Logger.log(`[${SCRIPT_NAME}]   - 選択されたページ: ${bestEntry.pageNumber}/${totalPages}`);
          Logger.log(`[${SCRIPT_NAME}]   - マッチタイプ: ${bestEntry.matchType}`);

          try {
            // この顧客に関連する全候補を収集
            const relatedEntries = allCustomerEntries.filter(entry => entry.customerName === customerName);
            const allCandidatesText = relatedEntries.map(e =>
              `${e.customerName}(P${e.pageNumber}-${e.matchType === 'exact' ? '完全' : e.similarity.toFixed(0) + '%'})`
            ).join('; ');

            // 該当ページのOCRテキストを取得
            const targetPageResult = ocrResults.find(result => result.pageNumber === bestEntry.pageNumber);
            const pageText = targetPageResult ? targetPageResult.text : getSafeOCRText_(ocrResults, bestEntry.pageNumber);

            // ログ行データ生成
            const timestamp = new Date();
            const uuid = Utilities.getUuid();
            const transConfig = globalConfig.sheets.documentTransaction;
            const columnMapping = transConfig.columns;

            const newRowData = [];
            const sortedColumnKeys = Object.keys(columnMapping).sort((keyA, keyB) => {
              const colNumA = columnToNumber_(columnMapping[keyA]);
              const colNumB = columnToNumber_(columnMapping[keyB]);
              return colNumA - colNumB;
            });

            for (const key of sortedColumnKeys) {
              switch (key) {
                case 'id':
                  newRowData.push(uuid);
                  break;
                case 'processDate':
                  newRowData.push(timestamp);
                  break;
                case 'fileId':
                  newRowData.push(fileId);
                  break;
                case 'fileName':
                  newRowData.push(newFileName);
                  break;
                case 'mimeType':
                  newRowData.push(file.mimeType);
                  break;
                case 'ocrResult':
                  newRowData.push(pageText);
                  break;
                case 'documentName':
                  newRowData.push(bestEntry.docName);
                  break;
                case 'customerName':
                  newRowData.push(customerName);
                  break;
                case 'officeName':
                  newRowData.push(bestEntry.officeName);
                  break;
                case 'fileUrl':
                  newRowData.push(fileUrl);  // ファイルIDベースのURL（移動前でも有効）
                  break;
                case 'fileDate':
                  newRowData.push(bestEntry.fileDate);
                  break;
                case 'isDuplicateCustomerName':
                  newRowData.push(bestEntry.isDuplicate);
                  break;
                case 'allCustomerCandidates':
                  newRowData.push(allCandidatesText);
                  break;
                case 'totalPages':
                  newRowData.push(totalPages);
                  break;
                case 'targetPageNumber':
                  newRowData.push(bestEntry.pageNumber);
                  break;
                case 'pageText':
                  newRowData.push(pageText ? pageText.substring(0, 200) + (pageText.length > 200 ? "..." : "") : "");
                  break;
                default:
                  newRowData.push('');
              }
            }

            allLogRows.push(newRowData);
            Logger.log(`[${SCRIPT_NAME}] 顧客 "${customerName}" のログデータ生成完了`);

          } catch (dataError) {
            dataGenerationErrors++;
            Logger.log(`[${SCRIPT_NAME}] [ERROR] 顧客 "${customerName}" のログデータ生成中にエラー: ${dataError.message}`);
            Logger.log(`[${SCRIPT_NAME}]   - スタックトレース: ${dataError.stack || 'なし'}`);
            break; // データ生成失敗したら以降の顧客をスキップ
          }
        }

        Logger.log(`[${SCRIPT_NAME}] ログデータ生成完了。生成件数: ${allLogRows.length}/${uniqueCustomerMap.size}`);

        // ====================================================================
        // スプレッドシートへの一括書き込み（All or Nothing）
        // 
        // 【最重要】この処理の成否が全てを決定する
        //   - 成功: ファイル移動を実行 → 処理完了
        //   - 失敗: ファイルはtargetFolderに残る → 次回再処理
        // ====================================================================
        let allLogsSucceeded = false;

        if (dataGenerationErrors > 0) {
          Logger.log(`[${SCRIPT_NAME}] データ生成エラーが発生したため、スプレッドシート書き込みをスキップします`);
          Logger.log(`[${SCRIPT_NAME}]   - エラー発生顧客数: ${dataGenerationErrors}件`);
          allLogsSucceeded = false;

        } else if (allLogRows.length > 0) {
          try {
            Logger.log(`[${SCRIPT_NAME}] スプレッドシートへの一括書き込みを開始します...`);
            Logger.log(`[${SCRIPT_NAME}]   - 対象顧客数: ${allLogRows.length}件`);
            Logger.log(`[${SCRIPT_NAME}]   - 書き込み方式: setValues()による一括書き込み（All or Nothing）`);

            const transConfig = globalConfig.sheets.documentTransaction;
            const spreadsheet = SpreadsheetApp.openById(transConfig.spreadsheetId);
            const sheet = spreadsheet.getSheetByName(transConfig.sheetName);

            // ヘッダー行確認
            const headerRowNumber = transConfig.headerRow || LOG_SHEET_DEFAULT_HEADER_ROW;
            if (sheet.getMaxRows() === 0 || sheet.getLastRow() < headerRowNumber) {
              Logger.log(`[${SCRIPT_NAME}] ヘッダー行を作成します...`);

              const headerDisplayNames = {
                id: "ID", processDate: "処理日時", fileId: "ファイルID",
                fileName: "ファイル名", mimeType: "MIMEタイプ", ocrResult: "OCR結果",
                documentName: "書類名", customerName: "顧客名", officeName: "事業所名",
                fileUrl: "ファイルURL", fileDate: "日付", isDuplicateCustomerName: "同姓同名フラグ",
                allCustomerCandidates: "全顧客候補", totalPages: "総ページ数",
                targetPageNumber: "ページ番号", pageText: "ページテキスト"
              };

              const headers = Object.entries(transConfig.columns)
                .sort(([, columnLetterA], [, columnLetterB]) =>
                  columnToNumber_(columnLetterA) - columnToNumber_(columnLetterB))
                .map(([key]) => headerDisplayNames[key] || key);

              if (sheet.getMaxRows() === 0) {
                sheet.appendRow(headers);
              } else {
                if (sheet.getMaxRows() < headerRowNumber) {
                  sheet.insertRowsAfter(sheet.getMaxRows(), headerRowNumber - sheet.getMaxRows());
                }
                sheet.getRange(headerRowNumber, 1, 1, headers.length).setValues([headers]);
              }
              Logger.log(`[${SCRIPT_NAME}] ヘッダー行作成完了`);
            }

            // 一括書き込み実行
            const lastRow = sheet.getLastRow();
            sheet.getRange(lastRow + 1, 1, allLogRows.length, allLogRows[0].length)
              .setValues(allLogRows);

            allLogsSucceeded = true;
            Logger.log(`[${SCRIPT_NAME}] スプレッドシートへの一括書き込み成功（${allLogRows.length}行）`);
            Logger.log(`[${SCRIPT_NAME}]   - 書き込み先シート: "${transConfig.sheetName}"`);
            Logger.log(`[${SCRIPT_NAME}]   - 書き込み開始行: ${lastRow + 1}行目`);

          } catch (writeError) {
            allLogsSucceeded = false;
            logErrorCount++;

            Logger.log(`[${SCRIPT_NAME}] [ERROR] スプレッドシート書き込み中にエラーが発生しました`);
            Logger.log(`[${SCRIPT_NAME}]   - エラー内容: ${writeError.message}`);
            Logger.log(`[${SCRIPT_NAME}]   - スタックトレース: ${writeError.stack || 'なし'}`);
            Logger.log(`[${SCRIPT_NAME}]   - 考えられる原因: API制限、一時的接続エラー、権限問題`);
            Logger.log(`[${SCRIPT_NAME}] [DEBUG] logErrorCount増加: ${logErrorCount - 1} → ${logErrorCount}`);
          }
        } else {
          Logger.log(`[${SCRIPT_NAME}] 書き込むログデータが0件です`);
          Logger.log(`[${SCRIPT_NAME}]   - 考えられる原因: 全顧客がデータ生成段階で失敗`);
          allLogsSucceeded = false;
        }

        // ====================================================================
        // ログ記録失敗時の処理（ファイル移動をスキップ）
        // 
        // 【設計の核心部分】
        // 
        // 【動作】
        //   - ファイルはtargetFolderに残る（まだ移動していない）
        //   - 5分後のトリガー実行で自動再処理
        //   - 再処理時も一括書き込みのため重複レコードなし
        // 
        // 【保証】
        //   - ログなしファイル = targetFolderに確実に存在
        //   - 自動復旧の仕組みが確実に働く
        //   - 人手介入不要
        // ====================================================================
        if (!allLogsSucceeded) {
          Logger.log(`[${SCRIPT_NAME}] ログ記録失敗を検出しました`);
          Logger.log(`[${SCRIPT_NAME}] ファイル移動をスキップします`);
          Logger.log(`[${SCRIPT_NAME}]   - ファイル "${originalFileName}" は対象フォルダ(targetFolder)に残されます`);
          Logger.log(`[${SCRIPT_NAME}]   - 現在位置: targetFolder (${globalConfig.targetFolderId})`);
          Logger.log(`[${SCRIPT_NAME}]   - ファイルは移動されていません（ログ記録前のため）`);
          Logger.log(`[${SCRIPT_NAME}] 自動復旧の仕組み:`);
          Logger.log(`[${SCRIPT_NAME}]   - 次回実行予定: 約5分後（トリガー設定による）`);
          Logger.log(`[${SCRIPT_NAME}]   - 再処理動作: OCR処理から完全に再実行`);
          Logger.log(`[${SCRIPT_NAME}]   - 重複レコード: 発生しません（一括書き込み方式のため）`);
          Logger.log(`[${SCRIPT_NAME}] 設計の利点:`);
          Logger.log(`[${SCRIPT_NAME}]   - ファイルはtargetFolderに確実に残る`);
          Logger.log(`[${SCRIPT_NAME}]   - ログなしファイルが放置されることはない`);
          Logger.log(`[${SCRIPT_NAME}]   - データ不整合が発生しない`);
          Logger.log(`[${SCRIPT_NAME}]   - 人手介入が不要`);

          skippedFileCount++;
          Logger.log(`[${SCRIPT_NAME}] [DEBUG] skippedFileCount増加: ${skippedFileCount - 1} → ${skippedFileCount} (ログ失敗によるスキップ)`);

          continue; // 次のファイルへ
        }

        // ====================================================================
        // ログ記録成功後のファイル移動処理
        // 
        // 【このセクションは、ログ記録が成功した場合のみ実行される】
        // 
        // 【処理順序の保証】
        //   1. ログ記録成功確認済み
        //   2. スプレッドシートに全顧客分のレコードあり
        //   3. ここでファイル移動を実行
        // 
        // 【移動失敗時の対応】
        //   - ログは既に記録済み
        //   - ファイルはtargetFolderに残る
        //   - エラーフォルダへの移動を試行
        //   - 管理者に通知
        // ====================================================================
        Logger.log(`[${SCRIPT_NAME}] ログ記録成功を確認。ファイル移動処理を開始します...`);
        Logger.log(`[${SCRIPT_NAME}]   - 元ファイル名: "${originalFileName}"`);
        Logger.log(`[${SCRIPT_NAME}]   - 新ファイル名: "${newFileName}"`);
        Logger.log(`[${SCRIPT_NAME}]   - 移動元: targetFolder (${globalConfig.targetFolderId})`);
        Logger.log(`[${SCRIPT_NAME}]   - 移動先: destinationFolder (${globalConfig.destinationFolderId})`);

        const resourceForUpdate = {
          name: newFileName
        };
        const optionsForUpdate = {
          supportsAllDrives: true,
          addParents: globalConfig.destinationFolderId
        };
        if (currentParentFolderId) {
          optionsForUpdate.removeParents = currentParentFolderId;
        }

        try {
          Drive.Files.update(
            resourceForUpdate,
            fileId,
            null,
            optionsForUpdate
          );

          Logger.log(`[${SCRIPT_NAME}] ファイル移動完了`);
          Logger.log(`[${SCRIPT_NAME}]   - 新しい位置: destinationFolder`);
          Logger.log(`[${SCRIPT_NAME}]   - ファイルURL: ${fileUrl} (変更なし)`);

          processedFileCount++;
          Logger.log(`[${SCRIPT_NAME}] [DEBUG] processedFileCount増加: ${processedFileCount - 1} → ${processedFileCount} (ファイル処理完了)`);

        } catch (moveError) {
          Logger.log(`[${SCRIPT_NAME}] [ERROR] ファイル移動中にエラーが発生しました`);
          Logger.log(`[${SCRIPT_NAME}]   - エラー内容: ${moveError.message}`);
          Logger.log(`[${SCRIPT_NAME}]   - スタックトレース: ${moveError.stack || 'なし'}`);
          Logger.log(`[${SCRIPT_NAME}] 重要: ログは既に記録済みです`);
          Logger.log(`[${SCRIPT_NAME}]   - スプレッドシート: ${allLogRows.length}件のレコード記録済み`);
          Logger.log(`[${SCRIPT_NAME}]   - ファイル位置: targetFolder (移動失敗のため)`);
          Logger.log(`[${SCRIPT_NAME}] 対応方針:`);
          Logger.log(`[${SCRIPT_NAME}]   - ファイルをエラーフォルダに移動して管理者に通知`);
          Logger.log(`[${SCRIPT_NAME}]   - または、次回実行時に再度移動試行される`);

          // エラーフォルダへの移動を試行
          if (globalConfig.errorFolderId) {
            try {
              Drive.Files.update(
                { name: newFileName },
                fileId,
                null,
                {
                  supportsAllDrives: true,
                  addParents: globalConfig.errorFolderId,
                  removeParents: currentParentFolderId
                }
              );
              Logger.log(`[${SCRIPT_NAME}] エラーフォルダへの移動成功`);
            } catch (errorMoveError) {
              Logger.log(`[${SCRIPT_NAME}] エラーフォルダへの移動も失敗: ${errorMoveError.message}`);
            }
          }

          // 管理者に通知
          sendErrorNotification_(
            `ファイル移動失敗（ログ記録済み） - ${newFileName}`,
            `ログ記録は成功しましたが、ファイル移動に失敗しました。\n\n` +
            `ファイル情報:\n` +
            `- ファイル名: ${newFileName}\n` +
            `- ファイルID: ${fileId}\n` +
            `- ファイルURL: ${fileUrl}\n\n` +
            `現在の状態:\n` +
            `- スプレッドシート記録: 完了（${allLogRows.length}件のレコード）\n` +
            `- ファイル位置: targetFolder または errorFolder\n\n` +
            `移動失敗の原因:\n${moveError.message}\n\n` +
            `影響:\n` +
            `- データ整合性: 保たれています（ログは記録済み）\n` +
            `- ファイルアクセス: URLで直接アクセス可能\n` +
            `- 次回実行時: 再度移動試行されます\n\n` +
            `対応:\n` +
            `- 緊急対応不要（ログは既に記録済みのため）\n` +
            `- 必要に応じて手動でファイルをdestinationFolderに移動\n` +
            `- または次回実行を待つ`,
            globalConfig
          );

          errorFileCount++;
          Logger.log(`[${SCRIPT_NAME}] [DEBUG] errorFileCount増加: ${errorFileCount - 1} → ${errorFileCount} (ファイル移動失敗)`);

          continue; // 次のファイルへ
        }

        // デバッグ用：ユニーク顧客の一覧表示
        if (uniqueCustomerMap.size > 0) {
          Logger.log(`[${SCRIPT_NAME}] === ユニーク顧客一覧 ===`);
          let debugIndex = 1;
          for (const [customerName, entry] of uniqueCustomerMap) {
            Logger.log(`[${SCRIPT_NAME}] ${debugIndex}. "${customerName}" (ページ${entry.pageNumber}, ${entry.matchType}, 書類: ${entry.docName})`);
            debugIndex++;
          }
          Logger.log(`[${SCRIPT_NAME}] === ログ記録統計 ===`);
          Logger.log(`[${SCRIPT_NAME}] 総エントリ数: ${allCustomerEntries.length}件 → ユニーク顧客数: ${uniqueCustomerMap.size}件`);
          Logger.log(`[${SCRIPT_NAME}] 重複排除数: ${allCustomerEntries.length - uniqueCustomerMap.size}件`);
        }

        Logger.log(`[${SCRIPT_NAME}] ファイル "${newFileName}" の処理を正常に終了しました。`);
      } catch (e) { // --- 個別ファイル処理のエラーハンドリング ---
        // ファイル処理エラー（OCRや移動の失敗）
        Logger.log(`[${SCRIPT_NAME}] ファイル "${originalFileName}" (ID: ${fileId}) の処理中にエラーが発生しました。エラー: ${e.stack || e.message}`);
        errorFileCount++;
        Logger.log(`[${SCRIPT_NAME}] [DEBUG] errorFileCount増加: ${errorFileCount - 1} → ${errorFileCount} (ファイル処理エラー)`);

        // === ステップ1: エラー履歴Tへの記録（最優先） ===
        let recordingSucceeded = false;
        try {
          // OCR完全失敗かどうかを判定
          let errorType = ERROR_TYPES.FILE_OPERATION_ERROR; // デフォルト

          // エラーメッセージから種別を判定
          const errorMessage = e.message || e.toString();
          if (errorMessage.includes("OCR処理に失敗") || errorMessage.includes("Cloud Function")) {
            errorType = ERROR_TYPES.OCR_COMPLETE_FAILURE;
          } else if (errorMessage.includes("顧客") || errorMessage.includes("書類") || errorMessage.includes("事業所")) {
            errorType = ERROR_TYPES.EXTRACTION_ERROR;
          }

          recordGeneralError_({
            errorType: errorType,
            fileName: originalFileName,
            fileId: fileId,
            totalPages: undefined,
            successPages: undefined,
            failedPages: undefined,
            failedPageNumbers: "",
            errorDetails: errorMessage,
            fileUrl: `https://drive.google.com/file/d/${fileId}/view`
          });

          recordingSucceeded = true;
          Logger.log(`[${SCRIPT_NAME}] ✅ エラー履歴Tに記録しました: ${errorType}`);

        } catch (recordError) {
          recordingSucceeded = false;
          Logger.log(`[${SCRIPT_NAME}] ❌ エラー履歴記録に失敗しましたが、処理は続行します: ${recordError.message}`);

          // 記録失敗を管理者に通知（重要）
          try {
            sendErrorNotification_(
              "【重要】エラー履歴記録失敗",
              `ファイル処理エラーが発生しましたが、エラー履歴Tへの記録に失敗しました。\n\n` +
              `■ファイル情報:\n` +
              `- ファイル名: ${originalFileName}\n` +
              `- ファイルID: ${fileId}\n` +
              `- ファイルURL: https://drive.google.com/file/d/${fileId}/view\n\n` +
              `■元のエラー:\n${e.message || e.toString()}\n\n` +
              `■記録失敗理由:\n${recordError.message}\n\n` +
              `⚠️ このファイルはエラーフォルダに移動されない可能性があります。\n` +
              `手動でのフォローアップが必要です。`,
              globalConfig
            );
          } catch (mailError) {
            Logger.log(`[${SCRIPT_NAME}] エラー通知メール送信も失敗: ${mailError.message}`);
          }
        }

        // === ステップ2: エラーフォルダへの移動（記録状況に応じて） ===
        if (globalConfig.errorFolderId) {
          if (recordingSucceeded) {
            // 記録成功時のみ移動
            try {
              const resourceForErrorMove = {};
              const optionsForErrorMove = {
                supportsAllDrives: true,
                addParents: globalConfig.errorFolderId
              };
              if (currentParentFolderId) {
                optionsForErrorMove.removeParents = currentParentFolderId;
              }

              Drive.Files.update(
                resourceForErrorMove,
                fileId,
                null,
                optionsForErrorMove
              );
              Logger.log(`[${SCRIPT_NAME}] ✅ エラー発生のため、ファイル "${originalFileName}" をエラーフォルダID "${globalConfig.errorFolderId}" に移動しました。`);

            } catch (moveError) {
              Logger.log(`[${SCRIPT_NAME}] ❌ エラーファイルの移動に失敗しました。ファイル: "${originalFileName}", 移動先エラーフォルダID: "${globalConfig.errorFolderId}", エラー: ${moveError.stack || moveError.message}`);

              // 移動失敗も通知
              sendErrorNotification_(
                "エラーファイル移動失敗",
                `エラー履歴には記録されましたが、ファイルの移動に失敗しました。\n\n` +
                `ファイル: ${originalFileName}\n` +
                `ファイルID: ${fileId}\n` +
                `エラー: ${moveError.message}`,
                globalConfig
              );
            }
          } else {
            // 記録失敗時は移動しない（重要なポリシー決定）
            Logger.log(`[${SCRIPT_NAME}] ⚠️ エラー履歴記録が失敗したため、ファイル "${originalFileName}" は元のフォルダに残します（トレーサビリティ確保のため）。`);
            Logger.log(`[${SCRIPT_NAME}] 💡 対応方法: エラー履歴Tスプレッドシートの設定を確認後、手動でファイルを移動してください。`);
          }
        }

        // === ステップ3: 元のエラー内容をメール通知 ===
        const errorSubject = `OCR処理エラー - ファイル: ${originalFileName}`;

        // ocrResponse変数の安全な参照
        let ocrResultText = "OCR結果取得失敗または該当なし";
        try {
          if (typeof ocrResponse !== 'undefined' && ocrResponse && ocrResponse.ocrResults && Array.isArray(ocrResponse.ocrResults)) {
            ocrResultText = ocrResponse.ocrResults.map(p => p.text).join(' ').substring(0, 200) + "...";
          } else if (typeof ocrResponse !== 'undefined' && typeof ocrResponse === 'string') {
            ocrResultText = ocrResponse.substring(0, 200) + (ocrResponse.length > 200 ? "..." : "");
          }
        } catch (ocrError) {
          ocrResultText = "OCR結果参照エラー";
        }

        const errorBody = `ファイル "${originalFileName}" (ID: ${fileId}) の処理中にエラーが発生しました。\n\n` +
          `■エラー履歴記録: ${recordingSucceeded ? '✅ 成功' : '❌ 失敗'}\n` +
          `■エラーフォルダ移動: ${recordingSucceeded ? (globalConfig.errorFolderId ? '実行済み' : '設定なし') : 'スキップ（記録失敗のため）'}\n\n` +
          `OCR結果(先頭200文字):\n${ocrResultText}\n\n` +
          `エラー詳細:\n${e.stack || e.message}`;

        sendErrorNotification_(errorSubject, errorBody, globalConfig);
        Logger.log(`[${SCRIPT_NAME}] ファイル "${originalFileName}" の処理をエラー終了しました。`);
      }
    } // --- for (const file of filesToProcess) ループの終了 ---

    // --- 4. 全体処理完了のログとサマリー通知 ---
    Logger.log(`[${SCRIPT_NAME}] ========================================`);
    Logger.log(`[${SCRIPT_NAME}] 全てのファイルの処理が完了しました。`);
    Logger.log(`[${SCRIPT_NAME}] === 詳細処理統計 ===`);
    Logger.log(`  - 処理対象ファイル数: ${filesToProcess.length}件`);
    Logger.log(`  - ファイル処理成功数: ${processedFileCount}件`);
    Logger.log(`  - ファイル処理失敗数: ${errorFileCount}件`);
    Logger.log(`  - ログ記録失敗数: ${logErrorCount}件`);
    Logger.log(`  - スキップファイル数: ${skippedFileCount}件`);
    Logger.log(`  - 統計合計確認: ${processedFileCount + errorFileCount + skippedFileCount} = ${filesToProcess.length} ${processedFileCount + errorFileCount + skippedFileCount === filesToProcess.length ? '✓' : '✗'}`);

    if (filesToProcess.length > 0) {
      const successRate = (processedFileCount / filesToProcess.length * 100).toFixed(1);
      Logger.log(`  - 処理成功率: ${successRate}%`);
    }
    Logger.log(`[${SCRIPT_NAME}] ========================================`);

    // エラー通知条件の改善
    if (errorFileCount > 0) {
      // ファイル処理エラーのみ通知
      sendErrorNotification_("OCR処理バッチ完了 (一部エラーあり)",
        `OCR処理バッチが完了しましたが、${errorFileCount}件のファイルでエラーが発生しました。\n` +
        `処理成功: ${processedFileCount}件, 処理失敗: ${errorFileCount}件, スキップ: ${skippedFileCount}件\n` +
        `詳細はGoogle Apps Scriptのログを確認してください。`, globalConfig);
    } else if (logErrorCount > 0) {
      // ログ記録エラーは別途通知（重要度低）
      sendErrorNotification_("OCR処理バッチ完了 (ログ記録エラーあり)",
        `OCR処理バッチが完了しました。ファイル処理は全て成功しましたが、${logErrorCount}件のログ記録でエラーが発生しました。\n` +
        `処理成功: ${processedFileCount}件, ログエラー: ${logErrorCount}件, スキップ: ${skippedFileCount}件\n` +
        `ファイル処理自体は正常に完了しており、業務への影響はありません。`, globalConfig);
    } else if (processedFileCount > 0) {
      Logger.log(`[${SCRIPT_NAME}] エラーなく処理が完了しました。`);
    } else {
      Logger.log(`[${SCRIPT_NAME}] 今回の実行では、実際に処理されたファイルはありませんでした（対象なし、または全てスキップ）。`);
    }

  } catch (error) {
    const criticalErrorMessage = `スクリプトの実行中に予期せぬ重大なエラーが発生しました。\nエラー詳細:\n${error.stack || error.message}`;
    Logger.log(`[${SCRIPT_NAME}] 重大な実行時エラー: ${criticalErrorMessage}`);
    sendErrorNotification_("OCR処理 - 重大エラー発生", criticalErrorMessage, globalConfig);
  }
  Logger.log(`[${SCRIPT_NAME}] OCR処理バッチを終了します。`);
}

// 初期化処理を関数として分離
function initializeSystemCredentials() {
  try {
    Logger.log("=== システム認証情報の初期化開始 ===");

    SA_CREDENTIALS = initializeSecureCredentials_();

    if (SA_CREDENTIALS === null) {
      throw new Error("認証情報の初期化に失敗しました");
    }

    // 認証情報の基本検証
    if (!SA_CREDENTIALS.private_key || !SA_CREDENTIALS.client_email || !SA_CREDENTIALS.project_id) {
      throw new Error("認証情報の内容が不完全です");
    }

    Logger.log(`✅ システム認証情報の初期化成功: ${SA_CREDENTIALS.project_id}`);
    SYSTEM_INITIALIZED = true;
    INITIALIZATION_ERROR = null;
    return true;

  } catch (error) {
    SYSTEM_INITIALIZED = false;
    INITIALIZATION_ERROR = error;

    Logger.log(`❌ システム認証情報の初期化失敗: ${error.message}`);
    Logger.log(`詳細: ${error.stack || error.toString()}`);

    // エラー通知を試行（configが利用可能な場合）
    try {
      if (typeof config !== 'undefined' && config.errorNotificationEmails) {
        MailApp.sendEmail(
          config.errorNotificationEmails,
          "【緊急】システム初期化エラー",
          `認証情報の初期化に失敗しました。\n\nエラー: ${error.message}\n\n` +
          `対応方法:\n` +
          `1. Secret Managerの設定を確認\n` +
          `2. スクリプトプロパティ 'SA_CREDENTIALS_JSON' を確認\n` +
          `3. サービスアカウントの権限を確認`
        );
      }
    } catch (mailError) {
      Logger.log(`通知メール送信も失敗: ${mailError.message}`);
    }

    return false;
  }
}

/**
 * OCR結果から安全にテキストを取得する
 * 
 * Cloud FunctionからのOCR結果が空配列の場合でも安全にテキストを取得し、
 * TypeError の発生を防いで「書類管理T」への記録を継続させる。
 * 
 * @param {Array<Object>} ocrResults OCR結果配列 [{pageNumber, text}, ...]
 * @param {number} [preferredPageNumber=1] 優先取得ページ番号
 * @returns {string} OCRテキスト（取得失敗時は説明メッセージ）
 * 
 * @example
 * // 正常時: const text = getSafeOCRText_(ocrResults, 1);
 * // 空配列時: "OCR結果が空のため、テキストを取得できませんでした。"
 * 
 * @since 2025-01-01 TypeError対策として追加
 */
function getSafeOCRText_(ocrResults, preferredPageNumber = 1) {
  const SCRIPT_NAME = "getSafeOCRText_"; // ログ出力用の関数名

  try {
    Logger.log(`[${SCRIPT_NAME}] OCRテキストの安全取得を開始。優先ページ: ${preferredPageNumber}`);

    // --- Step 1: 基本的な入力検証 ---
    if (!Array.isArray(ocrResults)) {
      const errorMessage = "ocrResults が配列ではありません";
      Logger.log(`[${SCRIPT_NAME}] ❌ 入力検証エラー: ${errorMessage} (型: ${typeof ocrResults})`);
      return `入力エラー: ${errorMessage}`;
    }

    if (ocrResults.length === 0) {
      const errorMessage = "OCR結果が空のため、テキストを取得できませんでした。";
      Logger.log(`[${SCRIPT_NAME}] ⚠️ 空配列検出: ${errorMessage}`);
      Logger.log(`[${SCRIPT_NAME}] 💡 原因候補: Cloud FunctionでNO_TEXT_ERROR、白紙ページ、OCR処理失敗等`);
      return errorMessage;
    }

    Logger.log(`[${SCRIPT_NAME}] 📊 OCR結果概要: ${ocrResults.length}ページ分のデータを受信`);

    // --- Step 2: 優先ページの検索 ---
    Logger.log(`[${SCRIPT_NAME}] 🎯 優先ページ ${preferredPageNumber} を検索中...`);
    const preferredPage = ocrResults.find(result =>
      result &&
      result.pageNumber === preferredPageNumber &&
      result.text &&
      typeof result.text === 'string' &&
      result.text.trim().length > 0
    );

    if (preferredPage) {
      const textLength = preferredPage.text.length;
      Logger.log(`[${SCRIPT_NAME}] ✅ 優先ページ ${preferredPageNumber} から取得成功 (${textLength}文字)`);
      Logger.log(`[${SCRIPT_NAME}] 📄 テキスト先頭50文字: "${preferredPage.text.substring(0, 50)}${textLength > 50 ? '...' : ''}"`);
      return preferredPage.text;
    }

    Logger.log(`[${SCRIPT_NAME}] ⚠️ 優先ページ ${preferredPageNumber} にテキストが見つかりませんでした`);

    // --- Step 3: 最初の有効ページの検索 ---
    Logger.log(`[${SCRIPT_NAME}] 🔍 最初の有効ページを検索中...`);

    // 有効なページの候補を収集
    const validCandidates = [];
    ocrResults.forEach((result, index) => {
      if (result && result.text && typeof result.text === 'string') {
        const trimmedText = result.text.trim();
        if (trimmedText.length > 0) {
          validCandidates.push({
            pageNumber: result.pageNumber || index + 1,
            textLength: trimmedText.length,
            result: result
          });
        } else {
          Logger.log(`[${SCRIPT_NAME}] ⚠️ ページ ${result.pageNumber || index + 1}: テキストが空白のみ`);
        }
      } else {
        Logger.log(`[${SCRIPT_NAME}] ❌ ページ ${result?.pageNumber || index + 1}: 無効なテキスト (型: ${typeof result?.text})`);
      }
    });

    if (validCandidates.length > 0) {
      // 最初の有効候補を選択
      const firstValid = validCandidates[0];
      Logger.log(`[${SCRIPT_NAME}] ✅ 最初の有効ページ ${firstValid.pageNumber} から取得 (${firstValid.textLength}文字)`);
      Logger.log(`[${SCRIPT_NAME}] 📊 有効ページ統計: ${validCandidates.length}/${ocrResults.length}ページが有効`);
      Logger.log(`[${SCRIPT_NAME}] 📄 取得テキスト先頭50文字: "${firstValid.result.text.substring(0, 50)}${firstValid.textLength > 50 ? '...' : ''}"`);

      return firstValid.result.text;
    }

    // --- Step 4: 全ページ無効の場合 ---
    const errorMessage = `OCR処理は実行されましたが、${ocrResults.length}ページ全てでテキスト抽出に失敗しました。`;
    Logger.log(`[${SCRIPT_NAME}] ❌ 全ページ無効: ${errorMessage}`);

    // デバッグ情報の出力
    Logger.log(`[${SCRIPT_NAME}] 🔍 デバッグ情報: 各ページの状況`);
    ocrResults.forEach((result, index) => {
      const pageNum = result?.pageNumber || index + 1;
      const hasResult = !!result;
      const hasText = result?.text !== undefined;
      const textType = typeof result?.text;
      const textLength = result?.text?.length || 0;

      Logger.log(`[${SCRIPT_NAME}]   - ページ${pageNum}: result=${hasResult}, text=${hasText}(${textType}), length=${textLength}`);
    });

    Logger.log(`[${SCRIPT_NAME}] 💡 対応方法: 元ファイルの品質確認、手動処理検討、Cloud Function ログ確認`);

    return errorMessage;

  } catch (error) {
    // エラーハンドリング：既存スクリプトの流れに合わせた詳細ログ
    const errorMessage = `getSafeOCRText_関数内でエラーが発生しました: ${error.message}`;
    Logger.log(`[${SCRIPT_NAME}] ❌ 予期しないエラー: ${errorMessage}`);
    Logger.log(`[${SCRIPT_NAME}] 📋 エラー詳細:`);
    Logger.log(`[${SCRIPT_NAME}]   - エラータイプ: ${error.name}`);
    Logger.log(`[${SCRIPT_NAME}]   - エラーメッセージ: ${error.message}`);
    Logger.log(`[${SCRIPT_NAME}]   - スタックトレース: ${error.stack || 'スタックトレースなし'}`);
    Logger.log(`[${SCRIPT_NAME}]   - 入力データ型: ${typeof ocrResults}`);
    Logger.log(`[${SCRIPT_NAME}]   - 入力データ長: ${Array.isArray(ocrResults) ? ocrResults.length : 'N/A'}`);
    Logger.log(`[${SCRIPT_NAME}]   - 優先ページ番号: ${preferredPageNumber}`);

    // フォールバック処理：エラーが発生しても安全な文字列を返す
    const fallbackMessage = `テキスト取得処理中にエラーが発生しました (${error.name}: ${error.message})`;
    Logger.log(`[${SCRIPT_NAME}] 🔄 フォールバック: 安全な文字列を返却 - "${fallbackMessage}"`);

    return fallbackMessage;
  }
}

// 共通の事前チェック関数
function checkSystemReady(functionName) {
  if (!SYSTEM_INITIALIZED) {
    const errorMsg = `[${functionName}] システムが初期化されていません。`;
    Logger.log(`❌ ${errorMsg}`);

    if (INITIALIZATION_ERROR) {
      Logger.log(`初期化エラー詳細: ${INITIALIZATION_ERROR.message}`);
    }

    // 再初期化を試行（1回のみ）
    Logger.log(`[${functionName}] 再初期化を試行します...`);
    if (!initializeSystemCredentials()) {
      Logger.log(`[${functionName}] 再初期化も失敗しました。処理を中断します。`);

      // エラー情報を含む例外をスロー
      throw new Error(
        `システム初期化エラー: ${INITIALIZATION_ERROR ? INITIALIZATION_ERROR.message : '不明なエラー'}`
      );
    }

    Logger.log(`[${functionName}] 再初期化成功。処理を続行します。`);
  }

  // Cloud Function URLの確認
  if (!CLOUD_FUNCTION_INVOCATION_URL || CLOUD_FUNCTION_INVOCATION_URL.trim() === '') {
    throw new Error("Cloud Function URLが設定されていません");
  }

  return true;
}

/**
 * Secret Manager からサービスアカウント認証情報を取得
 */
function getServiceAccountCredentialsFromSecretManager_() {
  const SCRIPT_NAME = "getServiceAccountCredentialsFromSecretManager_";

  try {
    const url = `https://secretmanager.googleapis.com/v1/projects/${SECRET_MANAGER_CONFIG.projectId}` +
      `/secrets/${SECRET_MANAGER_CONFIG.secretId}/versions/${SECRET_MANAGER_CONFIG.versionId}:access`;

    const resp = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });

    if (resp.getResponseCode() !== 200) {
      throw new Error(`Secret Manager アクセス失敗 (${resp.getResponseCode()}): ${resp.getContentText()}`);
    }

    // Base64でエンコードされたデータをデコード
    const payload = JSON.parse(resp.getContentText()).payload.data;
    const jsonStr = Utilities.newBlob(Utilities.base64Decode(payload)).getDataAsString();
    const credentials = JSON.parse(jsonStr);

    Logger.log(`[${SCRIPT_NAME}] Secret Managerから認証情報を取得成功: ${credentials.client_email}`);
    return credentials;

  } catch (error) {
    Logger.log(`[${SCRIPT_NAME}] Secret Manager取得エラー: ${error.message}`);
    throw error;
  }
}

/**
 * Cloud Function (Google Cloud Functions) にファイルIDを送信してOCR結果を取得します。
 * この関数は、指定されたCloud Functionエンドポイントに対してPOSTリクエストを送信し、
 * Gemini 2.0 Flash APIによるページ毎のテキスト抽出を実行します。
 * サービスアカウントの認証情報を使用してIDトークンを取得し、認証を行います。
 *
 * ★更新: 新しいレスポンス形式（ページ毎構造化データ）に対応しました。
 * Cloud Functionからの戻り値は以下の構造になります：
 * {
 *   "success": true,
 *   "fileInfo": { "fileName": "document.pdf", "totalPages": 3 },
 *   "ocrResults": [
 *     { "pageNumber": 1, "text": "ページ1のテキスト...", "model": "gemini-2.0-flash-001" },
 *     { "pageNumber": 2, "text": "ページ2のテキスト...", "model": "gemini-2.0-flash-001" },
 *     { "pageNumber": 3, "text": "ページ3のテキスト...", "model": "gemini-2.0-flash-001" }
 *   ],
 *   "processingInfo": { "totalPages": 3, "successfulPages": 3, "failedPages": 0 }
 * }
 *
 * @param {string} fileId Google DriveのファイルID（Base64データではなくファイルIDを直接送信）。
 * @param {string} fileMimeType ファイルのMIMEタイプ (例: "image/jpeg", "application/pdf")。
 * @param {string} geminiModel OCR処理に使用するGeminiモデル名 (例: "gemini-2.0-flash-001")。
 * @returns {Object|string} 成功時: OCR結果の構造化オブジェクト（上記形式）、失敗時: "エラー:" で始まるエラーメッセージ文字列
 */
function extractTextFromFile_(fileId, fileMimeType, geminiModel) {
  const SCRIPT_NAME = "extractTextFromFile_"; // ログ出力用の関数名

  // --- 事前チェック: システム初期化状態の確認 ---
  if (!SYSTEM_INITIALIZED || !SA_CREDENTIALS) {
    const errorMessage = "システムが正しく初期化されていません。サービスアカウント認証情報が利用できません。";
    Logger.log(`[${SCRIPT_NAME}] ❌ システム初期化エラー: ${errorMessage}`);
    return `エラー: ${errorMessage}`;
  }

  // --- 事前チェック: 必須パラメータの検証 ---
  if (!fileId || typeof fileId !== 'string' || fileId.trim() === '') {
    const errorMessage = "fileId パラメータが無効です。有効なGoogle DriveファイルIDを指定してください。";
    Logger.log(`[${SCRIPT_NAME}] ❌ パラメータエラー: ${errorMessage}`);
    return `エラー: ${errorMessage}`;
  }

  if (!geminiModel || typeof geminiModel !== 'string' || geminiModel.trim() === '') {
    const errorMessage = "geminiModel パラメータが無効です。有効なGeminiモデル名を指定してください。";
    Logger.log(`[${SCRIPT_NAME}] ❌ パラメータエラー: ${errorMessage}`);
    return `エラー: ${errorMessage}`;
  }

  // --- 事前チェック: Cloud FunctionエンドポイントURL ---
  const endpoint = CLOUD_FUNCTION_INVOCATION_URL;
  if (!endpoint) {
    const errorMessage = `Cloud FunctionのエンドポイントURL (CLOUD_FUNCTION_INVOCATION_URL) が設定されていません。`;
    Logger.log(`[${SCRIPT_NAME}] ❌ 設定エラー: ${errorMessage}`);
    return `エラー: ${errorMessage}`;
  }

  // --- リクエストペイロードの構築 ---
  // ★★★ 新形式: Google Drive ファイルID方式のペイロード ★★★
  const payloadObj = {
    fileId: fileId.trim(),           // Google DriveのファイルID（前後の空白を除去）
    model: geminiModel.trim()        // Gemini 2.0 Flash モデル名（前後の空白を除去）
  };
  const payload = JSON.stringify(payloadObj); // ペイロードをJSON文字列に変換

  Logger.log(`[${SCRIPT_NAME}] ▶ Cloud FunctionへのOCR処理要求を準備:`);
  Logger.log(`  - エンドポイント: ${endpoint}`);
  Logger.log(`  - 送信ファイルID: ${fileId}`);
  Logger.log(`  - ファイルMIMEタイプ: ${fileMimeType}`);
  Logger.log(`  - 要求Geminiモデル: ${geminiModel}`);
  Logger.log(`  - 処理内容: Cloud Function側でファイル取得→OCR実行→結果返却`);

  // --- IDトークンの取得 ---
  let idToken;
  try {
    Logger.log(`[${SCRIPT_NAME}] Cloud Function認証用のIDトークンを取得中...`);
    idToken = getIdTokenForCloudFunction_();
    if (!idToken) {
      // getIdTokenForCloudFunction_ 内で詳細なエラーログが出力されているはず
      throw new Error("IDトークンの取得に失敗しました。getIdTokenForCloudFunction_() の詳細ログを確認してください。");
    }
    Logger.log(`[${SCRIPT_NAME}] ✅ IDトークンの取得に成功しました。`);
  } catch (e) {
    const errorMessage = `Cloud Function認証用のIDトークン取得に失敗しました: ${e.message || e.toString()}`;
    Logger.log(`[${SCRIPT_NAME}] ❌ IDトークン取得エラー: ${errorMessage}`);
    Logger.log(`[${SCRIPT_NAME}] エラー詳細: ${e.stack || "スタックトレースなし"}`);
    return `エラー: ${errorMessage}`;
  }

  // --- HTTPリクエストオプションの設定 ---
  const fetchOptions = {
    method: 'post',                     // HTTPメソッド: POST
    contentType: 'application/json',    // コンテンツタイプ: JSON
    payload: payload,                   // 送信するJSONペイロード
    muteHttpExceptions: true,           // HTTPエラー時に例外をスローせず、応答オブジェクトを返す
    headers: {
      'Authorization': 'Bearer ' + idToken, // IDトークンをBearerトークンとしてAuthorizationヘッダーに設定
      'User-Agent': 'Google-Apps-Script-OCR-Client/1.0', // 独自のUser-Agentヘッダー（任意）
      'X-Request-Source': 'GAS-OCR-System' // カスタムヘッダー（ログ解析用、任意）
    }
  };

  // --- Cloud FunctionへのHTTPリクエスト送信 ---
  let response;
  try {
    Logger.log(`[${SCRIPT_NAME}] ▶ Cloud FunctionにHTTPリクエストを送信中...`);
    const startTime = new Date().getTime(); // パフォーマンス測定用

    response = UrlFetchApp.fetch(endpoint, fetchOptions);

    const endTime = new Date().getTime();
    const elapsedTime = endTime - startTime;
    Logger.log(`[${SCRIPT_NAME}] ◀ HTTPリクエスト完了。所要時間: ${elapsedTime}ms`);

  } catch (e) {
    // ネットワークエラーなど、fetch自体が失敗した場合の処理
    const errorMessage = `Cloud Functionへのアクセス中にエラーが発生しました`;
    Logger.log(`[${SCRIPT_NAME}] ❌ ${errorMessage}`);
    Logger.log(`[${SCRIPT_NAME}] エラー詳細: ${e.message || e.toString()}`);
    Logger.log(`[${SCRIPT_NAME}] エラータイプ: ${e.name || '不明'}`);
    Logger.log(`[${SCRIPT_NAME}] スタックトレース: ${e.stack || 'なし'}`);
    return `エラー: ${errorMessage}: ${e.message || e.toString()}`;
  }

  // --- HTTPレスポンスの解析 ---
  const responseCode = response.getResponseCode();
  const responseBody = response.getContentText();
  const responseHeaders = response.getAllHeaders(); // デバッグ用（必要に応じて）

  Logger.log(`[${SCRIPT_NAME}] ◀ HTTPレスポンス受信:`);
  Logger.log(`  - ステータスコード: ${responseCode}`);
  Logger.log(`  - Content-Type: ${responseHeaders['Content-Type'] || 'N/A'}`);
  Logger.log(`  - レスポンスサイズ: ${responseBody.length} bytes`);

  // レスポンスボディが長大な場合を考慮し、ログには先頭部分のみを出力
  const truncatedBodyForLog = responseBody.length > 500
    ? responseBody.substring(0, 500) + `... (残り${responseBody.length - 500}文字省略)`
    : responseBody;
  Logger.log(`[${SCRIPT_NAME}] ◀ レスポンスボディ (先頭500文字): ${truncatedBodyForLog}`);

  // --- HTTPエラーステータスの処理 ---
  if (responseCode !== 200) {
    const errorMessage = `Cloud Functionからエラーステータス ${responseCode} が返されました。`;
    Logger.log(`[${SCRIPT_NAME}] ❌ HTTPエラー: ${errorMessage}`);

    // エラー時はより多くのレスポンス情報をログに出力
    const errorBodyForLog = responseBody.length > 1000
      ? responseBody.substring(0, 1000) + `... (残り${responseBody.length - 1000}文字省略)`
      : responseBody;
    Logger.log(`[${SCRIPT_NAME}] エラーレスポンス詳細 (先頭1000文字): ${errorBodyForLog}`);

    return `エラー: ${errorMessage} レスポンス: ${responseBody.substring(0, 200)}`;
  }

  // --- JSONレスポンスのパースと検証 ---
  let parsedResponse;
  try {
    Logger.log(`[${SCRIPT_NAME}] レスポンスJSONの解析中...`);
    parsedResponse = JSON.parse(responseBody);
    Logger.log(`[${SCRIPT_NAME}] ✅ JSON解析成功。`);

  } catch (e) {
    // JSONパース中にエラーが発生した場合
    const errorMessage = `Cloud Functionの応答JSONのパースに失敗しました: ${e.message || e.toString()}`;
    Logger.log(`[${SCRIPT_NAME}] ❌ JSON解析エラー: ${errorMessage}`);

    // パース失敗時のレスポンス内容をより詳細にログ出力
    const parseErrorBodyForLog = responseBody.length > 1000
      ? responseBody.substring(0, 1000) + "... (以下省略)"
      : responseBody;
    Logger.log(`[${SCRIPT_NAME}] JSON解析失敗レスポンス内容: ${parseErrorBodyForLog}`);

    return `エラー: ${errorMessage}`;
  }

  // --- 新形式レスポンス構造の検証 ---
  Logger.log(`[${SCRIPT_NAME}] レスポンス形式の検証中...`);

  // 必須プロパティの存在チェック
  if (!parsedResponse.hasOwnProperty('success')) {
    const errorMessage = "Cloud Functionの応答に 'success' プロパティがありません。";
    Logger.log(`[${SCRIPT_NAME}] ❌ レスポンス構造エラー: ${errorMessage}`);
    Logger.log(`[${SCRIPT_NAME}] 受信したプロパティ: ${Object.keys(parsedResponse).join(', ')}`);
    return `エラー: ${errorMessage}`;
  }

  if (!parsedResponse.success) {
    const errorMessage = `Cloud Functionから処理失敗の応答がありました。success: ${parsedResponse.success}`;
    const errorDetail = parsedResponse.error || parsedResponse.message || "詳細不明";
    Logger.log(`[${SCRIPT_NAME}] ❌ Cloud Function処理失敗: ${errorMessage}`);
    Logger.log(`[${SCRIPT_NAME}] エラー詳細: ${errorDetail}`);
    return `エラー: ${errorMessage} 詳細: ${errorDetail}`;
  }

  // 成功レスポンスの詳細検証
  if (!parsedResponse.ocrResults || !Array.isArray(parsedResponse.ocrResults)) {
    const errorMessage = "Cloud Functionの応答に有効な 'ocrResults' 配列がありません。";
    Logger.log(`[${SCRIPT_NAME}] ❌ レスポンス構造エラー: ${errorMessage}`);
    Logger.log(`[${SCRIPT_NAME}] ocrResults の型: ${typeof parsedResponse.ocrResults}`);
    return `エラー: ${errorMessage}`;
  }

  if (!parsedResponse.fileInfo || typeof parsedResponse.fileInfo !== 'object') {
    const errorMessage = "Cloud Functionの応答に有効な 'fileInfo' オブジェクトがありません。";
    Logger.log(`[${SCRIPT_NAME}] ❌ レスポンス構造エラー: ${errorMessage}`);
    Logger.log(`[${SCRIPT_NAME}] fileInfo の型: ${typeof parsedResponse.fileInfo}`);
    return `エラー: ${errorMessage}`;
  }

  if (!parsedResponse.processingInfo || typeof parsedResponse.processingInfo !== 'object') {
    const errorMessage = "Cloud Functionの応答に有効な 'processingInfo' オブジェクトがありません。";
    Logger.log(`[${SCRIPT_NAME}] ❌ レスポンス構造エラー: ${errorMessage}`);
    Logger.log(`[${SCRIPT_NAME}] processingInfo の型: ${typeof parsedResponse.processingInfo}`);
    return `エラー: ${errorMessage}`;
  }

  // --- OCR結果の詳細検証とログ出力 ---
  const fileInfo = parsedResponse.fileInfo;
  const ocrResults = parsedResponse.ocrResults;
  const processingInfo = parsedResponse.processingInfo;

  Logger.log(`[${SCRIPT_NAME}] ✅ Cloud FunctionからOCR処理結果を受信しました！`);
  Logger.log(`  - ファイル情報:`);
  Logger.log(`    • ファイル名: ${fileInfo.fileName || 'N/A'}`);
  Logger.log(`    • 総ページ数: ${fileInfo.totalPages || 'N/A'}`);
  Logger.log(`  - OCR実行結果:`);
  Logger.log(`    • 処理成功ページ数: ${processingInfo.successfulPages || 'N/A'}`);
  Logger.log(`    • 処理失敗ページ数: ${processingInfo.failedPages || 'N/A'}`);
  Logger.log(`  - 受信テキストデータ:`);
  Logger.log(`    • 受信ページ数: ${ocrResults.length}`);
  Logger.log(`    • 各ページの文字数: ${ocrResults.map((page, index) => `P${page.pageNumber || index + 1}:${page.text ? page.text.length : 0}文字`).join(', ')}`);

  // --- ページ数チェックと警告 ---
  const totalPages = fileInfo.totalPages || ocrResults.length;
  if (totalPages > 50) {
    Logger.log(`[${SCRIPT_NAME}] ⚠️ 警告: ${totalPages}ページの大量ファイルです。`);
    Logger.log(`[${SCRIPT_NAME}] • 推奨: 50ページ以下での利用`);
    Logger.log(`[${SCRIPT_NAME}] • 大量処理時はGAS実行時間制限やGeminiトークン制限に注意`);

    if (totalPages > 100) {
      Logger.log(`[${SCRIPT_NAME}] 🚨 重要: ${totalPages}ページは想定を大幅に超えています！`);
      Logger.log(`[${SCRIPT_NAME}] • 処理中断の可能性が高いため、事前に分割を検討してください`);

      // 管理者に通知（configが利用可能な場合）
      try {
        if (typeof config !== 'undefined' && config.errorNotificationEmails) {
          MailApp.sendEmail(
            config.errorNotificationEmails,
            `[OCR警告] 大量ページファイル検出: ${totalPages}ページ`,
            `大量ページのファイルが処理されています。\n\n` +
            `• ファイルID: ${fileId}\n` +
            `• 総ページ数: ${totalPages}ページ\n` +
            `• 推奨上限: 50ページ\n\n` +
            `処理が途中で停止する可能性があります。`
          );
        }
      } catch (mailError) {
        Logger.log(`[${SCRIPT_NAME}] 警告通知メール送信失敗: ${mailError.message}`);
      }
    }
  }

  // --- 各ページの内容をサンプル表示（デバッグ用） ---
  if (ocrResults.length > 0) {
    Logger.log(`[${SCRIPT_NAME}] 各ページのテキストサンプル（先頭100文字）:`);
    ocrResults.forEach((pageResult, index) => {
      const pageNumber = pageResult.pageNumber || (index + 1);
      const pageText = pageResult.text || "";
      const sampleText = pageText.length > 100
        ? pageText.substring(0, 100) + "..."
        : pageText;
      Logger.log(`    • ページ ${pageNumber}: "${sampleText}"`);
    });
  }

  // --- 最終チェック: 空のページがないか確認 ---
  const emptyPages = ocrResults.filter(page => !page.text || page.text.trim() === '');
  if (emptyPages.length > 0) {
    Logger.log(`[${SCRIPT_NAME}] ⚠️ 警告: ${emptyPages.length}ページでテキストが抽出されませんでした。`);
    Logger.log(`[${SCRIPT_NAME}] 空ページ: ${emptyPages.map(page => page.pageNumber || 'N/A').join(', ')}`);
  }

  Logger.log(`[${SCRIPT_NAME}] ✅ OCR処理完了。構造化レスポンスを返却します。`);
  return parsedResponse; // 完全な構造化レスポンスオブジェクトを返す
}

/**
 * 複数ページ・複数顧客に対応した最適なファイル名を生成します。
 * 全ページから収集された顧客エントリを分析し、統一性をチェックして適切な名前を決定します。
 * 
 * 生成パターン:
 * - 単一顧客: YYYYMMDD_顧客名_事業所名_書類名_FileID8桁
 * - 複数顧客(統一): YYYYMMDD_複数顧客_事業所名_書類名_FileID8桁  
 * - 複数顧客(混合): 複数日付_複数顧客_複数拠点_混合書類_FileID8桁
 *
 * @param {Object} params - ファイル名生成用のパラメータ
 * @param {string} params.documentName - 統合書類名
 * @param {string} params.officeName - 統合事業所名
 * @param {string} params.fileDate - 統合日付
 * @param {Array<Object>} params.customerEntries - 全ページの顧客エントリ配列
 * @param {string} params.fileId - Google DriveファイルID
 * @returns {string} 生成されたファイル名（拡張子なし、サニタイズ済み）
 */
function generateOptimalFileName_(params) {
  const SCRIPT_NAME = "generateOptimalFileName_";
  const { documentName, officeName, fileDate, customerEntries, fileId } = params;

  Logger.log(`[${SCRIPT_NAME}] ファイル名生成開始:`);
  Logger.log(`  - 統合書類名: ${documentName}`);
  Logger.log(`  - 統合事業所名: ${officeName}`);
  Logger.log(`  - 統合日付: ${fileDate}`);
  Logger.log(`  - 顧客エントリ数: ${customerEntries.length}`);

  // --- 1. 顧客情報の分析 ---
  const customerAnalysis = analyzeCustomerEntries_(customerEntries);
  Logger.log(`[${SCRIPT_NAME}] 顧客分析結果:`);
  Logger.log(`  - ユニーク顧客数: ${customerAnalysis.uniqueCustomers.length}`);
  Logger.log(`  - 顧客名統一性: ${customerAnalysis.isCustomerUnified}`);

  // --- 2. 属性情報の統一性チェック ---
  const unificationCheck = checkAttributeUnification_(customerEntries, documentName, officeName, fileDate);
  Logger.log(`[${SCRIPT_NAME}] 統一性チェック結果:`);
  Logger.log(`  - 書類名統一: ${unificationCheck.isDocumentUnified}`);
  Logger.log(`  - 事業所名統一: ${unificationCheck.isOfficeUnified}`);
  Logger.log(`  - 日付統一: ${unificationCheck.isDateUnified}`);

  // --- 3. ファイル名構成要素の決定 ---
  const fileNameComponents = determineFileNameComponents_(
    customerAnalysis, unificationCheck, documentName, officeName, fileDate
  );

  Logger.log(`[${SCRIPT_NAME}] ファイル名構成要素:`);
  Logger.log(`  - 日付部分: "${fileNameComponents.datePart}"`);
  Logger.log(`  - 顧客部分: "${fileNameComponents.customerPart}"`);
  Logger.log(`  - 事業所部分: "${fileNameComponents.officePart}"`);
  Logger.log(`  - 書類部分: "${fileNameComponents.documentPart}"`);

  // --- 4. ファイル名の組み立て ---
  const shortFileIdPart = fileId.substring(0, 8);
  const fileNameBeforeSanitize = `${fileNameComponents.datePart}_${fileNameComponents.customerPart}_${fileNameComponents.officePart}${fileNameComponents.documentPart}_${shortFileIdPart}`;

  // --- 5. サニタイズ処理 ---
  const sanitizedFileName = sanitizeFileName_(fileNameBeforeSanitize);

  Logger.log(`[${SCRIPT_NAME}] 生成ファイル名: "${sanitizedFileName}"`);
  return sanitizedFileName;
}

/**
 * 顧客エントリを分析して統計情報を取得します
 * @param {Array<Object>} customerEntries - 顧客エントリ配列
 * @returns {Object} 分析結果オブジェクト
 */
function analyzeCustomerEntries_(customerEntries) {
  const uniqueCustomers = [...new Set(customerEntries.map(entry => entry.customerName))];
  const isCustomerUnified = uniqueCustomers.length === 1;

  return {
    uniqueCustomers: uniqueCustomers,
    isCustomerUnified: isCustomerUnified,
    totalEntries: customerEntries.length
  };
}

/**
 * 各属性（書類名、事業所名、日付）の統一性をチェックします
 * @param {Array<Object>} customerEntries - 顧客エントリ配列
 * @param {string} globalDocumentName - 統合書類名
 * @param {string} globalOfficeName - 統合事業所名  
 * @param {string} globalFileDate - 統合日付
 * @returns {Object} 統一性チェック結果
 */
function checkAttributeUnification_(customerEntries, globalDocumentName, globalOfficeName, globalFileDate) {
  // 各エントリの属性を収集
  const documentNames = customerEntries.map(entry => entry.docName).filter(name => name && name !== STATUS_UNDETERMINED);
  const officeNames = customerEntries.map(entry => entry.officeName).filter(name => name && name !== STATUS_UNDETERMINED);
  const fileDates = customerEntries.map(entry => entry.fileDate).filter(date => date && date.trim() !== "");

  // ユニーク値の計算
  const uniqueDocuments = [...new Set(documentNames)];
  const uniqueOffices = [...new Set(officeNames)];
  const uniqueDates = [...new Set(fileDates)];

  return {
    isDocumentUnified: uniqueDocuments.length <= 1,
    isOfficeUnified: uniqueOffices.length <= 1,
    isDateUnified: uniqueDates.length <= 1,
    uniqueDocuments: uniqueDocuments,
    uniqueOffices: uniqueOffices,
    uniqueDates: uniqueDates
  };
}

/**
 * 分析結果に基づいてファイル名の各構成要素を決定します
 * @param {Object} customerAnalysis - 顧客分析結果
 * @param {Object} unificationCheck - 統一性チェック結果
 * @param {string} globalDocumentName - 統合書類名
 * @param {string} globalOfficeName - 統合事業所名
 * @param {string} globalFileDate - 統合日付
 * @returns {Object} ファイル名構成要素オブジェクト
 */
function determineFileNameComponents_(customerAnalysis, unificationCheck, globalDocumentName, globalOfficeName, globalFileDate) {

  // --- 日付部分の決定 ---
  let datePart;
  if (unificationCheck.isDateUnified && globalFileDate && globalFileDate.trim() !== "") {
    // 統一された日付がある場合
    datePart = globalFileDate.replace(/\//g, ""); // "YYYY/MM/DD" → "YYYYMMDD"
  } else if (!unificationCheck.isDateUnified && unificationCheck.uniqueDates.length > 1) {
    // 複数の異なる日付がある場合
    datePart = "複数日付";
  } else {
    // 日付がない場合は登録日を使用
    datePart = "登録日" + getToday_();
  }

  // --- 顧客部分の決定 ---
  let customerPart;
  if (customerAnalysis.isCustomerUnified) {
    // 単一顧客の場合
    customerPart = customerAnalysis.uniqueCustomers[0] || FILE_NAME_UNKNOWN_CUSTOMER;
  } else {
    // 複数顧客の場合
    customerPart = "複数顧客";
  }

  // --- 事業所部分の決定 ---
  let officePart;
  if (unificationCheck.isOfficeUnified && globalOfficeName && globalOfficeName !== STATUS_UNDETERMINED) {
    // 統一された事業所名がある場合
    officePart = globalOfficeName + "_";
  } else if (!unificationCheck.isOfficeUnified && unificationCheck.uniqueOffices.length > 1) {
    // 複数の異なる事業所がある場合
    officePart = "複数拠点_";
  } else {
    // 事業所名がない、または未判定の場合
    officePart = ""; // 事業所部分を省略
  }

  // --- 書類部分の決定 ---
  let documentPart;
  if (unificationCheck.isDocumentUnified && globalDocumentName && globalDocumentName !== STATUS_UNDETERMINED) {
    // 統一された書類名がある場合
    documentPart = globalDocumentName;
  } else if (!unificationCheck.isDocumentUnified && unificationCheck.uniqueDocuments.length > 1) {
    // 複数の異なる書類がある場合
    documentPart = "混合書類";
  } else {
    // 書類名がない、または未判定の場合
    documentPart = FILE_NAME_UNKNOWN_DOCUMENT;
  }

  return {
    datePart: datePart,
    customerPart: customerPart,
    officePart: officePart,
    documentPart: documentPart
  };
}

/**
 * 従来のgenerateUniqueFileName_関数の互換性維持版
 * 新しいgenerateOptimalFileNameシステムのフォールバックとして使用_
 * @param {Object} extractedInfo - 従来形式の抽出情報
 * @param {string} fileId - ファイルID
 * @param {string} originalExtension - 元の拡張子
 * @returns {string} 生成されたファイル名
 */
function generateUniqueFileName_(extractedInfo, fileId, originalExtension) {
  const SCRIPT_NAME = "generateUniqueFileName_";
  Logger.log(`[${SCRIPT_NAME}] 従来形式のファイル名生成を実行します（フォールバック）`);

  // 従来のロジックをそのまま実行（後方互換性のため）
  const { documentName, customerName, officeName, fileDate, isMultipleCustomers } = extractedInfo;

  const docNamePart = (documentName && documentName !== STATUS_UNDETERMINED) ? documentName : FILE_NAME_UNKNOWN_DOCUMENT;

  // 顧客名部分:
  let custNamePart;
  if (isMultipleCustomers) { // 関連顧客が複数いる場合
    custNamePart = "複数顧客"; // 固定文字列 "複数顧客" を使用
  } else { // 関連顧客が1名以下 (未判定含む) の場合
    if (customerName && customerName !== STATUS_UNDETERMINED) {
      // ★追加★ 未登録顧客の場合はファイル名用に変換
      custNamePart = customerName === "未登録顧客" ? FILE_NAME_UNKNOWN_CUSTOMER : customerName;
    } else {
      custNamePart = FILE_NAME_UNKNOWN_CUSTOMER;
    }
  }

  let datePart;
  if (fileDate && fileDate.trim() !== "") {
    datePart = fileDate.replace(/\//g, "");
  } else {
    datePart = "登録日" + getToday_();
  }

  const officePart = (officeName && officeName !== STATUS_UNDETERMINED)
    ? `${officeName}_`
    : "";

  const shortFileIdPart = fileId.substring(0, 8);
  const fileNameBeforeSanitize = `${datePart}_${custNamePart}_${officePart}${docNamePart}_${shortFileIdPart}${originalExtension}`;
  const sanitizedFileName = sanitizeFileName_(fileNameBeforeSanitize);

  Logger.log(`[${SCRIPT_NAME}] 従来形式ファイル名生成完了: "${sanitizedFileName}"`);
  return sanitizedFileName;
}

/**
 * OCRやマスター照合で抽出・識別された情報に基づいて、Google Drive上で一意性を持つファイル名を生成します。
 * ファイル名の形式: `[日付(YYYYMMDD)]_[顧客名または"複数顧客"]_[事業所名(あれば)]_[書類名]_[ファイルID先頭8文字].[元拡張子]`
 * - 日付: 書類から抽出できればその日付、できなければ処理日の日付に "登録日" プレフィックスを付与。
 * - 顧客名部分:
 * - 関連する顧客が複数いる場合は、固定文字列 "複数顧客" を使用。
 * - 関連する顧客が1名または未識別の場合は、識別された顧客名または代替文字列 "不明顧客" を使用。
 * - 各要素 (書類名、事業所名): 未識別の場合は、定義済みの代替文字列を使用。
 * - ファイルID: 元のファイルIDの先頭8文字を付与し、ファイル名の一意性を高める。
 * - 拡張子: 元のファイルの拡張子を維持。
 * 生成されたファイル名は、ファイルシステムで安全に使用できるようサニタイズ処理も行われます。
 *
 * @param {Object} extractedInfo - OCRやマスター照合によって抽出・識別された情報を含むオブジェクト。
 * @param {string} extractedInfo.documentName - 識別された書類名。未識別の場合は `STATUS_UNDETERMINED`。
 * @param {string} extractedInfo.customerName - 識別された主要な顧客名（単一の場合）。未識別の場合は `STATUS_UNDETERMINED`。
 * @param {string} extractedInfo.officeName - 識別された事業所名。未識別の場合は `STATUS_UNDETERMINED`。
 * @param {string} extractedInfo.fileDate - 書類から抽出された日付 (YYYY/MM/DD形式)。抽出できなかった場合は空文字列。
 * @param {boolean} extractedInfo.isMultipleCustomers - このファイルに関連する顧客候補が複数存在する場合に `true`、そうでない場合は `false`。
 * @param {string} fileId - 元のGoogle DriveファイルのID。ファイル名の一意性確保に使用。
 * @param {string} originalExtension - 元のファイルの拡張子 (例: ".pdf", ".jpg")。ドットを含む。
 * @returns {string} 生成された新しいファイル名。ファイル名として不適切な文字はアンダースコア '_' に置換済み。
 */
function generateUniqueFileName_(extractedInfo, fileId, originalExtension) {
  const SCRIPT_NAME = "generateUniqueFileName_";
  // extractedInfoオブジェクトから各プロパティを分割代入で取得
  const { documentName, customerName, officeName, fileDate, isMultipleCustomers } = extractedInfo;

  // --- ファイル名の各構成要素を準備 ---

  // 書類名部分: 未判定ならFILE_NAME_UNKNOWN_DOCUMENT ("不明文書") を使用
  const docNamePart = (documentName && documentName !== STATUS_UNDETERMINED) ? documentName : FILE_NAME_UNKNOWN_DOCUMENT;

  // 顧客名部分:
  let custNamePart;
  if (isMultipleCustomers) { // 関連顧客が複数いる場合
    custNamePart = "複数顧客"; // 固定文字列 "複数顧客" を使用
  } else { // 関連顧客が1名以下 (未判定含む) の場合
    custNamePart = (customerName && customerName !== STATUS_UNDETERMINED) ? customerName : FILE_NAME_UNKNOWN_CUSTOMER;
  }

  // 日付部分:
  let datePart;
  if (fileDate && fileDate.trim() !== "") { // 書類から日付が抽出できた場合
    datePart = fileDate.replace(/\//g, ""); // "YYYY/MM/DD" -> "YYYYMMDD"
  } else { // 日付が抽出できなかった場合
    datePart = "登録日" + getToday_(); // "登録日YYYYMMDD"
  }

  // 事業所名部分: 存在し、かつ未判定でなければ追加 (末尾にアンダースコア)
  const officePart = (officeName && officeName !== STATUS_UNDETERMINED)
    ? `${officeName}_`
    : ""; // なければ空文字

  // ファイルIDの先頭8文字部分:
  const shortFileIdPart = fileId.substring(0, 8);

  // 全てのパーツをアンダースコアで結合してファイル名を構築
  const fileNameBeforeSanitize = `${datePart}_${custNamePart}_${officePart}${docNamePart}_${shortFileIdPart}${originalExtension}`;

  // ファイル名として使用できない文字を置換 (サニタイズ)
  const sanitizedFileName = sanitizeFileName_(fileNameBeforeSanitize);

  Logger.log(`[${SCRIPT_NAME}] 生成ファイル名 (サニタイズ後): "${sanitizedFileName}" (顧客情報: ${isMultipleCustomers ? '複数' : custNamePart})`);
  return sanitizedFileName;
}

/**
 * ファイル名に使用できない文字をアンダースコア '_' に置換します。
 * Google Drive および一般的なOSで問題を起こしやすい文字を対象とします。
 * 連続するアンダースコアは1つにまとめます。
 * 半角スペースは削除するが、アンダースコアには変換しない
 * @param {string} fileName - サニタイズ対象のファイル名文字列。
 * @returns {string} サニタイズ後のファイル名文字列。
 */
function sanitizeFileName_(fileName) {
  // 1. Windows/Drive で禁止されている文字 (例: \ / : * ? " < > |) を '_' に置換
  // 2. 半角・全角スペースを削除（アンダースコアにはしない）
  // 3. 連続する '_' を一つにまとめる
  return fileName
    .replace(/[\\/:*?"<>|]/g, "_")   // 禁止文字 → アンダースコア
    .replace(/[\s　]+/g, "")         // ★修正: スペース → 削除（空文字）
    .replace(/_+/g, "_");           // 連続アンダースコア → 単一アンダースコア
}

/**
 * 現在の日付を 'YYYYMMDD' 形式の文字列で取得します。
 *
 * @returns {string} 'YYYYMMDD' 形式の現在日付文字列。
 */
function getToday_() {
  const today = new Date();
  const year = today.getFullYear();
  // getMonth() は 0始まりなので +1 する。padStartで2桁ゼロ埋め。
  const month = String(today.getMonth() + 1).padStart(2, "0");
  // getDate() は日。padStartで2桁ゼロ埋め。
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}
/**
 * OAuth2サービスオブジェクトを生成・返却します。
 * サービスアカウントの認証情報を利用してIDトークン取得の準備をします。
 * @return {Object|null} OAuth2サービスオブジェクト。認証情報が無効な場合はnull。
 */
function getOAuth2Service_() {
  if (!SA_CREDENTIALS) {
    Logger.log("getOAuth2Service_: サービスアカウント認証情報 (SA_CREDENTIALS) がロードされていません。");
    return null;
  }
  try {
    return OAuth2.createService('GCPServiceAccountAuth') // サービス名は任意
      .setTokenUrl('https://oauth2.googleapis.com/token')
      .setPrivateKey(SA_CREDENTIALS.private_key)
      .setIssuer(SA_CREDENTIALS.client_email)
      .setSubject(SA_CREDENTIALS.client_email) // 通常、発行者と同じで可
      .setPropertyStore(PropertiesService.getScriptProperties()) // トークンキャッシュ用
      .setScope('https://www.googleapis.com/auth/cloud-platform'); // Cloud Platform API全般へのアクセススコープ
    // .setAudience() はここでは不要。IAM Credentials API を利用するため。
  } catch (e) {
    Logger.log("getOAuth2Service_ でエラーが発生しました: " + e.toString());
    return null;
  }
}

/**
 * サービスアカウントを使用してCloud Function/Runを呼び出すためのIDトークンを取得します。
 * IAM Credentials API (generateIdToken) を利用します。
 * @return {string|null} IDトークン。取得に失敗した場合はnull。
 */
function getIdTokenForCloudFunction_() {
  const SCRIPT_NAME = "getIdTokenForCloudFunction_";
  if (!SA_CREDENTIALS || !SA_CREDENTIALS.client_email) {
    Logger.log(`[${SCRIPT_NAME}] サービスアカウントのメールアドレスが SA_CREDENTIALS から取得できません。`);
    return null;
  }

  const oauth2Service = getOAuth2Service_();
  if (!oauth2Service) {
    Logger.log(`[${SCRIPT_NAME}] OAuth2サービスの初期化に失敗しました。`);
    return null;
  }

  const accessToken = oauth2Service.getAccessToken();
  if (!accessToken) {
    Logger.log(`[${SCRIPT_NAME}] アクセストークン(OAuth2)の取得に失敗しました。`);
    return null;
  }

  const iamCredentialsApiUrl = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${SA_CREDENTIALS.client_email}:generateIdToken`;
  const requestPayload = {
    audience: CLOUD_FUNCTION_INVOCATION_URL, // グローバル定数で定義した呼び出し先URL
    includeEmail: true // IDトークンにサービスアカウントのメールアドレスを含めるか
  };

  try {
    const response = UrlFetchApp.fetch(iamCredentialsApiUrl, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + accessToken,
        "Content-Type": "application/json"
      },
      payload: JSON.stringify(requestPayload),
      muteHttpExceptions: true
    });

    const responseCode = response.getResponseCode();
    const responseBody = response.getContentText();

    if (responseCode === 200) {
      const idTokenResponse = JSON.parse(responseBody);
      Logger.log(`[${SCRIPT_NAME}] IDトークン (IAM Credentials API) の取得に成功しました。`);
      return idTokenResponse.token;
    } else {
      Logger.log(`[${SCRIPT_NAME}] IDトークン (IAM Credentials API) の取得に失敗しました。Status: ${responseCode}, Body: ${responseBody}`);
      return null;
    }
  } catch (e) {
    Logger.log(`[${SCRIPT_NAME}] IDトークン取得中に予期せぬエラー (UrlFetchApp): ${e.toString()}`);
    return null;
  }
}

/**
 * (デバッグ用) OAuth2サービスの状態をリセットします。
 */
function resetOAuth2Service_() {
  const oauth2Service = getOAuth2Service_();
  if (oauth2Service) {
    oauth2Service.reset();
    Logger.log("OAuth2サービスをリセットしました。");
  } else {
    Logger.log("OAuth2サービスの初期化に失敗しているため、リセットできません。");
  }
}

/**
 * OCRテキストから、条件に一致する可能性のある全ての顧客候補を重複なく取得します。
 * マスターデータ、OCRテキスト共に正規化して比較します。
 *
 * ★ファイル全体で顧客が見つからない場合のみ「未登録顧客」を返す
 * 
 * @param {string} ocrText OCR処理で抽出されたテキスト。
 * @param {Array<object>} customerList 顧客マスターから取得した顧客情報のリスト。
 * 各要素は { customerName: string, isDuplicate: boolean } 形式。
 * @returns {Array<object>} 識別された顧客候補の配列。類似度が高い順、次に完全一致優先、次に出現位置が早い順。
 * ★ファイル全体で顧客が見つからない場合のみ「未登録顧客」エントリを1件返します。★
 * 各オブジェクトは {
 * customerName: string,       // 元のマスターの顧客名（または「未登録顧客」）
 * isDuplicate: boolean,       // 同姓同名フラグ
 * similarity: number,         // 類似度 (0-100)
 * matchType: 'exact'|'similar'|'unregistered', // ★'unregistered'を追加★
 * startIndex: number | null // OCRテキスト内での最初の出現位置 (完全一致の場合のみ)
 * }
 */
function getBestMatchingCustomerCandidates_(ocrText, customerList) {
  const SCRIPT_NAME = "getBestMatchingCustomerCandidates_";

  Logger.log(`[${SCRIPT_NAME}] 顧客名の識別を開始... (マスター数: ${customerList.length}件)`);
  const normalizedOCR = normalizeText_(ocrText); // OCRテキストを正規化
  const candidatesMap = new Map(); // 顧客名ごとの最良の候補情報を保持するためのMap

  // 詳細なエラーハンドリングと原因分析
  if (!normalizedOCR || customerList.length === 0) {
    if (!normalizedOCR) {
      Logger.log(`[${SCRIPT_NAME}] ⚠️ OCRテキストが空です。原因候補:`);
      Logger.log(`[${SCRIPT_NAME}]   - 白紙ページまたは空白文書`);
      Logger.log(`[${SCRIPT_NAME}]   - OCR処理の失敗`);
      Logger.log(`[${SCRIPT_NAME}]   - Cloud Function処理エラー`);
      Logger.log(`[${SCRIPT_NAME}]   - ファイル破損`);
      Logger.log(`[${SCRIPT_NAME}]   - 元OCRテキスト長: ${ocrText ? ocrText.length : 0}文字`);

      // OCRテキストのサンプルを表示（デバッグ用）
      if (ocrText && ocrText.length > 0) {
        const sample = ocrText.substring(0, 100);
        Logger.log(`[${SCRIPT_NAME}]   - OCRテキストサンプル: "${sample}..."`);
      }
    }

    if (customerList.length === 0) {
      Logger.log(`[${SCRIPT_NAME}] ⚠️ 顧客マスターが空です。原因候補:`);
      Logger.log(`[${SCRIPT_NAME}]   - 顧客マスタースプレッドシートが空`);
      Logger.log(`[${SCRIPT_NAME}]   - スプレッドシートアクセス権限なし`);
      Logger.log(`[${SCRIPT_NAME}]   - getCustomerList_()関数エラー`);
      Logger.log(`[${SCRIPT_NAME}]   - 設定ミス（スプレッドシートID等）`);
      Logger.log(`[${SCRIPT_NAME}]   - 顧客マスターの列定義エラー`);
    }

    // ページレベルではなく、ファイルレベルで判定するため空配列を返す
    Logger.log(`[${SCRIPT_NAME}] ページレベルでは候補なしとして空配列を返します（ファイルレベルで判定）`);
    return [];
  }

  // 1. 完全一致検索
  // 顧客マスターの各項目について、OCRテキスト内で完全一致する箇所を検索します。
  for (const customerInfo of customerList) {
    if (customerInfo.customerName) {
      const masterName = customerInfo.customerName;
      const normalizedMasterName = normalizeText_(masterName); // マスター名も正規化
      if (!normalizedMasterName) continue; // 正規化結果が空の場合はスキップ

      let searchFromIndex = 0;
      let foundIndex;
      // OCRテキスト内で正規化されたマスター名が複数回出現する可能性を考慮し、ループで全てを検索します。
      while ((foundIndex = normalizedOCR.indexOf(normalizedMasterName, searchFromIndex)) !== -1) {
        const candidateKey = masterName; // Mapのキーは元のマスター名を使用し、重複を避けます。
        const newCandidate = {
          customerName: masterName,
          isDuplicate: customerInfo.isDuplicate,
          similarity: 100, // 完全一致なので類似度は100
          matchType: 'exact', // マッチタイプは「exact」（完全一致）
          startIndex: foundIndex // OCRテキスト内での出現開始位置
        };
        // 既に同じ顧客名の候補が存在する場合、より早い出現位置のものを優先します。
        if (!candidatesMap.has(candidateKey) || (candidatesMap.get(candidateKey).startIndex === null || foundIndex < candidatesMap.get(candidateKey).startIndex)) {
          candidatesMap.set(candidateKey, newCandidate);
        }
        searchFromIndex = foundIndex + normalizedMasterName.length; // 次の検索開始位置を更新
        if (searchFromIndex >= normalizedOCR.length) break; // 検索範囲の終わりを超えたら終了
      }
    }
  }

  // 2. 類似度検索
  // 完全一致で見つからなかった顧客、または類似度でより高評価を得られる可能性がある顧客について、類似度を計算します。
  for (const customerInfo of customerList) {
    if (customerInfo.customerName) {
      const masterName = customerInfo.customerName;
      const candidateKey = masterName;

      // 既に完全一致で見つかっている顧客は、類似度検索の対象外とします（より高い類似度はありえないため）。
      if (candidatesMap.has(candidateKey) && candidatesMap.get(candidateKey).matchType === 'exact') {
        continue;
      }

      const normalizedMasterName = normalizeText_(masterName);
      if (!normalizedMasterName) continue;

      // OCRテキスト全体とマスター名の間の類似度を計算します。
      // calculateSimilarity_ 関数は別途定義されている必要があります。
      const similarity = calculateSimilarity_(normalizedOCR, normalizedMasterName);

      // 設定された閾値以上の類似度がある場合のみ候補として採用します。
      if (similarity >= CUSTOMER_SIMILARITY_THRESHOLD) {
        const newCandidate = {
          customerName: masterName,
          isDuplicate: customerInfo.isDuplicate,
          similarity: similarity,
          matchType: 'similar', // マッチタイプは「similar」（類似一致）
          startIndex: null // 類似度検索では正確な出現位置は特定できないためnull
        };
        // 既に候補がある場合は、より高い類似度を持つ方を優先して更新します。なければ新規追加。
        if (!candidatesMap.has(candidateKey) || similarity > candidatesMap.get(candidateKey).similarity) {
          candidatesMap.set(candidateKey, newCandidate);
        }
      }
    }
  }

  // Mapから最終的な候補の配列を作成し、ソートします。
  const finalCandidates = Array.from(candidatesMap.values());
  finalCandidates.sort((a, b) => {
    // 優先順位: 類似度が高い順
    if (b.similarity !== a.similarity) return b.similarity - a.similarity;
    // 次に: 完全一致を優先
    if (a.matchType !== b.matchType) return a.matchType === 'exact' ? -1 : 1;
    // 最後に: 完全一致の場合、出現位置が早い方を優先
    if (a.startIndex !== null && b.startIndex !== null) return a.startIndex - b.startIndex;
    // startIndexがnullの項目とそうでない項目がある場合、startIndexがある方を優先
    if (a.startIndex !== null) return -1;
    if (b.startIndex !== null) return 1;
    return 0; // それ以外の順序は保持
  });

  // ページレベルでは空配列を返し、ファイル全体で判定
  if (finalCandidates.length === 0) {
    Logger.log(`[${SCRIPT_NAME}] このページでは顧客候補が見つかりませんでした（空配列を返却）`);
    return []; // 「未登録顧客」ではなく空配列を返す
  }
  // ============================================================================

  Logger.log(`[${SCRIPT_NAME}] ${finalCandidates.length}件の重複排除済み顧客候補を識別しました。`);

  // 発見された候補の詳細ログ出力
  if (finalCandidates.length > 0) {
    Logger.log(`[${SCRIPT_NAME}] 📋 発見された顧客候補一覧:`);
    finalCandidates.forEach((candidate, index) => {
      Logger.log(`[${SCRIPT_NAME}]   ${index + 1}. "${candidate.customerName}" (${candidate.matchType}, 類似度: ${candidate.similarity}%)`);
    });
  }

  return finalCandidates;
}

/**
 * ファイル全体の顧客エントリを分析し、顧客が一つも見つからない場合は
 * 「未登録顧客」エントリを生成します。
 * 
 * @param {Array<Object>} allCustomerEntries - 全ページから収集された顧客エントリ
 * @returns {Array<Object>} 処理済み顧客エントリ（必要に応じて「未登録顧客」を追加）
 */
function ensureCustomerEntries_(allCustomerEntries) {
  const SCRIPT_NAME = "ensureCustomerEntries_";

  // 実際の顧客候補があるかチェック（「未登録顧客」以外）
  const realCustomers = allCustomerEntries.filter(entry =>
    entry.customerName !== "未登録顧客" &&
    entry.matchType !== 'unregistered'
  );

  if (realCustomers.length === 0) {
    Logger.log(`[${SCRIPT_NAME}] ファイル全体で顧客名が見つかりませんでした。「未登録顧客」として処理します。`);

    // ファイル全体で顧客が見つからない場合のみ「未登録顧客」を生成
    return [{
      customerName: "未登録顧客",        // スプレッドシートの顧客名列に記録される値
      isDuplicate: false,               // 同姓同名フラグはfalse
      similarity: 0,                    // 類似度は0%（マスターに存在しないため）
      matchType: 'unregistered',        // マッチタイプは「未登録」
      startIndex: null,                 // 出現位置は特定不可のためnull
      pageNumber: 1,                    // デフォルトでページ1に設定
      docName: "未判定",                // 書類名も未判定
      officeName: "未判定",             // 事業所名も未判定
      fileDate: ""                      // 日付も空
    }];
  }

  Logger.log(`[${SCRIPT_NAME}] ファイル全体で${realCustomers.length}件の顧客候補が見つかりました。通常処理を継続します。`);
  return allCustomerEntries; // 既存のエントリをそのまま返す
}

/**
 * OCR処理の結果と識別された情報を、指定されたGoogleスプレッドシート（書類管理ログ）に記録します。
 * ★更新: ページ毎処理に対応し、総ページ数・ページ番号・ページテキストを記録します。
 *
 * @param {object} file - 処理されたファイルオブジェクト。これはDrive APIのFilesリソース
 * @param {string} ocrText - 該当ページのOCRテキスト（完全版）。
 * @param {Object} config - グローバル設定オブジェクト。
 * @param {string} fileUrl - Google Drive上のファイルへのURL。
 * @param {string} fileDate - OCRテキストから抽出された日付 (YYYY/MM/DD形式)。
 * @param {string} docName - 識別された書類名。
 * @param {string} customerName - 識別された顧客名。
 * @param {string} officeName - 識別された事業所名。
 * @param {string} fileId - Google Drive のファイルID。
 * @param {boolean} isDuplicateCustomer - 識別された顧客名が顧客マスターで「同姓同名フラグ」が立っているか。
 * @param {string} [allCandidatesText=""] - 識別された全ての顧客候補をセミコロン区切りで結合した文字列。
 * @param {string} [newFileName=""] - リネーム後のファイル名
 * @param {number} [totalPages=1] - ★新規: ファイルの総ページ数
 * @param {number} [pageNumber=1] - ★新規: このログエントリが対象とするページ番号
 */
function logOCRResult_(file, ocrText, config, fileUrl, fileDate, docName, customerName, officeName, fileId, isDuplicateCustomer, allCandidatesText = "", newFileName = "", totalPages = 1, pageNumber = 1) {
  const SCRIPT_NAME = "logOCRResult_"; // 関数名をログ出力用に定数化
  try {
    // --- 1. 設定とスプレッドシートオブジェクトの取得 ---
    const transConfig = config.sheets.documentTransaction;
    if (!transConfig || !transConfig.spreadsheetId || !transConfig.sheetName || !transConfig.columns) {
      Logger.log(`[${SCRIPT_NAME}] エラー: config.sheets.documentTransaction の設定が不完全です。ログ記録をスキップします。`);
      return;
    }

    const spreadsheetId = transConfig.spreadsheetId;
    const sheetName = transConfig.sheetName;
    const columnMapping = transConfig.columns;

    let spreadsheet;
    try {
      spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    } catch (e) {
      Logger.log(`[${SCRIPT_NAME}] エラー: スプレッドシート (ID: ${spreadsheetId}) を開けませんでした。エラー: ${e.message}`);
      return;
    }

    const sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) {
      Logger.log(`[${SCRIPT_NAME}] エラー: ログシート "${sheetName}" がスプレッドシート (ID: ${spreadsheetId}) 内に見つかりません。`);
      return;
    }

    // --- 2. ヘッダー行の確認と自動作成 ---
    const headerRowNumber = transConfig.headerRow || LOG_SHEET_DEFAULT_HEADER_ROW;

    if (sheet.getMaxRows() === 0 || sheet.getLastRow() < headerRowNumber) {
      Logger.log(`[${SCRIPT_NAME}] シート "${sheetName}" にヘッダー行が存在しないか、行が不足しているため、ヘッダー行を作成します。 (指定ヘッダー行: ${headerRowNumber})`);

      const headerDisplayNames = {
        id: "ID",
        processDate: "処理日時",
        fileId: "ファイルID",
        fileName: "ファイル名", // リネーム後のファイル名が記録される 
        mimeType: "MIMEタイプ",
        ocrResult: "OCR結果",
        documentName: "書類名",
        customerName: "顧客名",
        officeName: "事業所名",
        fileUrl: "ファイルURL",
        fileDate: "日付",
        isDuplicateCustomerName: "同姓同名フラグ",
        allCustomerCandidates: "全顧客候補",
        totalPages: "総ページ数",        // ★新規追加
        targetPageNumber: "ページ番号",  // ★新規追加
        pageText: "ページテキスト"      // ★新規追加
      };

      const headers = Object.entries(columnMapping)
        .sort(([, columnLetterA], [, columnLetterB]) => columnToNumber_(columnLetterA) - columnToNumber_(columnLetterB))
        .map(([key]) => headerDisplayNames[key] || key);

      if (sheet.getMaxRows() === 0) {
        sheet.appendRow(headers);
      } else {
        if (sheet.getMaxRows() < headerRowNumber) {
          sheet.insertRowsAfter(sheet.getMaxRows(), headerRowNumber - sheet.getMaxRows());
        }
        sheet.getRange(headerRowNumber, 1, 1, headers.length).setValues([headers]);
      }
      Logger.log(`[${SCRIPT_NAME}] ヘッダー行をシート "${sheetName}" の ${headerRowNumber} 行目に書き込みました。`);
    }

    // --- 3. ログデータの準備 ---
    const timestamp = new Date();
    const uuid = Utilities.getUuid();

    const newRowData = [];
    const sortedColumnKeys = Object.keys(columnMapping).sort((keyA, keyB) => {
      const colNumA = columnToNumber_(columnMapping[keyA]);
      const colNumB = columnToNumber_(columnMapping[keyB]);
      return colNumA - colNumB;
    });

    for (const key of sortedColumnKeys) {
      switch (key) {
        case 'id':
          newRowData.push(uuid);
          break;
        case 'processDate':
          newRowData.push(timestamp);
          break;
        case 'fileId':
          newRowData.push(fileId);
          break;
        case 'fileName':
          // リネーム後のファイル名を優先、なければ元のファイル名
          newRowData.push(newFileName || file.name);
          break;
        case 'mimeType':
          newRowData.push(file.mimeType);
          break;
        case 'ocrResult':
          newRowData.push(ocrText); // このページの完全なOCRテキスト
          break;
        case 'documentName':
          newRowData.push(docName);
          break;
        case 'customerName':
          newRowData.push(customerName);
          break;
        case 'officeName':
          newRowData.push(officeName);
          break;
        case 'fileUrl':
          newRowData.push(fileUrl);
          break;
        case 'fileDate':
          newRowData.push(fileDate);
          break;
        case 'isDuplicateCustomerName':
          newRowData.push(isDuplicateCustomer);
          break;
        case 'allCustomerCandidates':
          newRowData.push(allCandidatesText);
          break;
        case 'totalPages': // ★新規追加
          newRowData.push(totalPages);
          break;
        case 'targetPageNumber': // ★新規追加
          newRowData.push(pageNumber);
          break;
        case 'pageText': // ★新規追加
          // ページのテキストの先頭200文字程度を記録（視認性用）
          newRowData.push(ocrText ? ocrText.substring(0, 200) + (ocrText.length > 200 ? "..." : "") : "");
          break;
        default:
          Logger.log(`[${SCRIPT_NAME}] 警告: ログ記録対象のキー "${key}" に対応するデータが指定されていません。空文字を記録します。`);
          newRowData.push('');
      }
    }

    // --- 4. スプレッドシートへの書き込み ---
    sheet.appendRow(newRowData);

    // リネーム後のファイル名を表示
    const logFileName = newFileName || file.name;
    Logger.log(`[${SCRIPT_NAME}] ログ記録完了 - ファイル名: "${logFileName}", ID: ${uuid}, 書類名: ${docName}, 顧客名: ${customerName}, 日付: ${fileDate}, 同姓同名: ${isDuplicateCustomer}, ページ: ${pageNumber}/${totalPages}`);

  } catch (error) {
    const fileNameForLog = (newFileName || (file && file.name)) ? `"${newFileName || file.name}"` : "(ファイルオブジェクトまたは名前不明)";
    Logger.log(`[${SCRIPT_NAME}] ログ記録中に予期せぬエラーが発生しました。ファイル名: ${fileNameForLog}, ページ: ${pageNumber}, エラー: ${error.stack || error.message}`);
  }
}

/**
 * 書類マスタースプレッドシートから書類名と日付マーカーのリストを取得します。
 *
 * @param {Object} config - グローバル設定オブジェクト。書類マスターのシートID、シート名、列定義を含む。
 * @returns {Array<Object>} 書類情報のオブジェクト配列。各オブジェクトは { documentName: string, dateMarker: string } 形式。
 *                           シートが見つからない場合やデータがない場合は空配列を返します。
 */
function getDocumentNameList_(config) {
  try {
    const docConfig = config.sheets.documentMaster;
    const ss = SpreadsheetApp.openById(docConfig.spreadsheetId);
    const sheet = ss.getSheetByName(docConfig.sheetName);

    if (!sheet) {
      Logger.log(`getDocumentNameList_: エラー - シート "${docConfig.sheetName}" が見つかりません。`);
      return [];
    }

    const startRow = docConfig.startRow || 2; // デフォルトは2行目から
    const lastRow = sheet.getLastRow();

    if (lastRow < startRow) {
      Logger.log(`getDocumentNameList_: シート "${docConfig.sheetName}" に有効なデータがありません (開始行: ${startRow}, 最終行: ${lastRow})。`);
      return [];
    }

    // 書類名列と日付マーカー列の列番号を取得
    const docNameCol = columnToNumber_(docConfig.columns.documentName);
    const dateMarkerCol = columnToNumber_(docConfig.columns.dateMarker);
    // 取得範囲の開始列と列数を計算 (A列=1)
    const startCol = Math.min(docNameCol, dateMarkerCol);
    const numCols = Math.max(docNameCol, dateMarkerCol) - startCol + 1;
    // 範囲を指定して値を取得
    const range = sheet.getRange(startRow, startCol, lastRow - startRow + 1, numCols);
    const values = range.getValues();

    // 取得した値を整形してリスト化
    const list = values.map(row => {
      // values配列内のインデックスを計算 (0始まり)
      const docNameIndex = docNameCol - startCol;
      const dateMarkerIndex = dateMarkerCol - startCol;
      return {
        documentName: row[docNameIndex] ? String(row[docNameIndex]).trim() : "", // 文字列化してトリム
        dateMarker: row[dateMarkerIndex] ? String(row[dateMarkerIndex]).trim() : ""  // 文字列化してトリム
      };
    }).filter(item => item.documentName !== ""); // 書類名が空でないものだけを対象とする

    Logger.log(`getDocumentNameList_: ${list.length}件の書類名情報を取得しました。`);
    return list;

  } catch (error) {
    Logger.log(`getDocumentNameList_: 書類マスター読み込み中にエラーが発生しました。エラー: ${error}`);
    return []; // エラー時は空配列を返す
  }
}

/**
 * 顧客マスタースプレッドシートから顧客名と「同姓同名フラグ」のリストを取得します。
 *
 * @param {Object} config - グローバル設定オブジェクト。顧客マスターのシートID、シート名、列定義を含む。
 * @returns {Array<Object>} 顧客情報のオブジェクト配列。各オブジェクトは { customerName: string, isDuplicate: boolean } 形式。
 *                           シートが見つからない、データがない、列定義がない場合は空配列を返します。
 */
function getCustomerList_(config) {
  try {
    const custConfig = config.sheets.customerMaster;
    // 列定義の存在チェック
    if (!custConfig.columns.customerName || !custConfig.columns.isDuplicateName) {
      Logger.log(`getCustomerList_: エラー - config 内の customerMaster.columns に customerName または isDuplicateName の定義がありません。`);
      return [];
    }

    const ss = SpreadsheetApp.openById(custConfig.spreadsheetId);
    const sheet = ss.getSheetByName(custConfig.sheetName);

    if (!sheet) {
      Logger.log(`getCustomerList_: エラー - シート "${custConfig.sheetName}" が見つかりません。`);
      return [];
    }

    const startRow = custConfig.startRow || 2;
    const lastRow = sheet.getLastRow();

    if (lastRow < startRow) {
      Logger.log(`getCustomerList_: シート "${custConfig.sheetName}" に有効なデータがありません (開始行: ${startRow}, 最終行: ${lastRow})。`);
      return [];
    }

    // 顧客名列と同姓同名フラグ列の列番号を取得
    const nameCol = columnToNumber_(custConfig.columns.customerName);
    const flagCol = columnToNumber_(custConfig.columns.isDuplicateName);
    const startCol = Math.min(nameCol, flagCol);
    const numCols = Math.max(nameCol, flagCol) - startCol + 1;

    const range = sheet.getRange(startRow, startCol, lastRow - startRow + 1, numCols);
    const values = range.getValues();

    // 取得した値を整形
    const list = values.map(row => {
      const nameIndex = nameCol - startCol;
      const flagIndex = flagCol - startCol;
      const customerName = row[nameIndex] ? String(row[nameIndex]).trim() : "";
      // フラグ列の値が `true` (チェックボックス) または 文字列 "TRUE" (大文字小文字問わず) の場合に true とする
      const isDuplicate = row[flagIndex] === true || String(row[flagIndex]).toUpperCase() === 'TRUE';
      return {
        customerName: customerName,
        isDuplicate: isDuplicate
      };
    }).filter(item => item.customerName !== ""); // 顧客名が空でないものだけ

    Logger.log(`getCustomerList_: ${list.length}件の顧客情報を取得しました。`);
    return list;

  } catch (error) {
    Logger.log(`getCustomerList_: 顧客マスター読み込み中にエラーが発生しました。エラー: ${error}`);
    return [];
  }
}


/**
 * 事業所マスタースプレッドシートから事業所名のリストを取得します。
 *
 * @param {Object} config - グローバル設定オブジェクト。事業所マスターのシートID、シート名、列定義を含む。
 * @returns {Array<string>} 事業所名の文字列配列。シートが見つからない場合やデータがない場合は空配列を返します。
 */
function getOfficeList_(config) {
  try {
    const officeConfig = config.sheets.officeMaster;
    const ss = SpreadsheetApp.openById(officeConfig.spreadsheetId);
    const sheet = ss.getSheetByName(officeConfig.sheetName);

    if (!sheet) {
      Logger.log(`getOfficeList_: エラー - シート "${officeConfig.sheetName}" が見つかりません。`);
      return [];
    }

    const startRow = officeConfig.startRow || 2;
    const lastRow = sheet.getLastRow();

    if (lastRow < startRow) {
      Logger.log(`getOfficeList_: シート "${officeConfig.sheetName}" に有効なデータがありません (開始行: ${startRow}, 最終行: ${lastRow})。`);
      return [];
    }

    // 事業所名列の列番号を取得
    const officeNameCol = columnToNumber_(officeConfig.columns.officeName);

    // A列から事業所名列までの範囲を取得 (A列前提ではなく、定義された列のみ取得)
    const range = sheet.getRange(startRow, officeNameCol, lastRow - startRow + 1, 1);
    const values = range.getValues();

    // 取得した値を整形してリスト化 (1次元配列に変換)
    const list = values.map(row => row[0] ? String(row[0]).trim() : "") // 文字列化してトリム
      .filter(name => name !== ""); // 空でないものだけ

    Logger.log(`getOfficeList_: ${list.length}件の事業所名を取得しました。`);
    return list;

  } catch (error) {
    Logger.log(`getOfficeList_: 事業所マスター読み込み中にエラーが発生しました。エラー: ${error}`);
    return []; // エラー時は空配列を返す
  }
}

/**
 * スプレッドシートの列文字 (A, B, ..., Z, AA, AB, ...) を列番号 (1, 2, ..., 26, 27, 28, ...) に変換します。
 *
 * @param {string} column - 列文字 (例: "A", "C", "AA")。大文字小文字は区別しません。
 * @returns {number} 対応する列番号 (1始まり)。
 * @throws 列文字が無効な場合 (空、数字を含むなど) エラーをスローします。
 */
function columnToNumber_(column) {
  if (!column || typeof column !== 'string' || !/^[A-Z]+$/i.test(column)) {
    throw new Error(`無効な列文字です: "${column}"`);
  }
  const normalizedColumn = column.toUpperCase();
  let result = 0;
  for (let i = 0; i < normalizedColumn.length; i++) {
    result = result * 26 + (normalizedColumn.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
  }
  return result;
}

/**
 * OCR結果などのテキストを正規化（クリーニング）します。
 * マスターデータにスペースが含まれない前提で、スペースも完全に削除します。
 * 以下の処理を行います:
 * 1. 改行コード（\r, \n）を削除。
 * 2. 半角スペースおよび全角スペースを完全に削除。
 * 3. 一般的な記号（句読点、括弧など）を削除。
 * 4. 先頭と末尾の空白を削除 (通常は不要だが念のため)。
 *
 * @param {string} text - 正規化対象のテキスト。
 * @returns {string} 正規化後のテキスト。入力が null や undefined の場合は空文字列を返します。
 */
function normalizeText_(text) {
  if (!text) return "";
  // 1. 改行を削除
  let normalized = text.replace(/[\r\n]+/g, ""); // スペースに置換せず削除
  // 2. 全角・半角スペースを削除 ★変更点: 置換後の文字列を空にする
  normalized = normalized.replace(/[\s　]+/g, "");
  // 3. 記号削除 (英数字と日本語文字以外を削除するイメージ)
  normalized = normalized.replace(/[!-/:-@[-`{-~\u3000-\u303F]/g, ""); // 半角記号 + 全角スペースなど
  // 4. 先頭末尾の空白削除 (スペース削除後なので不要かもしれないが念のため)
  return normalized.trim();
}


/**
 * 2つの文字列間のレーベンシュタイン距離（編集距離）を計算します。
 * 一方の文字列をもう一方の文字列に変形するために必要な、文字の挿入・削除・置換の最小回数です。
 *
 * @param {string} a - 比較する文字列1。
 * @param {string} b - 比較する文字列2。
 * @returns {number} 2つの文字列間のレーベンシュタイン距離。
 */
function calculateLevenshteinDistance_(a, b) {
  if (!a) a = ""; // null/undefined対策
  if (!b) b = ""; // null/undefined対策
  const matrix = [];

  // matrix[i][j] は b の最初の i 文字と a の最初の j 文字の間の距離を表す

  // i 行目の初期化 (bのi文字と空文字列の距離)
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  // j 列目の初期化 (aのj文字と空文字列の距離)
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  // 行列を埋める
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      // b の i 番目の文字と a の j 番目の文字が同じ場合、コストは 0
      const cost = (b.charAt(i - 1) === a.charAt(j - 1)) ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // 削除 (b から文字を削除)
        matrix[i][j - 1] + 1,      // 挿入 (b に文字を挿入)
        matrix[i - 1][j - 1] + cost // 置換 (文字が異なればコスト1)
      );
    }
  }

  // 右下の要素が最終的な距離
  return matrix[b.length][a.length];
}


/**
 * 2つの文字列間の類似度をパーセンテージで計算します。
 * レーベンシュタイン距離を使用し、以下の式で算出します:
 * 類似度(%) = (1 - (レーベンシュタイン距離 / 長い方の文字列長)) * 100
 *
 * @param {string} a - 比較する文字列1。
 * @param {string} b - 比較する文字列2。
 * @returns {number} 文字列の類似度 (0〜100)。両方が空文字列の場合は100を返します。
 */
function calculateSimilarity_(a, b) {
  if (!a && !b) return 100; // 両方空なら類似度100%
  if (!a || !b) return 0;   // 片方だけ空なら類似度0%

  const distance = calculateLevenshteinDistance_(a, b);
  const maxLength = Math.max(a.length, b.length);

  // 距離が長さより大きい場合があり得る？(通常は最大でもmaxLength) → 念のため0未満にならないように
  const similarityScore = Math.max(0, (1 - distance / maxLength));
  return similarityScore * 100;
}

/**
 * OCRテキストから、事業所マスターリストに最も一致する可能性のある事業所名を識別します。
 * 処理ロジックは getBestMatchingCustomer と同様で、まず完全一致を探し、
 * なければ類似度（閾値70%）で判定します。
 *
 * @param {string} ocrText - OCR処理で抽出されたテキスト。
 * @param {Array<string>} officeList - 事業所マスターから取得した事業所名のリスト。
 * @returns {string} 識別された事業所名。識別できなければ "未判定"。
 */
function getBestMatchingOffice_(ocrText, officeList) {
  const SCRIPT_NAME = "getBestMatchingOffice_";
  Logger.log(`[${SCRIPT_NAME}] 事業所名の識別を開始... (マスター数: ${officeList.length}件)`);
  const normalizedOCR = normalizeText_(ocrText); // OCR結果を正規化
  let bestMatch = "未判定";
  let highestSimilarity = 0;
  const SIMILARITY_THRESHOLD = 70;

  if (!normalizedOCR || officeList.length === 0) {
    Logger.log("getBestMatchingOffice_: OCRテキストが空、または事業所リストが空のため、事業所名を判定できません。");
    return bestMatch;
  }

  // 1. 完全一致検索 (マスターデータも正規化して比較)
  for (const officeName of officeList) {
    if (officeName) {
      const normalizedMasterOfficeName = normalizeText_(officeName); // ★★★ マスター側の事業所名も正規化 ★★★
      if (normalizedMasterOfficeName && normalizedOCR.includes(normalizedMasterOfficeName)) { // ★★★ 正規化された同士で比較 ★★★
        Logger.log(`getBestMatchingOffice_: 事業所名 '${officeName}' (正規化後: '${normalizedMasterOfficeName}') を直接一致で識別しました。`);
        return officeName; // 返すのは元のマスター名
      }
    }
  }

  // 2. 類似度検索 (OCR結果とマスター名をそれぞれ正規化してから比較)
  Logger.log("getBestMatchingOffice_: 直接一致なし。類似度検索を開始します。");
  for (const officeName of officeList) {
    if (!officeName) continue;
    const normalizedMasterOfficeName = normalizeText_(officeName); // ★★★ マスター側の事業所名も正規化 ★★★
    if (!normalizedMasterOfficeName) continue; // 正規化後空になる場合はスキップ

    const similarity = calculateSimilarity_(normalizedOCR, normalizedMasterOfficeName); // ★★★ 正規化された同士で比較 ★★★
    // Logger.log(` - 比較: OCR"${normalizedOCR}" vs Master"${normalizedMasterOfficeName}" (元: "${officeName}"), 類似度: ${similarity.toFixed(1)}%`);

    if (similarity > highestSimilarity && similarity >= SIMILARITY_THRESHOLD) {
      highestSimilarity = similarity;
      bestMatch = officeName; // 返すのは元のマスター名
    }
  }

  if (bestMatch !== "未判定") {
    Logger.log(`getBestMatchingOffice_: 類似度検索で事業所名 '${bestMatch}' を識別しました。(類似度: ${highestSimilarity.toFixed(1)}%)`);
  } else {
    Logger.log("getBestMatchingOffice_: 類似度検索でも閾値を超える一致が見つかりませんでした。");
  }

  return bestMatch;
}

/**
 * OCRテキストから、書類マスターリストに最も一致する可能性のある書類名を決定します。
 * 優先順位:
 * 1. OCRテキストの先頭200文字以内に、マスターの書類名が完全一致で出現するかどうか。
 *    複数ヒットした場合、よりテキストの先頭に近く、かつ文字列が長いものを優先します。
 * 2. 先頭200文字で見つからない場合、OCRテキスト全体とマスターの各書類名の類似度を計算し、
 *    最も類似度が高いものを候補とします。（ここでは閾値は設けず、最も近いものを採用）
 *
 * @param {string} ocrText - OCR処理で抽出されたテキスト。
 * @param {Array<Object>} documentList - 書類マスターから取得した書類情報のリスト。
 *                                       各要素は { documentName: string, dateMarker: string } 形式。
 * @returns {Object} 識別結果。{ documentName: string, dateMarker: string } 形式。
 *                   最も可能性の高い書類名とその日付マーカー。見つからなければ documentName は "未判定" となる可能性あり。
 */
function getBestMatchingDocumentName_(ocrText, documentList) {
  const SCRIPT_NAME = "getBestMatchingDocumentName_";
  Logger.log(`[${SCRIPT_NAME}] 書類名の識別を開始... (マスター数: ${documentList.length}件)`);
  const normalizedOCR = normalizeText_(ocrText);
  let bestMatch = { documentName: "未判定", dateMarker: "" }; // デフォルトは未判定

  if (!normalizedOCR || documentList.length === 0) {
    Logger.log("getBestMatchingDocumentName_: OCRテキストが空、または書類リストが空のため、書類名を判定できません。");
    return bestMatch;
  }

  // --- 1. 先頭部分での完全一致検索 ---
  const searchRange = normalizedOCR.substring(0, 200); // 検索範囲を先頭200文字に限定
  let candidateMatches = []; // ヒットした候補を格納する配列

  Logger.log("getBestMatchingDocumentName_: 先頭200文字での直接一致検索を開始します。");
  for (const docInfo of documentList) {
    if (!docInfo.documentName) continue; // 書類名がないデータはスキップ
    const normCandidate = normalizeText_(docInfo.documentName); // 候補も正規化
    if (!normCandidate) continue; // 正規化後空になる場合もスキップ

    const index = searchRange.indexOf(normCandidate); // 先頭200文字内で検索
    if (index !== -1) {
      // ヒットした場合、情報を記録
      candidateMatches.push({
        documentName: docInfo.documentName,
        dateMarker: docInfo.dateMarker || "", // dateMarkerがundefinedの場合に備える
        index: index,                     // 出現位置
        length: normCandidate.length      // 一致した文字列の長さ
      });
      Logger.log(` - ヒット候補: "${docInfo.documentName}" (位置: ${index}, 長さ: ${normCandidate.length})`);
    }
  }

  // ヒットした候補がある場合、最適なものを選定
  if (candidateMatches.length > 0) {
    // 優先度: 1. 出現位置が早い (indexが小さい) / 2. 同じような位置なら文字列が長い
    candidateMatches.sort((a, b) => {
      if (a.index !== b.index) {
        return a.index - b.index; // index昇順
      }
      return b.length - a.length; // indexが同じならlength降順
    });
    bestMatch = { documentName: candidateMatches[0].documentName, dateMarker: candidateMatches[0].dateMarker };
    Logger.log(`getBestMatchingDocumentName_: 先頭直接一致で '${bestMatch.documentName}' を選択しました。(位置: ${candidateMatches[0].index})`);
    return bestMatch; // 最適なものを返す
  }

  // --- 2. 全文類似度検索 (先頭でヒットしなかった場合) ---
  Logger.log("getBestMatchingDocumentName_: 先頭直接一致なし。全文類似度検索を開始します。");
  let highestSimilarity = -1; // 最高類似度を初期化 (-1なら候補なし)

  for (const docInfo of documentList) {
    if (!docInfo.documentName) continue;
    const normCandidate = normalizeText_(docInfo.documentName);
    if (!normCandidate) continue;

    const similarity = calculateSimilarity_(normalizedOCR, normCandidate);
    // Logger.log(` - 比較: "${docInfo.documentName}", 類似度: ${similarity.toFixed(1)}%`);

    if (similarity > highestSimilarity) {
      highestSimilarity = similarity;
      bestMatch = { documentName: docInfo.documentName, dateMarker: docInfo.dateMarker || "" };
    }
  }

  if (highestSimilarity >= 0) { // 少なくとも比較対象があった場合
    Logger.log(`getBestMatchingDocumentName_: 全文類似度検索で '${bestMatch.documentName}' を選択しました。(類似度: ${highestSimilarity.toFixed(1)}%)`);
  } else {
    Logger.log("getBestMatchingDocumentName_: 全文類似度検索でも候補が見つかりませんでした。");
    // この場合 bestMatch は初期値 { documentName: "未判定", dateMarker: "" } のまま
  }


  return bestMatch;
}

/**
 * OCRテキストから日付情報を抽出します。
 * 複数の日付候補がある場合は、妥当性を判定して最適な日付を選択します。
 * 単一候補の場合でも、異常な年（外れ値）を検出・除外する妥当性チェックを実行します。
 * 
 * 処理の流れ:
 * 1. マーカー指定がある場合、マーカー周辺を優先的に検索
 * 2. 全文検索で追加の日付候補を収集
 * 3. 全ての候補（単一候補含む）に対して妥当性判定を実行
 * 4. 最も妥当な日付を選択して返却
 *
 * @param {string} ocrText - OCR処理で抽出されたテキスト。
 * @param {string} marker - 書類マスターで定義された日付マーカー文字列。空文字の場合もあります。
 * @returns {string} 抽出・整形された日付文字列 (YYYY/MM/DD形式)。見つからない、または妥当でなければ空文字列。
 */
function getDateFromOCR_(ocrText, marker) {
  const SCRIPT_NAME = "getDateFromOCR_";
  const normalized = normalizeText_(ocrText);

  // --- 事前チェック: OCRテキストの有効性確認 ---
  if (!normalized) {
    Logger.log(`[${SCRIPT_NAME}] OCRテキストが空のため、日付抽出をスキップします。`);
    return "";
  }

  Logger.log(`[${SCRIPT_NAME}] 日付抽出を開始します。OCRテキスト長: ${normalized.length}文字`);

  const dateCandidates = []; // 日付候補を格納する配列

  // --- 1. マーカー指定がある場合、マーカー周辺を優先的に検索 ---
  if (marker && marker.trim() !== "") {
    Logger.log(`[${SCRIPT_NAME}] 日付マーカー "${marker}" が指定されています。マーカー周辺を優先検索します。`);

    const markerNorm = normalizeText_(marker);
    const markerIndex = normalized.indexOf(markerNorm);

    if (markerIndex !== -1) {
      // マーカーが見つかった場合、その直後50文字を検索範囲とする
      const searchStartIndex = markerIndex + markerNorm.length;
      const searchEndIndex = searchStartIndex + 50;
      const textAroundMarker = normalized.substring(searchStartIndex, searchEndIndex);

      Logger.log(`[${SCRIPT_NAME}] マーカー "${markerNorm}" を位置${markerIndex}で発見。周辺テキスト: "${textAroundMarker}"`);

      // マーカー周辺から日付を抽出
      const markerDate = extractRawDate_(textAroundMarker);
      if (markerDate) {
        dateCandidates.push({
          date: markerDate,
          source: 'marker',
          priority: 1,
          description: `マーカー"${marker}"周辺から抽出`
        });
        Logger.log(`[${SCRIPT_NAME}] ✅ マーカー周辺で日付候補 "${markerDate}" を発見しました。`);
      } else {
        Logger.log(`[${SCRIPT_NAME}] ⚠️ マーカー周辺では日付が見つかりませんでした。`);
      }
    } else {
      Logger.log(`[${SCRIPT_NAME}] ⚠️ マーカー "${markerNorm}" がテキスト中に見つかりませんでした。`);
    }
  } else {
    Logger.log(`[${SCRIPT_NAME}] 日付マーカーの指定がないため、全文検索のみを実行します。`);
  }

  // --- 2. 全文検索で追加の日付候補を収集 ---
  Logger.log(`[${SCRIPT_NAME}] 全文検索で日付候補を探索します...`);

  const fullTextDate = extractRawDate_(normalized);
  if (fullTextDate) {
    // マーカー周辺と同じ日付でない場合のみ追加（重複排除）
    const isDuplicate = dateCandidates.some(candidate => candidate.date === fullTextDate);

    if (!isDuplicate) {
      dateCandidates.push({
        date: fullTextDate,
        source: 'fulltext',
        priority: 2,
        description: "全文検索から抽出"
      });
      Logger.log(`[${SCRIPT_NAME}] ✅ 全文検索で日付候補 "${fullTextDate}" を発見しました。`);
    } else {
      Logger.log(`[${SCRIPT_NAME}] 🔄 全文検索の結果 "${fullTextDate}" はマーカー周辺と同一のため、重複排除しました。`);
    }
  } else {
    Logger.log(`[${SCRIPT_NAME}] ⚠️ 全文検索でも日付が見つかりませんでした。`);
  }

  // --- 3. 日付候補の数に応じた処理分岐 ---
  Logger.log(`[${SCRIPT_NAME}] 日付候補の収集完了。候補数: ${dateCandidates.length}件`);

  // 候補がない場合
  if (dateCandidates.length === 0) {
    Logger.log(`[${SCRIPT_NAME}] ❌ 日付候補が見つかりませんでした。空文字列を返します。`);
    return "";
  }

  // 発見された候補の一覧をログ出力
  Logger.log(`[${SCRIPT_NAME}] === 発見された日付候補一覧 ===`);
  dateCandidates.forEach((candidate, index) => {
    Logger.log(`[${SCRIPT_NAME}] ${index + 1}. "${candidate.date}" (ソース: ${candidate.source}, 優先度: ${candidate.priority}, 説明: ${candidate.description})`);
  });

  // --- 4. すべての候補（単一候補含む）に対して妥当性判定を実行 ---
  Logger.log(`[${SCRIPT_NAME}] === 妥当性判定を開始します ===`);

  if (dateCandidates.length === 1) {
    Logger.log(`[${SCRIPT_NAME}] 単一候補ですが、外れ値除外のため妥当性チェックを実行します...`);
  } else {
    Logger.log(`[${SCRIPT_NAME}] 複数候補があるため、妥当性判定で最適な日付を選択します...`);
  }

  // 妥当性判定を実行
  const bestDate = selectMostReasonableDate_(dateCandidates);

  // --- 5. 結果の判定とログ出力 ---
  if (bestDate && bestDate.trim() !== "") {
    if (dateCandidates.length === 1) {
      Logger.log(`[${SCRIPT_NAME}] ✅ 単一候補 "${bestDate}" の妥当性チェック完了。採用します。`);
    } else {
      Logger.log(`[${SCRIPT_NAME}] ✅ ${dateCandidates.length}件の候補から "${bestDate}" を最適として選択しました。`);
    }

    // 選択された日付の詳細情報をログ出力
    const selectedCandidate = dateCandidates.find(c => c.date === bestDate);
    if (selectedCandidate) {
      Logger.log(`[${SCRIPT_NAME}] 📋 選択された日付の詳細: ${selectedCandidate.description}`);
    }

    Logger.log(`[${SCRIPT_NAME}] 🎯 最終決定: "${bestDate}" を返却します。`);
    return bestDate;

  } else {
    Logger.log(`[${SCRIPT_NAME}] ❌ 妥当性チェックの結果、すべての候補が不適切と判定されました。`);
    Logger.log(`[${SCRIPT_NAME}] 💡 考えられる原因: 異常な年（外れ値）、不正な月日、現在年から大きく離れた日付など`);
    Logger.log(`[${SCRIPT_NAME}] 🔄 空文字列を返却し、フォールバック処理に委ねます。`);
    return "";
  }
}

/**
 * 複数の日付候補から最も妥当な日付を選択します。
 * 年の妥当性（1900年以降、現在年+10年以下）、月日の妥当性、
 * 現在年からの距離、優先度（マーカー周辺優先）を総合的に評価します。
 * 
 * スコアリング基準:
 * - 基本スコア: マーカー周辺=20点、全文=10点
 * - 年の妥当性: 現在年±2年=30点、±5年=20点、±10年=10点
 * - 月の妥当性: 1-12月=5点
 * - 日の妥当性: 1-31日=5点
 * - 異常な年（1900年以前、現在年+10年以降）は除外
 * 
 * @param {Array<Object>} candidates - 日付候補の配列。各候補は { date, source, priority, description } 形式。
 * @returns {string} 最も妥当な日付文字列 (YYYY/MM/DD形式)。妥当な候補がなければ空文字列。
 */
function selectMostReasonableDate_(candidates) {
  const SCRIPT_NAME = "selectMostReasonableDate_";
  const currentYear = new Date().getFullYear();
  const scoredCandidates = [];

  Logger.log(`[${SCRIPT_NAME}] === 妥当性判定を開始 ===`);
  Logger.log(`[${SCRIPT_NAME}] 現在年: ${currentYear}年`);
  Logger.log(`[${SCRIPT_NAME}] 評価対象候補数: ${candidates.length}件`);

  // --- 各候補に対して妥当性スコアを計算 ---
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];

    Logger.log(`[${SCRIPT_NAME}] --- 候補${i + 1}: "${candidate.date}" の評価開始 ---`);
    Logger.log(`[${SCRIPT_NAME}] ソース: ${candidate.source}, 優先度: ${candidate.priority}`);

    // 日付文字列を年・月・日に分解
    const dateMatch = candidate.date.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
    if (!dateMatch) {
      Logger.log(`[${SCRIPT_NAME}] ❌ 日付形式が不正です。スキップします。パターン: ${candidate.date}`);
      continue;
    }

    const year = parseInt(dateMatch[1], 10);
    const month = parseInt(dateMatch[2], 10);
    const day = parseInt(dateMatch[3], 10);

    Logger.log(`[${SCRIPT_NAME}] 📅 分解結果: ${year}年${month}月${day}日`);

    // --- 年の妥当性チェック（最重要） ---
    let score = 0;
    const yearDiff = Math.abs(year - currentYear);

    Logger.log(`[${SCRIPT_NAME}] 📊 年の妥当性評価:`);
    Logger.log(`[${SCRIPT_NAME}]   - 現在年との差: ${yearDiff}年`);

    if (year < 1900 || year > currentYear + 10) {
      Logger.log(`[${SCRIPT_NAME}] ❌ 異常な年を検出: ${year}年`);
      Logger.log(`[${SCRIPT_NAME}]   - 理由: 1900年以前または現在年+10年以降`);
      Logger.log(`[${SCRIPT_NAME}]   - 判定: 外れ値として除外`);
      continue; // このエントリは除外
    }

    // 基本スコア（ソース優先度による）
    const baseScore = candidate.priority === 1 ? 20 : 10;
    score += baseScore;
    Logger.log(`[${SCRIPT_NAME}] ✅ 基本スコア: ${baseScore}点 (${candidate.source})`);

    // 年の距離によるスコア
    let yearScore = 0;
    if (yearDiff <= 2) {
      yearScore = 30;
      Logger.log(`[${SCRIPT_NAME}] ✅ 年評価: ${yearScore}点 (現在年±2年以内: 最高評価)`);
    } else if (yearDiff <= 5) {
      yearScore = 20;
      Logger.log(`[${SCRIPT_NAME}] ✅ 年評価: ${yearScore}点 (現在年±5年以内: 高評価)`);
    } else if (yearDiff <= 10) {
      yearScore = 10;
      Logger.log(`[${SCRIPT_NAME}] ✅ 年評価: ${yearScore}点 (現在年±10年以内: 中評価)`);
    } else {
      yearScore = 0;
      Logger.log(`[${SCRIPT_NAME}] ⚠️ 年評価: ${yearScore}点 (現在年から10年以上離れている: 低評価)`);
    }
    score += yearScore;

    // --- 月・日の妥当性チェック ---
    let monthScore = 0;
    if (month >= 1 && month <= 12) {
      monthScore = 5;
      Logger.log(`[${SCRIPT_NAME}] ✅ 月評価: ${monthScore}点 (${month}月: 正常範囲)`);
    } else {
      Logger.log(`[${SCRIPT_NAME}] ❌ 月評価: ${monthScore}点 (${month}月: 異常値)`);
    }
    score += monthScore;

    let dayScore = 0;
    if (day >= 1 && day <= 31) {
      dayScore = 5;
      Logger.log(`[${SCRIPT_NAME}] ✅ 日評価: ${dayScore}点 (${day}日: 正常範囲)`);
    } else {
      Logger.log(`[${SCRIPT_NAME}] ❌ 日評価: ${dayScore}点 (${day}日: 異常値)`);
    }
    score += dayScore;

    // --- 最終スコア記録 ---
    const finalScore = score;
    Logger.log(`[${SCRIPT_NAME}] 🎯 候補${i + 1}の最終スコア: ${finalScore}点`);
    Logger.log(`[${SCRIPT_NAME}]   - 内訳: 基本${baseScore} + 年${yearScore} + 月${monthScore} + 日${dayScore} = ${finalScore}`);

    scoredCandidates.push({
      ...candidate,
      year: year,
      month: month,
      day: day,
      score: finalScore,
      yearDiff: yearDiff
    });

    Logger.log(`[${SCRIPT_NAME}] ✅ 候補${i + 1} "${candidate.date}" を評価対象として登録しました。`);
  }

  // --- 妥当な候補が存在するかチェック ---
  Logger.log(`[${SCRIPT_NAME}] === 評価結果サマリー ===`);
  Logger.log(`[${SCRIPT_NAME}] 評価完了候補数: ${scoredCandidates.length}件 (除外: ${candidates.length - scoredCandidates.length}件)`);

  if (scoredCandidates.length === 0) {
    Logger.log(`[${SCRIPT_NAME}] ❌ 妥当な日付候補がありませんでした。`);
    Logger.log(`[${SCRIPT_NAME}] 💡 すべての候補が以下の理由で除外されました:`);
    Logger.log(`[${SCRIPT_NAME}]   - 異常な年（1900年以前または現在年+10年以降）`);
    Logger.log(`[${SCRIPT_NAME}]   - 不正な日付形式`);
    return "";
  }

  // --- 最高スコア順でソート ---
  scoredCandidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score; // スコア降順
    if (a.yearDiff !== b.yearDiff) return a.yearDiff - b.yearDiff; // 年差昇順（より現在に近い）
    return a.priority - b.priority; // 優先度昇順（マーカー周辺優先）
  });

  // --- ソート結果をログ出力 ---
  Logger.log(`[${SCRIPT_NAME}] === スコア順ランキング ===`);
  scoredCandidates.forEach((candidate, index) => {
    const rank = index + 1;
    const badge = rank === 1 ? "🏆" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `${rank}.`;
    Logger.log(`[${SCRIPT_NAME}] ${badge} "${candidate.date}" - ${candidate.score}点 (年差:${candidate.yearDiff}, ${candidate.description})`);
  });

  // --- 最高評価の候補を選択 ---
  const selected = scoredCandidates[0];

  Logger.log(`[${SCRIPT_NAME}] === 最終選択結果 ===`);
  Logger.log(`[${SCRIPT_NAME}] 🏆 選択された日付: "${selected.date}"`);
  Logger.log(`[${SCRIPT_NAME}] 📊 最終スコア: ${selected.score}点`);
  Logger.log(`[${SCRIPT_NAME}] 📍 抽出ソース: ${selected.source} (${selected.description})`);
  Logger.log(`[${SCRIPT_NAME}] ⏰ 現在年との差: ${selected.yearDiff}年`);
  Logger.log(`[${SCRIPT_NAME}] 🎯 選択理由: 最高スコアを獲得した最も妥当な日付`);

  return selected.date;
}

/**
 * 文字列中の全角数字（０～９）を半角数字（0～9）に変換します。
 *
 * @param {string} str - 変換対象の文字列。
 * @returns {string} 全角数字が半角に変換された文字列。入力が null や undefined の場合は空文字列を返します。
 */
function convertFullWidthToHalfWidth_(str) {
  if (!str) return "";
  return str.replace(/[０-９]/g, function (char) {
    return String.fromCharCode(char.charCodeAt(0) - 0xFEE0); // Unicodeの差分を利用
  });
}

/**
 * 年・月・日を 'YYYY/MM/DD' 形式の文字列に整形します。
 * 月と日は常に2桁になるようにゼロ埋めされます。
 *
 * @param {number|string} year - 年 (4桁推奨)。
 * @param {number|string} month - 月 (1～12)。
 * @param {number|string} day - 日 (1～31)。
 * @returns {string} 'YYYY/MM/DD' 形式の日付文字列。
 */
function formatDate_(year, month, day) {
  const y = String(year);
  const m = String(month).padStart(2, "0"); // 2桁になるよう左側を0で埋める
  const d = String(day).padStart(2, "0"); // 2桁になるよう左側を0で埋める
  return `${y}/${m}/${d}`;
}

/**
 * 修正版: テキスト内から日付表現を抽出し、'YYYY/MM/DD' 形式に変換して返します。
 * 令和年月パターンを最優先し、OCR誤読みに対応します。
 * 
 * 修正された優先順位:
 * 1. [元号]年月分 (最優先: 「令和7年5月分」)
 * 2. [元号]年月日 (「令和7年4月25日」)
 * 3. [元号]年月 (「令和7年5月」)
 * 4. YYYY年MM月 (「2025年5月」)
 * 5. YYYY/MM/DD (「2025/05/30」- FAX日時等)
 * 6. YYYY年MM月DD日 (誤検出が多いため後回し)
 * 7. YY/MM/DD
 *
 * @param {string} text - 日付抽出対象のテキスト。
 * @returns {string} 'YYYY/MM/DD' 形式の日付文字列。年月のみの場合は'YYYY/MM/01'。マッチしなければ空文字列。
 */
function extractRawDate_(text) {
  const SCRIPT_NAME = "extractRawDate_";

  if (!text) {
    Logger.log(`[${SCRIPT_NAME}] 入力テキストが空です`);
    return "";
  }

  Logger.log(`[${SCRIPT_NAME}] 日付抽出開始 - 元テキスト: "${text.substring(0, 100)}..."`);

  // === 最優先: 前処理前の元号パターン直接検索 ===
  Logger.log(`[${SCRIPT_NAME}] 【最優先】前処理前の元号パターン検索...`);

  // パターン1: 令和X年Y月分 (最重要!)
  let match = text.match(/令和(\d{1,2})年(\d{1,2})月分/);
  if (match) {
    const eraYear = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const adYear = eraYear + 2018; // 令和元年 = 2019年
    const result = formatDate_(adYear, month, 1);
    Logger.log(`[${SCRIPT_NAME}] ✅ 【最重要】令和年月分パターン: "${match[0]}" -> "${result}"`);
    return result;
  }

  // パターン2: 令和X年Y月Z日
  match = text.match(/令和(\d{1,2})年(\d{1,2})月(\d{1,2})日/);
  if (match) {
    const eraYear = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const day = parseInt(match[3], 10);
    const adYear = eraYear + 2018;
    const result = formatDate_(adYear, month, day);
    Logger.log(`[${SCRIPT_NAME}] ✅ 令和年月日パターン: "${match[0]}" -> "${result}"`);
    return result;
  }

  // パターン3: 令和X年Y月
  match = text.match(/令和(\d{1,2})年(\d{1,2})月/);
  if (match) {
    const eraYear = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const adYear = eraYear + 2018;
    const result = formatDate_(adYear, month, 1);
    Logger.log(`[${SCRIPT_NAME}] ✅ 令和年月パターン: "${match[0]}" -> "${result}"`);
    return result;
  }

  // パターン4: 平成・昭和・大正パターン
  const eraPatterns = [
    { regex: /([Hh平成])(\d{1,2})年(\d{1,2})月(\d{1,2})日/, era: 'H', hasDay: true },
    { regex: /([Hh平成])(\d{1,2})年(\d{1,2})月/, era: 'H', hasDay: false },
    { regex: /([Ss昭和])(\d{1,2})年(\d{1,2})月(\d{1,2})日/, era: 'S', hasDay: true },
    { regex: /([Ss昭和])(\d{1,2})年(\d{1,2})月/, era: 'S', hasDay: false },
    { regex: /([Tt大正])(\d{1,2})年(\d{1,2})月(\d{1,2})日/, era: 'T', hasDay: true },
    { regex: /([Tt大正])(\d{1,2})年(\d{1,2})月/, era: 'T', hasDay: false }
  ];

  for (const pattern of eraPatterns) {
    match = text.match(pattern.regex);
    if (match) {
      const eraYear = parseInt(match[2], 10);
      const month = parseInt(match[3], 10);
      const day = pattern.hasDay ? parseInt(match[4], 10) : 1;

      const adYear = convertEraToWesternYear_(pattern.era, eraYear);
      if (adYear > 0) {
        const result = formatDate_(adYear, month, day);
        Logger.log(`[${SCRIPT_NAME}] ✅ ${pattern.era}年号パターン: "${match[0]}" -> "${result}"`);
        return result;
      }
    }
  }

  // === 前処理実行 ===
  Logger.log(`[${SCRIPT_NAME}] 元号パターン見つからず。前処理を実行...`);

  let correctedText = convertFullWidthToHalfWidth_(text);
  correctedText = correctedText.replace(/／/g, "/").replace(/[｜Il]/g, "1");
  correctedText = correctedText.replace(/\s+/g, "");

  Logger.log(`[${SCRIPT_NAME}] 補正後テキスト: "${correctedText.substring(0, 100)}..."`);

  // === 前処理後の元号パターン ===
  const normalizedEraPatterns = [
    /([Rr令和])(\d{1,2})年(\d{1,2})月(\d{1,2})日/,
    /([Rr令和])(\d{1,2})年(\d{1,2})月/,
    /([Hh平成])(\d{1,2})年(\d{1,2})月(\d{1,2})日/,
    /([Hh平成])(\d{1,2})年(\d{1,2})月/
  ];

  for (const pattern of normalizedEraPatterns) {
    match = correctedText.match(pattern);
    if (match) {
      const eraChar = match[1];
      const eraYear = parseInt(match[2], 10);
      const month = parseInt(match[3], 10);
      const day = match[4] ? parseInt(match[4], 10) : 1;

      const adYear = convertEraToWesternYear_(eraChar, eraYear);
      if (adYear > 0) {
        const result = formatDate_(adYear, month, day);
        Logger.log(`[${SCRIPT_NAME}] ✅ 正規化後元号パターン: "${match[0]}" -> "${result}"`);
        return result;
      }
    }
  }

  // === 西暦パターン（範囲チェック付き） ===
  Logger.log(`[${SCRIPT_NAME}] 西暦パターン検索...`);

  // YYYY年MM月 形式 (年月のみ)
  match = correctedText.match(/(\d{4})年(\d{1,2})月/);
  if (match) {
    const year = parseInt(match[1], 10);
    if (year >= 1900 && year <= 2050) {
      const result = formatDate_(match[1], match[2], 1);
      Logger.log(`[${SCRIPT_NAME}] ✅ YYYY年MM月: "${match[0]}" -> "${result}"`);
      return result;
    } else {
      Logger.log(`[${SCRIPT_NAME}] ⚠️ YYYY年MM月で範囲外年: ${year}年`);
    }
  }

  // YYYY/MM/DD 形式
  match = correctedText.match(/(\d{4})[/.\-](\d{1,2})[/.\-](\d{1,2})/);
  if (match) {
    const year = parseInt(match[1], 10);
    if (year >= 1900 && year <= 2050) {
      const result = formatDate_(match[1], match[2], match[3]);
      Logger.log(`[${SCRIPT_NAME}] ✅ YYYY/MM/DD: "${match[0]}" -> "${result}"`);
      return result;
    } else {
      Logger.log(`[${SCRIPT_NAME}] ⚠️ YYYY/MM/DDで範囲外年: ${year}年`);
    }
  }

  // YYYY年MM月DD日 形式 (最も誤検出しやすいため最後)
  match = correctedText.match(/(\d{2,4})年(\d{1,2})月(\d{1,2})日/);
  if (match) {
    let year = match[1];
    if (year.length === 2) {
      year = "20" + year;
    }
    const yearNum = parseInt(year, 10);

    Logger.log(`[${SCRIPT_NAME}] YYYY年MM月DD日候補: "${match[0]}" (年: ${yearNum})`);

    if (yearNum >= 1900 && yearNum <= 2050) {
      const result = formatDate_(year, match[2], match[3]);
      Logger.log(`[${SCRIPT_NAME}] ✅ YYYY年MM月DD日: "${match[0]}" -> "${result}"`);
      return result;
    } else {
      Logger.log(`[${SCRIPT_NAME}] ❌ YYYY年MM月DD日で異常年除外: ${yearNum}年 (おそらく誤検出)`);
    }
  }

  // YY/MM/DD 形式
  match = correctedText.match(/(\d{2})[/.\-](\d{1,2})[/.\-](\d{1,2})/);
  if (match) {
    const yearNum = parseInt(match[1], 10);
    const currentYearLastTwoDigits = new Date().getFullYear() % 100;

    let fullYear;
    if (yearNum > (currentYearLastTwoDigits + 5) && yearNum >= 70) {
      fullYear = "19" + match[1];
    } else {
      fullYear = "20" + match[1];
    }

    const result = formatDate_(fullYear, match[2], match[3]);
    Logger.log(`[${SCRIPT_NAME}] ✅ YY/MM/DD: "${match[0]}" -> "${result}"`);
    return result;
  }

  Logger.log(`[${SCRIPT_NAME}] ❌ 有効な日付パターンが見つかりませんでした`);
  return "";
}

/**
 * 元号と年数を西暦に変換する関数
 * @param {string} eraChar 元号文字（令和、R、平成、H等）
 * @param {number} eraYear 元号の年数
 * @returns {number} 西暦年。変換できない場合は-1
 */
function convertEraToWesternYear_(eraChar, eraYear) {
  const SCRIPT_NAME = "convertEraToWesternYear_";

  if (!eraChar || eraYear < 1) {
    Logger.log(`[${SCRIPT_NAME}] 無効な元号情報: "${eraChar}", ${eraYear}年`);
    return -1;
  }

  const normalizedEra = eraChar.toUpperCase();
  let adYear = -1;

  // 元号対応表
  if (normalizedEra === 'R' || normalizedEra.includes('令') || normalizedEra.includes('和')) {
    // 令和元年 = 2019年
    adYear = eraYear + 2018;
    Logger.log(`[${SCRIPT_NAME}] 令和${eraYear}年 -> ${adYear}年に変換`);
  } else if (normalizedEra === 'H' || normalizedEra.includes('平') || normalizedEra.includes('成')) {
    // 平成元年 = 1989年
    adYear = eraYear + 1988;
    Logger.log(`[${SCRIPT_NAME}] 平成${eraYear}年 -> ${adYear}年に変換`);
  } else if (normalizedEra === 'S' || normalizedEra.includes('昭')) {
    // 昭和元年 = 1926年
    adYear = eraYear + 1925;
    Logger.log(`[${SCRIPT_NAME}] 昭和${eraYear}年 -> ${adYear}年に変換`);
  } else if (normalizedEra === 'T' || normalizedEra.includes('大') || normalizedEra.includes('正')) {
    // 大正元年 = 1912年
    adYear = eraYear + 1911;
    Logger.log(`[${SCRIPT_NAME}] 大正${eraYear}年 -> ${adYear}年に変換`);
  } else {
    Logger.log(`[${SCRIPT_NAME}] 未知の元号: "${eraChar}"`);
    return -1;
  }

  // 妥当性チェック
  const currentYear = new Date().getFullYear();
  if (adYear < 1900 || adYear > currentYear + 50) {
    Logger.log(`[${SCRIPT_NAME}] 変換結果が異常値: ${adYear}年 (元号: ${eraChar}${eraYear}年)`);
    return -1;
  }

  return adYear;
}