/**
 * ==================================================================
 * AppSheet連携 新規ファイル処理用スクリプト (キー値検索版)
 * ==================================================================
 *
 * このスクリプトは、AppSheet Automationから呼び出され、
 * Google Drive上の指定フォルダ内に新規保存されたファイルを、
 * ファイル名の先頭部分（AppSheetのキー値に相当）で検索し、
 * 指定されたメタデータに基づいてファイル名を変更し、
 * 新しいファイル名、ファイルID、ファイルURL、MIMEタイプをAppSheetに返します。
 *
 * 必要な関数:
 * - processNewFileFromAppSheet (エントリーポイント)
 * - generateUniqueFileName (ファイル名生成ロジック)
 * - sanitizeFileName (ファイル名サニタイズ)
 * - getToday (日付取得ユーティリティ)
 */

/**
 * AppSheet Automationから呼び出され、新規保存されたファイルを検索・リネームし、URL等を返す関数。
 * ファイル名の最初のピリオド(.)までの部分がAppSheetのキー値と一致するファイルを検索します。
 *
 * @param {string} targetFolderId   - 検索対象のGoogle DriveフォルダID (必須)。AppSheetがファイルを保存した場所。
 * @param {string} fileKey          - AppSheetのキー値 (必須)。ファイル名の最初の '.' までの部分と一致する想定。例: "d844c65e"
 * @param {string} documentName     - リネームに使用する書類名。
 * @param {string} customerName     - リネームに使用する顧客名。
 * @param {string} officeName       - リネームに使用する事業所名。
 * @param {string} fileDate         - リネームに使用する日付 (AppSheetからはYYYY-MM-DDTHH:mm:ss または YYYY-MM-DD 等の形式を想定)。
 * @returns {Object}                - 処理結果を示すオブジェクト。
 * 例: { status: "success", fileId: "...", newName: "...", fileUrl: "...", mimeType: "...", renameSkipped: false }
 * 例: { status: "not_found", message: "ファイルが見つかりません..." }
 * 例: { status: "error", message: "エラーメッセージ" }
 */
