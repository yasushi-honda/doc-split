/**
 * 指定されたパラメータに基づき、Gmailから添付ファイルを取得し、
 * 指定されたGoogleドライブのフォルダに保存します。
 * エラーフォルダ内に同名ファイルがある場合は、それをゴミ箱に移動します。
 *
 * @param {string} folderId       添付ファイルを保存するGoogleドライブのフォルダID。
 * @param {string} errorFolderId  エラーファイルを確認するフォルダID。
 * @param {string} fileName       取得したい添付ファイルの正確なファイル名。
 * @param {string} emailSubject   添付ファイルが含まれるメールの正確な件名。
 * @return {boolean}              処理が成功した場合は true、失敗した場合は false を返します。
 */
function saveAttachmentToDrive(folderId, errorFolderId, fileName, emailSubject) {
  // --- 1. パラメータ（引数）の検証 ---
  if (!folderId || !errorFolderId || !fileName || !emailSubject) {
    console.error("【エラー】folderId, errorFolderId, fileName, emailSubject のいずれかの引数が不足しています。");
    return false;
  }

  console.log('============================================================');
  console.log(' Gmail添付ファイルのドライブ保存処理を開始します');
  console.log('============================================================');
  console.log('【処理パラメータ】');
  console.log(`  保存先フォルダID: ${folderId}`);
  console.log(`  エラーフォルダID: ${errorFolderId}`);
  console.log(`  ファイル名: ${fileName}`);
  console.log(`  メール件名: ${emailSubject}`);
  console.log('------------------------------------------------------------');

  try {
    // --- 2. 検索先のGoogleドライブフォルダを取得 ---
    const folder = DriveApp.getFolderById(folderId);
    console.log(`  [OK] 保存先フォルダ「${folder.getName()}」を認識しました。`);

    const errorFolder = DriveApp.getFolderById(errorFolderId);
    console.log(`  [OK] エラーフォルダ「${errorFolder.getName()}」を認識しました。`);

    // --- 3. エラーフォルダ内で同名ファイルをチェック ---
    const filesInErrorFolder = errorFolder.getFilesByName(fileName);
    let trashedCount = 0;
    
    while (filesInErrorFolder.hasNext()) {
      const fileToTrash = filesInErrorFolder.next();
      fileToTrash.setTrashed(true);
      trashedCount++;
      console.log(`  [削除] エラーフォルダ内のファイル「${fileToTrash.getName()}」をゴミ箱に移動しました。`);
      console.log(`    ファイルID: ${fileToTrash.getId()}`);
    }
    
    if (trashedCount > 0) {
      console.log(`  [完了] ${trashedCount} 件のファイルをゴミ箱に移動しました。`);
    } else {
      console.log(`  [確認] エラーフォルダ内に「${fileName}」は見つかりませんでした。`);
    }
    console.log('------------------------------------------------------------');

    // --- 4. Gmailの検索クエリを構築（最も確実な方法） ---
    // 「件名」と「ファイル名」を完全に一致させ、迷惑メールやゴミ箱も含む全範囲を検索
    const query = `subject:"${emailSubject}" filename:"${fileName}" in:anywhere`;
    console.log(`  [検索クエリ] → ${query}`);

    // --- 5. Gmailを検索 ---
    const threads = GmailApp.search(query, 0, 2); // 念のため2件まで検索

    // --- 6. 検索結果を判定 ---
    if (threads.length === 0) {
      console.error("【エラー】条件に一致するメールが見つかりませんでした。件名やファイル名が正確か確認してください。");
      return false;
    }
    if (threads.length > 1) {
      console.warn("【警告】条件に一致するメールが複数見つかりました。最初の1件を処理しますが、意図しないファイルを取得する可能性があります。");
    }
    
    console.log(`  [検索結果] → ${threads.length} 件のスレッドがヒットしました。最初のスレッドを処理します。`);

    // --- 7. 添付ファイルを取得して保存 ---
    const message = threads[0].getMessages()[0]; // スレッド内の最初のメッセージを取得
    const attachments = message.getAttachments();

    let fileSaved = false;
    for (const attachment of attachments) {
      // 取得した添付ファイル名とパラメータのファイル名が一致するかを厳密にチェック
      if (attachment.getName() === fileName) {
        
        // ファイルをドライブに作成（保存）
        const savedFile = folder.createFile(attachment);
        
        console.log('------------------------------------------------------------');
        console.log('★★★ 処理成功 ★★★');
        console.log(`  ファイルを「${folder.getName()}」フォルダに保存しました。`);
        console.log(`  保存ファイル名: ${savedFile.getName()}`);
        console.log(`  ファイルURL: ${savedFile.getUrl()}`);
        console.log('============================================================');

        fileSaved = true;
        break; // 目的のファイルを保存したらループを抜ける
      }
    }

    if (!fileSaved) {
      console.error("【エラー】メールは見つかりましたが、指定されたファイル名の添付ファイルが含まれていませんでした。");
      return false;
    }
    
    return true; // 正常終了

  } catch (e) {
    console.error(`【致命的なエラー】処理中に予期せぬエラーが発生しました: ${e.message}`);
    console.error(`  [詳細] ${e.stack}`);
    console.log('============================================================');
    return false;
  }
}