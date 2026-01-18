/**
 * ==================================================================
 * AppSheet連携 ファイル名更新用スクリプト
 * ==================================================================
 *
 * このスクリプトは、AppSheet Automationから呼び出され、
 * Google Drive上のファイルのファイル名を、AppSheet上で更新された
 * メタデータ（書類名、顧客名、事業所名、日付）に基づいて更新します。
 *
 * 必要な関数:
 * - renameFileFromAppSheet (エントリーポイント)
 * - generateUniqueFileName (ファイル名生成ロジック)
 * - sanitizeFileName (ファイル名サニタイズ)
 * - getToday (日付取得ユーティリティ)
 */

/**
 * AppSheet Automationから呼び出され、Google Drive上のファイル名を更新します。
 */
function renameFileFromAppSheet(fileId, documentName, customerName, officeName, fileDate) {
  Logger.log(`renameFileFromAppSheet: 処理開始 - FileID: ${fileId}`);
  Logger.log(`   引数 - 書類名: ${documentName}, 顧客名: ${customerName}, 事業所名: ${officeName}, 日付(AppSheetから): ${fileDate}`);

  if (!fileId) {
    const errorMessage = "必須パラメータ 'fileId' が指定されていません。";
    Logger.log(`Error: ${errorMessage}`);
    // エラー時はオブジェクトを返す
    return { status: 'error', message: errorMessage };
  }

  try {
    // ファイル取得
    let file;
    try {
      file = DriveApp.getFileById(fileId);
    } catch (e) {
      const errorMessage = `File ID (${fileId}) でファイルを取得できませんでした: ${e.message}`;
      Logger.log(`Error: ${errorMessage}`);
      // エラー時はオブジェクトを返す
      return { status: 'error', message: errorMessage };
    }

    const currentName = file.getName();
    const extension = currentName.includes('.') ? '.' + currentName.split('.').pop() : '';

    // 日付フォーマット
    let formattedFileDate = '';
    if (fileDate) {
      if (fileDate.includes('T')) {
        formattedFileDate = fileDate.split('T')[0].replace(/-/g, '/');
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(fileDate)) {
        formattedFileDate = fileDate.replace(/-/g, '/');
      } else if (/^\d{4}\/\d{2}\/\d{2}$/.test(fileDate)) {
        formattedFileDate = fileDate;
      }
      if (formattedFileDate && !/^\d{4}\/\d{2}\/\d{2}$/.test(formattedFileDate)) formattedFileDate = '';
    }

    const extractedInfo = {
      documentName: documentName || '未判定',
      customerName: customerName || '未判定',
      officeName: officeName || '未判定',
      fileDate: formattedFileDate
    };
    Logger.log(`Info: ${JSON.stringify(extractedInfo)}`);

    const newName = generateUniqueFileName(extractedInfo, fileId, extension);
    if (currentName === newName) {
      Logger.log('Info: ファイル名は最新のためスキップ');
      // スキップ時はオブジェクトを返す
      return { status: 'skipped', newName: currentName, message: '最新です' };
    }

    file.setName(newName);
    Logger.log(`Info: 名前を${currentName}から${newName}に変更`);
    // 成功時はstatus: trueを含むオブジェクトを返す
    return { status: true, newName: newName };

  } catch (err) {
    const errorMessage = `予期せぬエラー: ${err.message}`;
    Logger.log(`Error: ${errorMessage}`);
    // 予期せぬエラー時はオブジェクトを返す
    return { status: 'error', message: errorMessage };
  }
}

/**
 * 情報を元に一意のファイル名を生成します。
 * 個別フィールドのスペース (全角/半角) を除去するよう変更。
 */
function generateUniqueFileName(info, fileId, originalExtension) {
  // 各フィールドからスペース除去
  const docRaw = info.documentName;
  const custRaw = info.customerName;
  const officeRaw = info.officeName;
  const docClean = docRaw.replace(/[\s　]+/g, '');
  const custClean = custRaw.replace(/[\s　]+/g, '');
  const officeClean = officeRaw.replace(/[\s　]+/g, '');

  const docName = docClean && docClean !== '未判定' ? docClean : '不明文書';
  const custName = custClean && custClean !== '未判定' ? custClean : '不明顧客';
  const officeSegment = officeClean && officeClean !== '未判定' ? officeClean + '_' : '';

  // 日付文字列生成
  let dateStr;
  if (info.fileDate && /^\d{4}\/\d{2}\/\d{2}$/.test(info.fileDate)) {
    dateStr = info.fileDate.replace(/\//g, '');
  } else {
    dateStr = '登録日' + getToday();
  }

  const shortId = fileId.slice(0, 8);
  const baseName = `${dateStr}_${custName}_${officeSegment}${docName}_${shortId}${originalExtension}`;
  return sanitizeFileName(baseName);
}

/**
 * ファイル名に使えない文字を '_' に置換します。
 */
function sanitizeFileName(name) {
  if (!name) return '';
  let s = name.replace(/[\\/:*?"<>|]/g, '_');
  s = s.replace(/_+/g, '_').replace(/^_|_$/g, '');
  return s;
}

/**
 * 現在日付をYYYYMMDDで取得します。
 */
function getToday() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}