function processNewFileFromAppSheet(targetFolderId, fileKey, documentName, customerName, officeName, fileDate) {
  Logger.log(`processNewFileFromAppSheet: 処理開始 - FolderID: ${targetFolderId}, FileKey: ${fileKey}`);
  Logger.log(`   引数 - 書類名: ${documentName}, 顧客名: ${customerName}, 事業所名: ${officeName}, 日付(AppSheetから): ${fileDate}`);

  // === 入力チェック ===
  // 必須パラメータが指定されているかを確認
  if (!targetFolderId || !fileKey) {
    const errorMessage = "必須パラメータ 'targetFolderId' または 'fileKey' が指定されていません。";
    Logger.log(`processNewFileFromAppSheet: エラー - ${errorMessage}`);
    return { status: "error", message: errorMessage };
  }

  try {
    // === フォルダオブジェクト取得 ===
    let folder;
    try {
      // 指定されたフォルダIDでGoogle Driveのフォルダを取得
      folder = DriveApp.getFolderById(targetFolderId);
    } catch (e) {
      // フォルダ取得に失敗した場合のエラーハンドリング
      const errorMessage = `指定されたFolder ID (${targetFolderId}) でフォルダを取得できませんでした。IDが正しいか、アクセス権限があるか確認してください。詳細: ${e.message}`;
      Logger.log(`processNewFileFromAppSheet: エラー - ${errorMessage}`);
      return { status: "error", message: errorMessage };
    }
    Logger.log(`   検索対象フォルダ: "${folder.getName()}"`);

    // === ファイル検索 (ファイル名の先頭が fileKey と一致するものを検索) ===
    Logger.log(`   フォルダ "${folder.getName()}" 内のファイルを検索し、名前の先頭が "${fileKey}" で始まるものを探します...`);
    const files = folder.getFiles(); // フォルダ内の全ファイルを取得

    let targetFile = null;
    let fileId = null;
    let foundCount = 0;

    // フォルダ内のファイルを一つずつ確認
    while (files.hasNext()) {
      const currentFile = files.next();
      const currentName = currentFile.getName();

      // ファイル名の最初のピリオド(.)までの部分を取得し、キーとして使用
      const nameParts = currentName.split('.');
      const keyPart = nameParts[0];

      // 取得したキー部分が引数の fileKey と完全に一致するかチェック
      if (keyPart === fileKey) {
        foundCount++;
        if (foundCount === 1) {
          // 最初に見つかったファイルを処理対象とする
          targetFile = currentFile;
          fileId = targetFile.getId();
          Logger.log(`   ファイル発見: "${currentName}", ID: ${fileId}`);
        } else {
          // 2つ目以降が見つかった場合は警告をログに出力
          Logger.log(`   警告: Keyが "${fileKey}" で始まるファイルが複数見つかりました。最初のファイル "${targetFile.getName()}" を処理対象とします。(他候補: "${currentName}")`);
          // ※ ここで処理を中断し、エラーを返すことも可能だが、今回は最初のファイルで続行
          // return { status: "error", message: `Key '${fileKey}' で始まるファイルが複数見つかりました。` };
        }
      }
    } // End while (ファイル検索ループ終了)

    // === ファイルが見つからなかった場合の処理 ===
    if (!targetFile) {
      const message = `指定されたフォルダ内に、名前が '${fileKey}.' で始まるファイルが見つかりませんでした。ファイルがまだ保存されていないか、キー値がファイル名と一致しない可能性があります。`;
      Logger.log(`processNewFileFromAppSheet: Not Found - ${message}`);
      return { status: "not_found", message: message };
    }

    // === ファイルが見つかった場合の処理 ===
    const currentName = targetFile.getName(); // 対象ファイルの現在の名前
    const mimeType = targetFile.getMimeType(); // ファイルのMIMEタイプを取得
    Logger.log(`   処理対象ファイル確定: "${currentName}", MIME: ${mimeType}`);

    // === 拡張子取得 ===
    // ファイル名にピリオドが含まれていれば、最後のピリオド以降を拡張子とする
    const extension = currentName.includes('.') ? "." + currentName.split('.').pop() : "";
    Logger.log(`   検出された拡張子: "${extension}"`);

    // === AppSheetから渡された日付をYYYY/MM/DD形式に変換 ===
    let formattedFileDate = "";
    if (fileDate && typeof fileDate === 'string') {
      try {
        // AppSheetが渡す可能性のある日付形式をチェック
        if (fileDate.includes('T')) {
          // 例: 2024-05-25T10:00:00 のような形式の場合、日付部分のみ抽出
          const datePart = fileDate.split('T')[0];
          formattedFileDate = datePart.replace(/-/g, '/'); // ハイフンをスラッシュに置換
          Logger.log(`   日付変換: AppSheet形式(YYYY-MM-DDTHH:mm:ss) → YYYY/MM/DD形式(${formattedFileDate})`);
        } else if (/^\d{4}\/\d{2}\/\d{2}$/.test(fileDate)) {
          // 例: 2024/05/25 のような形式の場合、そのまま使用
          formattedFileDate = fileDate;
          Logger.log(`   日付形式: AppSheetからYYYY/MM/DD形式(${formattedFileDate})で渡されました。`);
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(fileDate)) {
          // 例: 2024-05-25 のような形式の場合、ハイフンをスラッシュに置換
          formattedFileDate = fileDate.replace(/-/g, '/');
          Logger.log(`   日付変換: AppSheet形式(YYYY-MM-DD) → YYYY/MM/DD形式(${formattedFileDate})`);
        } else {
          // 認識できない形式の場合はログ出力
          Logger.log(`   日付形式: AppSheetからの日付(${fileDate})は認識できない形式です。`);
        }
        // 最終的にYYYY/MM/DD形式になっているか再確認
        if (formattedFileDate !== "" && !/^\d{4}\/\d{2}\/\d{2}$/.test(formattedFileDate)) {
          Logger.log(`   日付変換エラー: 変換後の形式(${formattedFileDate})が不正です。日付はファイル名に含めません。`);
          formattedFileDate = ""; // 不正な場合は空にする
        }
      } catch (dateError) {
        // 日付変換中にエラーが発生した場合
        Logger.log(`   日付変換中にエラーが発生しました: ${dateError.message}。日付はファイル名に含めません。`);
        formattedFileDate = ""; // エラー時も空にする
      }
    } else {
      // AppSheetから日付が渡されなかった場合
      Logger.log(`   日付情報: AppSheetから日付が渡されませんでした。日付はファイル名に含めません。`);
    }

    // === 新しいファイル名生成のための情報準備 ===
    const extractedInfo = {
      documentName: documentName || "未判定", // 書類名がなければ"未判定"
      customerName: customerName || "未判定", // 顧客名がなければ"未判定"
      officeName: officeName || "未判定",     // 事業所名がなければ"未判定"
      fileDate: formattedFileDate              // フォーマットされた日付（または空文字）
    };
    Logger.log(`   ファイル名生成用情報: ${JSON.stringify(extractedInfo)}`);

    // === 新しいファイル名生成 (依存関数を利用) ===
    // ファイルIDは検索で見つけたものを使用
    const newName = generateUniqueFileName(extractedInfo, fileId, extension);
    Logger.log(`   生成された新ファイル名候補: "${newName}"`);

    // === ファイル名比較と更新 ===
    let finalName = currentName; // 最終的なファイル名を保持
    let fileUrl = targetFile.getUrl(); // ファイルの共有URLを取得
    let renameSkipped = false; // 名前変更がスキップされたかどうかのフラグ

    // 現在のファイル名と生成された新しいファイル名が同じ場合は、リネームをスキップ
    if (currentName === newName) {
      Logger.log(`processNewFileFromAppSheet: ファイル名は既に "${newName}" です。変更はスキップします。`);
      renameSkipped = true;
    } else {
      try {
        // ファイル名を新しい名前に変更
        targetFile.setName(newName);
        finalName = newName; // 更新後の名前をセット
        // 必要であればURL再取得: fileUrl = targetFile.getUrl(); // URLはファイル名変更で変わらない場合が多いが、念のため
        Logger.log(`processNewFileFromAppSheet: ファイル名を "${currentName}" から "${newName}" に変更しました。`);
      } catch (renameError) {
        // ファイル名の変更に失敗した場合のエラーハンドリング
        const errorMessage = `ファイル名の変更に失敗しました: ${renameError.message}`;
        Logger.log(`processNewFileFromAppSheet: エラー - ${errorMessage}`);
        // 失敗した場合も、元のファイル情報は返すように調整可能だが、ここではエラーとして処理を中断
        return { status: "error", message: errorMessage };
      }
    }

    // === 成功結果を返す ===
    Logger.log(`processNewFileFromAppSheet: 処理成功。FileID: ${fileId}, FinalName: ${finalName}, URL: ${fileUrl}, MIME: ${mimeType}`);
    return {
      status: "success",
      fileId: fileId,
      newName: finalName,
      fileUrl: fileUrl,
      mimeType: mimeType,        // MIMEタイプを戻り値に追加
      renameSkipped: renameSkipped
    };

  } catch (error) {
    // === 予期せぬエラー処理 ===
    const errorMessage = `新規ファイル処理中に予期せぬエラーが発生しました: ${error.message}`;
    Logger.log(`processNewFileFromAppSheet: 重大エラー - ${errorMessage}`);
    Logger.log(error.stack); // エラースタックトレースもログに出力
    return { status: "error", message: errorMessage };
  }
}


