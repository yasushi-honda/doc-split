/**
 * AppSheet連携用：ファイルのOCR処理フォルダへの移動
 *
 * 指定されたファイルをOCR処理用のフォルダへ移動します。
 * ファイルの移動が成功したか、および次のステップへ進めるかを示す結果を返します。
 *
 * @param {string} fileId - 移動するファイルのID。
 * @returns {object} 移動処理の結果。
 * - success: {boolean} ファイルの移動が成功した場合は true、それ以外は false。
 * - canProceedToNextStep: {boolean} 次の処理に進める場合は true、それ以外は false。
 * (今回は success と同じ値になりますが、将来的な拡張性を考慮して分けています。)
 */
function moveFileToOcrFolder(fileId) {
  const OCR_TARGET_FOLDER_ID = "1Z3iATGpHqPi51ZYXpvcanOdFq9pu8yjI"; // OCR処理対象フォルダのID

  try {
    const file = DriveApp.getFileById(fileId);
    const destinationFolder = DriveApp.getFolderById(OCR_TARGET_FOLDER_ID);

    file.moveTo(destinationFolder);

    // 成功時は success と canProceedToNextStep を true に設定
    return { success: true, canProceedToNextStep: true };
  } catch (error) {
    // エラー発生時は success と canProceedToNextStep を false に設定
    console.error(`ファイルの移動中にエラーが発生しました: ${error.message}`);
    return { success: false, canProceedToNextStep: false };
  }
}