/**
 * ==================================================================
 * 依存関数
 * ==================================================================
 * 上記 processNewFileFromAppSheet 関数が動作するために必要な関数群です。
 */

/**
 * 抽出された情報に基づいて、Google Drive上で一意となるファイル名を生成します。
 *
 * 形式: [日付(YYYYMMDD、任意)]_[顧客名]_[事業所名(任意)]_[書類名]_[ファイルID先頭8文字].[元拡張子]
 * 日付が指定されない、または不正な形式の場合は日付部分は**無記入**になります。
 * 各要素が"未判定"の場合は代替文字列 (例: "不明文書", "不明顧客") を使用します。
 *
 * @param {Object} extractedInfo - AppSheet等から渡された情報。
 * @param {string} extractedInfo.documentName - 識別された書類名 ("未判定" の場合あり)。
 * @param {string} extractedInfo.customerName - 識別された顧客名 ("未判定" の場合あり)。
 * @param {string} extractedInfo.officeName - 識別された事業所名 ("未判定" の場合あり)。
 * @param {string} extractedInfo.fileDate - 抽出された日付 (YYYY/MM/DD形式、空文字の場合あり)。
 * @param {string} fileId - Google Drive のファイルID。ファイル名の一意性を保証するために使用。nullの場合も考慮。
 * @param {string} originalExtension - 元ファイルの拡張子 (例: ".pdf", ".jpg")。
 * @returns {string} 生成された新しいファイル名。ファイル名として不適切な文字は '_' に置換されます。
 */
function generateUniqueFileName(extractedInfo, fileId, originalExtension) {
  // 引数から各情報を取得し、null/undefinedの場合は空文字にする
  // 各情報から半角/全角スペースを削除する処理を追加
  const documentName = (extractedInfo.documentName || "").replace(/[\s　]/g, "");
  const customerName = (extractedInfo.customerName || "").replace(/[\s　]/g, "");
  const officeName = (extractedInfo.officeName || "").replace(/[\s　]/g, "");
  const fileDate = extractedInfo.fileDate || ""; // formattedFileDateが渡される

  // 各要素が存在し、かつ "未判定" でないかチェック。そうでなければ代替文字列を使用。
  const docName = (documentName && documentName !== "未判定") ? documentName : "不明文書";
  const custName = (customerName && customerName !== "未判定") ? customerName : "不明顧客";

  // 日付部分の文字列を生成
  let dateStr;
  if (fileDate && fileDate.trim() !== "" && /^\d{4}\/\d{2}\/\d{2}$/.test(fileDate)) {
    // 抽出された日付がYYYY/MM/DD 形式であればYYYYMMDD 形式に変換して使用
    dateStr = fileDate.replace(/\//g, "");
  } else {
    // AppSheetから日付が渡されなかった、または不正な形式だった場合は、日付部分を空文字列にする
    dateStr = "";
    // 必要であれば、ここでログ出力などを追加できます
    // Logger.log("日付がAppSheetから渡されなかったか、不正な形式だったため、日付をファイル名に含めません。");
  }

  // 事業所名部分の文字列を生成 (存在し、"未判定"でなければ追加)
  const officePrefix = (officeName && officeName !== "未判定")
    ? `${officeName}_` // 事業所名があれば、その後にアンダースコアを付けて追加
    : ""; // 事業所名がなければ空文字列

  // ファイルIDの先頭8文字を取得 (ファイル名の一意性確保と短縮化のため)
  // fileId が null や undefined の場合も考慮し、"noFileId"とする
  const shortFileId = fileId ? String(fileId).substring(0, 8) : "noFileId";

  // 各パーツをアンダースコアで結合してファイル名を構築
  // 日付部分が空の場合、最初のアンダースコアは後でsanitizeFileNameで削除される
  const fileName = `${dateStr}_${custName}_${officePrefix}${docName}_${shortFileId}${originalExtension}`;

  // ファイル名として使用できない文字を置換し、余分なアンダースコアを整理して最終的なファイル名を返す
  const sanitizedFileName = sanitizeFileName(fileName);
  return sanitizedFileName;
}

/**
 * ファイル名に使用できない文字をアンダースコア '_' に置換します。
 * Google Drive および一般的なOSで問題を起こしやすい文字を対象とします。
 * また、スペース（全角・半角）もアンダースコアに置換し、
 * 連続するアンダースコアは1つにまとめます。
 * 最後に、先頭・末尾のアンダースコアは削除します。
 *
 * @param {string} fileName - サニタイズ対象のファイル名文字列。
 * @returns {string} サニタイズ後のファイル名文字列。nullや空の場合は"invalid_filename"。
 */
function sanitizeFileName(fileName) {
  // nullや空文字の場合、デフォルトのファイル名を返す
  if (!fileName) return "invalid_filename";

  // 1. WindowsやGoogle Driveでファイル名として禁止されている文字（\ / : * ? " < > |）を '_' に置換
  let sanitized = String(fileName).replace(/[\\/:*?"<>|]/g, "_");
  // 2. 全角・半角スペースを '_' に置換
  sanitized = sanitized.replace(/[\s　]+/g, "_");
  // 3. 連続するアンダースコア (例: ___) を一つにまとめる (例: _)
  sanitized = sanitized.replace(/_+/g, "_");
  // 4. ファイル名の先頭または末尾にあるアンダースコアを削除する (例: _filename_ -> filename)
  sanitized = sanitized.replace(/^_|_$/g, "");
  // 5. サニタイズの結果、ファイル名が空になった場合 (例: "///" など禁止文字だけで構成されていた場合)
  if (!sanitized) {
    sanitized = "invalid_filename"; // デフォルトのファイル名を指定
  }
  return sanitized;
}

/**
 * 現在の日付を 'YYYYMMDD' 形式の文字列で取得します。
 * この関数は、今回は直接ファイル名生成には使用されませんが、
 * 日付関連の処理で参照される可能性があるため残しています。
 * タイムゾーンはスクリプトが実行される環境（通常は日本のサーバー）に依存します。
 *
 * @returns {string} 'YYYYMMDD' 形式の現在日付文字列。
 */
function getToday() {
  const today = new Date();
  const year = today.getFullYear();
  // getMonth() は 0始まり（1月が0）なので +1 する。padStartで2桁ゼロ埋め。
  const month = String(today.getMonth() + 1).padStart(2, "0");
  // getDate() は日。padStartで2桁ゼロ埋め。
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}